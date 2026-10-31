import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { createAgent, type LlmTurnOutput } from "../src/agent/index.js";
import { LocalSchemeRetriever } from "../src/agent/retriever.js";
import { loadEngine } from "../src/engine/index.js";
import { createApp } from "../src/server.js";

const engine = loadEngine();
const output = (o: Partial<LlmTurnOutput>): LlmTurnOutput => ({
  facts: {}, landArea: null, language: "en", switchLanguageTo: null, topics: [], intent: "give_info",
  pickedSchemeId: null, otherPhoneNumber: null, scam: { detected: false, pattern: null }, answer: null, sources: [], ...o,
});

function start(apiKey?: string, liveToken?: string) {
  const agent = createAgent({
    engine,
    retriever: new LocalSchemeRetriever(engine.schemes),
    llm: {
      turn: async (i) => {
        if (i.userText === "boom") throw new Error("llm down");
        return output({ topics: ["farming"], facts: { ownsCultivableLand: true } });
      },
    },
  });
  const server: Server = createApp(agent, { apiKey, liveToken }).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { server, base, post, agent };
}

describe("HTTP server", () => {
  const open = start();
  const locked = start("s3cret");
  afterAll(() => {
    open.server.close();
    locked.server.close();
  });

  it("GET /health", async () => {
    expect(await (await fetch(`${open.base}/health`)).json()).toEqual({ ok: true });
  });

  it("POST /turn: greeting, then a turn, with trace", async () => {
    const greet = await (await open.post("/turn", { sessionId: "a", text: "", lang: "en", callerNumber: "+91999" })).json();
    expect(greet.replyText).toContain("Welcome to Yojana Darshak");
    expect(greet.done).toBe(false);

    const res = await open.post("/turn", { sessionId: "a", text: "I have land" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replyText).toBe("Which state do you live in?");
    expect(body.trace.facts.ownsCultivableLand).toBe(true);
    expect(body.trace.results).toHaveLength(21);
  });

  it("rejects bad input", async () => {
    expect((await open.post("/turn", { text: "hi" })).status).toBe(400);
    expect((await open.post("/turn", { sessionId: "a", lang: "ta" })).status).toBe(400);
    const badJson = await fetch(`${open.base}/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(badJson.status).toBe(400);
    expect((await open.post("/turn", { sessionId: "a", text: "x".repeat(20000) })).status).toBe(413);
  });

  it("an LLM failure still returns 200 with a retry prompt", async () => {
    await open.post("/turn", { sessionId: "b", text: "", lang: "en" });
    const res = await open.post("/turn", { sessionId: "b", text: "boom" });
    expect(res.status).toBe(200);
    expect((await res.json()).replyText).toContain("Sorry");
  });

  it("POST /sessions/:id/language switches and repeats the pending question", async () => {
    await open.post("/turn", { sessionId: "l", text: "", lang: "hi" });
    await open.post("/turn", { sessionId: "l", text: "मेरे पास ज़मीन है" }); // pending: state
    const res = await (await open.post("/sessions/l/language", { lang: "mr" })).json();
    expect(res.actions).toEqual([{ type: "SET_LANGUAGE", lang: "mr" }]);
    expect(res.replyText).toBe("ठीक आहे, आता मराठीत बोलूया. तुम्ही कोणत्या राज्यात राहता?");
    expect(res.trace.lang).toBe("mr");
    expect((await open.post("/sessions/nope/language", { lang: "mr" })).status).toBe(404);
    expect((await open.post("/sessions/l/language", { lang: "ta" })).status).toBe(400);
  });

  it("POST /sessions/:id/end clears the session", async () => {
    await open.post("/turn", { sessionId: "c", text: "" });
    expect(await (await open.post("/sessions/c/end", {})).json()).toEqual({ ended: true });
    expect(open.agent.store.get("c")).toBeUndefined();
    expect(await (await open.post("/sessions/c/end", {})).json()).toEqual({ ended: false });
  });

  it("live panel: SSE sends a snapshot, then every turn and the hang-up, with the number masked", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${open.base}/live/events`, { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const next = async (): Promise<any> => {
      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (chunk.startsWith("data: ")) return JSON.parse(chunk.slice(6));
          continue;
        }
        const { value } = await reader.read();
        buffer += decoder.decode(value, { stream: true });
      }
    };

    expect((await next()).type).toBe("snapshot");
    await open.post("/turn", { sessionId: "live-1", text: "", lang: "en", callerNumber: "+919876543210", channel: "phone" });
    const greet = await next();
    expect(greet.type).toBe("turn");
    expect(greet.session).toMatchObject({ sessionId: "live-1", channel: "phone", caller: "+91••••••3210", ended: false });
    expect(greet.turn.trace.results).toHaveLength(21);

    await open.post("/turn", { sessionId: "live-1", text: "I have land" });
    const turn = await next();
    expect(turn.turn.userText).toBe("I have land");
    expect(turn.turn.trace.next.fact).toBe("state");

    await open.post("/sessions/live-1/end", {});
    expect(await next()).toMatchObject({ type: "ended", sessionId: "live-1" });
    ctrl.abort();

    const snapshot = await (await fetch(`${open.base}/live/sessions`)).json();
    const s = snapshot.find((x: { sessionId: string }) => x.sessionId === "live-1");
    expect(s.turns).toHaveLength(2);
    expect(s.ended).toBe(true);
  });

  it("live panel: meta lists schemes and fact labels; token enforced when set", async () => {
    const meta = await (await fetch(`${open.base}/live/meta`)).json();
    expect(meta.schemes).toHaveLength(21);
    expect(meta.facts.state.label).toBe("Which state do you live in?");

    const guarded = start(undefined, "view-token");
    try {
      expect((await fetch(`${guarded.base}/live/sessions`)).status).toBe(401);
      expect((await fetch(`${guarded.base}/live/sessions?token=wrong`)).status).toBe(401);
      expect((await fetch(`${guarded.base}/live/sessions?token=view-token`)).status).toBe(200);
    } finally {
      guarded.server.close();
    }
  });

  it("requires the bearer key when configured, but /health stays open", async () => {
    expect((await fetch(`${locked.base}/health`)).status).toBe(200);
    expect((await locked.post("/turn", { sessionId: "d", text: "" })).status).toBe(401);
    expect((await locked.post("/turn", { sessionId: "d", text: "" }, { authorization: "Bearer wrong!" })).status).toBe(401);
    expect((await locked.post("/turn", { sessionId: "d", text: "" }, { authorization: "Bearer s3cret" })).status).toBe(200);
  });
});
