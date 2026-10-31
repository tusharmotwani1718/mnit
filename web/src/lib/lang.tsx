"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Lang } from "./types";

const KEY = "yd_lang";
const EVENT = "yd-lang";
const LANGS: Lang[] = ["hi", "mr", "en"];

/** Site language, remembered per browser (localStorage). Hindi by default; Marathi and English one tap away. */
function read(): Lang {
  try {
    const saved = localStorage.getItem(KEY) as Lang | null;
    if (saved && LANGS.includes(saved)) return saved;
  } catch {
    // storage blocked: default
  }
  return "hi";
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // not remembered across reloads
  }
  memory = l;
  window.dispatchEvent(new Event(EVENT));
}

/** Fallback when storage is blocked, so switching still works for this page view. */
let memory: Lang | null = null;

export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const lang = useSyncExternalStore(subscribe, () => memory ?? read(), () => "hi" as Lang);
  return { lang, setLang };
}

/** Keeps <html lang> in step with the site language (screen readers, Devanagari font choice). */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { lang } = useLang();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return children;
}
