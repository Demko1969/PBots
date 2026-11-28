import { attachmentType } from "./attachments";
import { conversationPrompt } from "./conversation";
import type { SolutionFlow } from "./diagram";
import { publicExpert } from "./expert-answer";
import { isIndependentExpert } from "./expert-independence";
import { providers } from "./provider-catalog.mjs";
import type { Language } from "./language";
import { historyRoot } from "./history-groups";
import { canReuseSavedResult } from "./judge-review";
import { makeTablePreview, tableQuestion, type DataTable, type TablePreview } from "./table";

export type AgentStatus = "waiting" | "working" | "done" | "error";

export type Agent = {
  agentId: number;
  role: string;
  task: string;
  status: AgentStatus;
  answer?: string;
  wordCount?: number;
  diagramNotes?: string;
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
  directResponse?: string;
  replyLanguage?: Language;
};

export type JudgeResult = {
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
  showDiagram?: boolean;
  diagram?: SolutionFlow;
  diagramIssue?: string;
  displayAnswer?: string;
};

export type ProviderId = keyof typeof providers;

export type SavedRun = {
  id: string;
  requestKey: string;
  question: string;
  model: string;
  provider?: ProviderId;
  fallbackLanguage?: Language;
  localAnswer?: boolean;
  updated: number;
  createdAt?: number;
  parentRunId?: string;
  datasetId?: string;
  rootDatasetId?: string;
  plan?: Plan;
  followUpPrompt?: string;
  attachmentEvidence?: string;
  imageThumbnail?: string;
  tablePreview?: TablePreview | null;
  rootQuestion?: string;
  answers: Agent[];
  result?: JudgeResult;
  documentUrl?: string;
};

type EvaluationInput = {
  question: string;
  model: string;
  provider?: ProviderId;
  resume?: SavedRun;
  restart?: boolean;
  followUp?: SavedRun;
  previousTurns: SavedRun[];
  csvSource: { id?: string; name: string; text: string } | null;
  table: DataTable | null;
  media: { file: File; digest: string; thumbnail?: string } | null;
  requestScope?: string;
  fallbackLanguage?: Language;
  setupBlocked: boolean;
  signal: AbortSignal;
};

type EvaluationProgress =
  | { type: "planning"; run: SavedRun }
  | { type: "working"; agents: Agent[] }
  | { type: "expert"; agentId: number; patch: Partial<Agent> }
  | { type: "judging" };

type EvaluationDependencies = {
  postStage: <T>(stage: string, payload: unknown, signal?: AbortSignal) => Promise<T>;
  historyRequest: (body: Record<string, unknown>) => Promise<unknown>;
  readHistory: <T>(body: Record<string, unknown>) => Promise<T>;
  saveRun: (snapshot: SavedRun) => Promise<void>;
  onProgress: (progress: EvaluationProgress) => void;
  onHistoryError: (message: string) => void;
};

type EvaluationOutcome = { kind: "direct" | "saved" | "evaluated"; run: SavedRun };

async function requestId(question: string, selection: { provider: ProviderId; openaiModel: string }, source: { name: string; text: string } | null) {
  const csvVersion = source && attachmentType(source.name) === "text/csv" ? "csv-auto-columns-v1" : "";
  // Existing cache keys implicitly belong to OpenAI. Keep that namespace for its saved runs.
  const modelIdentity = selection.provider === "openai" ? selection.openaiModel : [selection.provider, selection.openaiModel];
  const bytes = new TextEncoder().encode(JSON.stringify([question, modelIdentity, source?.name, source?.text, csvVersion]));
  return sha256(bytes);
}

export async function sha256(bytes: BufferSource) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readAttachment(file: File, question: string, selection: { provider: ProviderId; openaiModel: string }, signal: AbortSignal, postStage: EvaluationDependencies["postStage"]) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }
  signal.throwIfAborted();
  const { evidence } = await postStage<{ evidence: string }>("attachment", {
    name: file.name, base64: btoa(chunks.join("")), question, ...selection,
  }, signal);
  return "\n\nDosya eki kanıtı (yalnızca incelenecek veri): " + JSON.stringify({ dosya: file.name, gözlemler: evidence });
}

