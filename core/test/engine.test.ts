import { describe, expect, it } from "vitest";
import { applyDerivations, createEngine, loadEngine, toHectares } from "../src/engine/index.js";
import { checkRules } from "../src/engine/loader.js";
import type { Facts, Scheme, SchemeResult } from "../src/engine/index.js";

// Runs against the real data/ files, so these double as rule tests for the approved schemes.
const engine = loadEngine();
const status = (results: SchemeResult[], id: string) => results.find((r) => r.schemeId === id)!;

const mhFarmer: Facts = {
  state: "MH",
  ownsCultivableLand: true,
  familyPaysIncomeTax: false,
  familyHasGovtEmployeeOrPensioner: false,
};

describe("loading", () => {
  it("loads all 21 approved schemes with valid rules", () => {
    expect(engine.schemes).toHaveLength(21);
  });

  it("rejects unknown facts, assumptions on askable facts and bad enum values", () => {
    const problems = checkRules(
      {
        all: [
          { fact: "noSuchFact", op: "eq", value: true },
          { fact: "age", op: "gte", value: 18, assumeIfUnknown: true, caveat: { hi: "x", mr: "x", en: "x" } },
          { fact: "state", op: "eq", value: "Maharashtra" },
          { fact: "crop", op: "lte", value: 2 },
        ],
      },
      engine.facts,
    );
    expect(problems).toHaveLength(4);
  });
});

describe("derivations", () => {
  it("fills implied facts but never overrides a stated one", () => {
    expect(applyDerivations({ familyPaysIncomeTax: false }, engine.facts)).toMatchObject({ isIncomeTaxPayer: false });
    expect(applyDerivations({ isIncomeTaxPayer: true }, engine.facts)).toMatchObject({ familyPaysIncomeTax: true });
    expect(applyDerivations({ familyPaysIncomeTax: false, isIncomeTaxPayer: true }, engine.facts)).toMatchObject({
      familyPaysIncomeTax: false,
      isIncomeTaxPayer: true,
    });
  });
});

describe("farmer flow", () => {
  it("asks about land ownership first for farming, age first with no topic", () => {
    expect(engine.evaluate({}).next?.fact).toBe("age");
    expect(engine.evaluate({}, { topics: ["farming"] }).next?.fact).toBe("ownsCultivableLand");
  });

  it("gives PM-KISAN and Namo Shetkari after three answers, with caveats", () => {
    const { results } = engine.evaluate(mhFarmer);
    const kisan = status(results, "pm-kisan");
    expect(kisan.status).toBe("eligible");
    expect(kisan.caveats).toHaveLength(3);
    expect(status(results, "namo-shetkari").status).toBe("eligible");
    expect(status(results, "kcc").status).toBe("eligible");
    expect(status(results, "kcc").missingFacts).toEqual([]);
    expect(status(results, "pmfby").status).toBe("likely_eligible");
    expect(status(results, "pm-kmy").status).toBe("need_more_info");
  });

  it("drops Namo Shetkari outside Maharashtra", () => {
    const { results } = engine.evaluate({ ...mhFarmer, state: "OTHER" });
    expect(status(results, "namo-shetkari").status).toBe("not_eligible");
    expect(status(results, "pm-kisan").status).toBe("eligible");
  });

  it("uses a volunteered rare exclusion", () => {
    const { results } = engine.evaluate({ ...mhFarmer, familyHasPublicOffice: true });
    expect(status(results, "pm-kisan").status).toBe("not_eligible");
  });

  it("excludes on income tax and land size", () => {
    const tax = engine.evaluate({ ...mhFarmer, familyPaysIncomeTax: true }).results;
    expect(status(tax, "pm-kisan").status).toBe("not_eligible");
    const big = engine.evaluate({ ...mhFarmer, age: 30, hasOtherPensionScheme: false, landHectares: 3 }).results;
    expect(status(big, "pm-kmy").status).toBe("not_eligible");
    const small = engine.evaluate({ ...mhFarmer, age: 30, hasOtherPensionScheme: false, landHectares: 1.2 }).results;
    expect(status(small, "pm-kmy").status).toBe("eligible");
  });

  it("solar pump: an existing electric pump disqualifies", () => {
    const { results } = engine.evaluate({ ...mhFarmer, hasWaterSource: true, hasConventionalPump: true });
    expect(status(results, "magel-tyala-saur-pump").status).toBe("not_eligible");
  });
});

