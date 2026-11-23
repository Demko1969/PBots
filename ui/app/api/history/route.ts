import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { NextResponse } from "next/server";
import { checkRequest, readJson, RequestError } from "../../../lib/server-security";

import { isAttachmentThumbnail } from "../../../lib/attachments";
import { isTablePreview } from "../../../lib/table";
import { groupHistory } from "../../../lib/history-groups";
import { redactCredentials } from "../../../lib/credential-redaction";

let database: DatabaseSync | undefined;
const leaseMs = 25 * 60 * 1000;

function store(path: string) {
  if (database) return database;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS runs_request_key ON runs(json_extract(data, '$.requestKey'), updated DESC);
    CREATE TABLE IF NOT EXISTS leases (key TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS leases_expires ON leases(expires);
  `);
  database = db;
  return db;
}

// Only the evaluation fields used by the UI may reach disk.
const fields = new Set([
  "id", "requestKey", "question", "model", "updated", "plan", "followUpPrompt", "attachmentEvidence", "rootQuestion", "parentRunId", "createdAt", "answers", "result", "documentUrl",
  "openaiModel", "questionType", "complexity", "agentCount", "agents", "agentId", "role", "task",
  "status", "answer", "diagramNotes", "wordCount", "error", "summaryPoints", "detailedAnswer", "finalAnswer",
  "displayAnswer", "showDiagram", "diagramIssue", "diagram", "nodes", "edges", "title", "detail", "kind", "from", "to", "label",
]);
function sanitize(key: string, value: unknown) {
  if (key === "tablePreview") {
    if (value === null) return null;
    if (!isTablePreview(value)) return undefined;
    const [name, columns, rows, count] = value;
    return [
      redactCredentials(name), columns.map(redactCredentials),
      rows.map(row => row.map(redactCredentials)), count,
    ];
  }
  if (key === "imageThumbnail") return isAttachmentThumbnail(value) ? value : undefined;
  if (key && !/^\d+$/.test(key) && !fields.has(key)) return undefined;
  if (key === "showDiagram") return typeof value === "boolean" ? value : undefined;
  if (key === "diagramIssue" && typeof value !== "string") return undefined;
  if (typeof value === "string") return redactCredentials(value);
  return value;
}

const idPattern = /^[a-f0-9-]{36}$/i;
const keyPattern = /^[a-f0-9]{64}$/;

function historyGroups(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT id, json_extract(data, '$.question') AS question,
      COALESCE(json_extract(data, '$.createdAt'), updated) AS askedAt,
      json_extract(data, '$.rootQuestion') AS rootQuestion,
      CASE WHEN json_extract(data, '$.rootQuestion') <> ''
        THEN CASE WHEN json_extract(data, '$.followUpPrompt') <> '' THEN '1' END
        ELSE json_extract(data, '$.followUpPrompt')
      END AS followUpPrompt,
      json_type(data, '$.result') = 'object' AS completed
    FROM runs ORDER BY askedAt DESC, rowid DESC
  `).all() as {
    id: string; question: string; askedAt: number; rootQuestion?: string; followUpPrompt?: string; completed: number | null;
  }[];
  const groups = groupHistory(rows).map(group => ({
    ...group,
    askedAt: (group.runs.find(run => !run.followUpPrompt) ?? group.runs[0]).askedAt,
  }));
  return groups.sort((a, b) => b.askedAt - a.askedAt);
}

