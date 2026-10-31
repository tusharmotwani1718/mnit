import type { Metadata } from "next";
import { LivePanel } from "@/components/live/LivePanel";

export const metadata: Metadata = {
  title: "Yojana Darshak · Live call view",
  description: "Live view of Yojana Darshak calls: conversation, facts and rule-based eligibility.",
};

/** Judges' / operators' screen: every call and chat, as the rules engine sees it. */
export default function LivePage() {
  return <LivePanel />;
}
