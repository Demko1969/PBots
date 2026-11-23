import { NextRequest, NextResponse } from "next/server";
import { checkRequest, readJson, internalHeaders, reserveRequest, RequestError } from "../../../../lib/server-security";
import { diagramPreference, diagramRequirement, diagramValidationIssue, minimumScenarioBranches, needsReviewLoop } from "../../../../lib/judge-review";
import { splitExpertAnswer } from "../../../../lib/expert-answer";
import { isIndependentExpert } from "../../../../lib/expert-independence";
import { attachmentType, matchesAttachmentSignature, MAX_ATTACHMENT_BYTES } from "../../../../lib/attachments";

const endpoints: Record<string, string> = {
  plan: "multi-agent-ui-plan",
  worker: "multi-agent-ui-worker",
  attachment: "multi-agent-ui-worker",
  judge: "multi-agent-ui-judge",
  docs: "multi-agent-ui-docs",
};

function formatExpertAnswers(value: unknown, includeDiagramNotes = false) {
  if (!Array.isArray(value)) return value;
  return value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const { diagramNotes, ...rest } = entry as Record<string, unknown>;
    if (typeof rest.answer !== "string") return rest;
    const { answer, diagramNotes: inlineNotes } = splitExpertAnswer(rest.answer);
    const notes = [inlineNotes, typeof diagramNotes === "string" ? diagramNotes : ""]
      .filter(Boolean).join("\n").slice(0, 6000);
    return {
      ...rest,
      answer: includeDiagramNotes && notes
        ? [answer, "Diyagram yolu (yalnızca diyagram için): " + notes].filter(Boolean).join("\n\n")
        : answer,
    };
  });
}

