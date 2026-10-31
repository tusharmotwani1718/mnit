import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryAccountStore } from "../src/account/store.js";
import { createToken } from "../src/account/token.js";
import { createAgent } from "../src/agent/index.js";
import { LocalSchemeRetriever } from "../src/agent/retriever.js";
import { evaluateScheme, idealFacts, loadEngine, NOT_ELIGIBLE_CAP, readiness } from "../src/engine/index.js";
import { createApp } from "../src/server.js";

const engine = loadEngine();
const scheme = (id: string) => engine.schemes.find((s) => s.id === id)!;
const allDocs = (id: string) => scheme(id).documents.map((d) => d.en);

describe("ideal applicant", () => {
  it("meets every scheme's rules", () => {
    for (const s of engine.schemes) {
      const status = evaluateScheme(s, idealFacts(s), engine.facts).status;
      expect(["eligible", "likely_eligible"], `${s.id} → ${status}`).toContain(status);
    }
  });

  it("uses sensible values inside the limits", () => {
    expect(idealFacts(scheme("apy")).age).toBe(29); // 18–40
    expect(idealFacts(scheme("vb-g-ram-g")).age).toBe(28); // 18 or older
    expect(idealFacts(scheme("shravanbal")).age).toBe(68); // 65 or older
    for (const s of engine.schemes) {
      const age = idealFacts(s).age;
      if (age !== undefined) expect(Number.isInteger(age)).toBe(true);
    }
  });

  it("scores well itself, with a name and gender that fit", () => {
    const r = readiness(scheme("pmmvy"), {}, [], engine.facts);
    expect(r.ideal.gender).toBe("female");
    expect(r.ideal.score).toBeGreaterThanOrEqual(80);
    expect(readiness(scheme("apy"), {}, [], engine.facts).ideal.score).toBe(100);
  });
});

describe("readiness score", () => {
  const apyFacts = { age: 30, isIncomeTaxPayer: false, hasBankAccount: true };

  it("is 100 when every condition is met and every document is ready", () => {
    const r = readiness(scheme("apy"), apyFacts, allDocs("apy"), engine.facts);
    expect(r).toMatchObject({ score: 100, band: "ready", status: "eligible", points: { conditions: 60, documents: 30, bank: 10 } });
  });

  it("drops with missing documents and unanswered conditions, and says which", () => {
    const docs = readiness(scheme("apy"), apyFacts, [], engine.facts);
    expect(docs.score).toBe(70);
    expect(docs.band).toBe("almost");
    expect(docs.documents.every((d) => !d.have)).toBe(true);

    const unknown = readiness(scheme("apy"), { age: 30 }, [], engine.facts);
    expect(unknown.band).toBe("missing_info");
    expect(unknown.rows.flatMap((r) => r.missing)).toEqual(expect.arrayContaining(["hasBankAccount", "isIncomeTaxPayer"]));
  });

  it("caps the score when a condition fails, however much else is ready", () => {
    const r = readiness(scheme("apy"), { ...apyFacts, age: 55 }, allDocs("apy"), engine.facts);
    expect(r.score).toBe(NOT_ELIGIBLE_CAP);
    expect(r.band).toBe("not_eligible");
    expect(r.rows.find((row) => row.result === false)).toBeTruthy();
  });

  it("gives half points for an office check or an assumed rare exclusion", () => {
    const r = readiness(scheme("pm-kisan"), { ownsCultivableLand: true, familyPaysIncomeTax: false, familyHasGovtEmployeeOrPensioner: false }, [], engine.facts);
    const assumed = r.rows.filter((row) => row.partial);
    expect(assumed.length).toBeGreaterThan(0);
    for (const row of assumed) expect(row.points).toBeCloseTo(row.max / 2);
  });

  it("keeps an 'any' group as one row with its options", () => {
    const r = readiness(scheme("pm-jay"), { age: 72 }, [], engine.facts);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.options.length).toBe(3);
    expect(r.rows[0]!.result).toBe(true);
  });
});

describe("POST /schemes/:id/readiness", () => {
  const SECRET = "test-secret-test-secret-test-secret";
  const PHONE = "+919876543210";
  const store = new MemoryAccountStore();
  const agent = createAgent({ engine, retriever: new LocalSchemeRetriever(engine.schemes), llm: { turn: async () => { throw new Error("unused"); } } });
  const server = createApp(agent, { accounts: { store, secret: SECRET } }).listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => void server.close());

  const post = async (id: string, body: unknown, token?: string) => {
    const res = await fetch(`${url}/schemes/${id}/readiness`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-user-token": token } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("scores a guest from the facts and documents sent", async () => {
    const r = await post("apy", { facts: { age: 30, isIncomeTaxPayer: false, hasBankAccount: true }, documents: allDocs("apy") });
    expect(r.body).toMatchObject({ score: 100, band: "ready", saved: false });
    expect((await post("nope", {})).status).toBe(404);
  });

  it("uses and updates a consented profile; documents are shared across schemes", async () => {
    const now = new Date().toISOString();
    await store.saveProfile({
      phone: PHONE, name: null, lang: "hi", facts: { age: 30 }, documents: ["Class 12 marksheet"], consentAt: now, passwordHash: null, createdAt: now, updatedAt: now,
    });
    const token = createToken(PHONE, SECRET);
    const first = await post("apy", {}, token);
    expect((first.body.known as Record<string, unknown>).age).toBe(30);

    await post("apy", { facts: { isIncomeTaxPayer: false, hasBankAccount: true }, documents: [allDocs("apy")[0]!] }, token);
    const saved = await store.getProfile(PHONE);
    expect(saved!.facts).toMatchObject({ age: 30, isIncomeTaxPayer: false, hasBankAccount: true });
    // A document from another scheme (CSSS) is kept; the APY document is added.
    expect(saved!.documents).toEqual(expect.arrayContaining(["Class 12 marksheet", allDocs("apy")[0]!]));
  });
});
