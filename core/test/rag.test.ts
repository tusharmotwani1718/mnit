import { describe, expect, it } from "vitest";
import { createAgent, shouldRetrieve, type Chunk, type LlmTurnOutput, type Retriever, type TurnLlm } from "../src/agent/index.js";
import { buildUserMessage } from "../src/agent/llm.js";
import { FallbackRetriever, LocalSchemeRetriever } from "../src/agent/retriever.js";
import { loadEngine } from "../src/engine/index.js";
import { buildCorpus, chunkText, isMostlyDevanagari, normalise } from "../src/rag/corpus.js";
import { diversify, namedSchemes } from "../src/rag/store.js";
import { loadAliases } from "../src/rag/corpus.js";

const engine = loadEngine();

const chunk = (id: string, schemeId: string, tier: Chunk["tier"] = "tier1"): Chunk => ({
  id, schemeId, tier, title: `${schemeId} doc`, section: "official", text: `text of ${id}`, sourceUrl: `https://example.gov.in/${schemeId}`,
});

describe("corpus", () => {
  it("strips control characters but keeps all letters", () => {
    expect(normalise("FUND Disbursal\u0000 of\nDBT \uFFFD done")).toBe("FUND Disbursal of DBT done");
    expect(isMostlyDevanagari("पीएम किसान योजना")).toBe(true);
    expect(isMostlyDevanagari("PM-KISAN operational guidelines")).toBe(false);
  });

  it("chunks long PDF text into bounded, overlapping windows", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} explains a rule of the scheme.`).join("\n");
    const chunks = chunkText(text, 400, 80);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(400 + 80 + 60);
    // Overlap: the last sentence of one chunk starts the next.
    const lastOfFirst = chunks[0]!.split(". ").at(-1)!;
    expect(chunks[1]).toContain(lastOfFirst.replace(/\.$/, ""));
  });

  it("covers every rule scheme in hi/mr/en and the 20 RAG-only schemes", () => {
    const corpus = buildCorpus(engine.schemes);
    expect(new Set(corpus.map((c) => c.id)).size).toBe(corpus.length);
    for (const s of engine.schemes) {
      for (const lang of ["hi", "mr", "en"]) expect(corpus.some((c) => c.id === `${s.id}:summary:${lang}`)).toBe(true);
    }
    const extras = new Set(corpus.filter((c) => c.tier === "extra").map((c) => c.schemeId));
    expect(extras.size).toBe(20);
    expect(corpus.filter((c) => c.section === "official").length).toBeGreaterThan(100);
  });
});

describe("retrieval gating", () => {
  it("skips plain answers to the engine's questions, keeps real questions", () => {
    expect(shouldRetrieve("हाँ", { lastPrompt: "fact" })).toBe(false);
    expect(shouldRetrieve("तीस साल", { lastPrompt: "fact" })).toBe(false);
    expect(shouldRetrieve("पैसा कब आएगा", { lastPrompt: "fact" })).toBe(true);
    expect(shouldRetrieve("हो, किती पैसे मिळतात", { lastPrompt: "fact" })).toBe(true);
    expect(shouldRetrieve("मेरे पास दो एकड़ ज़मीन है और मैं महाराष्ट्र में रहता हूँ", { lastPrompt: "fact" })).toBe(true);
    expect(shouldRetrieve("ठीक है", { lastPrompt: "pick" })).toBe(true);
    expect(shouldRetrieve("", { lastPrompt: null })).toBe(false);
  });
});

describe("FallbackRetriever", () => {
  const local = new LocalSchemeRetriever(engine.schemes);
  it("falls back when the primary fails or is too slow", async () => {
    const failing: Retriever = { retrieve: async () => { throw new Error("db down"); } };
    const slow: Retriever = { retrieve: () => new Promise((r) => setTimeout(() => r([chunk("late", "pm-kisan")]), 200)) };
    const opts = { schemeIds: ["pm-kisan"], lang: "hi" as const };
    expect((await new FallbackRetriever(failing, local).retrieve("q", opts))[0]?.id).toBe("pm-kisan:local");
    expect((await new FallbackRetriever(slow, local, 20).retrieve("q", opts))[0]?.id).toBe("pm-kisan:local");
    const fast: Retriever = { retrieve: async () => [chunk("fast", "pmfby")] };
    expect((await new FallbackRetriever(fast, local).retrieve("q", opts))[0]?.id).toBe("fast");
  });
});

describe("RAG in a turn", () => {
  it("marks RAG-only passages, and traces which passages the answer cited", async () => {
    const retrieved = [chunk("pm-kisan.txt#3", "pm-kisan"), chunk("ladki-bahin:text:0", "ladki-bahin", "extra")];
    const retriever: Retriever = { retrieve: async () => retrieved };
    const inputs: Parameters<TurnLlm["turn"]>[0][] = [];
    const base: LlmTurnOutput = {
      facts: {}, landArea: null, language: "hi", switchLanguageTo: null, topics: [], intent: "ask_question", pickedSchemeId: null,
      otherPhoneNumber: null, scam: { detected: false, pattern: null }, answer: "नए पंजीकरण अभी बंद बताए जाते हैं।", sources: [2, 9], aboutSomeoneElse: false,
    };
    const llm: TurnLlm = { turn: async (input) => (inputs.push(input), base) };
    const agent = createAgent({ engine, llm, retriever });

    await agent.handleTurn("rag-1", "", "hi");
    const r = await agent.handleTurn("rag-1", "लाडकी बहीण का पैसा कब आएगा?");
    expect(r.replyText).toContain("नए पंजीकरण");
    expect(r.trace.rag?.retrieved.map((c) => c.id)).toEqual(["pm-kisan.txt#3", "ladki-bahin:text:0"]);
    expect(r.trace.rag?.used).toEqual([1]); // [9] is out of range and dropped

    const message = buildUserMessage(inputs[0]!);
    expect(message).toContain('[1] scheme="pm-kisan" rules="verified"');
    expect(message).toContain('[2] scheme="ladki-bahin" rules="none"');
  });
});

describe("hybrid search helpers", () => {
  it("finds schemes named in a query, in any script", () => {
    const aliases = loadAliases();
    expect(namedSchemes("पीएम किसान की किस्त कब आती है?", aliases)).toEqual(["pm-kisan"]);
    expect(namedSchemes("PM-Kisan kab aayega", aliases)).toEqual(["pm-kisan"]);
    expect(namedSchemes("लाडकी बहीण योजनेचे पैसे", aliases)).toEqual(["ladki-bahin"]);
    expect(namedSchemes("खेती के लिए पैसा", aliases)).toEqual([]);
  });

  it("keeps at most two passages per scheme", () => {
    const c = (id: string, schemeId: string): Chunk => ({ id, schemeId, tier: "tier1", title: "", section: "", text: "", sourceUrl: "" });
    const out = diversify([c("1", "a"), c("2", "a"), c("3", "a"), c("1", "a"), c("4", "b"), c("5", "c")], 4);
    expect(out.map((x) => x.id)).toEqual(["1", "2", "4", "5"]);
  });
});

describe("ungrounded answers", () => {
  const base: LlmTurnOutput = {
    facts: {}, landArea: null, language: "en", switchLanguageTo: null, topics: [], intent: "ask_question", pickedSchemeId: null,
    otherPhoneNumber: null, scam: { detected: false, pattern: null }, answer: "You'll get exact information at a CSC centre.", sources: [], aboutSomeoneElse: false,
  };
  const run = async (partial: Partial<LlmTurnOutput>) => {
    const llm: TurnLlm = { turn: async () => ({ ...base, ...partial }) };
    const agent = createAgent({ engine, llm, retriever: new LocalSchemeRetriever(engine.schemes) });
    await agent.handleTurn("u", "", "en");
    return agent.handleTurn("u", "want to know the schemes my son is eligible for as a student");
  };

  it("skips the 'ask at CSC' filler when the caller was describing their need", async () => {
    const r = await run({ topics: ["education"] });
    expect(r.replyText).not.toContain("CSC");
    expect(r.replyText).toContain("Which class or course");
  });

  it("doesn't let the LLM answer a need with schemes, even when grounded", async () => {
    const r = await run({ topics: ["education"], answer: "Your son may be eligible for the Central Sector Scholarship.", sources: [1] });
    expect(r.replyText).not.toContain("Central Sector");
    expect(r.replyText).toContain("Which class or course");
  });

  it("caps a grounded answer at two sentences", async () => {
    const r = await run({ answer: "One. Two. Three. Four.", sources: [1] });
    expect(r.replyText.startsWith("One. Two.")).toBe(true);
    expect(r.replyText).not.toContain("Three");
  });

  it("still says the CSC line for a real question it can't answer", async () => {
    const r = await run({});
    expect(r.replyText).toContain("CSC");
  });
});
