import { readFile } from "node:fs/promises";

export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function checkRequest(request: Request, write = true) {
  const url = new URL(request.url);
  const allowed = process.env.APP_ALLOWED_ORIGINS?.split(",").map(value => value.trim());
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (allowed ? !allowed.includes(url.origin) : !loopback) throw new RequestError("İzin verilmeyen adres.", 403);
  if (write && (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site")) {
    throw new RequestError("Geçersiz istek kaynağı.", 403);
  }
  if (write && request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new RequestError("JSON gövdesi gerekli.", 415);
  }
}

export async function readJson(request: Pick<Request, "body">, limit: number): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("JSON gövdesi gerekli.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestError("İstek çok büyük.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new RequestError("Geçerli bir JSON nesnesi gerekli.", 400); }
}

export async function internalHeaders() {
  const token = process.env.INTERNAL_TOKEN_FILE
    ? await readFile(process.env.INTERNAL_TOKEN_FILE, "utf8").then(value => value.trim(), () => undefined)
    : process.env.N8N_WEBHOOK_SECRET;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    throw new RequestError("İş akışı erişim anahtarı yapılandırılmadı.", 503);
  }
  return { "Content-Type": "application/json", "X-Multi-Agent-Key": token };
}

let activeRequests = 0;
let windowStart = 0;
let requestCount = 0;
export function reserveRequest() {
  const now = Date.now();
  if (now - windowStart > 60000) { windowStart = now; requestCount = 0; }
  if (activeRequests >= 4 || requestCount >= 60) throw new RequestError("İstek sınırına ulaşıldı. Biraz sonra tekrar deneyin.", 429);
  activeRequests++;
  requestCount++;
  return () => { activeRequests--; };
}
