import logo from "../public/ortak-akil-lens.svg?inline";
import { demoHistory } from "./history";
import { questions, scenario, scriptStep, ticketEvidence } from "./scenario";

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
  const marker = "\n\nGüncel soru:\n";
  const currentQuestion = question.slice(question.includes(marker) ? question.lastIndexOf(marker) + marker.length : 0);
  const questionIndex = questions
    .findIndex(prompt => currentQuestion === prompt || currentQuestion.startsWith(prompt + "\n\n"));
  if (stage === "attachment" && questionIndex === 2 && body.name === scenario.followUps[1].attachment?.name) {
    return Response.json({ evidence: ticketEvidence });
  }
  if (questionIndex < 0) return Response.json({ error: "Bu soru demoda kullanılamıyor." }, { status: 400 });
  const step = scriptStep(questionIndex);
  const model = scenario.model.id;
  const result = { question, model, openaiModel: model, questionType: "ERP destek analizi", complexity: "medium", agentCount: step.agents.length };
  if (stage === "plan") return Response.json({ ...result, agents: step.agents });
  if (stage === "worker") {
    const index = Number(body.agentId) - 1;
    return Response.json({ ...step.agents[index], answer: step.expertAnswers[index] });
  }
  if (stage === "judge") {
    return Response.json({
      ...result, answers: body.answers,
      finalAnswer: step.finalAnswer,
      showDiagram: !!step.diagram, diagram: step.diagram,
    });
  }
  return Response.json({ error: "Bu özellik örnek analizde kullanılamıyor." }, { status: 404 });
}
