import logo from "../public/ortak-akil-lens.svg?inline";
import { demoHistory } from "./history";
import { agents, diagram, expertAnswers, finalAnswer, followUpAnswer, scenario } from "./scenario";

export const brandLogo = logo;
export const isDemoTransport = true;
export const robotSprite = "";

export async function appRequest(url: string, options?: RequestInit): Promise<Response> {
  const body = JSON.parse(String(options?.body ?? "{}")) as Record<string, unknown>;
  if (url === "/api/history") return Response.json(demoHistory(body));

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
