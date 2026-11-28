import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canReuseSavedResult } from "../lib/judge-review.ts";
import test from "node:test";

test("sorts main questions and follow-ups by ask time and deletes only the selected group", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ortak-akil-history-"));
  process.env.HISTORY_DB_PATH = join(directory, "history.sqlite");
  try {
    const root = {
      id: randomUUID(), requestKey: "a".repeat(64), question: "İlk soru", model: "test",
      answers: [], createdAt: 1, result: { finalAnswer: "İlk yanıt" },
    };
    const legacyFollowUp = {
      ...root, id: randomUUID(), requestKey: "b".repeat(64), question: "Takip sorusu", createdAt: 3,
      followUpPrompt: "<onceki_degerlendirme>\nİlk soru\n\nÖnceki yanıt:\nİlk yanıt",
    };
    const otherRoot = { ...root, id: randomUUID(), requestKey: "c".repeat(64), question: "Diğer soru", createdAt: 2 };
    const newestFollowUp = {
      ...legacyFollowUp, id: randomUUID(), requestKey: "d".repeat(64),
      question: "Daha yeni takip", createdAt: 4, rootQuestion: root.question,
    };
    const pending = { ...root, id: randomUUID(), result: undefined };
    const db = new DatabaseSync(process.env.HISTORY_DB_PATH);
    db.exec("CREATE TABLE runs (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, data TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO runs VALUES (?, ?, ?)");
    for (const [index, run] of [root, newestFollowUp, otherRoot, legacyFollowUp, pending].entries()) {
      const updated = index + 1;
      insert.run(run.id, updated, JSON.stringify({ ...run, updated }));
    }
    db.close();

    const { default: worker } = await import("../dist/server/index.js");
    const handler = typeof worker === "function" ? worker : worker.fetch.bind(worker);
    async function history(body, expectedStatus = 200) {
      const response = await handler(new Request("http://localhost/api/history", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify(body),
      }), { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} });
      const data = await response.json();
      assert.equal(response.status, expectedStatus);
      return data;
    }

    const { groups } = await history({ action: "list" });
    assert.deepEqual(groups, [
      { key: "diğer soru", question: otherRoot.question, completed: true },
      { key: "ilk soru", question: root.question, completed: true },
    ]);
    const { runs } = await history({ action: "group", key: groups[1].key });
    assert.deepEqual(runs.map(run => run.id), [root.id, pending.id, legacyFollowUp.id, newestFollowUp.id]);
    assert.equal((await history({ action: "find", requestKey: root.requestKey })).run.id, pending.id);
    assert.equal((await history({ action: "find", requestKey: root.requestKey, completed: true })).run.id, root.id);
    const deletion = await history({ action: "deleteGroup", key: groups[1].key });
    assert.deepEqual(new Set(deletion.deletedIds), new Set(runs.map(run => run.id)));
    assert.deepEqual((await history({ action: "list" })).groups, [groups[0]]);
    assert.deepEqual((await history({ action: "deleteGroup", key: groups[1].key, id: otherRoot.id })).deletedIds, []);
    assert.equal((await history({ action: "find", requestKey: otherRoot.requestKey })).run.id, otherRoot.id);

    const token = randomUUID();
    const contender = randomUUID();
    const requestKey = "e".repeat(64);
    await history({ action: "lock", requestKey, token });
    await history({ action: "lock", requestKey, token: contender }, 409);
    await history({ action: "unlock", requestKey, token: contender });
    await history({ action: "lock", requestKey, token: contender }, 409);
    await history({ action: "unlock", requestKey, token });
    await history({ action: "lock", requestKey, token: contender });

    const testKey = "sk-proj-" + "synthetic".repeat(4);
    const testBearer = "Bearer " + "mock-token".repeat(3);
    const run = {
      ...root, id: randomUUID(), requestKey, question: "Diyagram çiz",
      result: { finalAnswer: "Yanıt", showDiagram: false, diagramIssue: "Çözüm akışı oluşturulamadı" },
      tablePreview: [testKey + ".csv", [testBearer, "label"], [[testKey, "ordinary"]], 1],
    };
    await history({ action: "save", run });
    const { run: saved } = await history({ action: "find", requestKey, completed: true });
    assert.deepEqual(saved.result, run.result);
    assert.equal(canReuseSavedResult(saved.result, run.question), true);
    assert.equal(canReuseSavedResult({ diagram: undefined }, run.question), false);
    assert.deepEqual(saved.tablePreview, ["[gizlendi].csv", ["[gizlendi]", "label"], [["[gizlendi]", "ordinary"]], 1]);
    const savedDb = new DatabaseSync(process.env.HISTORY_DB_PATH, { readOnly: true });
    try {
      const { data } = savedDb.prepare("SELECT data FROM runs WHERE id = ?").get(run.id);
      assert.equal(data.includes(testKey) || data.includes(testBearer), false);
    } finally { savedDb.close(); }
  } finally {
    delete process.env.HISTORY_DB_PATH;
    await rm(directory, { recursive: true, force: true });
  }
});
