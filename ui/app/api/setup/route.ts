import { providers } from "../../../lib/provider-catalog.mjs";
import { NextRequest, NextResponse } from "next/server";
import { checkRequest, readJson, internalHeaders, reserveRequest, RequestError } from "../../../lib/server-security";

export async function GET(request: NextRequest) {
  try { checkRequest(request, false); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Geçersiz istek." }, { status: 403 }); }
  if (!process.env.SETUP_SERVICE_URL) return NextResponse.json({
    enabled: false,
    defaultProvider: "openai",
    providers: [{ id: "openai", ...providers.openai, model: process.env.OPENAI_MODEL || providers.openai.model, configured: true }],
    docsEnabled: process.env.GOOGLE_DOCS_ENABLED === "true",
  }, { headers: { "Cache-Control": "no-store" } });
  try {
    const response = await fetch(`${process.env.SETUP_SERVICE_URL}/status`, {
      headers: await internalHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Setup service unavailable");
    return NextResponse.json({
      ...await response.json(), enabled: true,
      docsEnabled: process.env.GOOGLE_DOCS_ENABLED === "true",
      editorUrl: process.env.N8N_EDITOR_URL || "http://localhost:5680",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ enabled: true, connected: false, error: "Kurulum servisine bağlanılamadı." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.SETUP_SERVICE_URL) return NextResponse.json({ error: "Kurulum etkin değil." }, { status: 404 });
  let release: (() => void) | undefined;
  try {
    checkRequest(request);
    const body = await readJson(request, 4096);
    if (body.action === "test" || body.action === "save") release = reserveRequest();
    const managing = body.action === "save" || body.action === "test" || body.action === "default";
    const response = await fetch(`${process.env.SETUP_SERVICE_URL}/${managing ? "providers" : "configure"}`, {
      method: "POST", headers: await internalHeaders(),
      body: JSON.stringify({ apiKey: body.apiKey, provider: body.provider, action: body.action }),
      redirect: "error", signal: AbortSignal.timeout(managing ? 25_000 : 10 * 60 * 1000),
    });
    return NextResponse.json(await response.json(), { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Kurulum tamamlanamadı. Bağlantıyı kontrol edip tekrar deneyin." }, { status: 502 });
  } finally { release?.(); }
}
