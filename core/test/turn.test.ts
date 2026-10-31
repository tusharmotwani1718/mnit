import { describe, expect, it } from "vitest";
import { createAgent, type LlmTurnInput, type LlmTurnOutput, type TurnLlm } from "../src/agent/index.js";
import { buildOutputSchema } from "../src/agent/llm.js";
import { LocalSchemeRetriever } from "../src/agent/retriever.js";
import { detectScamKeywords } from "../src/agent/scam.js";
import { markerLanguage } from "../src/agent/language.js";
import { loadEngine } from "../src/engine/index.js";

const engine = loadEngine();

const base = (): LlmTurnOutput => ({
  facts: {},
  landArea: null,
  language: "hi",
  switchLanguageTo: null,
  topics: [],
  intent: "give_info",
  pickedSchemeId: null,
  otherPhoneNumber: null,
  scam: { detected: false, pattern: null },
  answer: null,
  sources: [],
  aboutSomeoneElse: false,
});

type Script = Record<string, Partial<LlmTurnOutput> | ((input: LlmTurnInput) => Partial<LlmTurnOutput>)>;

/** Fake LLM: each user message maps to a partial output (or a function of the input); records inputs. */
class ScriptedLlm implements TurnLlm {
  inputs: LlmTurnInput[] = [];
  constructor(private script: Script) {}
  async turn(input: LlmTurnInput) {
    this.inputs.push(input);
    const entry = this.script[input.userText];
    const partial = typeof entry === "function" ? entry(input) : (entry ?? { intent: "other" as const });
    return { ...base(), ...partial };
  }
}

function agentWith(script: Script) {
  const llm = new ScriptedLlm(script);
  const agent = createAgent({ engine, llm, retriever: new LocalSchemeRetriever(engine.schemes) });
  return { agent, llm };
}

describe("handleTurn: farmer call", () => {
  it("greets, asks only what's missing, speaks results, details, consent, checklist", async () => {
    const { agent, llm } = agentWith({
      "मेरे पास ज़मीन है, कोई योजना है क्या?": { topics: ["farming"], facts: { ownsCultivableLand: true } },
      "महाराष्ट्र": { facts: { state: "MH" } },
      // A bare "no" answers whatever question is pending, as the real LLM is instructed to do.
      "नहीं": (input) => ({ intent: "no", facts: { [input.pendingQuestion!.fact]: false } }),
      "तीस साल": { facts: { age: 30 } },
      "पीएम किसान": { intent: "pick_scheme", pickedSchemeId: "pm-kisan" },
      "पैसा कब आएगा?": { intent: "ask_question", answer: "साल में तीन किस्तें आती हैं।", sources: [1] },
      "बस": { intent: "done" },
      "हाँ": { intent: "yes" },
    });
    const id = "call-1";
    const say = async (t: string) => agent.handleTurn(id, t, "hi", { callerNumber: "+919876543210" });

    const greet = await say("");
    expect(greet.replyText).toContain("योजना दर्शक");

    let r = await say("मेरे पास ज़मीन है, कोई योजना है क्या?");
    expect(r.trace.topics).toEqual(["farming"]);
    expect(r.trace.next?.fact).toBe("state");
    expect(r.replyText).toContain("राज्य");

    r = await say("महाराष्ट्र");
    expect(r.trace.next?.fact).toBe("familyPaysIncomeTax");

    r = await say("नहीं");
    expect(llm.inputs.at(-1)?.pendingQuestion?.fact).toBe("familyPaysIncomeTax");
    expect(r.trace.facts.isIncomeTaxPayer).toBe(false); // derived
    expect(r.trace.next?.fact).toBe("familyHasGovtEmployeeOrPensioner");

    r = await say("नहीं");
    const kisan = r.trace.results.find((x) => x.schemeId === "pm-kisan")!;
    expect(kisan.status).toBe("eligible");

    // Keep answering until results are spoken (stopping rule caps the questions).
    for (let i = 0; i < 6 && r.trace.state === "collecting"; i++) r = await say("तीस साल");
    expect(r.trace.state).toBe("results");
    expect(r.trace.questionsAsked).toBeLessThanOrEqual(5);
    expect(r.replyText).toContain("पीएम किसान");
    expect(r.replyText).toContain("नमो शेतकरी");

    r = await say("पीएम किसान");
    expect(r.trace.state).toBe("details");
    expect(r.replyText).toContain("आधार कार्ड");
    expect(r.replyText).toContain("सीएससी");

    r = await say("पैसा कब आएगा?");
    expect(r.replyText).toContain("तीन किस्तें");
    expect(llm.inputs.at(-1)?.chunks.map((c) => c.schemeId)).toEqual(["pm-kisan"]);

    r = await say("बस");
    expect(r.trace.state).toBe("consent");

    r = await say("हाँ");
    expect(r.done).toBe(true);
    expect(r.actions).toContainEqual({ type: "SEND_CHECKLIST", to: "+919876543210", schemeIds: ["pm-kisan"], lang: "hi" });
    expect(r.replyText).toContain("मुफ़्त");
  });
});

