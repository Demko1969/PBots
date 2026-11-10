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
    <p>{status.configured
      ? status.connected ? "OpenAI bağlantısı yapılandırıldı. Sorunuzu veya CSV tablonuzu değerlendirebilirsiniz." : "Servis başlatılıyor. Bağlantı otomatik kontrol ediliyor."
      : "OpenAI API anahtarınızı girin. Sekiz iş akışı ve bağlantıları otomatik kurulur. Kurulum tamamlandığında değerlendirmeye başlayabilirsiniz."}</p>
    {status.ownerSetupRequired && <p className="owner-setup-notice">
      Önce <a href={status.editorUrl || "http://localhost:5680"} target="_blank" rel="noreferrer">n8n yönetici hesabınızı oluşturun</a>.
      Hesap kurulumu tamamlandığında anahtar girişi etkinleşir.
    </p>}
    {!status.configured && <form onSubmit={configure}>
      <label htmlFor="setup-key">OpenAI API anahtarı</label>
      <input id="setup-key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" aria-describedby="key-usage" value={apiKey}
        onChange={event => setApiKey(event.target.value)} disabled={saving || status.installing || status.ownerSetupRequired} required placeholder="sk-…" />
      <small id="key-usage">Anahtar gönderildiğinde giriş alanı temizlenir. Anahtar doğrulaması model listesini okur. Test sorusu çalıştırmak API kullanım ücreti oluşturur.</small>
      <button className="primary-button" disabled={!apiKey.trim() || saving || status.installing || !status.connected || status.ownerSetupRequired}>
        {saving || status.installing ? "İş akışları kuruluyor…" : "Kurulumu tamamla"}
      </button>
    </form>}
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
    <GoogleDocsSetup status={status} />

  </section>;
}

function GoogleDocsSetup({ status }: { status: SetupStatus | null }) {
  if (!status?.enabled) return null;
  return <div className="docs-settings" aria-label="Google Docs bağlantısı">
    <details id="google-docs-setup">
      <summary>{status.docsEnabled ? "Google Docs açık" : "Google Docs kurulumu"}</summary>
      {status.docsEnabled ? <p>Önce bir değerlendirmeyi tamamlayın. Ardından Nihai sonuç bölümündeki <b>Google Docs’a kaydet</b> düğmesini kullanın. <a href={status.editorUrl || "http://localhost:5680"} target="_blank" rel="noreferrer">Bağlantıları yönet</a></p> : <>
      <p><a href={status.editorUrl || "http://localhost:5680"} target="_blank" rel="noreferrer">n8n yönetimini açın</a> ve ilk kullanımda yönetici hesabınızı oluşturun.
        Google Drive ve Google Docs OAuth2 bağlantılarını ekleyin. “Multi-Agent UI - Google Docs API” iş akışındaki Drive/Docs düğümlerinde bu bağlantıları ve hedef klasörü seçip iş akışını yayınlayın.</p>
      <p>Ardından terminalde <code>GOOGLE_DOCS_ENABLED=true bash scripts/start.sh</code> çalıştırın. Google Docs için Google Cloud OAuth yapılandırması gerekir.</p>
      </>}
    </details>
  </div>;
}
