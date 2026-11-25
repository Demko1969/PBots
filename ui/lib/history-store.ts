import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { RequestError } from "./server-security";

import { isAttachmentThumbnail } from "./attachments";
import { isTablePreview } from "./table";
import { historyDeletionIds, historyThreads } from "./history-groups";
import { redactCredentials } from "./credential-redaction";

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
  "id", "datasetId", "rootDatasetId", "requestKey", "question", "model", "updated", "plan", "followUpPrompt", "attachmentEvidence", "rootQuestion", "parentRunId", "createdAt", "answers", "result", "documentUrl",
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
  if (key === "datasetId" || key === "rootDatasetId") return typeof value === "string" && keyPattern.test(value) ? value : undefined;
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
      json_extract(data, '$.rootDatasetId') AS rootDatasetId,
      CASE WHEN json_extract(data, '$.rootQuestion') <> ''
        THEN CASE WHEN json_extract(data, '$.followUpPrompt') <> '' THEN '1' END
        ELSE json_extract(data, '$.followUpPrompt')
      END AS followUpPrompt,
      json_type(data, '$.result') = 'object' AS completed
    FROM runs ORDER BY rowid
  `).all() as {
    id: string; question: string; askedAt: number; rootQuestion?: string; rootDatasetId?: string;
    followUpPrompt?: string; completed: number | null;
  }[];
  return historyThreads(rows.map(row => ({ ...row, completed: Boolean(row.completed) })));
}

export function historyAction(path: string, body: Record<string, unknown>) {
  const db = store(path);
  switch (body.action) {
    case "list":
      return Response.json({
        groups: historyGroups(db).map(({ key, question, completed }) => ({ key, question, completed })),
      }, { headers: { "Cache-Control": "no-store" } });
    case "group": {
      if (typeof body.key !== "string") throw new RequestError("Geçersiz soru grubu.", 400);
      const group = historyGroups(db).find(entry => entry.key === body.key);
      const ids = JSON.stringify(group?.runs.map(run => run.id) ?? []);
      const rows = db.prepare(`
        SELECT runs.data FROM json_each(?) AS turn JOIN runs ON runs.id = turn.value
        ORDER BY turn.key
      `).all(ids);
      return Response.json({ runs: rows.map(row => JSON.parse(String(row.data))) },
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
      return Response.json({ run: row ? JSON.parse(String(row.data)) : null },
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
      // Freeze the original ask time, including the timestamp fallback for older rows.
      db.prepare(body.action === "import"
        ? insert + " ON CONFLICT(id) DO NOTHING"
        : insert + ` ON CONFLICT(id) DO UPDATE SET updated = excluded.updated,
          data = json_set(excluded.data, '$.createdAt', COALESCE(json_extract(runs.data, '$.createdAt'), runs.updated))`
      ).run(run.id, updated, data);
      break;
    }
    case "delete":
    case "deleteGroup": {
      const target = body.action === "deleteGroup"
        ? (typeof body.key === "string" ? { action: body.action, key: body.key } as const : null)
        : (typeof body.id === "string" && idPattern.test(body.id) ? { action: body.action, id: body.id } as const : null);
      if (!target) throw new RequestError("Geçersiz kayıt.", 400);
      const remove = db.prepare("DELETE FROM runs WHERE id = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        const deletedIds = historyDeletionIds(historyGroups(db), target);
        for (const id of deletedIds) remove.run(id);
        db.exec("COMMIT");
        return Response.json({ ok: true, deletedIds });
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
  return Response.json({ ok: true });
}
