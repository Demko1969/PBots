"use client";

import { downloadSolutionDiagram, renderSolutionDiagram, solutionFlow, type SolutionFlow } from "../lib/diagram";
import Setup, { type SetupStatus } from "../components/Setup";
import { MAX_CSV_BYTES, parseCsv, profileTable, tableQuestion } from "../lib/table";
import { Fragment, type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";

type Stage = "idle" | "planning" | "working" | "judging" | "complete" | "error";
type AgentStatus = "waiting" | "working" | "done" | "error";

type Agent = {
  agentId: number;
  role: string;
  task: string;
  status: AgentStatus;
  answer?: string;
  wordCount?: number;
  error?: string;
};

type Plan = {
  question: string;
  model: string;
  openaiModel?: string;
  questionType: string;
  complexity: string;
  agentCount: number;
  agents: Array<Omit<Agent, "status">>;
};

type JudgeResult = {
  question: string;
  model?: string;
  openaiModel?: string;
  questionType: string;
  complexity: string;
  agentCount: number;
  answers: Agent[];
  summaryPoints?: string[];
  detailedAnswer?: string;
  finalAnswer: string;
  diagram?: SolutionFlow;
  displayAnswer?: string;
};

// Selection guidance checked against https://developers.openai.com/api/docs/models on 2026-11-08.
const modelOptions = [
  { id: "gpt-6-astra", label: "GPT-6 Astra · En güçlü analiz", description: "Derin ve çok adımlı analiz için. Daha yüksek maliyet." },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol · Dengeli", description: "Analiz gücü ve maliyet arasında denge." },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra · Hızlı", description: "Günlük analiz ve açık anlatım için hızlı seçenek." },
  { id: "gpt-6-luna", label: "GPT-6 Luna · Ekonomik", description: "Daha dar kapsamlı işler için ekonomik seçenek." },
];
const previewNumber = new Intl.NumberFormat("tr-TR", { maximumSignificantDigits: 6 });

const exampleQuestion =
  "ERP destek süreçlerimizde çözüm süreleri uzarken müşteri memnuniyeti düşüyor. Sorunun olası nedenlerini ve uygulanabilir iyileştirme planını değerlendir.";

const stageCopy: Record<Stage, string> = {
  idle: "Yeni bir değerlendirme başlatmaya hazır",
  planning: "Soru analiz ediliyor, uzman roller oluşturuluyor",
  working: "Uzmanlar bağımsız incelemelerini yürütüyor",
  judging: "Uzman görüşleri tek bir sonuca dönüştürülüyor",
  complete: "Değerlendirme tamamlandı",
  error: "İşlem tamamlanamadı",
};