function publicResult(data: Record<string, unknown>) {
  return {
    ...data,
    answers: formatExpertAnswers(data.answers),
    ...Object.fromEntries(["finalAnswer", "displayAnswer", "detailedAnswer"].flatMap(key =>
      typeof data[key] === "string" ? [[key, splitExpertAnswer(data[key]).answer]] : [])),
  };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ stage: string }> },
) {
  const { stage } = await context.params;
  if (!Object.hasOwn(endpoints, stage)) return NextResponse.json({ error: "Bilinmeyen işlem aşaması" }, { status: 404 });
  const endpoint = endpoints[stage];

  if (stage === "docs" && process.env.GOOGLE_DOCS_ENABLED !== "true") {
    return NextResponse.json({ error: "Önce Google Docs kurulumunu tamamlayın." }, { status: 409 });
  }

  const baseUrl = (process.env.N8N_WEBHOOK_BASE_URL || "http://127.0.0.1:5678/webhook").replace(/\/$/, "");
  let release: (() => void) | undefined;
  try {
    checkRequest(request);
    const headers = await internalHeaders();
    release = reserveRequest();
    let body = await readJson(request, stage === "attachment" ? Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 50_000 : 512 * 1024);
    if (stage === "attachment") {
      const { name, base64, question, openaiModel } = body;
      const mime = typeof name === "string" && name.length <= 255 ? attachmentType(name) : undefined;
      if (!mime || mime === "text/csv" || typeof base64 !== "string" ||
          base64.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 ||
          base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64) ||
          (base64.includes("=") && !/^[^=]+={1,2}$/.test(base64))) {
        throw new RequestError("Geçerli bir JPG, PNG veya PDF dosyası seçin.", 400);
      }
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length > MAX_ATTACHMENT_BYTES) throw new RequestError("Dosya en fazla 5 MB olabilir.", 413);
      if (!matchesAttachmentSignature(bytes, mime)) {
        throw new RequestError("Dosyanın içeriği uzantısıyla eşleşmiyor.", 400);
      }
      body = {
        question: typeof question === "string" ? question.trim().slice(0, 8000) : "",
        openaiModel: typeof openaiModel === "string" ? openaiModel.trim().slice(0, 160) : "",
        attachment: { name, mime, base64 },
      };
    } else if (stage === "worker") {
      // Only the dedicated attachment entry point may ask n8n to read binary input.
      delete body.attachment;
    }
    if (stage === "worker" && !isIndependentExpert(body)) {
      throw new RequestError("Uzman görevi bağımsız olarak yapılabilmeli.", 400);
    }
    const requirement = stage === "judge" ? diagramRequirement(body.question) : "optional";
    const preference = stage === "judge" ? diagramPreference(body.question) : "automatic";
    const minimumBranches = requirement === "branches" ? minimumScenarioBranches(body.question) : 2;
    const payload = stage === "judge" ? {
      ...body, answers: formatExpertAnswers(body.answers, preference !== "declined"),
      diagramRequirement: requirement, diagramPreference: preference, reviewDraft: undefined,
    }
      : stage === "docs" ? publicResult(body)
      : stage === "plan"
      ? {
          ...body,
          planFeedback: undefined,
          openaiModel:
            typeof body.openaiModel === "string" && body.openaiModel.trim()
              ? body.openaiModel.trim()
              : process.env.OPENAI_MODEL || "gpt-5-mini",
        }
      : body;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(stage === "attachment" ? 120_000 : 20 * 60 * 1000)]);
    async function invoke(input: Record<string, unknown>) {
      const response = await fetch(`${baseUrl}/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        throw new RequestError(stage === "attachment"
          ? `Dosya okunamadı (${response.status}). Dosyayı ve seçili modelin görsel desteğini kontrol edin.`
          : `İş akışı tamamlanamadı (${response.status}). Bağlantı ve model erişimini kontrol edin.`,
          response.status === 429 ? 429 : 502);
      }
      const data = await readJson(response, 2 * 1024 * 1024);
      if (typeof data.error === "string" || !Object.keys(data).length) {
        throw new RequestError("İş akışı geçerli bir sonuç üretmedi. n8n bağlantısını ve model erişimini kontrol edin.", 502);
      }
      return data;
    }

    let data = await invoke(payload);
    if (stage === "attachment") {
      if (typeof data.evidence !== "string" || !data.evidence.trim()) {
        throw new RequestError("Dosya okunamadı. Dosyayı ve seçili modelin görsel desteğini kontrol edin.", 502);
      }
      return NextResponse.json({ evidence: data.evidence.trim().slice(0, 12_000) });
    }
    if (stage === "worker" && typeof data.answer === "string") {
      const { answer, diagramNotes } = splitExpertAnswer(data.answer);
      if (diagramNotes) return NextResponse.json({
        ...data, answer: answer || "Uzman metin bulgusu sunmadı.", diagramNotes,
      });
    }
    if (stage === "plan") {
      const planIssue = (plan: Record<string, unknown>) => {
        if (typeof plan.planIssue === "string" && plan.planIssue) return plan.planIssue;
        if (typeof plan.directResponse === "string" && plan.directResponse.trim()) return;
        if (!Array.isArray(plan.agents) || !plan.agents.length || !plan.agents.every(isIndependentExpert)) {
          return "Her görev yalnızca özgün soru ve verilen kanıtla yapılabilmeli. Diğer uzmanların çalışmalarını gerektiren görevleri ve genel eylem planlama rollerini değiştir.";
        }
      };
      const feedback = planIssue(data);
      if (feedback) {
        data = await invoke({ ...payload, planFeedback: feedback.slice(0, 500) });
        if (planIssue(data)) {
          throw new RequestError("İki denemede de geçerli bağımsız uzman planı üretilemedi. Uzmanlar çalıştırılmadı.", 502);
        }
      }
    }
    if (stage === "judge") {
      const hidden = { showDiagram: false, diagram: { nodes: [], edges: [] } };
      if (preference === "declined") return NextResponse.json(publicResult({ ...data, ...hidden }));

      const requireLoop = needsReviewLoop(body.question);
      function validate(candidate: Record<string, unknown>) {
        if (candidate.showDiagram !== true) {
          return preference === "requested" ? "Kullanıcı açıkça çözüm akışı istedi; showDiagram true olmalı." : undefined;
        }
        return diagramValidationIssue(candidate.diagram, requirement === "branches" ? "branches" : "flow",
          minimumBranches, requireLoop);
      }
      let issue = validate(data);
      if (issue || (data.showDiagram === true && requirement === "branches")) {
        const first = data;
        const firstIssue = issue;
        try {
          data = await invoke({
            ...payload,
            reviewDraft: {
              answer: typeof data.finalAnswer === "string" ? data.finalAnswer.slice(0, 16_000) : "",
              diagramIssue: issue ?? "",
            },
          });
          issue = validate(data);
        } catch {
          if (request.signal.aborted) return new NextResponse(null, { status: 499 });
          issue = "İkinci doğrulama tamamlanamadı.";
        }
        if (issue && !firstIssue && first.showDiagram === true) {
          data = first;
          issue = undefined;
        }
      }
      if (issue) {
        data = { ...data, ...hidden, ...(preference === "requested" ? { diagramIssue: "Çözüm akışı oluşturulamadı" } : {}) };
      } else if (data.showDiagram !== true) {
        data = { ...data, ...hidden };
      }
      return NextResponse.json(publicResult(data));
    }
    return NextResponse.json(data);
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "İş akışı servisine bağlanılamadı veya yanıt geçersiz." }, { status: 502 });
  } finally { release?.(); }
}
