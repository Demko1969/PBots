import { DatabaseSync } from "node:sqlite";
import { NextResponse } from "next/server";
import { checkRequest, readJson, RequestError } from "../../../lib/server-security";

let database: DatabaseSync | undefined;
const locks = new Map<string, { token: string; until: number }>();
const leaseMs = 25 * 60 * 1000;

function store(path: string) {
  if (database) return database;
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, data TEXT NOT NULL);
  `);
  database = db;
  return db;
}

// Only the evaluation fields used by the UI may reach disk.
const fields = new Set([
  "id", "requestKey", "question", "model", "updated", "plan", "answers", "result", "documentUrl",
  "openaiModel", "questionType", "complexity", "agentCount", "agents", "agentId", "role", "task",
  "status", "answer", "wordCount", "error", "summaryPoints", "detailedAnswer", "finalAnswer",
  "displayAnswer", "diagram", "nodes", "edges", "title", "detail", "kind", "from", "to", "label",
]);
const credentialPattern = /\b(?:sk-(?:proj-|svcacct-|admin-)?[a-z0-9_-]{16,}|Bearer\s+[^\s"']{16,})/gi;
function sanitize(key: string, value: unknown) {
  if (key && !/^\d+$/.test(key) && !fields.has(key)) return undefined;
  if (typeof value === "string") return value.replace(credentialPattern, "[gizlendi]");
  return value;
}

const idPattern = /^[a-f0-9-]{36}$/i;
const keyPattern = /^[a-f0-9]{64}$/;

export async function POST(request: Request) {
  try {
    checkRequest(request);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)) {
      throw new RequestError("Geçmiş yalnızca yerel kurulumda kullanılabilir.", 403);
    }
    const path = process.env.HISTORY_DB_PATH;
    if (!path) throw new RequestError("Geçmiş depolama alanı yapılandırılmadı.", 503);
    const body = await readJson(request, 4 * 1024 * 1024);
    const db = store(path);
    switch (body.action) {
      case "list":
        return NextResponse.json({
          runs: db.prepare("SELECT data FROM runs ORDER BY updated DESC, rowid DESC").all()
            .map(row => JSON.parse(String(row.data))),
        }, { headers: { "Cache-Control": "no-store" } });
      case "save":
      case "import": {
        const run = body.run as Record<string, unknown> | undefined;
        if (!run || typeof run.id !== "string" || !idPattern.test(run.id) ||
          typeof run.requestKey !== "string" || !keyPattern.test(run.requestKey) ||
          typeof run.question !== "string" || typeof run.model !== "string" || !Array.isArray(run.answers)) {
          throw new RequestError("Geçersiz değerlendirme kaydı.", 400);
        }
        const data = JSON.stringify(run, sanitize);
        const updated = typeof run.updated === "number" && Number.isSafeInteger(run.updated) ? run.updated : Date.now();
        const insert = "INSERT INTO runs (id, updated, data) VALUES (?, ?, ?)";
        db.prepare(body.action === "import"
          ? insert + " ON CONFLICT(id) DO NOTHING"
          : insert + " ON CONFLICT(id) DO UPDATE SET updated = excluded.updated, data = excluded.data"
        ).run(run.id, updated, data);
        break;
      }
      case "delete":
        if (typeof body.id !== "string" || !idPattern.test(body.id)) throw new RequestError("Geçersiz kayıt.", 400);
        db.prepare("DELETE FROM runs WHERE id = ?").run(body.id);
        break;
      case "lock":
      case "unlock": {
        const { requestKey, token } = body;
        if (typeof requestKey !== "string" || !keyPattern.test(requestKey) ||
          typeof token !== "string" || !idPattern.test(token)) throw new RequestError("Geçersiz işlem.", 400);
        const now = Date.now();
        for (const [key, lease] of locks) if (lease.until <= now) locks.delete(key);
        const lease = locks.get(requestKey);
        if (body.action === "unlock") {
          if (lease?.token === token) locks.delete(requestKey);
        } else {
          if (lease && lease.token !== token) throw new RequestError("Bu değerlendirme başka bir tarayıcıda çalışıyor.", 409);
          locks.set(requestKey, { token, until: now + leaseMs });
        }
        break;
      }
      default:
        throw new RequestError("Bilinmeyen geçmiş işlemi.", 400);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof RequestError ? error.message : "Yerel geçmişe erişilemedi.",
    }, { status: error instanceof RequestError ? error.status : 500 });
  }
}