export async function POST(request: Request) {
  try {
    checkRequest(request);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)) {
      throw new RequestError("Geçmiş yalnızca yerel kurulumda kullanılabilir.", 403);
    }
    const path = process.env.HISTORY_DB_PATH || join(homedir(), ".ortak-akil", "evaluations.sqlite");
    const body = await readJson(request, 4 * 1024 * 1024);
    const db = store(path);
    switch (body.action) {
      case "list":
        return NextResponse.json({
          groups: historyGroups(db).map(({ key, question, runs }) => ({
            key, question, completed: runs.some(run => run.completed),
          })),
        }, { headers: { "Cache-Control": "no-store" } });
      case "group": {
        if (typeof body.key !== "string") throw new RequestError("Geçersiz soru grubu.", 400);
        const group = historyGroups(db).find(entry => entry.key === body.key);
        const ids = JSON.stringify(group?.runs.map(run => run.id) ?? []);
        const rows = db.prepare(`
          SELECT data FROM runs WHERE id IN (SELECT value FROM json_each(?))
          ORDER BY COALESCE(json_extract(data, '$.createdAt'), updated), rowid
        `).all(ids);
        return NextResponse.json({ runs: rows.map(row => JSON.parse(String(row.data))) },
          { headers: { "Cache-Control": "no-store" } });
      }
      case "find": {
        if (typeof body.requestKey !== "string" || !keyPattern.test(body.requestKey)) {
          throw new RequestError("Geçersiz kayıt anahtarı.", 400);
        }
        const row = db.prepare(`
          SELECT data FROM runs WHERE json_extract(data, '$.requestKey') = ?
            AND (? = 0 OR json_type(data, '$.result') = 'object')
          ORDER BY updated DESC, rowid DESC LIMIT 1
        `).get(body.requestKey, body.completed ? 1 : 0);
        return NextResponse.json({ run: row ? JSON.parse(String(row.data)) : null },
          { headers: { "Cache-Control": "no-store" } });
      }
      case "save":
      case "import": {
        const run = body.run as Record<string, unknown> | undefined;
        if (!run || typeof run.id !== "string" || !idPattern.test(run.id) ||
          typeof run.requestKey !== "string" || !keyPattern.test(run.requestKey) ||
          typeof run.question !== "string" || (run.rootQuestion !== undefined && typeof run.rootQuestion !== "string") || typeof run.model !== "string" || !Array.isArray(run.answers) ||
          (run.parentRunId !== undefined && (typeof run.parentRunId !== "string" || !idPattern.test(run.parentRunId))) ||
          (run.createdAt !== undefined && (typeof run.createdAt !== "number" || !Number.isSafeInteger(run.createdAt)))) {
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
      case "deleteGroup": {
        const groupKey = body.action === "deleteGroup" && typeof body.key === "string" ? body.key : null;
        const id = groupKey === null && typeof body.id === "string" && idPattern.test(body.id) ? body.id : null;
        if (groupKey === null && !id) throw new RequestError("Geçersiz kayıt.", 400);
        const remove = db.prepare("DELETE FROM runs WHERE id = ?");
        db.exec("BEGIN IMMEDIATE");
        try {
          const group = historyGroups(db).find(entry => groupKey !== null
            ? entry.key === groupKey
            : entry.runs.some(run => run.id === id));
          const run = group?.runs.find(run => run.id === id);
          const lastMainRun = run && !run.followUpPrompt &&
            !group?.runs.some(other => other.id !== run.id && !other.followUpPrompt);
          const deletedIds = group && (body.action === "deleteGroup" || lastMainRun)
            ? group.runs.map(run => run.id)
            : id ? [id] : [];
          for (const id of deletedIds) remove.run(id);
          db.exec("COMMIT");
          return NextResponse.json({ ok: true, deletedIds });
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
      case "lock":
      case "unlock": {
        const { requestKey, token } = body;
        if (typeof requestKey !== "string" || !keyPattern.test(requestKey) ||
          typeof token !== "string" || !idPattern.test(token)) throw new RequestError("Geçersiz işlem.", 400);
        const now = Date.now();
        if (body.action === "unlock") {
          db.prepare("DELETE FROM leases WHERE key = ? AND token = ?").run(requestKey, token);
        } else {
          db.prepare("DELETE FROM leases WHERE expires <= ?").run(now);
          const result = db.prepare(`
            INSERT INTO leases (key, token, expires) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET token = excluded.token, expires = excluded.expires
            WHERE leases.token = excluded.token OR leases.expires <= ?
          `).run(requestKey, token, now + leaseMs, now);
          if (!result.changes) throw new RequestError("Bu değerlendirme başka bir tarayıcıda çalışıyor.", 409);
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
