import { groupHistory } from "../lib/history-groups";
import logo from "../public/ortak-akil-lens.svg?inline";
import { agents, diagram, expertAnswers, finalAnswer, followUpAnswer, scenario } from "./scenario";

export const brandLogo = logo;
export const isDemoTransport = true;
export const robotSprite = "";

type Run = Parameters<typeof groupHistory>[0][number] & {
  id: string;
  requestKey: string;
  updated: number;
  result?: unknown;
};

const runs = new Map<string, Run>();

function history(body: Record<string, unknown>) {
  const entries = [...runs.values()].sort((a, b) => b.updated - a.updated);
  const groups = groupHistory(entries);
  const group = groups.find(group => group.key === body.key || group.runs.some(run => run.id === body.id));
  switch (body.action) {
    case "save":
    case "import": {
      const run = body.run as Run;
      runs.set(run.id, run);
      break;
    }
    case "list":
      return { groups: groups.map(({ key, question, runs }) => ({ key, question, completed: runs.some(run => run.result) })) };
    case "group":
      return { runs: (group?.runs ?? []).slice().reverse() };
    case "find":
      return { run: entries.find(run => run.requestKey === body.requestKey && (!body.completed || run.result)) ?? null };
    case "delete":
    case "deleteGroup": {
      const deletedIds = body.action === "deleteGroup" ? (group?.runs ?? []).map(run => run.id) : [String(body.id)];
      deletedIds.forEach(id => runs.delete(id));
      return { deletedIds };
    }
  }
  return { ok: true };
}

export async function appRequest(url: string, options?: RequestInit): Promise<Response> {
  const body = JSON.parse(String(options?.body ?? "{}")) as Record<string, unknown>;
  if (url === "/api/history") return Response.json(history(body));

  const stage = url.split("/").at(-1);
  const time = stage === "plan" ? 1050 : stage === "worker" ? 1200 + Number(body.agentId) * 250 : 900;
  const signal = options?.signal;
  await new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, time);
    signal?.addEventListener("abort", abort, { once: true });
  });
  const question = String(body.question);
  const followUp = question.includes(scenario.followUp);
  const model = typeof body.openaiModel === "string" ? body.openaiModel : "gpt-5-mini";
  const result = { question, model, openaiModel: model, questionType: "ERP destek analizi", complexity: "medium", agentCount: agents.length };
  if (stage === "plan") return Response.json({ ...result, agents });
  if (stage === "worker") {
    const index = Number(body.agentId) - 1;
    return Response.json({ ...agents[index], answer: expertAnswers[index] });
  }
  if (stage === "judge") {
    return Response.json({
      ...result, answers: body.answers,
      finalAnswer: followUp ? followUpAnswer : finalAnswer,
      showDiagram: !followUp, diagram: followUp ? undefined : diagram,
    });
  }
  return Response.json({ error: "Bu özellik örnek analizde kullanılamıyor." }, { status: 404 });
}