describe("handleTurn: English test mode", () => {
  it("runs the whole flow in English and never auto-switches", async () => {
    const { agent } = agentWith({
      "I have land, any scheme?": { language: "en", topics: ["farming"], facts: { ownsCultivableLand: true } },
      "Maharashtra": { language: "en", facts: { state: "MH" } },
      "no": (input) => ({ language: "en", intent: "no", facts: { [input.pendingQuestion!.fact]: false } }),
      "माझ्याकडे शेती आहे": { language: "mr" },
      "PM-KISAN": { language: "en", intent: "pick_scheme", pickedSchemeId: "pm-kisan" },
    });
    const greet = await agent.handleTurn("e", "", "en");
    expect(greet.replyText).toContain("Welcome to Yojana Darshak");
    let r = await agent.handleTurn("e", "I have land, any scheme?", "en");
    expect(r.replyText).toBe("Which state do you live in?");
    r = await agent.handleTurn("e", "माझ्याकडे शेती आहे", "en");
    expect(r.trace.lang).toBe("en");
    await agent.handleTurn("e", "Maharashtra", "en");
    for (let i = 0; i < 6 && r.trace.state === "collecting"; i++) r = await agent.handleTurn("e", "no", "en");
    expect(r.replyText).toContain("You are eligible for these schemes.");
    expect(r.replyText).toContain("PM-KISAN");
    r = await agent.handleTurn("e", "PM-KISAN", "en");
    expect(r.replyText).toContain("For this, take your Aadhaar card");
    expect(r.replyText).toContain("to your nearest CSC centre");
  });
});

