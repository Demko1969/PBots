import { NextRequest, NextResponse } from "next/server";
import { checkRequest, readJson, internalHeaders, reserveRequest, RequestError } from "../../../../lib/server-security";

const endpoints: Record<string, string> = {
  plan: "multi-agent-ui-plan",
  worker: "multi-agent-ui-worker",
  judge: "multi-agent-ui-judge",
  docs: "multi-agent-ui-docs",
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ stage: string }> },
) {
  const { stage } = await context.params;
  const endpoint = endpoints[stage];
  if (!endpoint) return NextResponse.json({ error: "Bilinmeyen işlem aşaması" }, { status: 404 });

  if (stage === "docs" && process.env.SETUP_SERVICE_URL && process.env.GOOGLE_DOCS_ENABLED !== "true") {
    return NextResponse.json({ error: "Önce Google Docs kurulumunu tamamlayın." }, { status: 409 });
  }

  const baseUrl = (process.env.N8N_WEBHOOK_BASE_URL || "http://127.0.0.1:5678/webhook").replace(/\/$/, "");
  let body: Record<string, unknown>;
  let release: () => void;
  try {
    checkRequest(request);
    body = await readJson(request, 512 * 1024);
    release = reserveRequest();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Geçersiz istek." }, { status: error instanceof RequestError ? error.status : 400 });
  }

  const payload = stage === "plan"
    ? {
        ...body,
        openaiModel:
          typeof body.openaiModel === "string" && body.openaiModel.trim()
            ? body.openaiModel.trim()
            : process.env.OPENAI_MODEL || "gpt-5-mini",
      }
    : body;
  try {
    const headers = await internalHeaders();
    const response = await fetch(`${baseUrl}/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20 * 60 * 1000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      return NextResponse.json({ error: `İş akışı tamamlanamadı (${response.status}). Bağlantı ve model erişimini kontrol edin.` }, { status });
    }
    const data = await readJson(response, 2 * 1024 * 1024);
    if (typeof data.error === "string" || !Object.keys(data).length) {
      return NextResponse.json({ error: "İş akışı geçerli bir sonuç üretmedi. n8n bağlantısını ve model erişimini kontrol edin." }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "İş akışı servisine bağlanılamadı veya yanıt geçersiz." }, { status: 502 });
  } finally { release(); }
}
