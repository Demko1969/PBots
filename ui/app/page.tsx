"use client";

import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, attachmentType, createAttachmentThumbnail, isAttachmentThumbnail, matchesAttachmentSignature } from "../lib/attachments";
import { splitExpertAnswer } from "../lib/expert-answer";
import { isDiscussionExpert, runEvaluation, sha256, shortAnswer, type Agent, type AgentStatus, type JudgeResult, type SavedRun } from "../lib/evaluation-run";
import { downloadSolutionDiagram, renderSolutionDiagram, type SolutionFlow } from "../lib/diagram";
import { conversationBefore } from "../lib/conversation";
import { canShowStoredDiagram } from "../lib/judge-review";
import { historyGroupKey, historyTime, type HistoryDeletion } from "../lib/history-groups";
import Image from "next/image";
import { appRequest, brandLogo, robotSprite, isDemoTransport } from "../lib/app-request";
import Setup, { type SetupStatus } from "../components/Setup";
import { isTablePreview, MAX_CSV_BYTES, parseCsv, profileTable, tablePreviewFromContext, type TablePreview } from "../lib/table";
import { type Language } from "../lib/language";
import { LanguageSelect, setupGuide, useMessages, WorkspaceLanguage } from "../lib/workspace-language";
import { Fragment, type DragEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type DemoScenario = {
  question: string;
  followUps: { question: string; attachment?: File }[];
  presentation: (language: Language) => {
    question: (question: string) => string;
    agent: (question: string, agent: Agent) => Agent;
    result: (question: string, result: JudgeResult) => JudgeResult;
    diagram: (question: string, flow: SolutionFlow) => SolutionFlow;
    imageUrl: (question: string) => string | undefined;
    tableLabel: (value: string) => string;
  };
  download: string;
  model: { id: string; label: string };
  expertCount: (question: string) => number;
  installationUrl: string;
  csv: { name: string; text: string };
};

type Stage = "idle" | "planning" | "working" | "judging" | "complete" | "cancelled" | "error";
type HistoryGroup = { key: string; question: string; completed: boolean };

const historyKey = "ortak-akil.history.v1";

async function historyRequest<T>(body: Record<string, unknown>): Promise<T> {
  const response = await appRequest("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Yerel geçmişe erişilemedi.");
  return data as T;
}

let migration: Promise<void> | undefined;

async function importBrowserHistory() {
  if (isDemoTransport) return;
  let entries: SavedRun[];
  try { entries = JSON.parse(localStorage.getItem(historyKey) ?? "[]"); }
  catch { return; }
  if (!Array.isArray(entries) || !entries.length) return;
  for (const run of entries) await historyRequest({ action: "import", run });
  try { localStorage.removeItem(historyKey); } catch { /* Imports are idempotent. */ }
}

async function readHistory<T>(query: Record<string, unknown>) {
  migration ??= importBrowserHistory().catch(error => {
    migration = undefined;
    throw error;
  });
  await migration;
  return historyRequest<T>(query);
}

function googleDocumentUrl(value: unknown) {
  if (typeof value !== "string" || !URL.canParse(value)) return;
  const url = new URL(value);
  if (url.origin === "https://docs.google.com" && !url.username && !url.password &&
      url.pathname.startsWith("/document/")) return url.href;
}

// Selection guidance checked against https://developers.openai.com/api/docs/models on 2026-11-08.
const modelOptions = [
  { id: "gpt-6-astra", label: "GPT-6 Astra · En güçlü analiz" },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol · Dengeli" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra · Hızlı" },
  { id: "gpt-6-luna", label: "GPT-6 Luna · Ekonomik" },
];