describe("handleTurn: scam, language, robustness", () => {
  it("warns and logs a scam report once per pattern, without derailing the flow", async () => {
    const { agent } = agentWith({ "एक आदमी रजिस्ट्रेशन के लिए 500 रुपये माँग रहा है": { intent: "other" } });
    await agent.handleTurn("s", "", "hi");
    const r1 = await agent.handleTurn("s", "एक आदमी रजिस्ट्रेशन के लिए 500 रुपये माँग रहा है", "hi");
    expect(r1.replyText).toContain("सावधान");
    expect(r1.actions).toContainEqual({ type: "LOG_SCAM_REPORT", pattern: "fee_request" });
    const r2 = await agent.handleTurn("s", "एक आदमी रजिस्ट्रेशन के लिए 500 रुपये माँग रहा है", "hi");
    expect(r2.actions.filter((a) => a.type === "LOG_SCAM_REPORT")).toHaveLength(0);
  });

  it("switches to Marathi only when markers and the LLM agree", async () => {
    const mr = "माझ्याकडे तीन एकर शेती आहे, काय योजना मिळेल?";
    const { agent } = agentWith({
      [mr]: { language: "mr", topics: ["farming"], facts: { ownsCultivableLand: true }, landArea: { value: 3, unit: "acre" } },
      "मेरे पास ज़मीन है": { language: "mr", facts: { ownsCultivableLand: true } },
    });
    await agent.handleTurn("m", "", "hi");
    const disagree = await agent.handleTurn("m", "मेरे पास ज़मीन है", "hi");
    expect(disagree.trace.lang).toBe("hi");

    await agent.handleTurn("m2", "", "hi");
    const r = await agent.handleTurn("m2", mr, "hi");
    expect(r.actions).toContainEqual({ type: "SET_LANGUAGE", lang: "mr" });
    expect(r.trace.lang).toBe("mr");
    expect(r.replyText).toContain("मराठीत");
    expect(r.trace.facts.landHectares).toBeCloseTo(1.214, 2);
    expect(r.replyText).toContain("तुम्ही कोणत्या राज्यात राहता?");
  });

  it("recovers from an LLM failure by repeating the question", async () => {
    const agent = createAgent({
      engine,
      llm: { turn: async () => Promise.reject(new Error("timeout")) },
      retriever: new LocalSchemeRetriever(engine.schemes),
    });
    await agent.handleTurn("f", "", "hi");
    const r = await agent.handleTurn("f", "हैलो", "hi");
    expect(r.replyText).toContain("माफ़");
    expect(r.done).toBe(false);
  });

  it("offers other topics when nothing in scope matches", async () => {
    const { agent } = agentWith({
      "घर चाहिए": { topics: ["housing"] },
      "शहर में": { facts: { residence: "urban" } },
      "हाँ": { intent: "yes" },
    });
    await agent.handleTurn("h", "", "hi");
    await agent.handleTurn("h", "घर चाहिए", "hi");
    const r = await agent.handleTurn("h", "शहर में", "hi");
    expect(r.trace.state).toBe("results");
    expect(r.replyText).toContain("बीमा");
    const r2 = await agent.handleTurn("h", "हाँ", "hi");
    expect(r2.trace.topics).toEqual([]);
    expect(r2.trace.state).toBe("collecting");
  });
});

describe("helpers", () => {
  it("scam keywords", () => {
    expect(detectScamKeywords("वो ओटीपी माँग रहा था")).toBe("otp_request");
    expect(detectScamKeywords("दलाल बोला 1000 दो")).toBe("agent_registration");
    expect(detectScamKeywords("पीएम किसान में कितने पैसे मिलते हैं")).toBeNull();
  });

  it("marker language", () => {
    expect(markerLanguage("माझ्याकडे शेती आहे")).toBe("mr");
    expect(markerLanguage("मेरे पास खेती है")).toBe("hi");
    expect(markerLanguage("PM Kisan")).toBeNull();
  });

  it("output schema is strict-mode valid: every object lists all properties as required", () => {
    const schema = buildOutputSchema(engine.facts, engine.schemes.map((s) => s.id));
    const check = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.properties) {
        expect(n.additionalProperties).toBe(false);
        expect(new Set(n.required as string[])).toEqual(new Set(Object.keys(n.properties as object)));
      }
      Object.values(n).forEach(check);
    };
    check(schema);
  });
});

describe("handleTurn: volunteered facts", () => {
  it("doesn't apologise when the caller answers with a different fact than the one asked", async () => {
    const { agent } = agentWith({
      "scholarship for my son": { topics: ["education"] },
      "engineering in Maharashtra": { facts: { studentLevel: "degree", state: "MH" } },
      "we are general category": { facts: { socialCategory: "GEN" } },
      "hmm": { intent: "other" },
    });
    const say = (t: string) => agent.handleTurn("vol-1", t, "en");
    await say("");
    await say("scholarship for my son");
    const asked = await say("engineering in Maharashtra");
    expect(asked.trace.next?.fact).toBe("annualFamilyIncome");
    const volunteered = await say("we are general category");
    expect(volunteered.replyText).not.toContain("Sorry");
    expect(volunteered.replyText).toContain("earn in a year");
    const nothing = await say("hmm");
    expect(nothing.replyText).toContain("Sorry");
  });
});

