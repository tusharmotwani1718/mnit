import { toHectares, type Engine, type Evaluation, type Lang, type Scheme, type SchemeResult } from "../engine/index.js";
import { composeDetails, composeSchemeList, moreText, text } from "./composer.js";
import { decideLanguage } from "./language.js";
import type { LlmTurnOutput, TurnLlm } from "./llm.js";
import type { Retriever } from "./retriever.js";
import { detectScamKeywords } from "./scam.js";
import { SessionStore } from "./session.js";
import { toIndianMobile } from "../sms/number.js";
import type { Action, RagTrace, Session, Topic, TurnMeta, TurnResult } from "./types.js";
import type { Chunk } from "./retriever.js";

/** Stopping rule (spec 6.4.4): speak results after this many questions in a topic round. */
export const MAX_QUESTIONS = 5;
/** Schemes spoken per batch (spec 4.3: never read a long list). */
export const BATCH = 2;
const HISTORY_TURNS = 6;
const PREVIEW_CHARS = 220;

// Question words in Hindi, Marathi and English: a short reply containing one still gets retrieval.
const QUESTION_WORDS =
  /[?]|क्या|कब|कैसे|कितन|कौन|कहाँ|कहां|क्यों|काय|कधी|कसे|कसा|कशी|किती|कोण|कुठे|\b(what|when|how|which|where|why|who)\b/i;

/** Skip retrieval for plain answers to the engine's own questions ("हाँ", "तीस साल"): saves an embedding call. */
export function shouldRetrieve(userText: string, s: Pick<Session, "lastPrompt">): boolean {
  const text = userText.trim();
  if (!text) return false;
  if (s.lastPrompt === "fact" || s.lastPrompt === "consent") return text.split(/\s+/).length > 4 || QUESTION_WORDS.test(text);
  return true;
}

function ragTrace(chunks: Chunk[], sources: number[]): RagTrace {
  return {
    retrieved: chunks.map((c) => ({
      id: c.id,
      schemeId: c.schemeId,
      tier: c.tier,
      title: c.title,
      section: c.section,
      sourceUrl: c.sourceUrl,
      score: c.score ?? null,
      preview: c.text.length > PREVIEW_CHARS ? `${c.text.slice(0, PREVIEW_CHARS)}…` : c.text,
    })),
    used: [...new Set(sources.map((n) => n - 1).filter((i) => i >= 0 && i < chunks.length))],
  };
}

// Speaking order among schemes with the same status: biggest, most common benefits first.
const SPEAK_ORDER = [
  "pm-kisan", "namo-shetkari", "pmfby", "kcc", "pm-kmy", "magel-tyala-saur-pump",
  "pm-jay", "pmay-g", "pmuy", "pmmvy", "pmsby", "pmjjby", "apy",
  "vb-g-ram-g", "e-shram", "sgnay", "shravanbal",
  "pms-sc", "shahu-fee", "csss", "nmms",
];

export type Agent = {
  handleTurn(sessionId: string, userText: string, lang?: Lang, meta?: TurnMeta): Promise<TurnResult>;
  /** Explicit language choice (keypad 1/2, browser buttons). Returns null for an unknown session. */
  setLanguage(sessionId: string, lang: Lang): TurnResult | null;
  store: SessionStore;
  engine: Engine;
};

