import { Suspense } from "react";
import { ReadinessPage } from "@/components/site/ReadinessPage";

// The scheme id comes from the URL at request time, so the page renders inside a Suspense boundary (Cache Components).
export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-slate-50" />}>
      <ReadinessPage />
    </Suspense>
  );
}