describe("handleTurn: checking other kinds of schemes", () => {
  it("widens to all topics when the caller says yes, even if understood as 'want more'", async () => {
    const { agent } = agentWith({
      "scholarship for my son": { topics: ["education"] },
      "class 9": { facts: { studentLevel: "class9to10" } },
      "yes show more": { intent: "want_more" },
    });
    const say = (t: string) => agent.handleTurn("widen-1", t, "en");
    await say("");
    await say("scholarship for my son");
    const none = await say("class 9");
    expect(none.replyText).toContain("other kinds of schemes");
    const widened = await say("yes show more");
    expect(widened.trace.topics).toEqual([]);
    expect(widened.trace.state).toBe("collecting");
    expect(widened.replyText).not.toContain("other kinds of schemes");
  });
});

describe("handleTurn: facts about someone else", () => {
  it("ignores personal facts from a message about another person, keeps family and student facts", async () => {
    const { agent } = agentWith({
      "he is 15": { facts: { age: 15 }, aboutSomeoneElse: true },
      "my son is in class 9, we earn 2 lakh": { facts: { studentLevel: "class9to10", annualFamilyIncome: 200000 }, aboutSomeoneElse: true },
      "I am 42": { facts: { age: 42 } },
    });
    const say = (t: string) => agent.handleTurn("else-1", t, "en");
    await say("");
    const someoneElse = await say("he is 15");
    expect(someoneElse.trace.facts.age).toBeUndefined();
    const family = await say("my son is in class 9, we earn 2 lakh");
    expect(family.trace.facts).toMatchObject({ studentLevel: "class9to10", annualFamilyIncome: 200000 });
    expect((await say("I am 42")).trace.facts.age).toBe(42);
  });
});

describe("handleTurn: after scheme details", () => {
  it("'no' ends the conversation even if the LLM repeats the scheme under discussion", async () => {
    const { agent } = agentWith({
      "मेरे पास ज़मीन है": { topics: ["farming"], facts: { ownsCultivableLand: true, state: "MH" } },
      "नहीं": (input) => ({ intent: "no", facts: input.pendingQuestion ? { [input.pendingQuestion.fact]: false } : {}, pickedSchemeId: input.selectedSchemeId }),
      "तीस साल": { facts: { age: 30 } },
      "पीएम किसान": { intent: "pick_scheme", pickedSchemeId: "pm-kisan" },
    });
    const say = (t: string) => agent.handleTurn("loop-1", t, "hi", { callerNumber: "+919876543210" });
    await say("");
    let r = await say("मेरे पास ज़मीन है");
    for (let i = 0; i < 6 && r.trace.state === "collecting"; i++) r = await say(r.trace.next?.fact === "age" ? "तीस साल" : "नहीं");
    expect(r.trace.state).toBe("results");
    expect((await say("पीएम किसान")).trace.state).toBe("details");
    const after = await say("नहीं");
    expect(after.trace.state).toBe("consent");
  });
});

describe("handleTurn: coming back to a topic", () => {
  it("narrows to the caller's topic again after widening", async () => {
    const { agent } = agentWith({
      "scholarship for my son": { topics: ["education"] },
      "class 9": { facts: { studentLevel: "class9to10" } },
      "yes": { intent: "yes" },
      "actually schemes for my son's studies": { topics: ["education"], aboutSomeoneElse: true },
    });
    const say = (t: string) => agent.handleTurn("topic-1", t, "en");
    await say("");
    await say("scholarship for my son");
    await say("class 9");
    expect((await say("yes")).trace.topics).toEqual([]);
    const back = await say("actually schemes for my son's studies");
    expect(back.trace.topics).toEqual(["education"]);
  });
});

describe("handleTurn: student level", () => {
  it("doesn't take a class from an age, but does from a class word or an answer to the class question", async () => {
    const { agent } = agentWith({
      "schemes for my 12 year old son": { topics: ["education"], facts: { studentLevel: "class9to10" }, aboutSomeoneElse: true },
      "9": { facts: { studentLevel: "class9to10" } },
    });
    const say = (t: string) => agent.handleTurn("lvl-1", t, "en");
    await say("");
    const r = await say("schemes for my 12 year old son");
    expect(r.trace.facts.studentLevel).toBeUndefined();
    expect(r.trace.next?.fact).toBe("studentLevel");
    expect((await say("9")).trace.facts.studentLevel).toBe("class9to10");
  });
});
