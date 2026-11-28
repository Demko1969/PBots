import { NextRequest, NextResponse } from "next/server";
import { checkRequest, readJson, internalHeaders, RequestError } from "../../../lib/server-security";

export async function GET(request: NextRequest) {
  try { checkRequest(request, false); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Geçersiz istek." }, { status: 403 }); }
  if (!process.env.SETUP_SERVICE_URL) return NextResponse.json({
    enabled: false,
    defaultModel: process.env.OPENAI_MODEL || "gpt-5-mini",
    docsEnabled: process.env.GOOGLE_DOCS_ENABLED === "true",
  });
  try {
    const response = await fetch(`${process.env.SETUP_SERVICE_URL}/status`, {
      headers: await internalHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Setup service unavailable");
    return NextResponse.json({
      ...await response.json(), enabled: true,
      defaultModel: process.env.OPENAI_MODEL || "gpt-5-mini",
      docsEnabled: process.env.GOOGLE_DOCS_ENABLED === "true",
      editorUrl: process.env.N8N_EDITOR_URL || "http://localhost:5680",
    });
  } catch {
    return NextResponse.json({ enabled: true, connected: false, error: "Kurulum servisine bağlanılamadı." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.SETUP_SERVICE_URL) return NextResponse.json({ error: "Kurulum etkin değil." }, { status: 404 });
  try {
    checkRequest(request);
    const body = await readJson(request, 4096);
    const response = await fetch(`${process.env.SETUP_SERVICE_URL}/configure`, {
      method: "POST", headers: await internalHeaders(),
      body: JSON.stringify({ apiKey: body.apiKey }), redirect: "error", signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Kurulum tamamlanamadı. Bağlantıyı kontrol edip tekrar deneyin." }, { status: 502 });
  }
}