export function createAgent({
  engine,
  llm,
  retriever,
  store = new SessionStore(),
}: {
  engine: Engine;
  llm: TurnLlm;
  retriever: Retriever;
  store?: SessionStore;
}): Agent {
  const schemes = new Map<string, Scheme>(engine.schemes.map((s) => [s.id, s]));
  const schemeIds = engine.schemes.map((s) => s.id);

  const inTopics = (s: Session, id: string) =>
    !s.topics.length || (schemes.get(id)?.topics ?? []).some((t) => s.topics.includes(t as Topic));

  function rankOffers(s: Session, results: SchemeResult[]): string[] {
    const order = (id: string) => (SPEAK_ORDER.indexOf(id) + 1 || 99);
    const statusRank = { eligible: 0, likely_eligible: 1 } as Record<string, number>;
    return results
      .filter((r) => r.status in statusRank && inTopics(s, r.schemeId))
      .sort((a, b) => statusRank[a.status]! - statusRank[b.status]! || order(a.schemeId) - order(b.schemeId))
      .map((r) => r.schemeId);
  }

  function mergeFacts(s: Session, out: LlmTurnOutput) {
    for (const [key, value] of Object.entries(out.facts)) {
      if (value === null || value === undefined) continue;
      const def = engine.facts[key];
      if (!def) continue;
      if (def.type === "enum" && !def.values?.includes(value as string)) continue;
      if (def.type === "number" && typeof value !== "number") continue;
      if (def.type === "boolean" && typeof value !== "boolean") continue;
      s.stated[key] = value;
    }
    if (out.landArea) {
      const ha = toHectares(out.landArea.value, out.landArea.unit, s.stated.state as string | undefined);
      if (ha !== null) s.stated.landHectares = ha;
    }
  }

  return {
    store,
    engine,
    setLanguage(sessionId, lang) {
      const s = store.get(sessionId);
      if (!s) return null;
      const ev = engine.evaluate(s.stated, { topics: s.topics });
      if (s.lang === lang) return finish(s, ev, [], []);
      s.lang = lang;
      // Re-ask the pending question so the caller hears it in the new language.
      const repeat = s.lastPrompt === "fact" && s.pendingFact ? engine.facts[s.pendingFact]?.ask?.[lang] : undefined;
      return finish(s, ev, [text("switched", lang), repeat ?? ""], [{ type: "SET_LANGUAGE", lang }]);
    },
    async handleTurn(sessionId, userText, lang = "hi", meta = {}) {
      let s = store.get(sessionId);
      if (!s) {
        s = store.create(sessionId, lang, meta);
        const ev = engine.evaluate(s.stated);
        return finish(s, ev, [text("greeting", s.lang)], []);
      }
      if (s.state === "closed") {
        return finish(s, engine.evaluate(s.stated, { topics: s.topics }), [text("closing", s.lang)], [], true);
      }

      s.history.push({ role: "user", text: userText });
      const actions: Action[] = [];
      const say: string[] = [];

      const focus = s.selectedScheme ? [s.selectedScheme] : s.offered.slice(0, BATCH * 2);
      const retrieve = shouldRetrieve(userText, s);
      let chunks: Chunk[] = [];
      let out: LlmTurnOutput;
      try {
        if (retrieve) chunks = await retriever.retrieve(userText, { schemeIds: focus, lang: s.lang });
        out = await llm.turn({
          userText,
          lang: s.lang,
          pendingQuestion:
            s.pendingFact && engine.facts[s.pendingFact]?.ask
              ? { fact: s.pendingFact, text: engine.facts[s.pendingFact]!.ask![s.lang] }
              : null,
          knownFacts: s.stated,
          offeredSchemes: s.offered.map((id) => ({ id, name: `${schemes.get(id)!.name[s!.lang]} / ${schemes.get(id)!.name.en}` })),
          selectedSchemeId: s.selectedScheme,
          chunks,
          history: s.history.slice(-HISTORY_TURNS - 1, -1),
        });
      } catch (err) {
        console.error("LLM turn failed:", err);
        const ev = engine.evaluate(s.stated, { topics: s.topics });
        const repeat = s.pendingFact ? engine.facts[s.pendingFact]?.ask?.[s.lang] : undefined;
        return finish(s, ev, [text("sorry", s.lang), repeat ?? ""], []);
      }

      // Language
      const newLang = decideLanguage(s.lang, userText, out.language, out.switchLanguageTo);
      if (newLang !== s.lang) {
        s.lang = newLang;
        actions.push({ type: "SET_LANGUAGE", lang: newLang });
        say.push(text("switched", newLang));
      }

      // Scam check, any state
      const scamPattern = detectScamKeywords(userText) ?? (out.scam.detected ? (out.scam.pattern ?? "other") : null);
      if (scamPattern) {
        say.push(text("scamWarning", s.lang));
        if (!s.scamPatternsLogged.includes(scamPattern)) {
          s.scamPatternsLogged.push(scamPattern);
          actions.push({ type: "LOG_SCAM_REPORT", pattern: scamPattern });
        }
      }

      mergeFacts(s, out);
      if (!s.topics.length && out.topics.length && s.questionsAsked === 0) s.topics = out.topics;
      if (out.intent === "ask_question") say.push(out.answer?.trim() || text("noAnswer", s.lang));

      const ev = engine.evaluate(s.stated, { topics: s.topics });
      const results = new Map(ev.results.map((r) => [r.schemeId, r]));

      const askNext = (): boolean => {
        if (!ev.next || s!.questionsAsked >= MAX_QUESTIONS) return false;
        if (ev.next.fact === s!.pendingFact && s!.lastPrompt === "fact" && !(ev.next.fact in s!.stated)) {
          say.push(text("sorry", s!.lang));
        }
        s!.pendingFact = ev.next.fact;
        s!.lastPrompt = "fact";
        s!.questionsAsked++;
        say.push(ev.next.ask[s!.lang]);
        return true;
      };

      const presentBatch = () => {
        const batch = s!.offered.slice(s!.offeredUpTo, s!.offeredUpTo + BATCH);
        s!.offeredUpTo += batch.length;
        say.push(composeSchemeList(batch, results, schemes, s!.lang));
        const remaining = s!.offered.length - s!.offeredUpTo;
        if (remaining > 0) {
          s!.lastPrompt = "more";
          say.push(moreText(remaining, s!.lang));
        } else {
          s!.lastPrompt = "pick";
          say.push(text("pick", s!.lang));
        }
      };

      const enterResults = () => {
        s!.state = "results";
        s!.pendingFact = null;
        s!.offered = rankOffers(s!, ev.results);
        s!.offeredUpTo = 0;
        if (s!.offered.length) return presentBatch();
        say.push(text("noneFound", s!.lang));
        if (s!.topics.length) {
          s!.lastPrompt = "check_others";
          say.push(text("checkOthers", s!.lang));
        } else {
          actions.push({ type: "HANDOFF" });
          close(false);
        }
      };

      const widenTopics = () => {
        s!.topics = [];
        s!.questionsAsked = 0;
        s!.state = "collecting";
        const wide = engine.evaluate(s!.stated);
        ev.next = wide.next;
        ev.results = wide.results;
        if (!askNext()) enterResults();
      };

      const showDetails = (id: string) => {
        s!.state = "details";
        s!.selectedScheme = id;
        if (!s!.discussed.includes(id)) s!.discussed.push(id);
        say.push(composeDetails(schemes.get(id)!, results.get(id), s!.lang));
        s!.lastPrompt = "anything_else";
        say.push(text("anythingElse", s!.lang));
      };

      const askConsent = () => {
        if (!s!.offered.length) return close(false);
        s!.state = "consent";
        s!.lastPrompt = "consent";
        say.push(text(toIndianMobile(s!.callerNumber) ? "consent" : "consentNoNumber", s!.lang));
      };

      let closed = false;
      const close = (sent: boolean) => {
        closed = true;
        s!.state = "closed";
        s!.lastPrompt = null;
        say.push(text(sent ? "closingSent" : "closing", s!.lang));
      };

      const picked = out.pickedSchemeId && s.offered.includes(out.pickedSchemeId) ? out.pickedSchemeId : null;
      const yes = out.intent === "yes";
      const no = out.intent === "no" || out.intent === "done";

      switch (s.state) {
        case "collecting":
          if (out.intent === "done" || !askNext()) enterResults();
          break;

        case "results":
        case "details":
          if (picked) showDetails(picked);
          else if (s.lastPrompt === "check_others" && yes) widenTopics();
          else if (out.intent === "want_more" || (yes && s.lastPrompt === "more")) {
            if (s.offeredUpTo < s.offered.length) presentBatch();
            else if (s.topics.length) {
              s.lastPrompt = "check_others";
              say.push(text("checkOthers", s.lang));
            } else {
              s.lastPrompt = "pick";
              say.push(text("pick", s.lang));
            }
          } else if (yes && s.lastPrompt === "anything_else") {
            s.state = "results";
            if (s.offeredUpTo < s.offered.length) presentBatch();
            else {
              s.lastPrompt = "pick";
              say.push(text("pick", s.lang));
            }
          } else if (no) askConsent();
          else if (out.intent === "ask_question") {
            say.push(text(s.state === "details" ? "anythingElse" : "pick", s.lang));
          } else if (out.intent === "give_info") {
            // A corrected or new fact may change the results; re-rank and speak again.
            s.questionsAsked = Math.min(s.questionsAsked, MAX_QUESTIONS - 1);
            s.state = "collecting";
            if (!askNext()) enterResults();
          } else if (!scamPattern) {
            say.push(text("sorry", s.lang), text(s.state === "details" ? "anythingElse" : "pick", s.lang));
          }
          break;

        case "consent": {
          // A spoken number wins; otherwise "yes" means the caller's own number, if it is an Indian mobile.
          const own = toIndianMobile(s.callerNumber);
          const to = toIndianMobile(out.otherPhoneNumber) ?? (yes ? own : null);
          if (to) {
            const ids = s.discussed.length ? s.discussed : s.offered.slice(0, s.offeredUpTo);
            s.checklist = { to, schemeIds: ids, lang: s.lang };
            actions.push({ type: "SEND_CHECKLIST", to, schemeIds: ids, lang: s.lang });
            close(true);
          } else if (out.otherPhoneNumber) say.push(text("badNumber", s.lang), text("askNumber", s.lang));
          else if (yes) say.push(text("askNumber", s.lang));
          else if (no) close(false);
          else say.push(text("sorry", s.lang), text(own ? "consent" : "consentNoNumber", s.lang));
          break;
        }
      }

      const rag = retrieve ? ragTrace(chunks, out.intent === "ask_question" && out.answer ? out.sources : []) : null;
      return finish(s, ev, say, actions, closed, rag);
    },
  };

  function finish(s: Session, ev: Evaluation, say: string[], actions: Action[], done = false, rag: RagTrace | null = null): TurnResult {
    const replyText = say.filter(Boolean).join(" ");
    s.history.push({ role: "assistant", text: replyText });
    return {
      replyText,
      actions,
      done,
      trace: {
        state: s.state,
        lang: s.lang,
        facts: ev.facts,
        results: ev.results,
        next: ev.next,
        questionsAsked: s.questionsAsked,
        topics: s.topics,
        rag,
      },
    };
  }
}
