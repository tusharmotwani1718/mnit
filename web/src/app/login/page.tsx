"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { errorText, t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { api } from "@/lib/useAccount";

const RESEND_AFTER_SEC = 30;

/** Phone + OTP login: number → code by SMS → logged in (httpOnly cookie set by /api/auth/verify). */
export default function LoginPage() {
  const { lang } = useLang();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ retryAfterSec?: number | null }>("/api/auth/send", "POST", { phone, lang });
    setBusy(false);
    if (!r.ok) {
      setError(r.data.error ?? "unknown");
      if (r.data.retryAfterSec) setWait(r.data.retryAfterSec);
      return;
    }
    setStep("code");
    setCode("");
    setWait(RESEND_AFTER_SEC);
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const r = await api("/api/auth/verify", "POST", { phone, code, lang });
    setBusy(false);
    if (!r.ok) return setError(r.data.error ?? "unknown");
    router.push("/profile");
  };

  return (
    <div className="min-h-dvh bg-slate-50">
      <SiteHeader me={null} />
      <main className="mx-auto max-w-md px-4 py-8">
        <Link href="/" className="text-sm text-emerald-700 hover:underline">
          {t("backToChat", lang)}
        </Link>
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">{t("loginTitle", lang)}</h1>
          <p className="mt-2 text-sm text-slate-600">{t("loginWhy", lang)}</p>

          {step === "phone" ? (
            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void sendCode();
              }}
            >
              <label className="block text-sm font-medium text-slate-800" htmlFor="phone">
                {t("mobileNumber", lang)}
              </label>
              <div className="flex rounded-xl border border-slate-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-200">
                <span className="grid place-items-center border-r border-slate-200 px-3 text-slate-600">+91</span>
                <input
                  id="phone"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, "").slice(0, 12))}
                  placeholder="98765 43210"
                  className="min-w-0 flex-1 rounded-r-xl px-3 py-3 text-lg tracking-wide outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={busy || phone.replace(/\D/g, "").length !== 10 || wait > 0}
                className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? t("sending", lang) : wait > 0 ? `${t("resendIn", lang)} (${wait}s)` : t("sendCode", lang)}
              </button>
            </form>
          ) : (
            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <p className="text-sm text-slate-700">
                {t("codeSentTo", lang)} <span className="font-semibold">+91 {phone}</span>
              </p>
              <label className="block text-sm font-medium text-slate-800" htmlFor="code">
                {t("enterCode", lang)}
              </label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full rounded-xl border border-slate-300 px-3 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />
              <p className="text-xs text-amber-800">⚠ {t("otpWarning", lang)}</p>
              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? t("verifying", lang) : t("verify", lang)}
              </button>
              <div className="flex justify-between text-sm">
                <button type="button" onClick={() => setStep("phone")} className="text-slate-600 hover:underline">
                  {t("changeNumber", lang)}
                </button>
                <button type="button" disabled={wait > 0 || busy} onClick={() => void sendCode()} className="text-emerald-700 hover:underline disabled:text-slate-400 disabled:no-underline">
                  {t("resendIn", lang)}
                  {wait > 0 && ` (${wait}s)`}
                </button>
              </div>
            </form>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2.5 text-sm text-rose-800">
              {errorText(error, lang)}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