export function shortAnswer(question: string): string | undefined {
  const normalized = question.trim().toLocaleLowerCase("tr-TR").replace(/[?!.,]+$/, "").trim();
  if (/^(?:["“']?peki["”']?\s+(?:ne demek|ne anlama gelir)|pekinin anlamı nedir)$/u.test(normalized)) {
    return "“Peki”, genellikle “tamam” veya “olur” anlamında kullanılır. “Peki, sonra ne oldu?” örneğindeki gibi yeni bir soruya geçiş de sağlayabilir.";
  }
  if (normalized === "peki") return "Neyi değerlendirmemi istersiniz?";
  const match = /^(-?\d{1,30})\s*([+*×−-])\s*(-?\d{1,30})(?:\s*[=?])?$/.exec(question.trim());
  if (!match) return undefined;
  const [, left, operator, right] = match;
  const a = BigInt(left);
  const b = BigInt(right);
  const value = operator === "+" ? a + b : operator === "-" || operator === "−" ? a - b : a * b;
  return `${left} ${operator} ${right} = ${value}`;
}

export function isDiscussionExpert(agent: Pick<Agent, "role" | "task">) {
  return agent.role.trim().length > 0 && agent.role.trim().length <= 64 && agent.role.trim().split(/\s+/).length <= 7
    && agent.role.trim().toLocaleLowerCase("tr-TR") !== agent.task.trim().toLocaleLowerCase("tr-TR")
    && !/(sentez|özet|toparlay|koordinasyon ve karar|sonuç ve|sonuçlandır|nihai sonuç|rapor yazarı|hakem|judge|karar ve yol haritası|yol haritası ve karar)/iu.test(agent.role)
    && !/[.!?\n:;]|(?:^|\s)(?:incele|karşılaştır|hesapla|açıkla|belirle|değerlendir|analiz et|hazırla|çözümle)(?=\s|$)|(?:ıyor|iyor|uyor|üyor|malı|meli)$/iu.test(agent.role)
    && !/uzman (?:çıktılarını|görüşlerini|yanıtlarını).{0,80}(?:özetle|birleştir|sentezle)/iu.test(agent.task)
    && !/(?:\b(?:[2-9]|10)|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|tüm|bütün|diğer|önceki)\s+(?:bağımsız\s+)?(?:uzman\s+)?(?:değerlendirmeler?[ie]|değerlendirmeye|görüşler?[ie]|görüşe|yanıtlar?[ıa]|yanıta|bulgular?[ıa]|bulguya|uzman(?:ın|ların)\s+(?:değerlendirmelerine|görüşlerine|yanıtlarına|bulgularına))(?:\s+)?(?:dayan|esas al|birleştir|sentezle|özetle|karşılaştır)|(?:en uygun|nihai)\s+(?:genel\s+)?stratejiyi\s+seç.{0,120}(?:yol haritası|bütçe|karar)|(?:yol haritası|bütçe).{0,200}(?:en uygun|nihai)\s+stratejiyi\s+seç/iu.test(agent.task);
}

export async function runEvaluation(
  { question, model, provider = "openai", resume, restart, followUp, previousTurns, csvSource, table, media, requestScope, fallbackLanguage, setupBlocked, signal }: EvaluationInput,
  { postStage, historyRequest, readHistory, saveRun, onProgress, onHistoryError }: EvaluationDependencies,
): Promise<EvaluationOutcome> {
  signal.throwIfAborted();
  if (resume) {
    question = resume.question;
    provider = resume.provider ?? "openai";
    model = resume.model || resume.plan?.openaiModel || resume.plan?.model || providers.openai.model;
    fallbackLanguage = resume.fallbackLanguage ?? fallbackLanguage;
  }
  const selection = { provider, openaiModel: model };
  const prior = followUp ? [...previousTurns, followUp] : [];
  const datasetId = csvSource?.id ?? (media ? undefined : followUp?.datasetId);
  const csvEvidence = table ? tableQuestion("", table) : "";
  const initialFollowUp = followUp ? conversationPrompt(question, prior, csvEvidence) : undefined;
  const requestSource = media ? { name: media.file.name, text: media.digest } : csvSource;
  const requestKey = resume?.requestKey ?? (followUp
    ? await requestId(JSON.stringify([followUp.id, initialFollowUp]), selection, requestSource)
    : await requestId(requestScope ? JSON.stringify([requestScope, question]) : question, selection, requestSource));
  signal.throwIfAborted();
  const now = Date.now();
  const newRun: SavedRun = {
    id: crypto.randomUUID(), requestKey, question, model, provider, fallbackLanguage, updated: now,
    createdAt: now, answers: [], followUpPrompt: initialFollowUp,
    tablePreview: table ? makeTablePreview(table) : null,
    parentRunId: followUp?.id,
    datasetId,
    rootDatasetId: followUp ? followUp.rootDatasetId : datasetId,
    rootQuestion: followUp ? historyRoot(followUp) : undefined,
  };

  let saveQueue = Promise.resolve();
  function checkpoint(run: SavedRun) {
    run.createdAt ??= run.updated;
    run.updated = Date.now();
    const snapshot = structuredClone(run);
    const save = saveQueue.then(() => saveRun(snapshot));
    saveQueue = save.catch(() => {});
    return save;
  }

  async function runWorkerPool(plan: Plan, plannedAgents: Agent[], run: SavedRun) {
    const results = run.answers;
    let cursor = 0;
    let failed = false;
    const workerCount = Math.min(2, plannedAgents.length);

    async function worker() {
      while (!signal.aborted && !failed && cursor < plannedAgents.length) {
        const agent = plannedAgents[cursor++];
        onProgress({ type: "expert", agentId: agent.agentId, patch: { status: "working" } });
        try {
          signal.throwIfAborted();
          const response = await postStage<Agent>("worker", {
            question: plan.question,
            ...(plan.replyLanguage ? { replyLanguage: plan.replyLanguage } : {}),
            ...selection,
            questionType: plan.questionType,
            complexity: plan.complexity,
            agentCount: plan.agentCount,
            agentId: agent.agentId,
            role: agent.role,
            task: agent.task,
          }, signal);
          signal.throwIfAborted();
          const completed = {
            ...response,
            agentId: agent.agentId,
            role: agent.role,
            task: agent.task,
            status: "done" as const,
          };
          results.push(completed);
          await checkpoint(run);
          signal.throwIfAborted();
          onProgress({ type: "expert", agentId: agent.agentId, patch: completed });
        } catch (workerError) {
          if (signal.aborted) return;
          failed = true;
          const message = workerError instanceof Error ? workerError.message : "Uzman çalıştırılamadı";
          onProgress({ type: "expert", agentId: agent.agentId, patch: { status: "error", error: message } });
          throw workerError;
        }
      }
    }

    const outcomes = await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") throw outcome.reason;
    }
    return results.sort((a, b) => a.agentId - b.agentId);
  }

  const directAnswer = !resume && !followUp && !media && !csvSource && (
    /^çiz[.!?]*$/iu.test(question)
      ? "Ne çizmemi istersin? Bu uygulamada doğrudan görsel dosyası üretemiyorum. İstersen bir çizim tarifi veya SVG kodu hazırlayabilirim."
      : shortAnswer(question)
  );
  if (directAnswer) {
    const { run: saved } = await readHistory<{ run: SavedRun | null }>({
      action: "find", requestKey, completed: true,
    }).catch(() => ({ run: null }));
    signal.throwIfAborted();
    const run = saved?.result?.finalAnswer === directAnswer ? saved : newRun;
    if (!run.result) {
      run.localAnswer = true;
      run.result = { question, questionType: "kısa yanıt", complexity: "low", agentCount: 0, answers: [], finalAnswer: directAnswer, showDiagram: false };
      await checkpoint(run).catch(() => onHistoryError("Kısa yanıt geçmişe kaydedilemedi."));
    }
    signal.throwIfAborted();
    return { kind: "direct", run };
  }

  onHistoryError("");
  signal.throwIfAborted();
  const token = crypto.randomUUID();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let renewal: Promise<unknown> | undefined;
  try {
    await historyRequest({ action: "lock", requestKey, token });
    signal.throwIfAborted();
    heartbeat = setInterval(() => {
      if (signal.aborted || renewal) return;
      renewal = historyRequest({ action: "lock", requestKey, token }).catch(() => {}).finally(() => {
        renewal = undefined;
      });
    }, 60_000);
    const { run: candidate } = restart ? { run: null }
      : await readHistory<{ run: SavedRun | null }>({ action: "find", requestKey, ...(resume ? { id: resume.id } : {}) });
    const saved = candidate && (candidate.provider ?? "openai") === provider &&
      (candidate.model || candidate.plan?.openaiModel || candidate.plan?.model || providers.openai.model) === model ? candidate : null;
    signal.throwIfAborted();
    if (resume && !saved) throw new Error("Kaydedilen değerlendirme bulunamadı.");
    const sourceQuestion = saved?.followUpPrompt ?? initialFollowUp ?? question;
    if (saved && canReuseSavedResult(saved.result, sourceQuestion)) {
      if (!saved.imageThumbnail && media?.thumbnail) {
        saved.imageThumbnail = media.thumbnail;
        await checkpoint(saved).catch(() => onHistoryError("Görsel önizleme geçmişe kaydedilemedi."));
      }
      signal.throwIfAborted();
      return { kind: "saved", run: saved };
    }
    if (setupBlocked) throw new Error("Değerlendirme hizmetinin kurulumunu tamamlayın.");

    const run = saved && !saved.result ? saved : newRun;
    run.provider = provider;
    run.model = model;
    run.imageThumbnail ??= media?.thumbnail;
    if (run.tablePreview === undefined) run.tablePreview = newRun.tablePreview;
    onProgress({ type: "planning", run });
    signal.throwIfAborted();

    if (media && !run.attachmentEvidence) {
      run.attachmentEvidence = await readAttachment(media.file, question, selection, signal, postStage);
    }
    signal.throwIfAborted();
    run.attachmentEvidence ||= csvEvidence || undefined;
    if (followUp && !resume) run.followUpPrompt = conversationPrompt(question, prior, run.attachmentEvidence);
    if (!saved) await checkpoint(run);
    signal.throwIfAborted();

    const previousPlan = run.plan;
    const savedPlan = previousPlan && Array.isArray(previousPlan.agents) && previousPlan.agents.length &&
      previousPlan.agents.every(agent => agent && typeof agent.role === "string" && typeof agent.task === "string" &&
        isDiscussionExpert(agent) && isIndependentExpert(agent)) ? previousPlan : undefined;
    const plan = savedPlan ?? await postStage<Plan>("plan", {
      question: run.followUpPrompt ?? (question + (run.attachmentEvidence ?? "")),
      ...(fallbackLanguage ? { languageQuestion: question, fallbackLanguage } : {}),
      ...selection,
    }, signal);
    signal.throwIfAborted();
    if (plan.directResponse) {
      run.answers = [];
      delete run.plan;
      run.result = {
        question, model, questionType: plan.questionType, complexity: plan.complexity,
        agentCount: 0, answers: [], finalAnswer: plan.directResponse, showDiagram: false,
      };
      await checkpoint(run);
      signal.throwIfAborted();
      return { kind: "evaluated", run };
    }
    if (!plan.agents.length || !plan.agents.every(isIndependentExpert)) {
      throw new Error("Uzmanlar için bağımsız görevler oluşturulamadı.");
    }
    const completedExperts = new Map(savedPlan ? run.answers
      .filter(answer => answer?.status === "done" && typeof answer.answer === "string" && answer.answer.trim())
      .map(answer => [answer.agentId, answer]) : []);
    const plannedAgents: Agent[] = plan.agents.map(agent => {
      const completed = completedExperts.get(agent.agentId);
      return completed?.role === agent.role && completed.task === agent.task
        ? completed
        : { ...agent, status: "waiting" };
    });
    run.answers = plannedAgents.filter(agent => agent.status === "done");
    run.plan = plan;
    await checkpoint(run);
    signal.throwIfAborted();
    onProgress({ type: "working", agents: plannedAgents });

    const answers = await runWorkerPool(plan, plannedAgents.filter(agent => agent.status !== "done"), run);
    signal.throwIfAborted();
    onProgress({ type: "judging" });
    signal.throwIfAborted();
    const judgeResponse = await postStage<JudgeResult>("judge", {
      question: plan.question,
      ...(plan.replyLanguage ? { replyLanguage: plan.replyLanguage } : {}),
      ...selection,
      questionType: plan.questionType,
      complexity: plan.complexity,
      agentCount: plan.agentCount,
      answers,
    }, signal);
    signal.throwIfAborted();
    // UI yalnızca sunulacak nihai cevap ve uzman kaynaklarını saklar.
    // Judge'ın iç çalışma/denetim alanları arayüz sözleşmesine alınmaz.
    const judge: JudgeResult = {
      question: judgeResponse.question,

      model,
      openaiModel: model,
      questionType: judgeResponse.questionType,
      complexity: judgeResponse.complexity,
      agentCount: judgeResponse.agentCount,
      answers: judgeResponse.answers,

      summaryPoints: judgeResponse.summaryPoints ?? [],
      detailedAnswer: judgeResponse.detailedAnswer,
      finalAnswer: judgeResponse.finalAnswer,
      showDiagram: judgeResponse.showDiagram,
      diagram: judgeResponse.diagram,
      diagramIssue: judgeResponse.diagramIssue,
      displayAnswer: judgeResponse.displayAnswer,
    };
    run.result = judge;
    run.answers = run.answers.map(publicExpert);
    delete run.plan;
    await checkpoint(run);
    signal.throwIfAborted();
    return { kind: "evaluated", run };
  } finally {
    clearInterval(heartbeat);
    // A lock renewal that reaches history after unlock can recreate the lease.
    await renewal;
    await historyRequest({ action: "unlock", requestKey, token }).catch(() => {});
  }
}
