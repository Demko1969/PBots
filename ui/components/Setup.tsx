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

export default function Setup({ onStatus, desktop = false }: {
  onStatus: (status: SetupStatus) => void;
  desktop?: boolean;
}) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [googleId, setGoogleId] = useState("");
  const [googleSecret, setGoogleSecret] = useState("");
  const [docsSaving, setDocsSaving] = useState(false);
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
    const timer = desktop ? undefined : setInterval(() => { void refresh(); }, 5000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [desktop, refresh]);

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
      setEditingKey(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Kurulum tamamlanamadı.");
    } finally { setSaving(false); }
  }

  async function configureDocs(event: FormEvent) {
    event.preventDefault();
    setDocsSaving(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "google-docs", id: googleId.trim(), secret: googleSecret.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Google Docs kurulumu tamamlanamadı.");
      setGoogleId("");
      setGoogleSecret("");
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Google Docs kurulumu tamamlanamadı.");
    } finally { setDocsSaving(false); }
  }

  if (!status?.enabled) return null;
  const ready = status.configured && status.connected && !status.installing;
  return <section className={`setup-panel${ready ? " setup-ready" : ""}`} aria-live="polite">
    <h2>{ready ? "Sistem hazır" : "İlk kurulum"}</h2>
    {status.configured && !status.connected && <p>Servis başlatılıyor…</p>}
    {status.ownerSetupRequired && <p className="owner-setup-notice">
      <a href={status.editorUrl || "http://localhost:5680"} target="_blank" rel="noreferrer">n8n yönetici hesabı oluştur</a>
    </p>}
    {desktop && status.configured && !editingKey && <button type="button" className="text-button" onClick={() => setEditingKey(true)}>API anahtarını değiştir</button>}
    {(!status.configured || editingKey) && <form onSubmit={configure}>
      <label htmlFor="setup-key">OpenAI API anahtarı</label>
      <input id="setup-key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" value={apiKey}
        onChange={event => setApiKey(event.target.value)} disabled={saving || status.installing || status.ownerSetupRequired} required placeholder="sk-…" />
      <button className="primary-button" disabled={!apiKey.trim() || saving || status.installing || (!desktop && !status.connected) || status.ownerSetupRequired}>
        {saving || status.installing ? (desktop ? "Kaydediliyor…" : "İş akışları kuruluyor…") : "Kurulumu tamamla"}
      </button>
    </form>}
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
    {desktop ? <>
      <p className="desktop-disclosure">Soru ve analiz bağlamı OpenAI ile paylaşılır. Gerçek değerlendirmeler OpenAI API kullanımı oluşturur.</p>
      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI API anahtarları</a>
      <details id="google-docs-setup" className="desktop-disclosure">
        <summary>Google Docs kurulumu{status.docsEnabled ? " · Hazır" : ""}</summary>
        <p>Google Cloud projenizde Google Docs API’yi etkinleştirin ve Masaüstü uygulaması türünde bir OAuth istemcisi oluşturun. Dışa aktarırken Google, belgeyi Drive’ınıza kaydetmek için izin ister.</p>
        <form onSubmit={configureDocs}>
          <label htmlFor="google-client-id">Google istemci kimliği</label>
          <input id="google-client-id" required value={googleId} onChange={event => setGoogleId(event.target.value)} />
          <label htmlFor="google-client-secret">Google istemci anahtarı</label>
          <input id="google-client-secret" required type="password" value={googleSecret} autoComplete="off" onChange={event => setGoogleSecret(event.target.value)} />
          <button className="primary-button" disabled={docsSaving}>{docsSaving ? "Kaydediliyor…" : "Google Docs ayarlarını kaydet"}</button>
        </form>
      </details>
    </> : <div className="docs-settings" aria-label="Kurulum belgeleri">
      <a href="/docs/openai.txt"
        target="_blank" rel="noreferrer">OpenAI kurulum belgesi</a>
      <a id="google-docs-setup" href="/docs/google-docs.txt"
        target="_blank" rel="noreferrer">Google Docs kurulum belgesi</a>
    </div>}
  </section>;
}