async function postStage<T>(stage: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const response = await appRequest(`/api/n8n/${stage}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
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

function expertRole(role: string) {
  return /^kimlik\s+açıkla(?:dır|yıcı)?[.!]?$/iu.test(role.trim()) ? "Biyografi Araştırmacısı" : role;
}

const exampleQuestions = [
  "ERP geçişinde stok ve finans verilerini nasıl mutabık hale getiririz?",
  "Talep tahminleri sapıyorsa MRP parametrelerini nasıl yeniden ayarlarız?",
  "Üç fabrikada üretim planını kapasite ve teslimat kısıtlarına göre nasıl dengeleriz?",
  "ERP’de siparişten tahsilata kadar hangi kontrolleri otomatikleştirebiliriz?",
];

function SendSymbol() {
  return (
    <span className="send-symbol" aria-hidden="true">
      <span className="send-symbol-blade send-symbol-blade-top" />
      <span className="send-symbol-blade send-symbol-blade-right" />
      <span className="send-symbol-blade send-symbol-blade-bottom" />
      <span className="send-symbol-blade send-symbol-center" />
    </span>
  );
}

function DownloadIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" />
  </svg>;
}

function PlanningCrew({ fixedCount }: { fixedCount?: number }) {
  const [bots, setBots] = useState(() => Array.from({ length: fixedCount ?? 3 }, (_, index) => index + 1));

  function shuffleBots() {
    setBots(previous => {
      const next = Array.from({ length: 10 }, (_, index) => index + 1);
      for (let index = 0; index < 3; index++) {
        const selected = index + Math.floor(Math.random() * (next.length - index));
        [next[index], next[selected]] = [next[selected], next[index]];
      }
      if (next.slice(0, 3).every(bot => previous.includes(bot))) next[2] = next[3];
      return next.slice(0, 3);
    });
  }

  return (
    <div className="planning-crew" aria-hidden="true" onAnimationIteration={event => {
      if (fixedCount === undefined && event.target === event.currentTarget) shuffleBots();
    }}>
      {bots.map((bot, slot) => <span key={slot} className="planning-slot"><AgentIcon agentId={bot} /></span>)}
    </div>
  );
}

function AgentIcon({ agentId }: { agentId: number }) {
  const bot = ((agentId - 1) % 10 + 10) % 10 + 1;
  return <svg className="robot-icon expert-bot-icon" width="34" height="30" aria-hidden="true">
    <use href={`${robotSprite}#bot-${bot}`} width="100%" height="100%" />
  </svg>;
}

function ExpertTask({ role, task }: Pick<Agent, "role" | "task">) {
  return <div className="task-note"><h3>{role}</h3>{task}</div>;
}

function ExpertRoleTooltip({ role }: Pick<Agent, "role">) {
  return <span className="expert-tooltip expert-role-tooltip" aria-hidden="true">{expertRole(role)}</span>;
}

function ResultText({ result }: { result: JudgeResult }) {
  const { t } = useMessages();
  return <>
    <RichText text={result.displayAnswer || result.finalAnswer} hideDecisionHeading />
    {result.diagramIssue && <p className="evaluation-notice" role="status">{t(result.diagramIssue)}</p>}
  </>;
}

function FinalResultIcon({ confirmed, animate }: { confirmed: boolean; animate: boolean }) {
  return (
    <svg className="result-return-icon" data-confirmed={confirmed} data-animate={animate} width="36" height="36" viewBox="0 0 32 32"
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="result-arrow result-arrow-nw" d="m2 2 6 6M3 8h5V3" />
      <path className="result-arrow result-arrow-ne" d="m30 2-6 6m0-5v5h5" />
      <path className="result-arrow result-arrow-sw" d="m2 30 6-6m-5 0h5v5" />
      <path className="result-arrow result-arrow-se" d="m30 30-6-6m0 5v-5h5" />
      <path className="result-check" d="m8 16 5.5 5.5L24 11" pathLength="1" strokeWidth="2.6" />
      <g className="result-crew">
        {[{ x: 12, y: 7 }, { x: 7, y: 12.5 }, { x: 17, y: 12.5 }, { x: 12, y: 18 }].map(({ x, y }) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y})`} strokeWidth="1.2">
            <path d="M4 0v2" />
            <rect y="2" width="8" height="5" rx="1.6" />
            <path d="M2.6 4.5h.1m2.6 0h.1" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function FinalResultButton({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  const { t } = useMessages();
  const [activation, setActivation] = useState(0);

  return (
    <button type="button" className="text-button discussion-center" aria-label={t("Uzmanların kararı")}
      aria-pressed={selected} aria-disabled={selected} onClick={() => {
        if (selected) return;
        setActivation(value => value + 1);
        onClick();
      }}>
      <FinalResultIcon key={activation} confirmed={selected} animate={selected && activation > 0} />
      <span className="expert-tooltip" aria-hidden="true">{t("Uzmanların kararı")}</span>
    </button>
  );
}

function ExportIcon({ kind }: { kind: "docs" | "diagram" }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "docs"
      ? <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6" />
      : <path d="M9 3h6v5H9zM3 16h6v5H3zm12 0h6v5h-6zM12 8v4m-6 4v-4h12v4" />}
  </svg>;
}

function AnimatedAnswer({ view, className = "", children }: {
  view: string | number; className?: string; children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const height = useRef<number | null>(null);
  const previousContent = useRef<HTMLDivElement | null>(null);
  const previousView = useRef(view);
  const outgoing = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const outer = frame.current;
    const inner = content.current;
    if (!outer || !inner) return;

    const from = animation.current ? outer.getBoundingClientRect().height : height.current;
    animation.current?.cancel();
    animation.current = null;
    outer.style.removeProperty("overflow");
    const to = inner.getBoundingClientRect().height;
    height.current = to;
    const previous = previousContent.current;
    previousContent.current = inner;
    const fromProgress = previousView.current === "progress";
    previousView.current = view;
    const overlay = outgoing.current;
    overlay?.replaceChildren();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function revealAnswerStart() {
      if (!outer || !inner || view === "progress") return;
      const viewport = outer.closest<HTMLElement>(".thread-scroll");
      const controls = outer.previousElementSibling;
      if (!viewport || !controls) return;
      const viewportBounds = viewport.getBoundingClientRect();
      const controlsBounds = controls.getBoundingClientRect();
      const answerBounds = inner.getBoundingClientRect();
      if (controlsBounds.bottom <= viewportBounds.top || controlsBounds.top >= viewportBounds.bottom ||
          answerBounds.top < viewportBounds.top) return;
      const preview = Math.min(96, inner.offsetHeight);
      const missing = preview - (viewportBounds.bottom - answerBounds.top);
      if (missing > 1) viewport.scrollBy({ top: missing, behavior: reduceMotion ? "instant" : "smooth" });
    }

    if (previous && previous !== inner && !reduceMotion) {
      const duration = from !== null && from > to ? 440 : 320;
      if (from !== null && Math.abs(from - to) >= 1) {
        outer.style.overflow = "clip";
        const movement = outer.animate([{ height: `${from}px` }, { height: `${to}px` }], {
          duration, easing: "cubic-bezier(.25, .1, .25, 1)",
        });
        animation.current = movement;
        movement.onfinish = () => {
          outer.style.removeProperty("overflow");
          animation.current = null;
          revealAnswerStart();
        };
      }

      overlay?.append(previous.cloneNode(true));
      const fadeOut = overlay?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" });
      if (fadeOut) fadeOut.onfinish = () => { overlay?.replaceChildren(); fadeOut.cancel(); };
      const fadeIn = inner.animate([
        { opacity: 0, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], { delay: fromProgress ? 160 : 45, duration: 235, easing: "ease-out", fill: "backwards" });
      if (!animation.current) fadeIn.onfinish = revealAnswerStart;
    } else if (previous && previous !== inner) {
      revealAnswerStart();
    }

    const observer = new ResizeObserver(() => {
      height.current = inner.getBoundingClientRect().height;
    });
    observer.observe(inner);
    return () => {
      observer.disconnect();
      overlay?.getAnimations().forEach(animation => animation.cancel());
      overlay?.replaceChildren();
    };
  }, [view]);

  useEffect(() => () => animation.current?.cancel(), []);

  return <div className={`answer-frame ${className}`} ref={frame}>
    <div ref={outgoing} className="outgoing-answer" aria-hidden="true" inert />
    <div className="answer-content" key={view} ref={content}>{children}</div>
  </div>;
}

function savedTablePreview(run: SavedRun) {
  if (run.tablePreview === null) return;
  if (isTablePreview(run.tablePreview)) return run.tablePreview;
  return tablePreviewFromContext(run.followUpPrompt ?? run.plan?.question ?? run.result?.question);
}

function ImagePreview({ imageUrl, className, label, alt = label, children }: {
  imageUrl: string; className: string; label: string; alt?: string; children: ReactNode;
}) {
  const { t } = useMessages();
  const dialog = useRef<HTMLDialogElement>(null);

  function dismissImage() {
    const preview = dialog.current;
    if (!preview?.open) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) preview.close();
    else preview.dataset.closing = "true";
  }

  return <>
    <button className={className} type="button" aria-label={t("Görseli büyüt")}
      aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>{children}</button>
    <dialog ref={dialog} className="diagram-dialog image-preview-dialog" aria-label={label}
      onCancel={event => { event.preventDefault(); dismissImage(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dismissImage();
      }}
      onAnimationEnd={event => {
        if (event.animationName === "image-preview-dismiss") event.currentTarget.close();
      }}
      onClose={event => { delete event.currentTarget.dataset.closing; }}>
      <button className="diagram-action diagram-close image-preview-close" type="button"
        aria-label={t("Kapat")} title={t("Kapat")} onClick={dismissImage}>×</button>
      {/* eslint-disable-next-line @next/next/no-img-element -- Attachments keep their original dimensions. */}
      <img src={imageUrl} alt={alt} />
    </dialog>
  </>;
}

function ThreadQuestion({ question, thumbnail, table, imageUrl, demoImageUrl, tableLabel }: {
  question: string; thumbnail?: string; table?: TablePreview; imageUrl?: string; demoImageUrl?: string; tableLabel?: (value: string) => string;
}) {
  const { language, t } = useMessages();
  const number = new Intl.NumberFormat(language);
  const imageSource = demoImageUrl ?? (isAttachmentThumbnail(thumbnail) ? thumbnail : imageUrl);
  const imageLabel = t(demoImageUrl ? "Finans talebinin ekran görüntüsü" : "Soruya eklenen görsel");
  return <>
    {imageSource && <ImagePreview className="thread-image-trigger" imageUrl={demoImageUrl ?? imageUrl ?? imageSource}
      label={imageLabel} alt={demoImageUrl ? t("T-ERP-024 Finans destek talebinin tamamı") : imageLabel}>
      {/* eslint-disable-next-line @next/next/no-img-element -- The source is an attachment preview. */}
      <img className="thread-question-image" src={imageSource} alt={t("Soruya eklenen görsel")} />
    </ImagePreview>}
    {table && (
      <div className="thread-table-preview" role="region" aria-label={t("Soruya eklenen tablo")} tabIndex={0}>
        <table>
          <caption>{table[0]} · {t("{total} satır", { total: number.format(table[3]) })}{table[3] > table[2].length &&
            " · " + t("İlk {total} satır", { total: number.format(table[2].length) })}</caption>
          <thead><tr>{table[1].map((column, index) => <th key={index} scope="col">{tableLabel?.(column) ?? column}</th>)}</tr></thead>
          <tbody>{table[2].map((row, index) => <tr key={index}>
            {row.map((cell, column) => <td key={column}>{(tableLabel?.(cell) ?? cell) || "—"}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    )}
    <p className="thread-question">{question}</p>
  </>;
}

function ThreadTurn({ run, result, exports, imageUrl, demoImageUrl, tableLabel }: {
  run: SavedRun; result: JudgeResult; exports: ReactNode; imageUrl?: string; demoImageUrl?: string; tableLabel?: (value: string) => string;
}) {
  const { t } = useMessages();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const experts = result.answers.filter(agent => agent.answer && isDiscussionExpert(agent));
  const expert = experts.find(agent => agent.agentId === selectedId);

  return (
    <article className="thread-entry">
      <div className="thread-turn-header">
        <ThreadQuestion question={run.question} thumbnail={run.imageThumbnail} table={savedTablePreview(run)} imageUrl={imageUrl} demoImageUrl={demoImageUrl} tableLabel={tableLabel} />
        <div className="result-toolbar">
          {experts.length > 0 && <div className="result-experts" role="group" aria-label={t("Bu sorunun uzman görüşleri")}>
            <FinalResultButton selected={selectedId === null} onClick={() => setSelectedId(null)} />
            {experts.map(agent => (
              <button key={agent.agentId} type="button" className="robot-head robot-done"
                aria-label={expertRole(agent.role)} aria-pressed={selectedId === agent.agentId}
                onClick={() => setSelectedId(current => current === agent.agentId ? null : agent.agentId)}>
                <AgentIcon agentId={agent.agentId} /><ExpertRoleTooltip role={agent.role} />
              </button>
            ))}
          </div>}
          {exports}
        </div>
      </div>
      <AnimatedAnswer className="thread-answer" view={selectedId ?? "final"}>
        {expert ? <>
          <ExpertTask role={expert.role} task={expert.task} />
          <RichText text={splitExpertAnswer(expert.answer ?? "").answer} />
        </> : <ResultText result={result} />}
      </AnimatedAnswer>
    </article>
  );
}

function HistoryDisclosure({ className, summary, summaryClassName, onOpen, children }: {
  className?: string;
  summary: ReactNode;
  summaryClassName?: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const motion = useRef<{ animation: Animation; opening: boolean } | null>(null);

  useEffect(() => () => motion.current?.animation.cancel(), []);

  function toggle() {
    const disclosure = details.current;
    const body = content.current;
    if (!disclosure || !body || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

    const previous = motion.current;
    const opening = previous && disclosure.open ? !previous.opening : !disclosure.open;
    const height = disclosure.open ? body.getBoundingClientRect().height : 0;
    const opacity = disclosure.open ? getComputedStyle(body).opacity : "0";
    previous?.animation.cancel();
    if (opening) disclosure.open = true;
    const targetHeight = opening ? body.getBoundingClientRect().height : 0;
    body.style.overflow = "hidden";
    const animation = body.animate([
      { height: `${height}px`, opacity },
      { height: `${targetHeight}px`, opacity: opening ? 1 : 0 },
    ], { duration: 200, easing: "ease-in-out", fill: "both" });
    motion.current = { animation, opening };
    animation.onfinish = () => {
      if (!opening) disclosure.open = false;
      animation.cancel();
      body.style.removeProperty("overflow");
      motion.current = null;
    };
    return true;
  }

  return <details ref={details} className={className} data-history-disclosure=""
    onToggle={event => { if (event.currentTarget.open) onOpen?.(); }}>
    <summary className={summaryClassName} onClick={event => { if (toggle()) event.preventDefault(); }}>{summary}</summary>
    <div ref={content} className="history-disclosure-content">{children}</div>
  </details>;
}

async function collapseDeletedRecord(row: HTMLElement | null) {
  if (!row?.isConnected || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const style = getComputedStyle(row);
  row.style.overflow = "hidden";
  const animation = row.animate([
    { height: `${row.getBoundingClientRect().height}px`, opacity: 1, marginBlockStart: style.marginBlockStart,
      paddingBlockStart: style.paddingBlockStart, paddingBlockEnd: style.paddingBlockEnd },
    { height: "0px", opacity: 0, marginBlockStart: "0px", paddingBlockStart: "0px", paddingBlockEnd: "0px" },
  ], { duration: 190, easing: "ease-in-out", fill: "forwards" });
  await animation.finished.catch(() => {});
}

function RichText({ text, hideDecisionHeading = false }: { text: string; hideDecisionHeading?: boolean }) {
  const decisionHeading = /^\s*(?:#{1,6}\s+)?(?:\*\*)?karar(?:\*\*)?\s*(?:[:：](?:\*\*)?\s*(.*))?\s*$/iu;
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (hideDecisionHeading) {
    lines = lines.flatMap(line => {
      const heading = decisionHeading.exec(line);
      return heading ? (heading[1]?.trim() ? [heading[1].trim()] : []) : [line];
    });
  }
  lines = lines.join("\n").trimStart().split("\n");
  return (
    <div className="rich-text">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();
        if (!line) return <div className="text-gap" key={index} aria-hidden="true" />;
        const decision = /^(?:\*\*)?karar(?:\*\*)?\s*[:：](?:\*\*)?\s*(.*)$/iu.exec(line);
        if (decision) return <Fragment key={index}><h3>Karar</h3>{decision[1] && <p>{formatInline(decision[1])}</p>}</Fragment>;
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

function JudgingThoughts({ children, visible = true }: { children: ReactNode; visible?: boolean }) {
  const scene = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    const layout = scene.current;
    const destination = bubble.current;
    if (!layout || !destination) return;

    const observer = new ResizeObserver(() => {
      const bounds = layout.getBoundingClientRect();
      const end = destination.getBoundingClientRect();
      const endX = Math.round(end.left + end.width / 2 - bounds.left);
      setPaths(Array.from(layout.querySelectorAll(".robot-head"), robot => {
        const start = robot.getBoundingClientRect();
        const x = Math.round(start.left + start.width / 2 - bounds.left);
        const bubbleBelow = end.top >= start.bottom;
        const endY = Math.round((bubbleBelow ? end.top : end.bottom) - bounds.top);
        const y = Math.round((bubbleBelow ? start.bottom : start.top) - bounds.top);
        const middle = Math.round((y + endY) / 2);
        return `M ${x} ${y} C ${x} ${middle}, ${endX} ${middle}, ${endX} ${endY}`;
      }));
    });

    observer.observe(layout);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="judging-thoughts" data-thoughts-visible={visible} ref={scene}>
      <svg aria-hidden="true" className="thought-streams">
        {paths.map((path, index) => {
          const begin = `${(index % 5) * 0.14}s`;
          return (
            <g key={index}>
              <path d={path} className="thought-stream" />
              <circle r="2.6" className="thought-pulse" visibility="hidden">
                <set attributeName="visibility" to="visible" begin={begin} fill="freeze" />
                <animateMotion path={path} begin={begin} dur="1.35s" repeatCount="indefinite" />
              </circle>
            </g>
          );
        })}
      </svg>
      <div ref={bubble} className="thinking-bubble" aria-hidden="true"><i /><i /><i /></div>
      {children}
    </div>
  );
}

function StatusMark({ status }: { status: AgentStatus }) {
  const { t } = useMessages();
  return <span className={`status-mark status-${status}`} aria-label={{ waiting: t("Bekliyor"), working: t("Çalışıyor"), done: t("Tamamlandı"), error: t("Hata") }[status]} role="img" />;
}

function useAttachment(sample?: DemoScenario["csv"]) {
  const [media, setMedia] = useState<{ file: File; mime: string; digest: string; preview?: string; thumbnail?: string } | null>(null);
  const [csvSource, setCsvSource] = useState<DemoScenario["csv"] | null>(sample ?? null);
  const [readingCsv, setReadingCsv] = useState(false);
  const [csvError, setCsvError] = useState("");
  const csv = useMemo(() => {
    if (!csvSource) return { table: null, error: "" };
    try { return { table: parseCsv(csvSource.text, csvSource.name), error: "" }; }
    catch (error) { return { table: null, error: error instanceof Error ? error.message : "CSV okunamadı" }; }
  }, [csvSource]);
  const tableProfile = useMemo(() => csv.table ? profileTable(csv.table) : [], [csv.table]);

  const loadVersion = useRef(0);
  const preview = media?.preview;
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function loadAttachment(file: File | undefined) {
    const version = ++loadVersion.current;
    setReadingCsv(false);
    setMedia(null);
    setCsvSource(file ? null : sample ?? null);
    setCsvError("");
    if (!file) return;
    const mime = attachmentType(file.name);
    if (!mime) { setCsvError("JPG, PNG, PDF veya CSV dosyası seçin."); return; }
    const isCsv = mime === "text/csv";
    if (file.size > (isCsv ? MAX_CSV_BYTES : MAX_ATTACHMENT_BYTES)) {
      setCsvError(isCsv ? "CSV en fazla 1 MB olabilir." : "JPG, PNG ve PDF en fazla 5 MB olabilir.");
      return;
    }
    setReadingCsv(true);
    try {
      if (isCsv) {
        const text = await file.text();
        if (version === loadVersion.current) setCsvSource({ name: file.name, text });
      } else {
        const bytes = await file.arrayBuffer();
        if (!matchesAttachmentSignature(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8)), mime)) {
          if (version === loadVersion.current) setCsvError("Dosyanın içeriği uzantısıyla eşleşmiyor.");
          return;
        }
        const blob = new Blob([file], { type: mime });
        const [digest, thumbnail] = await Promise.all([
          sha256(bytes),
          mime.startsWith("image/") ? createAttachmentThumbnail(blob).catch(() => undefined) : undefined,
        ]);
        if (version === loadVersion.current) {
          const preview = URL.createObjectURL(blob);
          setMedia({ file, mime, digest, preview, thumbnail });
        }
      }
    }
    catch { if (version === loadVersion.current) setCsvError("Dosya okunamadı."); }
    finally { if (version === loadVersion.current) setReadingCsv(false); }
  }

  return { csvSource, csv,
    readingCsv, csvError, tableProfile, loadAttachment, media, setCsvError };
}

function EvaluationExports({ run, documentUrl, docsDisabled, managedSetup, savingDocs, onSetup, onSave, onDiagram, showDocs = true }: {
  run: SavedRun;
  documentUrl?: string;
  docsDisabled: boolean;
  showDocs?: boolean;
  managedSetup: boolean;
  savingDocs: boolean;
  onSetup: () => void;
  onSave: (run: SavedRun) => Promise<void>;
  onDiagram: (flow: SolutionFlow) => void;
}) {
  const { language, t } = useMessages();
  const completed = run.result;
  if (!completed?.agentCount) return null;
  const flow = completed.diagram;
  return (
    <div className="result-exports" role="group" aria-label={t("Sonucu dışa aktar")}>
      {showDocs && (docsDisabled ? (
        <a className="result-export" href={managedSetup ? "#google-docs-setup" : setupGuide("google-docs", language)} aria-label={t("Google Docs kurulumu")} onClick={event => {
          if (!managedSetup) return;
          event.preventDefault();
          onSetup();
        }}><ExportIcon kind="docs" /><span className="expert-tooltip" aria-hidden="true">{t("Google Docs kurulumu")}</span></a>
      ) : documentUrl ? (
        <a className="result-export" href={documentUrl} target="_blank" rel="noreferrer"
          aria-label={t("Google Docs’u aç")}><ExportIcon kind="docs" /><span className="expert-tooltip" aria-hidden="true">{t("Google Docs’u aç")}</span></a>
      ) : (
        <button type="button" className="result-export" onClick={() => void onSave(run)} disabled={savingDocs} aria-busy={savingDocs}
          aria-label={savingDocs ? t("Google Docs’a kaydediliyor") : t("Google Docs’a kaydet")}>
          <ExportIcon kind="docs" />
          <span className="expert-tooltip" aria-hidden="true">{t("Docs’a kaydet")}</span>
        </button>
      ))}
      {flow && canShowStoredDiagram(completed.showDiagram, flow) && <button className="result-export" type="button" aria-label={t("Çözüm akışını göster")}
        aria-haspopup="dialog" onClick={() => onDiagram(flow)}><ExportIcon kind="diagram" /><span className="expert-tooltip" aria-hidden="true">{t("Diyagramı göster")}</span></button>}
    </div>
  );
}

export default function Home() {
  return <Workspace />;
}

export function Workspace({ demo }: { demo?: DemoScenario }) {
  return <WorkspaceLanguage><WorkspaceContent demo={demo} /></WorkspaceLanguage>;
}

function WorkspaceContent({ demo }: { demo?: DemoScenario }) {
  const { language, t } = useMessages();
  const presentation = useMemo(() => demo?.presentation(language), [demo, language]);
  const showQuestionText = (text: string) => presentation?.question(text) ?? text;
  const previewNumber = new Intl.NumberFormat(language, { maximumSignificantDigits: 6 });
  const pageTitle = t(demo ? "Ortak Akıl | Tarayıcı demosu" : "Ortak Akıl — Çoklu Uzman Karar Alanı");
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = pageTitle;
  }, [language, pageTitle]);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const setupBlocked = !!setup?.enabled && (!setup.configured || !setup.connected || !!setup.installing);
  const [question, setQuestion] = useState(demo?.question ?? "");
  const [questionError, setQuestionError] = useState("");
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const questionField = useRef<HTMLTextAreaElement>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const questionAttachment = useAttachment(demo?.csv);
  const followUpAttachment = useAttachment();
  const demoAttempt = useRef<string | undefined>(undefined);
  const { csvSource, csv,
    readingCsv, csvError, tableProfile, loadAttachment, media, setCsvError } = showWorkspace ? followUpAttachment : questionAttachment;
  const [draggingAttachment, setDraggingAttachment] = useState(false);
  const dragDepth = useRef(0);
  const hasAttachment = !!(media || csvSource);
  const attachmentName = media?.file.name ?? csvSource?.name;
  const attachmentBlocked = readingCsv || !!csvError || !!csv.error;
  const [modelChoice, setModelChoice] = useState("default");
  const [customModel, setCustomModel] = useState("");
  const defaultModel = setup?.defaultModel || "gpt-5-mini";
  const openaiModel = demo?.model.id ?? (modelChoice === "custom" ? customModel : modelChoice === "default" ? defaultModel : modelChoice);
  const [stage, setStage] = useState<Stage>("idle");
  const isBusy = ["planning", "working", "judging"].includes(stage);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<"final" | number>("final");
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [error, setError] = useState("");
  const [docsLinks, setDocsLinks] = useState<Record<string, string>>({});
  const [savingDocs, setSavingDocs] = useState(false);

  const [historyGroups, setHistoryGroups] = useState<HistoryGroup[]>([]);
  const [managementRuns, setManagementRuns] = useState<Record<string, SavedRun[]>>({});
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [openingHistory, setOpeningHistory] = useState(false);
  const historyOpenVersion = useRef(0);
  const historyListVersion = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelTrigger = useRef<HTMLButtonElement>(null);
  const modelChoices = useRef<HTMLDivElement>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const historySearchField = useRef<HTMLInputElement>(null);
  const [historySearch, setHistorySearch] = useState("");
  const historyQuery = historySearch.trim().normalize("NFC").toLocaleLowerCase(language);
  const visibleHistory = historyGroups.filter(group => showQuestionText(group.question).normalize("NFC").toLocaleLowerCase(language).includes(historyQuery));
  const [historyError, setHistoryError] = useState("");
  const evaluation = useRef<AbortController | null>(null);
  const [displayQuestion, setDisplayQuestion] = useState("");
  const [displayThumbnail, setDisplayThumbnail] = useState<string>();
  const [displayImageUrl, setDisplayImageUrl] = useState<string>();
  const sessionImages = useRef(new Map<string, string>());
  const [sentImages, setSentImages] = useState<ReadonlyMap<string, string>>(() => new Map());
  useEffect(() => {
    const images = sessionImages.current;
    return () => {
      images.forEach(url => URL.revokeObjectURL(url));
      images.clear();
    };
  }, []);
  const [displayTable, setDisplayTable] = useState<TablePreview>();
  const [activeRecord, setActiveRecord] = useState<SavedRun | null>(null);
  const [previousTurns, setPreviousTurns] = useState<SavedRun[]>([]);
  const submitting = useRef(false);
  const currentTurn = useRef<HTMLElement>(null);
  const scrollPending = useRef<"bottom" | "turn" | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  useEffect(() => {
    const timers = new Map<HTMLElement, number>();
    function showScrollbar(event: Event) {
      const target = event.target === document ? document.documentElement : event.target;
      if (!(target instanceof HTMLElement)) return;
      target.dataset.scrolling = "true";
      window.clearTimeout(timers.get(target));
      timers.set(target, window.setTimeout(() => {
        delete target.dataset.scrolling;
        timers.delete(target);
      }, 650));
    }
    document.addEventListener("scroll", showScrollbar, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", showScrollbar, true);
      for (const [target, timer] of timers) {
        window.clearTimeout(timer);
        delete target.dataset.scrolling;
      }
    };
  }, []);

  useEffect(() => {
    if (searchOpen && historyOpen) historySearchField.current?.focus({ preventScroll: true });
  }, [searchOpen, historyOpen]);

  useLayoutEffect(() => {
    const trigger = modelTrigger.current;
    const choices = modelChoices.current;
    if (!trigger || !choices) return;
    if (!settingsOpen || !modelPickerOpen || isBusy) {
      if (choices.matches(":popover-open")) choices.hidePopover();
      return;
    }

    function positionChoices() {
      if (!trigger || !choices) return;
      const anchor = trigger.getBoundingClientRect();
      const gap = 6;
      const viewportInset = 8;
      const availableBelow = window.innerHeight - anchor.bottom - gap - viewportInset;
      const availableAbove = anchor.top - gap - viewportInset;
      const openAbove = availableBelow < choices.scrollHeight && availableAbove > availableBelow;
      choices.style.left = `${anchor.left}px`;
      choices.style.width = `${anchor.width}px`;
      choices.style.maxHeight = `${Math.max(0, openAbove ? availableAbove : availableBelow)}px`;
      choices.style.top = openAbove ? "auto" : `${anchor.bottom + gap}px`;
      choices.style.bottom = openAbove ? `${window.innerHeight - anchor.top + gap}px` : "auto";
    }

    choices.showPopover();
    positionChoices();
    window.addEventListener("resize", positionChoices);
    window.addEventListener("scroll", positionChoices, true);
    return () => {
      window.removeEventListener("resize", positionChoices);
      window.removeEventListener("scroll", positionChoices, true);
      if (choices.matches(":popover-open")) choices.hidePopover();
    };
  }, [settingsOpen, modelPickerOpen, isBusy]);

  useEffect(() => {
    const settings = document.getElementById("evaluation-settings");
    if (!settingsOpen) {
      settings?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach(details => { details.open = false; });
    }
    if (!settingsOpen && !csvOpen && !searchOpen) return;

    function dismissOutside(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (settingsOpen && !target.closest('#evaluation-settings, #model-choices, [aria-controls="evaluation-settings"]')) {
        setSettingsOpen(false);
      }
      if (csvOpen && !target.closest('#csv-panel, [aria-controls="csv-panel"]')) {
        setCsvOpen(false);
      }
      if (modelPickerOpen && !target.closest(".model-picker")) {
        setModelPickerOpen(false);
      }
      if (searchOpen && !target.closest('.run-history')) {
        setSearchOpen(false);
        setHistorySearch("");
      }
    }

    document.addEventListener("click", dismissOutside, true);
    return () => document.removeEventListener("click", dismissOutside, true);
  }, [settingsOpen, csvOpen, searchOpen, modelPickerOpen]);

  function showQuestion(focus = true) {
    historyOpenVersion.current++;
    setOpeningHistory(false);
    setShowWorkspace(false);
    if (focus) requestAnimationFrame(() => questionField.current?.focus());
  }

  useLayoutEffect(() => {
    const mode = scrollPending.current;
    const turn = currentTurn.current;
    const viewport = turn?.closest<HTMLElement>(".thread-scroll");
    if (!mode || !turn || !viewport) return;

    scrollPending.current = null;
    if (mode === "bottom") {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({ top: turn.offsetTop, behavior: demo || reducedMotion ? "instant" : "smooth" });
  }, [demo, scrollRequest, showWorkspace]);

  function showResults(mode: "bottom" | "turn" = "turn") {
    setShowWorkspace(true);
    scrollPending.current = mode;
    setScrollRequest(value => value + 1);
  }

  const refreshHistory = useCallback(async () => {
    const version = ++historyListVersion.current;
    try {
      const { groups } = await readHistory<{ groups: HistoryGroup[] }>({ action: "list" });
      if (version !== historyListVersion.current) return;
      setHistoryGroups(groups);
      setHistoryError(message => message === "Değerlendirmeler okunamadı." ? "" : message);
    } catch {
      if (version === historyListVersion.current) setHistoryError("Değerlendirmeler okunamadı.");
    }
  }, []);

  useEffect(() => {
    const refreshTimer = window.setTimeout(refreshHistory, 0);
    window.addEventListener("focus", refreshHistory);
    return () => {
      window.clearTimeout(refreshTimer);
      // Invalidate pending history responses when this subscription closes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      historyListVersion.current++;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      historyOpenVersion.current++;
      window.removeEventListener("focus", refreshHistory);
    };
  }, [refreshHistory]);

  async function readGroup(key: string) {
    return (await readHistory<{ runs: SavedRun[] }>({ action: "group", key })).runs;
  }

  const activeHistoryKey = showWorkspace && activeRecord ? historyGroupKey(activeRecord) : null;

  async function openHistoryGroup(key: string) {
    if (key === activeHistoryKey) return;
    const version = ++historyOpenVersion.current;
    setOpeningHistory(true);
    setHistoryError("");
    try {
      const runs = await readGroup(key);
      if (version !== historyOpenVersion.current || submitting.current) return;
      const completed = runs.findLast(run => run.result);
      if (!completed) {
        await refreshHistory();
        return;
      }
      if (!demo) void followUpAttachment.loadAttachment(undefined);
      openSaved(completed, runs);
    } catch {
      if (version === historyOpenVersion.current) setHistoryError("Sohbet yüklenemedi.");
    } finally {
      if (version === historyOpenVersion.current) setOpeningHistory(false);
    }
  }

  async function loadManagementGroup(key: string) {
    setHistoryError("");
    try {
      const runs = await readGroup(key);
      setManagementRuns(current => ({ ...current, [key]: runs }));
    } catch {
      setHistoryError("Değerlendirme kayıtları yüklenemedi.");
    }
  }

  async function saveHistoryRun(snapshot: SavedRun) {
    await historyRequest({ action: "save", run: snapshot });
    const key = historyGroupKey(snapshot);
    setManagementRuns(current => {
      const entries = current[key];
      if (!entries) return current;
      const existing = entries.find(entry => entry.id === snapshot.id);
      const runs = existing
        ? entries.map(entry => entry === existing ? { ...snapshot, createdAt: historyTime(existing) } : entry)
        : [...entries, snapshot].sort((a, b) => historyTime(a) - historyTime(b));
      return { ...current, [key]: runs };
    });
    setHistoryError("");
  }

  async function deleteHistory(target: HistoryDeletion, row: HTMLElement | null) {
    if (deletingHistory) return;
    setDeletingHistory(true);
    try {
      const { deletedIds } = await historyRequest<{ deletedIds: string[] }>(target);
      const deleted = new Set(deletedIds);
      for (const id of deleted) {
        const url = sessionImages.current.get(id);
        if (url) URL.revokeObjectURL(url);
        sessionImages.current.delete(id);
      }
      if (deleted.size) {
        setSentImages(new Map(sessionImages.current));
        await collapseDeletedRecord(row);
      }
      setManagementRuns(current => Object.fromEntries(
        Object.entries(current).map(([key, runs]) => [key, runs.filter(run => !deleted.has(run.id))])
      ));
      void refreshHistory();
      setPreviousTurns(turns => turns.filter(turn => !deleted.has(turn.id)));
      if (activeRecord && deleted.has(activeRecord.id)) {
        setActiveRecord(null);
        setFollowUpQuestion("");
        void followUpAttachment.loadAttachment(undefined);
        showQuestion(false);
      }
      setHistoryError("");
    } catch {
      setHistoryError("Kayıt silinemedi.");
    } finally {
      setDeletingHistory(false);
    }
  }

  function earlierTurns(run: SavedRun, entries: SavedRun[]) {
    const key = historyGroupKey(run);
    return conversationBefore(entries.filter(entry => historyGroupKey(entry) === key), run);
  }

  function openSaved(run: SavedRun, entries: SavedRun[], position: "bottom" | "preserve" = "bottom") {
    if (!run.result) return;
    if (demo) {
      const index = demo.followUps.findIndex(turn => turn.question === run.question);
      const next = demo.followUps[index + 1];
      setFollowUpQuestion(next?.question ?? "");
      void followUpAttachment.loadAttachment(next?.attachment);
    } else {
      setFollowUpQuestion("");
    }
    setSettingsOpen(false);
    setCsvOpen(false);
    const question = run.plan?.question ?? run.result.question ?? run.question;
    const directAnswer = !run.followUpPrompt && !run.attachmentEvidence && shortAnswer(question);
    setActiveRecord(run);
    setDisplayQuestion(run.question);
    setDisplayThumbnail(run.imageThumbnail);
    setDisplayImageUrl(sessionImages.current.get(run.id));
    setDisplayTable(savedTablePreview(run));
    setPreviousTurns(earlierTurns(run, entries));
    setResult(directAnswer ? {
      ...run.result, agentCount: 0, answers: [], finalAnswer: directAnswer,
      displayAnswer: directAnswer, showDiagram: false, diagram: undefined,
    } : run.result);
    setAgents(directAnswer ? [] : run.answers);
    setSelected("final");
    setError("");
    setStage("complete");
    if (position !== "preserve") showResults(position);
  }

  const completedCount = agents.filter(agent => agent.status === "done").length;
  const selectedAgent = useMemo(
    () => {
      const agent = typeof selected === "number" ? agents.find(agent => agent.agentId === selected) : undefined;
      return agent && (presentation?.agent(displayQuestion, agent) ?? agent);
    },
    [agents, selected, presentation, displayQuestion],
  );
  const diagramDialog = useRef<HTMLDialogElement>(null);
  const [diagram, setDiagram] = useState<{ flow: SolutionFlow; question: string }>();
  const diagramTitle = t("Çözüm akışı");
  const diagramSvg = diagram ? renderSolutionDiagram(
    presentation?.diagram(diagram.question, diagram.flow) ?? diagram.flow,
  ) : "";

  async function submitEvaluation(followUp?: SavedRun) {
    const draft = followUp ? followUpQuestion : question;
    const cleanQuestion = draft.trim() || (hasAttachment ? t("Ekli dosyayı incele.") : "");
    const model = openaiModel.trim();
    if (!cleanQuestion || !model || submitting.current || savingDocs) return;
    if (attachmentBlocked) return;

    const isNewQuestion = !followUp;
    if (demo && isNewQuestion) demoAttempt.current ??= crypto.randomUUID();
    if (isNewQuestion) setQuestionError("");
    historyOpenVersion.current++;
    setOpeningHistory(false);
    const prior = followUp ? [...previousTurns, followUp] : [];
    submitting.current = true;
    if (followUp) setFollowUpQuestion("");
    const controller = new AbortController();
    evaluation.current = controller;
    const { signal } = controller;
    const imageFile = !demo && media?.mime.startsWith("image/") ? media.file : undefined;
    let imageUrl: string | undefined;
    try {
      if (imageFile) imageUrl = URL.createObjectURL(imageFile);
      const { kind, run } = await runEvaluation({
        question: cleanQuestion, model, followUp, previousTurns, csvSource, table: csv.table,
        media, requestScope: demo && isNewQuestion ? demoAttempt.current : undefined,
        fallbackLanguage: demo ? undefined : language, setupBlocked, signal,
      }, {
        postStage,
        historyRequest,
        readHistory,
        saveRun: saveHistoryRun,
        onHistoryError: setHistoryError,
        onProgress(progress) {
          switch (progress.type) {
            case "planning":
              setDisplayQuestion(cleanQuestion);
              setDisplayThumbnail(progress.run.imageThumbnail);
              setDisplayImageUrl(imageUrl);
              setDisplayTable(savedTablePreview(progress.run));
              setPreviousTurns(prior);
              setActiveRecord(null);
              setError("");
              setResult(null);
              setAgents([]);
              setSelected("final");
              setStage("planning");
              setSettingsOpen(false);
              setCsvOpen(false);
              showResults();
              break;
            case "working":
              setAgents(progress.agents);
              setStage("working");
              break;
            case "expert":
              setAgents(current => current.map(agent =>
                agent.agentId === progress.agentId ? { ...agent, ...progress.patch } : agent));
              break;
            case "judging":
              setStage("judging");
              break;
          }
        },
      });
      signal.throwIfAborted();
      if (imageUrl && !sessionImages.current.has(run.id)) {
        sessionImages.current.set(run.id, imageUrl);
        setSentImages(new Map(sessionImages.current));
        imageUrl = undefined;
      }
      openSaved(run, prior, kind === "evaluated" ? "preserve" : "bottom");
      if (isNewQuestion) {
        setQuestion(demo?.question ?? "");
        if (kind !== "direct") {
          void questionAttachment.loadAttachment(undefined);
        }
      }
      if (!demo && kind !== "direct") void followUpAttachment.loadAttachment(undefined);
    } catch (runError) {
      if (followUp) {
        openSaved(followUp, prior);
        setFollowUpQuestion(draft);
        if (signal.aborted) setStage("cancelled");
        else setError(runError instanceof Error ? runError.message : "Beklenmeyen bir hata oluştu");
        return;
      }
      if (signal.aborted) {
        setStage("cancelled");
        showQuestion();
        return;
      }
      const message = runError instanceof Error ? runError.message : "Beklenmeyen bir hata oluştu";
      setStage("error");
      setQuestionError(message);
      showQuestion();
    } finally {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      evaluation.current = null;
      submitting.current = false;
      void refreshHistory();
    }
  }

  async function saveToDocs(run: SavedRun) {
    if (!run.result || savingDocs) return;
    setSavingDocs(true);
    setError("");
    try {
      const docs = await postStage<{ documentUrl: string }>("docs", { ...run.result, question: run.question });
      const url = googleDocumentUrl(docs.documentUrl);
      if (!url) {
        throw new Error("Google Docs bağlantısı doğrulanamadı.");
      }
      setDocsLinks(links => ({ ...links, [run.id]: url }));
      await saveHistoryRun({ ...run, documentUrl: url, updated: Date.now() });
    } catch (docsError) {
      setError(docsError instanceof Error ? docsError.message : "Google Docs kaydı oluşturulamadı");
    } finally {
      setSavingDocs(false);
    }
  }

  function showDocsSetup() {
    setSettingsOpen(true);
    setCsvOpen(false);
    showQuestion(false);
    requestAnimationFrame(() => document.getElementById("google-docs-setup")?.scrollIntoView({ block: "nearest" }));
  }

  function showSolutionDiagram(flow: SolutionFlow, question: string) {
    setDiagram({ flow, question });
    diagramDialog.current?.showModal();
  }

  function resultExports(run: SavedRun) {
    const documentUrl = googleDocumentUrl(docsLinks[run.id] ?? run.documentUrl);
    return <EvaluationExports showDocs={!demo} run={run} documentUrl={documentUrl}
      docsDisabled={setup?.docsEnabled !== true && !documentUrl} managedSetup={setup?.enabled === true} savingDocs={savingDocs} onSetup={showDocsSetup}
      onSave={saveToDocs} onDiagram={flow => showSolutionDiagram(flow, run.question)} />;
  }

  const discussionExperts = agents.filter(isDiscussionExpert).map(agent => presentation?.agent(displayQuestion, agent) ?? agent);
  function renderProgressRobots() {
    const robots = (
      <div className="robot-row">
        {discussionExperts.map((agent, index) => (
          <span key={agent.agentId} className="robot-progress" style={{ animationDelay: `${index}s` }}>
            <button type="button" className={`robot-head robot-${agent.status} progress-expert`}
              aria-label={expertRole(agent.role)} aria-pressed={selected === agent.agentId} onClick={() => setSelected(agent.agentId)}>
              <AgentIcon agentId={agent.agentId} /><ExpertRoleTooltip role={agent.role} />
            </button>
          </span>
        ))}
      </div>
    );
    return stage === "judging" ? <JudgingThoughts visible={selected === "final"}>{robots}</JudgingThoughts> : robots;
  }

  const expertNavigation = result && discussionExperts.length > 0 && <div className="result-experts" role="group" aria-label={t("Uzman görüşleri")}>
              <FinalResultButton selected={selected === "final"} onClick={() => setSelected("final")} />
              {discussionExperts.map(agent => (
                <button key={agent.agentId} type="button" className={`robot-head robot-${agent.status}`}
                  aria-label={expertRole(agent.role)} aria-pressed={selected === agent.agentId}
                  onClick={() => setSelected(current => current === agent.agentId ? "final" : agent.agentId)}>
                  <AgentIcon agentId={agent.agentId} /><ExpertRoleTooltip role={agent.role} />
                </button>
              ))}
            </div>;

  function closeComposerPanels() {
    setModelPickerOpen(false);
    setSettingsOpen(false);
    setCsvOpen(false);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || (!settingsOpen && !csvOpen)) return;
    if (modelPickerOpen) {
      setModelPickerOpen(false);
      modelTrigger.current?.focus();
      return;
    }
    const disclosure = (event.target as Element).closest<HTMLDetailsElement>("details[open]");
    if (disclosure) {
      disclosure.open = false;
      disclosure.querySelector("summary")?.focus();
      return;
    }
    event.currentTarget.querySelector<HTMLButtonElement>(`[aria-controls="${settingsOpen ? "evaluation-settings" : "csv-panel"}"]`)?.focus();
    closeComposerPanels();
  }

  const canAttach = !demo && !isBusy && (!showWorkspace || !!result);

  function attachFile(file: File | undefined) {
    if (!file || !canAttach) return;
    setSettingsOpen(false);
    setModelPickerOpen(false);
    setCsvOpen(attachmentType(file.name) === "text/csv");
    void loadAttachment(file);
  }

  function onAttachmentDrop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingAttachment(false);
    if (!canAttach) return;
    const files = event.dataTransfer.files;
    if (files.length > 1) {
      setCsvError("Her mesaja bir dosya ekleyebilirsiniz.");
      return;
    }
    attachFile(files[0]);
  }

  const demoImage = demo && media && presentation?.imageUrl(followUpQuestion);
  const attachmentImageUrl = demoImage || (media?.mime.startsWith("image/") ? media.preview : undefined);
  const attachmentImageLabel = demoImage ? t("Finans talebinin ekran görüntüsü") : media?.file.name ?? t("Soruya eklenen görsel");
  const displayAttachmentName = demoImage ? t("Örnek Finans talebi.png") : attachmentName;
  const attachmentDetails = <>
      {attachmentImageUrl && (
        <Image src={attachmentImageUrl} alt={demo ? t("Örnek Finans talebi ekran görüntüsü") : ""} width={48} height={48} unoptimized />
      )}
      <span className="attachment-description">
        {displayAttachmentName && <strong title={displayAttachmentName}>{displayAttachmentName}</strong>}
        {media && <small>{media.mime === "application/pdf" ? "PDF" : media.mime === "image/png" ? "PNG" : "JPG"} · {Math.ceil(media.file.size / 1024)} KB</small>}
        {media?.mime === "application/pdf" && <a href={media.preview} target="_blank" rel="noreferrer">{t("PDF’yi önizle")}</a>}
        {readingCsv && <span role="status">{t("Dosya okunuyor…")}</span>}
        {(csvError || csv.error) && <span role="alert">{t(csvError || csv.error)}</span>}
      </span>
  </>;
  const attachmentCard = !isBusy && (attachmentName || readingCsv || csvError || csv.error) && (
    <div className="attachment-preview">
      {attachmentImageUrl
        ? <ImagePreview className="attachment-image-trigger" imageUrl={attachmentImageUrl} label={attachmentImageLabel}
          alt={demoImage ? t("T-ERP-024 Finans destek talebinin tamamı") : attachmentImageLabel}>{attachmentDetails}</ImagePreview>
        : attachmentDetails}
      {!readingCsv && <button type="button" className="text-button attachment-remove" aria-label={t("Eki kaldır")} disabled={!!demo}
        onClick={() => { void loadAttachment(undefined); setCsvOpen(false); }}>×</button>}
    </div>
  );

  const composerTools = (
    <>
      <button type="button" className="settings-toggle text-button" aria-label={t("Ayarlar")} title={t("Ayarlar")}
        aria-expanded={settingsOpen} aria-controls="evaluation-settings"
        onClick={() => { setModelPickerOpen(false); setCsvOpen(false); setSettingsOpen(open => !open); }}>
        <span className="settings-sliders" aria-hidden="true"><i /><i /><i /></span>
      </button>
      <button type="button" className={`settings-toggle text-button${!demo && hasAttachment ? " csv-attached" : ""}`} title={displayAttachmentName ?? t("Dosya ekle")}
        aria-label={t("Dosya ekle")}
        aria-expanded={csvOpen} aria-controls="csv-panel" onClick={() => { setModelPickerOpen(false); setSettingsOpen(false); setCsvOpen(open => !open); }}>
        <span aria-hidden="true">+</span>
      </button>
    </>
  );

  const panelTable = demo && !demoImage ? questionAttachment.csv.table : csv.table;
  const tableSummary = panelTable && <p><b>{panelTable.name}</b> · {t("{total} satır", { total: panelTable.rows.length })} · {t("{total} sütun", { total: panelTable.columns.length })}</p>;
  const defaultLabel = t("Varsayılan · {model}", { model: defaultModel === "gpt-5-mini" ? "GPT-5 mini" : defaultModel });
  const composerPanels = (
    <>
    <div id="csv-panel" className="composer-panel csv-input" data-table={!!panelTable}
      data-open={csvOpen} inert={!csvOpen} role="group" aria-label={t("Dosya ekle")}>
      {demo ? demoImage ? (
        <Image className="attachment-panel-image" src={demoImage} alt={t("Örnek Finans talebi ekran görüntüsü")}
          width={670} height={405} unoptimized />
      ) : (
        <div className="demo-csv-header">
          {tableSummary}
          <a className="text-button attachment-choose demo-csv-download" href={demo.download} download={demo.csv.name}
            aria-label={t("Örnek CSV’yi indir")} title={t("Örnek CSV’yi indir")}><DownloadIcon /></a>
        </div>
      ) : <>
        <input id="csv-file" type="file" hidden accept={ATTACHMENT_ACCEPT} disabled={!canAttach || readingCsv}
          onChange={event => { attachFile(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" className="text-button attachment-choose" disabled={!canAttach || readingCsv}
          onClick={event => event.currentTarget.parentElement?.querySelector<HTMLInputElement>("#csv-file")?.click()}>
          {t("Dosya seç")}
        </button>
        {attachmentImageUrl && <ImagePreview className="attachment-panel-image-trigger" imageUrl={attachmentImageUrl} label={attachmentImageLabel}>
          {/* eslint-disable-next-line @next/next/no-img-element -- The source is a local attachment. */}
          <img className="attachment-panel-image" src={attachmentImageUrl} alt={attachmentImageLabel} />
        </ImagePreview>}
      </>}
      {panelTable && <>
        {!demo && tableSummary}
        <div className="table-preview" tabIndex={0} role="region" aria-label={t("CSV önizlemesi")}><table>
          <caption>{t("İlk 5 satırın önizlemesi")}</caption>
          <thead><tr>{panelTable.columns.map(column => <th key={column} scope="col">{presentation?.tableLabel(column) ?? column}</th>)}</tr></thead>
          <tbody>{panelTable.rows.slice(0, 5).map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} title={presentation?.tableLabel(cell) ?? cell}>{presentation?.tableLabel(cell) ?? cell}</td>)}</tr>)}</tbody>
        </table></div>
        {!demo &&
          <div className="table-preview" tabIndex={0} role="region" aria-label={t("Sütun istatistikleri")}><table>
            <caption>{t("Tüm dosya üzerinden hesaplanan özet")}</caption>
            <thead><tr><th scope="col">{t("Sütun")}</th><th scope="col">{t("Tür")}</th><th scope="col">{t("Eksik")}</th><th scope="col">{t("Toplam")}</th><th scope="col">{t("Ortalama")}</th><th scope="col">{t("Min / Maks")}</th></tr></thead>
            <tbody>{tableProfile.map(column => <tr key={column.name}>
              <td>{column.name}</td><td>{column.type === "number" ? t("Sayı") : t("Metin")}</td><td>{column.missing}</td>
              <td>{column.statistics ? previewNumber.format(column.statistics.sum) : "—"}</td><td>{column.statistics ? previewNumber.format(column.statistics.mean) : "—"}</td>
              <td>{column.statistics ? `${previewNumber.format(column.statistics.min)} / ${previewNumber.format(column.statistics.max)}` : "—"}</td>
            </tr>)}</tbody>
          </table></div>}
      </>}
    </div>
    <div id="evaluation-settings" className="composer-panel evaluation-options"
      data-open={settingsOpen} inert={!settingsOpen} aria-labelledby="evaluation-settings-title">
    <h2 className="composer-panel-title" id="evaluation-settings-title">{t("Ayarlar")}</h2>
    <div className="model-field">
      <span id="model-label">{t("Kullanılacak model")}</span>
      {demo ? (
        <span className="demo-model-value">{demo.model.label}</span>
      ) : (
        <>
          <div className="model-picker">
            <button ref={modelTrigger} id="openai-model" type="button" disabled={isBusy}
              aria-labelledby="model-label model-selection" aria-controls="model-choices" aria-expanded={modelPickerOpen}
              onClick={() => setModelPickerOpen(open => !open)}>
              <span id="model-selection">{modelChoice === "default"
                ? defaultLabel
                : t(modelOptions.find(model => model.id === modelChoice)?.label ?? "Başka bir model kullan")}</span>
            </button>
            <div ref={modelChoices} id="model-choices" className="model-choices" popover="manual">
              {[
                { id: "default", label: defaultLabel },
                ...modelOptions,
                { id: "custom", label: t("Başka bir model kullan") },
              ].map(model => (
                <button type="button" key={model.id} data-model={model.id} aria-pressed={modelChoice === model.id} onClick={() => {
                  setModelChoice(model.id);
                  setModelPickerOpen(false);
                  modelTrigger.current?.focus();
                }}>{t(model.label)}</button>
              ))}
            </div>
          </div>
          {modelChoice === "custom" && <>
            <label htmlFor="custom-model">{t("Model kimliği")}</label>
            <input id="custom-model" form={showWorkspace ? "follow-up-form" : "evaluation-form"} value={customModel} onChange={event => setCustomModel(event.target.value)}
              placeholder={t("Hesabınızdaki model kimliğini girin")} disabled={isBusy} required
              autoComplete="off" spellCheck={false} />
          </>}
        </>
      )}
    </div>
    {!demo && <Setup onStatus={setSetup} />}
    {historyGroups.length > 0 && <HistoryDisclosure className="history-management" summary={<h2>{t("Değerlendirme kayıtları")}</h2>}>
      {historyError && <p className="history-error" role="status">{t(historyError)}</p>}
      {historyGroups.map(group => {
        const runs = managementRuns[group.key];

        return <div className="history-records" key={group.key}>
          <HistoryDisclosure summaryClassName="history-record-heading" summary={showQuestionText(group.question)}
            onOpen={() => void loadManagementGroup(group.key)}>
            {runs ? <ul className="history-runs">
              {runs.map(run => <li className="history-entry" key={run.id}>
                <div className="history-record-meta">
                  <span>{showQuestionText(run.question)}</span>
                  <small>{run.model} · {new Date(historyTime(run)).toLocaleString(language)}</small>
                </div>
                {run.followUpPrompt && <button type="button" className="history-delete" disabled={isBusy || savingDocs || deletingHistory}
                  aria-label={t("Takip sorusunu sil")} title={t("Takip sorusunu sil")}
                  onClick={event => void deleteHistory({ action: "delete", id: run.id }, event.currentTarget.closest("li"))}>×</button>}
              </li>)}
            </ul> : !historyError && <p role="status">{t("Kayıtlar yükleniyor…")}</p>}
          </HistoryDisclosure>
          <button type="button" className="history-delete" disabled={isBusy || savingDocs || deletingHistory}
            aria-label={t("Soruyu ve takiplerini sil") + ": " + showQuestionText(group.question)} title={t("Soruyu ve takiplerini sil")}
            onClick={event => void deleteHistory({ action: "deleteGroup", key: group.key }, event.currentTarget.closest<HTMLElement>(".history-records"))}>×</button>
        </div>;
      })}
    </HistoryDisclosure>}
    </div>
    </>
  );

  return (
    <main className="app-shell" data-demo={!!demo}
      onKeyDown={event => {
        if (event.key !== "Escape" || !historyOpen || !(event.target instanceof Element) ||
            !event.target.closest(".run-history")) return;
        setHistoryOpen(false);
        document.getElementById("history-title")?.focus();
      }}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current++;
        if (canAttach) setDraggingAttachment(true);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = canAttach ? "copy" : "none";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDraggingAttachment(false);
      }}
      onDrop={onAttachmentDrop}>
      {draggingAttachment && canAttach && (
        <div className="attachment-drop-overlay" aria-hidden="true">
          <span>{t("Dosyayı buraya bırakın")}</span>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <Image className="brand-logo" src={brandLogo} width={44} height={44} alt="" priority unoptimized />
          <span className="brand-name">PBots</span>
        </div>
        <LanguageSelect />
      </header>

      <div className="evaluation-layout">
        {historyOpen && <div className="history-scrim" aria-hidden="true" onClick={() => setHistoryOpen(false)} />}
        <aside className="run-history" aria-labelledby="history-title" data-open={historyOpen}>
          <button type="button" id="history-title" className="history-toggle text-button"
            aria-label={t("Değerlendirmeler")} title={t("Değerlendirmeler")} aria-expanded={historyOpen}
            aria-controls="history-panel" onClick={() => setHistoryOpen(open => !open)}>
            <span className="history-toggle-icon" aria-hidden="true" />
          </button>
          <div id="history-panel" className="history-content" inert={!historyOpen}>
            <div className="history-heading-row">
              <h2 className="history-heading" title={t("Değerlendirmeler")}>{t("Değerlendirmeler")}</h2>
              <button type="button" className="text-button sidebar-new-question" aria-label={t("Yeni soru")} title={t("Yeni soru")}
                disabled={isBusy || savingDocs} onClick={() => {
                  historyOpenVersion.current++;
                  setOpeningHistory(false);
                  demoAttempt.current = undefined;
                  setFollowUpQuestion("");
                  void followUpAttachment.loadAttachment(undefined);
                  setSettingsOpen(false);
                  setCsvOpen(false);
                  setQuestion(demo?.question ?? "");
                  setQuestionError("");
                  setStage("idle");
                  showQuestion();
                }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6M11 13l1-4 7-7 3 3-7 7-4 1Z" />
                </svg>
              </button>
              <button type="button" className="sidebar-search-toggle text-button" aria-label={t("Geçmişte soru ara")}
                aria-expanded={searchOpen} aria-controls="history-search-field" onClick={() => { setSearchOpen(!searchOpen); setHistorySearch(""); }}>
                <span className="search-icon" aria-hidden="true" />
              </button>
            </div>
            <div id="history-search-field" className="history-search-field" data-open={searchOpen} inert={!searchOpen}>
              <div>
                <input ref={historySearchField} className="history-search" type="search"
                  aria-label={t("Geçmişte soru ara")} placeholder={t("Soru ara")} value={historySearch}
                  onChange={event => setHistorySearch(event.target.value)} />
              </div>
            </div>
            {historyError && <p className="history-error" role="status">{t(historyError)}</p>}
            {!historyError && historyQuery && visibleHistory.length === 0 && <p>{t("Eşleşen soru yok.")}</p>}
            <span className="sr-only" role="status">{openingHistory ? t("Sohbet yükleniyor…") : ""}</span>
            <ul className="history-list" aria-busy={openingHistory}>
              {visibleHistory.map(group => (
                <li className="history-group" key={group.key}>
                  {group.completed ? <button type="button" className="history-question text-button" title={showQuestionText(group.question)}
                    aria-current={group.key === activeHistoryKey ? "true" : undefined}
                    disabled={isBusy || savingDocs || group.key === activeHistoryKey} onClick={() => void openHistoryGroup(group.key)}>
                    {showQuestionText(group.question)}
                  </button> : <span className="history-question">{showQuestionText(group.question)}</span>}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      <div className="evaluation-main" id="top">
      {!showWorkspace && stage === "idle" && (
        <div className="question-examples" aria-label={t("Örnek ERP sorusu")}>
          {exampleQuestions.map((example, index) =>
            <p key={example} style={{ animationDelay: `${index * 6}s` }}
              aria-hidden={index > 0}>{t(example)}</p>
          )}
        </div>
      )}
      <section className="question-area" hidden={showWorkspace}>
        <div className="question-form question-card" onKeyDown={handleComposerKeyDown}>
        <form id="evaluation-form" className="composer-form" onSubmit={event => { event.preventDefault(); void submitEvaluation(); }}>
          {!showWorkspace && attachmentCard}
          <textarea
            id="question"
            readOnly={!!demo}
            onPointerDown={closeComposerPanels}
            onFocus={closeComposerPanels}
            aria-label={t("Değerlendirilecek soru")}
            ref={questionField}
            value={showQuestionText(question)}
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              const field = event.currentTarget;
              if (event.altKey || event.shiftKey) {
                field.setRangeText("\n", field.selectionStart, field.selectionEnd, "end");
                setQuestion(field.value);
                return;
              }
              if (!event.repeat) field.form?.requestSubmit();
            }}
            placeholder={t("Sorunuzu yazın")}
            rows={1}
            disabled={isBusy}
          />
          <div className="composer-tools">
            {composerTools}
            <button className="primary-button symbol-send" type="submit" data-running={isBusy} aria-busy={isBusy} aria-label={t("Uzmanları çalıştır")} title={t("Uzmanları çalıştır")} disabled={(!question.trim() && !hasAttachment) || !openaiModel.trim() || isBusy || savingDocs || attachmentBlocked}>
              <SendSymbol />
            </button>
          </div>
          {questionError && <p className="question-error" role="alert">{t(questionError)}</p>}
          {stage === "cancelled" && <p className="evaluation-notice" role="status">{t("Değerlendirme durduruldu.")}</p>}
        </form>
          {!showWorkspace && composerPanels}
        </div>

      </section>

      {showWorkspace && (
        <section className="workspace" aria-live="polite">
          <div className="thread-scroll" key={scrollRequest} role="region" aria-label={t("Sohbet mesajları")} tabIndex={0}>
          {previousTurns.map(run => run.result && <ThreadTurn key={`${scrollRequest}:${run.id}`}
            run={{ ...run, question: showQuestionText(run.question) }} result={presentation?.result(run.question, run.result) ?? run.result}
            exports={resultExports(run)} imageUrl={sentImages.get(run.id)}
            demoImageUrl={presentation?.imageUrl(run.question)} tableLabel={presentation?.tableLabel} />)}
          <article ref={currentTurn} className={isBusy ? "result-panel result-panel-running" : "result-panel"}>
            <div className="thread-turn-header">
              {displayQuestion && <ThreadQuestion question={showQuestionText(displayQuestion)} thumbnail={displayThumbnail}
                table={displayTable} imageUrl={displayImageUrl} demoImageUrl={presentation?.imageUrl(displayQuestion)} tableLabel={presentation?.tableLabel} />}
            </div>
            <div className="result-toolbar">
              {isBusy ? (
                <div className="turn-progress">
                  {selectedAgent && <div className="progress-return result-experts">
                    <FinalResultButton selected={false} onClick={() => setSelected("final")} />
                  </div>}
                  <span className="sr-only" role="status">{stage === "planning" ? t("Değerlendirme başlatılıyor.")
                    : stage === "judging" ? t("Ortak karar hazırlanıyor.")
                    : t("{completed} / {total} uzman tamamlandı.", { completed: completedCount, total: agents.length })}</span>
                  {stage === "planning" ? <PlanningCrew fixedCount={demo?.expertCount(displayQuestion)} /> : renderProgressRobots()}
                </div>
              ) : expertNavigation}
              {activeRecord && resultExports(activeRecord)}
            </div>
            <AnimatedAnswer view={selectedAgent?.answer ? `${selectedAgent.agentId}:ready` : isBusy && selected === "final" ? "progress" : selected}>
              {selectedAgent ? (
                <>
                  <ExpertTask role={selectedAgent.role} task={selectedAgent.task} />
                  {selectedAgent.answer && <RichText text={splitExpertAnswer(selectedAgent.answer).answer} />}
                  {selectedAgent.error && !selectedAgent.answer && <p className="evaluation-error">{t(selectedAgent.error)}</p>}
                </>
              ) : (
                <>
                  {result ? (
                    <ResultText result={presentation?.result(displayQuestion, result) ?? result} />
                  ) : isBusy ? (
                    <div className="empty-result" aria-hidden="true" />
                  ) : (
                    <div className="empty-result"><StatusMark status={stage === "error" ? "error" : "waiting"} /></div>
                  )}
                </>
              )}
            </AnimatedAnswer>
            {stage === "cancelled" && <p className="evaluation-notice" role="status">{t("Değerlendirme durduruldu.")}</p>}
            {error && <p className="evaluation-notice evaluation-error" role="alert">{t(error)}</p>}

          </article>
          </div>
          {demo && result && activeRecord?.question === demo.followUps.at(-1)?.question ? (
            <div className="thread-composer question-card demo-install">
              <p>{t("Demoyu beğendiyseniz Ortak Akıl’ı bilgisayarınıza kurup kendi dosyalarınızla kendi sorularınızı sorabilirsiniz.")}</p>
              <a className="text-button" href={demo.installationUrl} target="_blank" rel="noreferrer">{t("Kurulum rehberini aç")}</a>
            </div>
          ) : <div className="thread-composer question-card" data-busy={isBusy} onKeyDown={handleComposerKeyDown}>
            <form id="follow-up-form" className="composer-form" onSubmit={event => {
              event.preventDefault();
              if (activeRecord?.result && !isBusy) void submitEvaluation(activeRecord);
            }}>
              {attachmentCard}
              {!isBusy && <textarea rows={1} readOnly={!!demo} disabled={!result} aria-label={t("Takip sorusu")} placeholder={t("Bu değerlendirme hakkında soru sor")}
                onPointerDown={closeComposerPanels} onFocus={closeComposerPanels}
                value={showQuestionText(followUpQuestion)} onChange={event => setFollowUpQuestion(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  if ((followUpQuestion.trim() || hasAttachment) && !savingDocs) event.currentTarget.form?.requestSubmit();
                }} />}
              <div className="composer-tools">
                {result && !isBusy && composerTools}
                <button type={isBusy ? "button" : "submit"} className="primary-button symbol-send"
                  data-running={isBusy} data-spinning={isBusy}
                  aria-label={isBusy ? t("Değerlendirmeyi durdur") : t("Takip sorusunu gönder")}
                  title={isBusy ? t("Durdur") : undefined}
                  onClick={isBusy ? () => evaluation.current?.abort() : undefined}
                  disabled={!isBusy && (!result || (!followUpQuestion.trim() && !hasAttachment) || !openaiModel.trim() || savingDocs || attachmentBlocked)}>
                  <SendSymbol />
                </button>
              </div>
            </form>
            {composerPanels}
          </div>}
        </section>
      )}

      </div>

      </div>

        <dialog ref={diagramDialog} className="diagram-dialog" aria-labelledby="diagram-title"
          onClick={event => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right ||
                event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close();
          }}>
          <header className="diagram-dialog-header">
            <h2 id="diagram-title">{diagramTitle}</h2>
            <div className="diagram-dialog-actions">
              <button className="diagram-action" type="button" aria-label={t("SVG indir")} title={t("SVG indir")}
                onClick={() => downloadSolutionDiagram(diagramSvg)}>
                <DownloadIcon />
              </button>
              <form method="dialog">
                <button className="diagram-action diagram-close" type="submit" aria-label={t("Kapat")} title={t("Kapat")}>×</button>
              </form>
            </div>
          </header>
          <figure className="solution-diagram" tabIndex={0} aria-label={diagramTitle}>
            {/* eslint-disable-next-line @next/next/no-img-element -- The flow is rendered locally as an SVG. */}
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagramSvg)}`}
              alt={diagramTitle} />
          </figure>
        </dialog>
    </main>
  );
}
