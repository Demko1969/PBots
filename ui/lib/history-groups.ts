type HistoryRun = {
  question: string;
  rootQuestion?: string;
  followUpPrompt?: string;
};

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
  return historyRoot(run).normalize("NFC").toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ").replace(/[?？]+$/, "").trim();
}

export function groupHistory<T extends HistoryRun>(runs: T[]) {
  const groups = new Map<string, { key: string; question: string; runs: T[] }>();
  for (const run of runs) {
    const question = historyRoot(run);
    const key = historyGroupKey(run);
    let group = groups.get(key);
    if (!group) {
      group = { key, question, runs: [] };
      groups.set(key, group);
    }
    group.runs.push(run);
  }
  return [...groups.values()];
}
