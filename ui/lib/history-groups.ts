type HistoryRun = {
  question: string;
  rootDatasetId?: string;
  rootQuestion?: string;
  followUpPrompt?: string;
};

type HistoryEntry = HistoryRun & { id: string; askedAt: number; completed: boolean };

export type HistoryDeletion = { action: "delete"; id: string } | { action: "deleteGroup"; key: string };

export function historyTime(run: { createdAt?: number; updated: number }) {
  return run.createdAt ?? run.updated;
}

export function historyRoot(run: HistoryRun): string {
  if (run.rootQuestion) return run.rootQuestion;
  // Older follow-ups contain the original question at the innermost context opening.
  const prompt = run.followUpPrompt;
  const marker = "<onceki_degerlendirme>\n";
  const firstContext = prompt?.split("\n\nÖnceki yanıt:\n", 1)[0];
  const context = firstContext?.split(marker).at(-1);
  return context?.split("\n\nCSV analysis context\n", 1)[0].trim() || run.question;
}

export function historyGroupKey(run: HistoryRun) {
  const question = historyRoot(run).normalize("NFC").toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ").replace(/[?？]+$/, "").trim();
  return run.rootDatasetId ? JSON.stringify([run.rootDatasetId, question]) : question;
}

export function historyThreads<T extends HistoryEntry>(runs: T[]) {
  const groups = new Map<string, { key: string; question: string; runs: T[] }>();
  // Adapters supply insertion order to break ties between questions asked in the same millisecond.
  const newestFirst = runs.toSorted((a, b) => a.askedAt - b.askedAt).reverse();
  for (const run of newestFirst) {
    const key = historyGroupKey(run);
    let group = groups.get(key);
    if (!group) {
      group = { key, question: historyRoot(run), runs: [] };
      groups.set(key, group);
    }
    group.runs.push(run);
  }
  return [...groups.values()].map(({ key, question, runs }) => ({
    key, question,
    askedAt: (runs.find(run => !run.followUpPrompt) ?? runs[0]).askedAt,
    completed: runs.some(run => run.completed),
    runs: runs.reverse(),
  })).sort((a, b) => b.askedAt - a.askedAt);
}

export function historyDeletionIds<T extends HistoryEntry>(
  groups: ReturnType<typeof historyThreads<T>>, target: HistoryDeletion,
) {
  if (target.action === "deleteGroup") {
    return groups.find(group => group.key === target.key)?.runs.map(run => run.id) ?? [];
  }
  const group = groups.find(group => group.runs.some(run => run.id === target.id));
  const mainRuns = group?.runs.filter(run => !run.followUpPrompt);
  return group && mainRuns?.length === 1 && mainRuns[0].id === target.id
    ? group.runs.map(run => run.id)
    : [target.id];
}
