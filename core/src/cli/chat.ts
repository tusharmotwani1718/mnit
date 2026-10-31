// Text chat against the real agent core (gpt-4.1-mini). Usage: npm run chat [-- hi|mr|en]
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createDefaultAgent, type TurnResult } from "../agent/index.js";
import type { Lang } from "../engine/index.js";

const arg = process.argv[2];
const lang: Lang = arg === "mr" || arg === "en" ? arg : "hi";
const agent = createDefaultAgent();
const sessionId = `cli-${Date.now()}`;
const rl = createInterface({ input: stdin, output: stdout });

function show(r: TurnResult) {
  console.log(`\n🤖 ${r.replyText}`);
  const statuses = r.trace.results
    .filter((x) => x.status !== "not_eligible")
    .map((x) => `${x.schemeId}=${x.status}`)
    .join("  ");
  console.log(`   [state=${r.trace.state} lang=${r.trace.lang} q=${r.trace.questionsAsked} topics=${r.trace.topics.join(",") || "all"}]`);
  console.log(`   facts: ${JSON.stringify(r.trace.facts)}`);
  console.log(`   ${statuses}`);
  if (r.actions.length) console.log(`   actions: ${JSON.stringify(r.actions)}`);
}

show(await agent.handleTurn(sessionId, "", lang, { callerNumber: "+910000000000", channel: "cli" }));
for (;;) {
  const text = (await rl.question("\n🧑 ")).trim();
  if (!text) continue;
  const r = await agent.handleTurn(sessionId, text, lang);
  show(r);
  if (r.done) break;
}
rl.close();
