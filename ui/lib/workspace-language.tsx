"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { browserLanguage, languageNames, type Language } from "./language";
import { messages } from "./messages";

const LanguageContext = createContext<Language>("tr");
const storageKey = "ortak-akil.language";

function storedLanguage(): Language {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && Object.hasOwn(languageNames, saved)) return saved as Language;
  } catch { /* The language selector also works without browser storage. */ }
  return browserLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

function subscribeToLanguage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("languagechange", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("languagechange", onChange);
  };
}

function initialLanguage(): Language { return "en"; }

export function WorkspaceLanguage({ desktop, children }: { desktop: boolean; children: ReactNode }) {
  const preferred = useSyncExternalStore(subscribeToLanguage, storedLanguage, initialLanguage);
  const [selection, setLanguage] = useState<Language>();
  const language = desktop ? "tr" : selection ?? preferred;
  return <LanguageContext.Provider value={language}>
    <ChangeLanguageContext.Provider value={language => {
      setLanguage(language);
      try { localStorage.setItem(storageKey, language); } catch { /* Keep the current choice in memory. */ }
    }}>{children}</ChangeLanguageContext.Provider>
  </LanguageContext.Provider>;
}

const ChangeLanguageContext = createContext<(language: Language) => void>(() => {});

export function useMessages() {
  const language = useContext(LanguageContext);
  function t(key: string, values?: Record<string, string | number>) {
    const pair = Object.hasOwn(messages, key) ? messages[key] : undefined;
    const template = language === "tr" ? key : pair?.[language === "en" ? 0 : 1] ?? key;
    return values ? template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : match) : template;
  }
  return { language, t };
}

export function LanguageSelect() {
  const { language, t } = useMessages();
  const changeLanguage = useContext(ChangeLanguageContext);
  return <label className="language-picker">
    <span>{t("Dil")}</span>
    <select value={language} onChange={event => changeLanguage(event.target.value as Language)}>
      {Object.entries(languageNames).map(([code, name]) =>
        <option key={code} value={code} lang={code}>{name}</option>)}
    </select>
  </label>;
}

export function setupGuide(guide: "openai" | "google-docs", language: Language) {
  return `/docs/${guide}${language === "en" ? "" : "." + language}.txt`;
}
