import { historyDeletionIds, historyThreads, historyTime } from "../lib/history-groups";
import type { SavedRun } from "../lib/evaluation-run";

const runs = new Map<string, SavedRun>();

function completed(run: SavedRun) {
  return run.result != null && typeof run.result === "object" && !Array.isArray(run.result);
}

function groups() {
  return historyThreads([...runs.values()].map(run => ({
    id: run.id, question: run.question, rootQuestion: run.rootQuestion,
    rootDatasetId: run.rootDatasetId, followUpPrompt: run.followUpPrompt,
    askedAt: historyTime(run), completed: completed(run),
  })));
}

export function demoHistory(body: Record<string, unknown>) {
  switch (body.action) {
    case "save":
    case "import": {
      const run = body.run as SavedRun;
      const existing = runs.get(run.id);
      if (!existing) runs.set(run.id, run);
      else if (body.action === "save") runs.set(run.id, { ...run, createdAt: historyTime(existing) });
      break;
    }
    case "list":
      return { groups: groups().map(({ key, question, completed }) => ({ key, question, completed })) };
    case "group": {
      const group = groups().find(group => group.key === body.key);
      return { runs: (group?.runs ?? []).map(turn => runs.get(turn.id)) };
    }
    case "find": {
      const newestFirst = [...runs.values()].sort((a, b) => a.updated - b.updated).reverse();
      return {
        run: newestFirst.find(run => run.requestKey === body.requestKey && (!body.completed || completed(run))) ?? null,
      };
    }
    case "delete":
    case "deleteGroup": {
      const target = body.action === "deleteGroup"
        ? (typeof body.key === "string" ? { action: body.action, key: body.key } as const : null)
        : (typeof body.id === "string" ? { action: body.action, id: body.id } as const : null);
      const deletedIds = target ? historyDeletionIds(groups(), target) : [];
      for (const id of deletedIds) runs.delete(id);
      return { ok: true, deletedIds };
    }
  }
  return { ok: true };
}
