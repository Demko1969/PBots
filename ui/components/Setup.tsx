"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { ProviderId } from "../lib/evaluation-run";
import { isProvider, providers } from "../lib/provider-catalog.mjs";
import { setupGuide, useMessages } from "../lib/workspace-language";

export type SetupStatus = {
  enabled: boolean;
  defaultProvider?: ProviderId | null;
  providers?: ProviderOption[];
  ownerSetupRequired?: boolean;
  configured?: boolean;
  installing?: boolean;
  connected?: boolean;
  docsEnabled?: boolean;
  editorUrl?: string;
  error?: string;
};

export type ProviderOption = { id: ProviderId; name: string; model: string; label: string; configured: boolean };

function ProviderSettings({ option, defaultProvider, refresh }: {
  option: ProviderOption;
  defaultProvider?: ProviderId | null;
  refresh: () => Promise<void>;
}) {
  const { t } = useMessages();
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  async function update(action: "test" | "save" | "default") {
    setPending(true);
    setFeedback(undefined);
    try {
      const response = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, provider: option.id, apiKey: action === "default" ? undefined : key.trim() || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Bağlantı kontrol edilemedi.");
      if (action !== "test") await refresh();
      if (action === "save") setKey("");
      setFeedback({ text: { test: "Model bağlantısı doğrulandı.", save: "API anahtarı kaydedildi.", default: "Varsayılan model güncellendi." }[action] });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Bağlantı kontrol edilemedi.", error: true });
    } finally { setPending(false); }
  }
  return <fieldset className="provider-settings" disabled={pending} aria-busy={pending}>
    <legend>{option.name} · {option.label}</legend>
    <small>{option.id === defaultProvider ? t("Varsayılan model") : option.configured ? t("Anahtar kayıtlı") : t("Anahtar gerekli")}</small>
    <label htmlFor={`provider-key-${option.id}`}>{option.name} {t("API anahtarı")}</label>
    <input id={`provider-key-${option.id}`} type="password" autoComplete="off" spellCheck={false}
      autoCapitalize="none" maxLength={512} value={key} onChange={event => setKey(event.target.value)} />
    <div className="provider-actions">
      <button type="button" className="text-button" onClick={() => void update("test")} disabled={!key.trim() && !option.configured}>{t("Bağlantıyı test et")}</button>
      <button type="button" className="text-button" onClick={() => void update("save")} disabled={!key.trim()}>{t("Anahtarı kaydet")}</button>
      {option.configured && option.id !== defaultProvider && <button type="button" className="text-button" onClick={() => void update("default")}>{t("Varsayılan yap")}</button>}
    </div>
    {pending && <small role="status">{t("Sağlayıcı güncelleniyor…")}</small>}
    {feedback && <small role={feedback.error ? "alert" : "status"}>{t(feedback.text)}</small>}
  </fieldset>;
}

export default function Setup({ onStatus }: {
  onStatus: (status: SetupStatus) => void;
}) {
  const { language, t } = useMessages();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/setup", { cache: "no-store" });
      const next = await response.json() as SetupStatus;
      setStatus(next);
      onStatus(next);
    } catch {
      const next = { enabled: true, connected: false, error: "Bağlantı kontrol edilemedi." };
      setStatus(next);
      onStatus(next);
    }
  }, [onStatus]);

  useEffect(() => {
    const initial = setTimeout(() => { void refresh(); }, 0);
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);

  async function configure(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const submittedKey = apiKey;
    setApiKey("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: submittedKey, provider }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Kurulum tamamlanamadı.");
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Kurulum tamamlanamadı.");
    } finally { setSaving(false); }
  }

  if (!status?.enabled) return null;
  const ready = status.configured && status.connected && !status.installing;
  return <section className={`setup-panel${ready ? " setup-ready" : ""}`} aria-live="polite">
    <h2>{ready ? t("Sistem hazır") : t("İlk kurulum")}</h2>
    {status.configured && !status.connected && <p>{t("Servis başlatılıyor…")}</p>}
    {status.ownerSetupRequired && <p className="owner-setup-notice">
      <a href={status.editorUrl || "http://localhost:5680"} target="_blank" rel="noreferrer">{t("n8n yönetici hesabı oluştur")}</a>
    </p>}
    {!status.configured && <form onSubmit={configure}>
      <label htmlFor="setup-provider">{t("AI sağlayıcısı")}</label>
      <select id="setup-provider" value={provider} disabled={saving || status.installing} onChange={event => {
        if (!isProvider(event.target.value)) return;
        setProvider(event.target.value);
        setApiKey("");
      }}>
        {Object.entries(providers).map(([id, option]) => <option key={id} value={id}>{option.name} · {option.label}</option>)}
      </select>
      <label htmlFor="setup-key">{t("API anahtarı")}</label>
      <input id="setup-key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={apiKey}
        onChange={event => setApiKey(event.target.value)} disabled={saving || status.installing || status.ownerSetupRequired} required maxLength={512} />
      <button className="primary-button" disabled={!apiKey.trim() || saving || status.installing || !status.connected || status.ownerSetupRequired}>
        {saving || status.installing ? t("İş akışları kuruluyor…") : t("Kurulumu tamamla")}
      </button>
    </form>}
    {ready && <details className="provider-disclosure">
      <summary>{t("AI sağlayıcıları")}</summary>
      {status.providers?.map(option => <ProviderSettings key={option.id} option={option} defaultProvider={status.defaultProvider} refresh={refresh} />)}
    </details>}
    {(error || status.error) && <p role="alert">{t(error || status.error || "")}</p>}
    <div className="docs-settings" aria-label={t("Kurulum belgeleri")}>
      <a href={setupGuide("openai", language)}
        target="_blank" rel="noreferrer">{t("OpenAI kurulum belgesi")}</a>
      <a id="google-docs-setup" href={setupGuide("google-docs", language)}
        target="_blank" rel="noreferrer">{t("Google Docs kurulum belgesi")}</a>
    </div>
  </section>;
}
