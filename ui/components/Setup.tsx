"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

export type SetupStatus = {
  enabled: boolean;
  defaultModel?: string;
  ownerSetupRequired?: boolean;
  configured?: boolean;
  installing?: boolean;
  connected?: boolean;
  docsEnabled?: boolean;
  editorUrl?: string;
  error?: string;
};

export default function Setup({ onStatus }: {
  onStatus: (status: SetupStatus) => void;
}) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
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
        body: JSON.stringify({ apiKey: submittedKey }),
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
    <h2>{ready ? "Sistem hazır" : "İlk kurulum"}</h2>
    {status.configured && !status.connected && <p>Servis başlatılıyor…</p>}
    {status.ownerSetupRequired && <p className="owner-setup-notice">
      <a href={status.editorUrl || "http://localhost:5680"} target="_blank" rel="noreferrer">n8n yönetici hesabı oluştur</a>
    </p>}
    {!status.configured && <form onSubmit={configure}>
      <label htmlFor="setup-key">OpenAI API anahtarı</label>
      <input id="setup-key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={apiKey}
        onChange={event => setApiKey(event.target.value)} disabled={saving || status.installing || status.ownerSetupRequired} required placeholder="sk-…" />
      <button className="primary-button" disabled={!apiKey.trim() || saving || status.installing || !status.connected || status.ownerSetupRequired}>
        {saving || status.installing ? "İş akışları kuruluyor…" : "Kurulumu tamamla"}
      </button>
    </form>}
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
    <div className="docs-settings" aria-label="Kurulum belgeleri">
      <a href="/docs/openai.txt"
        target="_blank" rel="noreferrer">OpenAI kurulum belgesi</a>
      <a id="google-docs-setup" href="/docs/google-docs.txt"
        target="_blank" rel="noreferrer">Google Docs kurulum belgesi</a>
    </div>
  </section>;
}