async function postStage<T>(stage: string, payload: unknown): Promise<T> {
  const response = await fetch(`/api/n8n/${stage}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({ error: "Geçersiz sunucu yanıtı" }));
  if (!response.ok) {
    throw new Error(data.error || data.message || `İstek başarısız (${response.status})`);
  }
  return data as T;
}

function formatInline(value: string): ReactNode[] {
  return value.split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return (
    <div className="rich-text">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div className="text-gap" key={index} aria-hidden="true" />;
        if (/^#{1,4}\s+/.test(line)) {
          return <h3 key={index}>{formatInline(line.replace(/^#{1,4}\s+/, ""))}</h3>;
        }
        if (/^(?:[-*•]|\d+[.)])\s+/.test(line)) {
  return (
    <div className="result-item" key={index}>
      <span className="result-bullet" />

      <div className="result-item-text">
        {formatInline(
          line.replace(/^(?:[-*•]|\d+[.)])\s+/, "")
        )}
      </div>
    </div>
  );
}
        if (line.length < 90 && line === line.toLocaleUpperCase("tr-TR") && /[A-ZÇĞİÖŞÜ]/.test(line)) {
          return <h3 key={index}>{formatInline(line)}</h3>;
        }
        return <p key={index}>{formatInline(line)}</p>;
      })}
    </div>
  );
}

function StatusMark({ status }: { status: AgentStatus }) {
  return <span className={`status-mark status-${status}`} aria-label={{ waiting: "Bekliyor", working: "Çalışıyor", done: "Tamamlandı", error: "Hata" }[status]} role="img" />;
}

export default function Home() {
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const setupBlocked = !!setup?.enabled && (!setup.configured || !setup.connected || setup.installing);
  const [question, setQuestion] = useState("");
  const [csvSource, setCsvSource] = useState<{ name: string; text: string } | null>(null);
  const [columnNotes, setColumnNotes] = useState("");
  const [tableConfirmed, setTableConfirmed] = useState(false);
  const [readingCsv, setReadingCsv] = useState(false);
  const [csvError, setCsvError] = useState("");
  const csv = useMemo(() => {
    if (!csvSource) return { table: null, error: "" };
    try { return { table: parseCsv(csvSource.text, csvSource.name), error: "" }; }
    catch (error) { return { table: null, error: error instanceof Error ? error.message : "CSV okunamadı" }; }
  }, [csvSource]);
  const tableProfile = useMemo(() => csv.table ? profileTable(csv.table) : [], [csv.table]);

  async function loadCsv(file: File | undefined) {
    setCsvSource(null);
    setTableConfirmed(false);
    setCsvError("");
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) { setCsvError("CSV en fazla 1 MB olabilir."); return; }
    setReadingCsv(true);
    try { setCsvSource({ name: file.name, text: await file.text() }); }
    catch { setCsvError("Dosya okunamadı."); }
    finally { setReadingCsv(false); }
  }
  const [modelChoice, setModelChoice] = useState("default");
  const [customModel, setCustomModel] = useState("");
  const defaultModel = setup?.defaultModel || "gpt-5-mini";
  const openaiModel = modelChoice === "custom" ? customModel : modelChoice === "default" ? defaultModel : modelChoice;
  const [stage, setStage] = useState<Stage>("idle");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<"final" | number>("final");
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [error, setError] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [savingDocs, setSavingDocs] = useState(false);

  const completedCount = agents.filter(agent => agent.status === "done").length;
  const selectedAgent = useMemo(
    () => typeof selected === "number" ? agents.find(agent => agent.agentId === selected) : undefined,
    [agents, selected],
  );
  const diagramDialog = useRef<HTMLDialogElement>(null);
  const diagramSvg = useMemo(() => renderSolutionDiagram(solutionFlow(result?.diagram, result?.finalAnswer ?? "")), [result]);
  const hasFlow = Boolean(diagramSvg);
  const isBusy = ["planning", "working", "judging"].includes(stage);

  function updateAgent(agentId: number, patch: Partial<Agent>) {
    setAgents(current => current.map(agent => agent.agentId === agentId ? { ...agent, ...patch } : agent));
  }

  async function runWorkerPool(plan: Plan, plannedAgents: Agent[]) {
    const results: Agent[] = [];
    let cursor = 0;
    const workerCount = Math.min(2, plannedAgents.length);

    async function worker() {
      while (cursor < plannedAgents.length) {
        const agent = plannedAgents[cursor++];
        updateAgent(agent.agentId, { status: "working" });
        try {
          const response = await postStage<Agent>("worker", {
            question: plan.question,
            openaiModel: plan.openaiModel ?? plan.model,
            questionType: plan.questionType,
            complexity: plan.complexity,
            agentCount: plan.agentCount,
            agentId: agent.agentId,
            role: agent.role,
            task: agent.task,
          });
          const completed = { ...agent, ...response, status: "done" as const };
          results.push(completed);
          updateAgent(agent.agentId, completed);
        } catch (workerError) {
          const message = workerError instanceof Error ? workerError.message : "Uzman çalıştırılamadı";
          updateAgent(agent.agentId, { status: "error", error: message });
          throw workerError;
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results.sort((a, b) => a.agentId - b.agentId);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const cleanQuestion = question.trim();
    if (!cleanQuestion || isBusy || setupBlocked || readingCsv || csvError || csv.error || (csv.table && !tableConfirmed)) return;

    setError("");
    setResult(null);
    setDocumentUrl("");
    setAgents([]);
    setSelected("final");
    setStage("planning");

    try {
      const plan = await postStage<Plan>("plan", {
        question: csv.table ? tableQuestion(cleanQuestion, csv.table, columnNotes) : cleanQuestion,
        openaiModel: openaiModel.trim() || "gpt-5-mini",
      });
      const plannedAgents: Agent[] = plan.agents.map(agent => ({ ...agent, status: "waiting" }));
      setAgents(plannedAgents);
      setStage("working");

      const answers = await runWorkerPool(plan, plannedAgents);
      setStage("judging");
      const judgeResponse = await postStage<JudgeResult>("judge", {
        question: plan.question,
        openaiModel: plan.openaiModel ?? plan.model,
        questionType: plan.questionType,
        complexity: plan.complexity,
        agentCount: plan.agentCount,
        answers,
      });
      // UI yalnızca sunulacak nihai cevap ve uzman kaynaklarını saklar.
      // Judge'ın iç çalışma/denetim alanları arayüz sözleşmesine alınmaz.
      const judge: JudgeResult = {
  question: judgeResponse.question,

  model: judgeResponse.model,
  openaiModel: judgeResponse.openaiModel,
  questionType: judgeResponse.questionType,
  complexity: judgeResponse.complexity,
  agentCount: judgeResponse.agentCount,
  answers: judgeResponse.answers,

  summaryPoints: judgeResponse.summaryPoints ?? [],
  detailedAnswer: judgeResponse.detailedAnswer,
  finalAnswer: judgeResponse.finalAnswer,
  diagram: judgeResponse.diagram,
  displayAnswer: judgeResponse.displayAnswer,
      };
      setResult(judge);
      setSelected("final");
      setStage("complete");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Beklenmeyen bir hata oluştu");
      setStage("error");
    }
  }

  async function saveToDocs() {
    if (!result || savingDocs) return;
    setSavingDocs(true);
    setError("");
    try {
      const docs = await postStage<{ documentUrl: string }>("docs", result);
      const url = new URL(docs.documentUrl);
      if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !url.pathname.startsWith("/document/")) {
        throw new Error("Google Docs bağlantısı doğrulanamadı.");
      }
      setDocumentUrl(url.href);
    } catch (docsError) {
      setError(docsError instanceof Error ? docsError.message : "Google Docs kaydı oluşturulamadı");
    } finally {
      setSavingDocs(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Ortak Akıl ana sayfa">
          <span><b>ORTAK AKIL</b><small>Çoklu uzman karar alanı</small></span>
        </a>
        <div className="system-state" role="status">
          <StatusMark status={stage === "complete" ? "done" : stage === "error" ? "error" : isBusy ? "working" : "waiting"} />{stageCopy[stage]}
        </div>
      </header>

      <Setup onStatus={setSetup} />
      <section className="question-area" id="top">
        <div className="question-heading">
          <span className="eyebrow">Yeni değerlendirme</span>
          <h1 aria-label="Bir soruyu, doğru uzmanlarla birlikte düşünün.">Bir soruyu, <span className="heading-highlight">doğru uzmanlarla</span> birlikte düşünün.</h1>
        </div>
        <form className="question-form" onSubmit={handleSubmit}>
          <label htmlFor="question">Değerlendirilecek soru</label>
          <textarea
            id="question"
            value={question}
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={exampleQuestion}
            rows={5}
            disabled={isBusy}
          />
          <div className="csv-input">
            <label htmlFor="csv-file">CSV veri tablosu (isteğe bağlı)</label>
            <input id="csv-file" type="file" accept=".csv,text/csv" disabled={isBusy || readingCsv}
              onChange={event => { void loadCsv(event.target.files?.[0]); event.target.value = ""; }} />
            {readingCsv && <p role="status">CSV okunuyor…</p>}
            {(csvError || csv.error) && <p role="alert">{csvError || csv.error}</p>}
            {csvSource && <button type="button" className="text-button" disabled={isBusy || readingCsv}
              onClick={() => { setCsvSource(null); setTableConfirmed(false); setColumnNotes(""); }}>Tabloyu kaldır</button>}
            {csv.table && <>
              <p><b>{csv.table.name}</b> · {csv.table.rows.length} satır · {csv.table.columns.length} sütun</p>
              <div className="table-preview" tabIndex={0} role="region" aria-label="CSV önizlemesi"><table>
                <caption>İlk 5 satırın önizlemesi</caption>
                <thead><tr>{csv.table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
                <tbody>{csv.table.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} title={cell}>{cell}</td>)}</tr>)}</tbody>
              </table></div>
              <div className="table-preview" tabIndex={0} role="region" aria-label="Sütun istatistikleri"><table>
                <caption>Tüm dosya üzerinden hesaplanan özet</caption>
                <thead><tr><th scope="col">Sütun</th><th scope="col">Tür</th><th scope="col">Eksik</th><th scope="col">Toplam</th><th scope="col">Ortalama</th><th scope="col">Min / Maks</th></tr></thead>
                <tbody>{tableProfile.map(column => <tr key={column.name}>
                  <td>{column.name}</td><td>{column.type === "number" ? "Sayı" : "Metin"}</td><td>{column.missing}</td>
                  <td>{column.statistics ? previewNumber.format(column.statistics.sum) : "—"}</td><td>{column.statistics ? previewNumber.format(column.statistics.mean) : "—"}</td>
                  <td>{column.statistics ? `${previewNumber.format(column.statistics.min)} / ${previewNumber.format(column.statistics.max)}` : "—"}</td>
                </tr>)}</tbody>
              </table></div>
              <label htmlFor="column-notes">Sütun açıklamaları</label>
              <textarea id="column-notes" rows={2} value={columnNotes} disabled={isBusy}
                placeholder="Örn. amount EUR tutarıdır, customer_id bir kimliktir; tarih biçimi GG/AA/YYYY."
                onChange={event => { setColumnNotes(event.target.value); setTableConfirmed(false); }} />
              <label className="csv-confirm"><input type="checkbox" checked={tableConfirmed} disabled={isBusy}
                onChange={event => setTableConfirmed(event.target.checked)} /> Önizlemeyi ve sütun anlamlarını kontrol ettim.</label>
            </>}
          </div>
          <div className="model-field">
            <label htmlFor="openai-model">Kullanılacak model</label>
            <select id="openai-model" value={modelChoice} disabled={isBusy}
              aria-describedby="model-help" onChange={event => setModelChoice(event.target.value)}>
              <option value="default">Varsayılan · {defaultModel === "gpt-5-mini" ? "GPT-5 mini" : defaultModel}</option>
              <optgroup label="Güncel modeller">
                {modelOptions.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
              </optgroup>
              <optgroup label="Diğer seçenekler">
                <option value="custom">Başka bir model kullan</option>
              </optgroup>
            </select>
            {modelChoice === "custom" && <>
              <label htmlFor="custom-model">Model kimliği</label>
              <input id="custom-model" value={customModel} onChange={event => setCustomModel(event.target.value)}
                placeholder="Hesabınızdaki model kimliğini girin" disabled={isBusy} required
                autoComplete="off" spellCheck={false} aria-describedby="model-help" />
            </>}
            <small id="model-help">{modelChoice === "custom"
              ? "OpenAI hesabınızda erişiminiz olan ve Responses API ile metin üreten bir modelin tam kimliğini girin. Erişim, çalıştırma sırasında kontrol edilir."
              : (modelOptions.find(model => model.id === openaiModel)?.description || "Varsayılan model.") + " Erişim ve ücretlendirme API hesabınıza bağlıdır."}</small>
          </div>
          <div className="form-footer">
            <button type="button" className="text-button" onClick={() => setQuestion(exampleQuestion)} disabled={isBusy}>Örnek soruyu kullan</button>
            <span className="shortcut">⌘ + Enter</span>
            <button className="primary-button" type="submit" aria-busy={isBusy} aria-label={isBusy ? stageCopy[stage] : undefined} disabled={!question.trim() || !openaiModel.trim() || isBusy || setupBlocked || readingCsv || !!csvError || !!csv.error || (!!csv.table && !tableConfirmed)}>
              {isBusy ? <span className="button-wait-pulse" aria-hidden="true" /> : <>Uzmanları çalıştır <span>→</span></>}
            </button>
          </div>
        </form>
      </section>

      {(agents.length > 0 || result || stage === "error") && (
        <section className="workspace" aria-live="polite">
          <aside className="agent-rail">
            <div className="rail-heading">
              <div><span className="eyebrow">Çalışma ekibi</span><h2>Uzmanlar</h2></div>
              <span className="agent-count">{completedCount}/{agents.length}</span>
            </div>
            <div className="agent-list">
            <button
              className={`agent-card final-card ${selected === "final" ? "selected" : ""}`}
              onClick={() => setSelected("final")}
            >
              <span className="agent-number">∑</span>
              <span className="agent-copy"><b>Nihai sonuç</b><small>{stage === "complete" ? "Hazır" : stage === "judging" ? "Sentezleniyor" : "Uzmanlar bekleniyor"}</small></span>
              <StatusMark status={stage === "complete" ? "done" : stage === "error" ? "error" : stage === "judging" ? "working" : "waiting"} />
            </button>
              {agents.map(agent => (
                <button
                  key={agent.agentId}
                  className={`agent-card ${selected === agent.agentId ? "selected" : ""}`}
                  onClick={() => setSelected(agent.agentId)}
                >
                  <span className="agent-number">{String(agent.agentId).padStart(2, "0")}</span>
                  <span className="agent-copy"><b>{agent.role}</b><small>{agent.task}</small></span>
                  <StatusMark status={agent.status} />
                </button>
              ))}
            </div>
          </aside>

          <article className="result-panel">
            {selectedAgent ? (
              <>
                <div className="result-header">
                  <div><span className="eyebrow">Uzman {String(selectedAgent.agentId).padStart(2, "0")}</span><h2>{selectedAgent.role}</h2></div>
                  <span className={`result-status status-label-${selectedAgent.status}`}><StatusMark status={selectedAgent.status} />{selectedAgent.status === "done" ? "Tamamlandı" : selectedAgent.status === "working" ? "Çalışıyor" : selectedAgent.status === "error" ? "Hata" : "Sırada"}</span>
                </div>
                <div className="task-note"><span>Atanan görev</span>{selectedAgent.task}</div>
                {selectedAgent.answer ? <RichText text={selectedAgent.answer} /> : (
                  <div className="empty-result"><StatusMark status={selectedAgent.status} />
                    <h3>{selectedAgent.status === "working" ? "Uzman görüşünü hazırlıyor" : selectedAgent.status === "error" ? "Bu uzman tamamlanamadı" : "Bu uzman sırasını bekliyor"}</h3>
                    <p>{selectedAgent.error || "Yanıt hazır olduğunda burada otomatik olarak görünecek."}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="result-header">
                  <div><span className="eyebrow">Birleşik değerlendirme</span><h2>Nihai sonuç</h2></div>
                  {result && <div className="result-actions">
                    <button className="secondary-button" type="button" disabled={!hasFlow}
                      title={!hasFlow ? "Bu sonuçta çözüm akışı bulunmuyor." : undefined}
                      aria-haspopup="dialog" onClick={() => diagramDialog.current?.showModal()}>Çözüm akışını göster</button>
                    {setup?.enabled && !setup.docsEnabled ? <a className="docs-link" href="#google-docs-setup">Google Docs kurulumu</a> : documentUrl ? <a className="docs-link" href={documentUrl} target="_blank" rel="noreferrer">Google Docs’u aç ↗</a> : (
                      <button className="secondary-button" onClick={saveToDocs} disabled={savingDocs}>{savingDocs ? "Kaydediliyor…" : "Google Docs’a kaydet"}</button>
                    )}
                  </div>}
                </div>
                {result ? (
                  <>
                    <div className="summary-meta"><span>{result.agentCount} uzman görüşü</span><span>{result.questionType || "genel"}</span><span>{result.openaiModel ?? result.model ?? "gpt-5-mini"}</span></div>
                    <RichText
  text={
    result.displayAnswer  ||
    result.finalAnswer ||
    ""
  }
/>
                  </>
                ) : (
                  <div className="empty-result"><StatusMark status={stage === "judging" ? "working" : stage === "error" ? "error" : "waiting"} />
                    <h3>{stage === "error" ? "Değerlendirme durduruldu" : stage === "judging" ? "Görüşler birleştiriliyor" : "Nihai sonuç uzmanlardan sonra oluşacak"}</h3>
                    <p>{stage === "error" ? "İşlem bir hata nedeniyle durdu. Sorunu giderdikten sonra değerlendirmeyi yeniden başlatın." : "Bu sırada soldaki uzmanlara tıklayarak tamamlanan bağımsız cevapları okuyabilirsiniz."}</p>
                  </div>
                )}
              </>
            )}
            {error && <div className="error-banner"><b>İşlem tamamlanamadı</b><span>{error}</span></div>}
          </article>
        </section>
      )}

      {hasFlow && (
        <dialog ref={diagramDialog} className="diagram-dialog" aria-labelledby="diagram-title">
          <header className="diagram-dialog-header">
            <h2 id="diagram-title">Çözüm akışı</h2>
            <div className="diagram-dialog-actions">
              <button className="secondary-button" type="button" onClick={() => downloadSolutionDiagram(diagramSvg)}>SVG indir</button>
              <form method="dialog">
                <button className="secondary-button" type="submit">Kapat</button>
              </form>
            </div>
          </header>
          <figure className="solution-diagram" tabIndex={0} aria-label="Çözüm diyagramı, kaydırılabilir alan">
            {/* eslint-disable-next-line @next/next/no-img-element -- The flow is rendered locally as an SVG. */}
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagramSvg)}`}
              alt="Çözüm adımları, karar dalları ve yönlü bağlantılar" />
          </figure>
        </dialog>
      )}
    </main>
  );
}