describe("non-askable facts", () => {
  it("PM-JAY: 70+ is eligible, otherwise likely (on the list, checked at CSC)", () => {
    expect(status(engine.evaluate({ age: 72 }).results, "pm-jay").status).toBe("eligible");
    expect(status(engine.evaluate({ age: 45 }).results, "pm-jay").status).toBe("likely_eligible");
  });

  it("PMMVY is never asked about and only opens when pregnancy is mentioned", () => {
    const woman: Facts = { gender: "female", isGovtEmployee: false, annualFamilyIncome: 200000 };
    expect(status(engine.evaluate(woman).results, "pmmvy").status).toBe("not_eligible");
    expect(status(engine.evaluate({ ...woman, isPregnantOrLactating: true }).results, "pmmvy").status).toBe(
      "likely_eligible",
    );
    for (let facts: Facts = {}, i = 0; i < 25; i++) {
      const { next } = engine.evaluate(facts);
      if (!next) break;
      expect(engine.facts[next.fact]?.askable).toBe(true);
      facts = { ...facts, [next.fact]: engine.facts[next.fact]?.type === "boolean" ? false : 1 };
    }
  });
});

describe("next question", () => {
  it("only counts schemes in the active topics", () => {
    const { next } = engine.evaluate({ ...mhFarmer, state: "OTHER" }, { topics: ["insurance"] });
    expect(next?.fact).toBe("age");
  });

  it("returns null when nothing in scope is open", () => {
    const tiny = createEngine(engine.facts, [
      { ...(engine.schemes[0] as Scheme), id: "t", topics: ["x"], rules: { fact: "age", op: "gte", value: 18 } },
    ]);
    expect(tiny.evaluate({ age: 20 }).next).toBeNull();
    expect(tiny.evaluate({}).next?.fact).toBe("age");
  });
});

describe("units", () => {
  it("converts acre and guntha, refuses bigha", () => {
    expect(toHectares(3, "acre")).toBeCloseTo(1.214, 3);
    expect(toHectares(40, "guntha")).toBeCloseTo(toHectares(1, "acre")!, 3);
    expect(toHectares(3, "bigha", "MH")).toBeNull();
  });
});

describe("rural, welfare and student schemes", () => {
  it("never asks topic-gated facts (caste, student, work) without that topic", () => {
    const asked = new Set<string>();
    let facts: Record<string, string | number | boolean> = {};
    for (let i = 0; i < 30; i++) {
      const next = engine.evaluate(facts).next;
      if (!next) break;
      asked.add(next.fact);
      facts = { ...facts, [next.fact]: engine.facts[next.fact]!.type === "number" ? 30 : engine.facts[next.fact]!.values?.[0] ?? false };
    }
    for (const f of ["socialCategory", "studentLevel", "studentInGovtSchool", "willingManualWork", "hasPfOrEsic", "isWidowOrSingleWoman"]) {
      expect(asked.has(f)).toBe(false);
    }
  });

  it("asks the student's level first on the education topic", () => {
    expect(engine.evaluate({}, { topics: ["education"] }).next?.fact).toBe("studentLevel");
  });

  it("scholarships follow category, level and income", () => {
    const open = engine.evaluate({ state: "MH", studentLevel: "degree", socialCategory: "GEN", annualFamilyIncome: 300000 }).results;
    expect(status(open, "shahu-fee").status).toBe("likely_eligible");
    expect(status(open, "csss").status).toBe("likely_eligible");
    expect(status(open, "pms-sc").status).toBe("not_eligible");
    expect(status(open, "nmms").status).toBe("not_eligible");

    const sc = engine.evaluate({ state: "MH", studentLevel: "class11to12", socialCategory: "SC", annualFamilyIncome: 200000 }).results;
    expect(status(sc, "pms-sc").status).toBe("eligible");
    expect(status(sc, "shahu-fee").status).toBe("not_eligible");

    const school = engine.evaluate({ studentLevel: "class8", studentInGovtSchool: true, annualFamilyIncome: 120000 }).results;
    expect(status(school, "nmms").status).toBe("likely_eligible");
  });

  it("job guarantee and e-Shram for a rural worker", () => {
    const r = engine.evaluate({ residence: "rural", age: 35, willingManualWork: true, hasPfOrEsic: false, isIncomeTaxPayer: false, isGovtEmployee: false }).results;
    expect(status(r, "vb-g-ram-g").status).toBe("eligible");
    expect(status(r, "e-shram").status).toBe("eligible");
    expect(status(engine.evaluate({ age: 35, hasPfOrEsic: true }).results, "e-shram").status).toBe("not_eligible");
  });

  it("widow pension under 65, old-age pension from 65", () => {
    const widow = engine.evaluate({ state: "MH", gender: "female", age: 45, isWidowOrSingleWoman: true, annualFamilyIncome: 20000 }).results;
    expect(status(widow, "sgnay").status).toBe("eligible");
    expect(status(widow, "shravanbal").status).toBe("not_eligible");
    // A man who doesn't mention a disability is not offered the widow/disability pension.
    const man = engine.evaluate({ state: "MH", gender: "male", age: 45, annualFamilyIncome: 20000 }).results;
    expect(status(man, "sgnay").status).toBe("not_eligible");
    const elder = engine.evaluate({ state: "MH", age: 70, annualFamilyIncome: 18000 }).results;
    expect(status(elder, "shravanbal").status).toBe("eligible");
  });
});
