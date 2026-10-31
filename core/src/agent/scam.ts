import type { ScamPattern } from "./types.js";

// Deterministic first pass; the LLM's scam flag in the same turn call catches the rest.
const RULES: [ScamPattern, RegExp][] = [
  ["otp_request", /(otp|ओटीपी)/i],
  ["agent_registration", /(दलाल|एजेंट|agent|dalal)/i],
  [
    "fee_request",
    /(पैसे|पैसा|रुपये|रुपया|रुपए|फीस|फी|₹|paise|paisa|rupaye|fees?).{0,40}(माँग|मांग|माग|ले रहा|ले रहे|लिए|घेतले|घेत|देने को|द्यायला|maang|mang)/i,
  ],
  ["fee_request", /(माँग|मांग|माग|maang|mang).{0,40}(पैसे|पैसा|रुपये|रुपए|फीस|₹|paise|rupaye)/i],
];

export function detectScamKeywords(text: string): ScamPattern | null {
  for (const [pattern, re] of RULES) if (re.test(text)) return pattern;
  return null;
}
