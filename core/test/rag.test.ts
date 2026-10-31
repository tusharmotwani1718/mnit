import { describe, expect, it } from "vitest";
import { createAgent, shouldRetrieve, type Chunk, type LlmTurnOutput, type Retriever, type TurnLlm } from "../src/agent/index.js";
import { buildUserMessage } from "../src/agent/llm.js";
import { FallbackRetriever, LocalSchemeRetriever } from "../src/agent/retriever.js";
import { loadEngine } from "../src/engine/index.js";
import { buildCorpus, chunkText } from "../src/rag/corpus.js";

const engine = loadEngine();

const chunk = (id: string, schemeId: string, tier: Chunk["tier"] = "tier1"): Chunk => ({
  id, schemeId, tier, title: `${schemeId} doc`, section: "official", text: `text of ${id}`, sourceUrl: `https://example.gov.in/${schemeId}`,
});

describe("corpus", () => {
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
      otherPhoneNumber: null, scam: { detected: false, pattern: null }, answer: "नए पंजीकरण अभी बंद बताए जाते हैं।", sources: [2, 9],
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
