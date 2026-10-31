"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { errorText, t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { api } from "@/lib/useAccount";

// Same checks as core (src/account/password.ts, src/sms/number.ts), so mistakes show before submitting.
const PHONE_RULE = /^[6-9]\d{9}$/;
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

/** Mobile number + password: log in, or create an account. (OTP login is switched off for now.) */
export default function LoginPage() {
  const { lang } = useLang();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, "");
  const phoneOk = PHONE_RULE.test(digits);
  const passwordOk = mode === "login" ? password.length > 0 : PASSWORD_RULE.test(password);
  const canSubmit = phoneOk && passwordOk && (mode === "login" || confirm.length > 0) && !busy;

  const submit = async () => {
    if (!phoneOk) return setError("invalid_phone");
    if (mode === "signup") {
      if (!PASSWORD_RULE.test(password)) return setError("weak_password");
      if (password !== confirm) return setError("password_mismatch");
    }
    setBusy(true);
    setError(null);
    const r = await api(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", "POST", { phone: digits, password, lang });
    setBusy(false);
    if (!r.ok) {
      if (r.data.error === "phone_taken") setMode("login");
      return setError(r.data.error ?? "unknown");
    }
    try {
      sessionStorage.removeItem("yd_chat"); // new login, new chat
    } catch {}
    router.push("/profile");
  };

  const switchMode = (m: "login" | "signup") => {
    setMode(m);
    setError(null);
    setConfirm("");
  };

  const input =
    "w-full rounded-xl border border-slate-300 px-3 py-3 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200";

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

          <div role="tablist" className="mt-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`rounded-lg py-2 text-sm font-semibold ${mode === m ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"}`}
              >
                {m === "login" ? t("login", lang) : t("signup", lang)}
              </button>
            ))}
          </div>

          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="block text-sm">
              <span className="font-medium text-slate-800">{t("mobileNumber", lang)}</span>
              <div className="mt-1 flex rounded-xl border border-slate-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-200">
                <span className="grid place-items-center border-r border-slate-200 px-3 text-slate-600">+91</span>
                <input
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, "").slice(0, 12))}
                  placeholder="98765 43210"
                  className="min-w-0 flex-1 rounded-r-xl px-3 py-3 text-lg tracking-wide outline-none"
                />
              </div>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-800">{t("password", lang)}</span>
              <input
                type={show ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                maxLength={72}
                onChange={(e) => setPassword(e.target.value)}
                className={`mt-1 ${input}`}
              />
              {mode === "signup" && <span className="mt-1 block text-xs text-slate-500">{t("passwordRule", lang)}</span>}
            </label>

            {mode === "signup" && (
              <label className="block text-sm">
                <span className="font-medium text-slate-800">{t("confirmPassword", lang)}</span>
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  maxLength={72}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={`mt-1 ${input}`}
                />
              </label>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              {t("showPassword", lang)}
            </label>

            <button type="submit" disabled={!canSubmit} className="w-full rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? t("pleaseWait", lang) : mode === "login" ? t("login", lang) : t("createAccount", lang)}
            </button>
            <p className="text-xs text-amber-800">🔒 {t("passwordTip", lang)}</p>
          </form>

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
