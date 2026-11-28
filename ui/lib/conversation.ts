type ConversationRun = {
  question: string;
  followUpPrompt?: string;
  attachmentEvidence?: string;
  id: string;
  updated: number;
  createdAt?: number;
  parentRunId?: string;
  result?: { question: string; finalAnswer: string; displayAnswer?: string };
};

function runTime(run: ConversationRun) {
  return run.createdAt ?? run.updated;
}

export function conversationBefore<T extends ConversationRun>(runs: T[], current: T): T[] {
  const eligible = runs.filter(run => run.id !== current.id && run.result);
  const byId = new Map(eligible.map(run => [run.id, run]));
  const chain: T[] = [];
  let turn = current;
  while (turn.parentRunId) {
    const parent = byId.get(turn.parentRunId);
    if (!parent) break;
    chain.push(parent);
    byId.delete(parent.id);
    turn = parent;
  }

  // Older records have no parent ID. Infer their order within the existing history group.
  if (turn.followUpPrompt && !turn.parentRunId) {
    const earlier = eligible.filter(run => byId.has(run.id) && runTime(run) <= runTime(turn))
      .sort((a, b) => runTime(a) - runTime(b));
    const root = earlier.filter(run => !run.followUpPrompt).at(-1);
    return [...(root ? [root] : []), ...earlier.filter(run => run.followUpPrompt), ...chain.reverse()];
  }
  return chain.reverse();
}

export function conversationPrompt(question: string, turns: ConversationRun[], attachmentEvidence = "") {
  const messages: string[] = [];
  let remaining = 48_000;
  for (const turn of turns.slice().reverse()) {
    if (!turn.result) continue;
    const answer = turn.result.displayAnswer || turn.result.finalAnswer;
    const message = JSON.stringify({
      soru: turn.question.slice(0, 8000),
      yanıt: answer.length > 12_000 ? answer.slice(0, 12_000) + "…" : answer,
    });
    if (message.length > remaining) break;
    messages.unshift(message);
    remaining -= message.length;
  }

  const csvMarker = "\n\nCSV analysis context\n";
  let evidence = attachmentEvidence;
  if (!evidence) {
    for (const turn of turns.slice().reverse()) {
      if (turn.attachmentEvidence) {
        evidence = turn.attachmentEvidence;
        break;
      }
      const source = turn.followUpPrompt ?? turn.result?.question ?? "";
      const csvIndex = source.indexOf(csvMarker);
      if (csvIndex === -1) continue;
      evidence = source.slice(csvIndex);
      break;
    }
  }
  return [
    "Aşağıdaki soru ve yanıtlar sohbet geçmişidir. Yalnızca güncel soruyu yanıtla. Belirsiz göndermelerde son soru ve yanıtı temel al. Kullanıcı daha eski bir noktaya açıkça gönderme yapıyorsa ilgili konuşmayı da kullan.",
    `Sohbet geçmişi (eskiden yeniye): [${messages.join(",\n")}]`,
    `Güncel soru:\n${question}${evidence}`,
  ].join("\n\n");
}
