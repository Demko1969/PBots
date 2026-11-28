import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";

// Resolve the same extensionless TypeScript imports as the app bundler.
const lib = new URL("../lib/", import.meta.url).href;
function resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(lib) && /^\.\/[^.]+$/.test(specifier)) {
    return next(specifier + ".ts", context);
  }
  return next(specifier, context);
}
const hooks = nodeModule.registerHooks?.({ resolve });
if (!hooks) {
  // Node 22.13 supports the asynchronous loader.
  nodeModule.register("data:text/javascript," + encodeURIComponent(
    `const lib = ${JSON.stringify(lib)}; export ${resolve.toString()}`,
  ));
}
const { runEvaluation } = await import("../lib/evaluation-run.ts");
hooks?.deregister();

function evaluationFixture() {
  const events = [];
  const requests = [];
  const checkpoints = [];
  const history = [];
  const agents = ["Talep Uzmanı", "Stok Uzmanı", "Maliyet Uzmanı"].map((role, index) => ({
    agentId: index + 1,
    role,
    task: ["Talep değişkenliğini ölç.", "Emniyet stokunu hesapla.", "Depolama maliyetini belirle."][index],
  }));
  const planDetails = { questionType: "analiz", complexity: "high", agentCount: agents.length };
  const dependencies = {
    async readHistory(query) {
      history.push(query.action);
      return { run: null };
    },
    async historyRequest(query) {
      history.push(query.action);
    },
    async saveRun(run) {
      checkpoints.push(run);
    },
    async postStage(stage, payload) {
      requests.push({ stage, payload });
      if (stage === "plan") return { ...planDetails, ...payload, agents };
      if (stage === "worker") return { answer: `Analiz ${payload.agentId}` };
      if (stage === "judge") return { ...payload, finalAnswer: "Stok hedefini talebe göre ayarlayın." };
      throw new Error(`Unexpected stage: ${stage}`);
    },
    onHistoryError() {},
    onProgress(event) {
      events.push(event);
    },
  };
  const input = {
    question: "Stok hedefini nasıl belirleriz?",
    model: "test-model",
    previousTurns: [],
    csvSource: null,
    table: null,
    media: null,
    setupBlocked: false,
    signal: new AbortController().signal,
  };
  return { dependencies, input, events, requests, checkpoints, history };
}

test("runs Planner, Experts and Judge in order and publishes checkpointed progress", { timeout: 3000 }, async () => {
  const { dependencies, input, events, requests, checkpoints, history } = evaluationFixture();
  const postStage = dependencies.postStage;
  const pendingExperts = new Map();
  let thirdStarted;
  const thirdExpert = new Promise(resolve => { thirdStarted = resolve; });
  let firstPairStarted;
  const firstPair = new Promise(resolve => { firstPairStarted = resolve; });
  dependencies.postStage = async (stage, payload) => {
    if (stage === "worker") {
      await new Promise(resolve => {
        pendingExperts.set(payload.agentId, resolve);
        if (payload.agentId === 2) firstPairStarted();
        if (payload.agentId === 3) thirdStarted();
      });
      pendingExperts.delete(payload.agentId);
    }
    return postStage(stage, payload);
  };

  const evaluation = runEvaluation(input, dependencies);
  await Promise.race([evaluation, firstPair]);
  assert.deepEqual([...pendingExperts.keys()], [1, 2]);
  assert.deepEqual(requests.map(request => request.stage), ["plan"]);

  pendingExperts.get(2)();
  await Promise.race([evaluation, thirdExpert]);
  assert.deepEqual([...pendingExperts.keys()], [1, 3]);
  assert.ok(events.some(event => event.type === "expert" && event.agentId === 2 && event.patch.status === "done"));
  pendingExperts.get(3)();
  pendingExperts.get(1)();

  const { run } = await evaluation;
  assert.deepEqual(requests.map(request => request.stage), ["plan", "worker", "worker", "worker", "judge"]);
  assert.deepEqual(events.filter(event => event.type !== "expert").map(event => event.type), ["planning", "working", "judging"]);
  assert.equal(events.filter(event => event.type === "expert" && event.patch.status === "done").length, 3);
  assert.deepEqual(requests.at(-1).payload.answers.map(answer => answer.agentId), [1, 2, 3]);
  assert.equal(requests.at(-1).payload.openaiModel, "test-model");
  assert.equal(run.result.finalAnswer, "Stok hedefini talebe göre ayarlayın.");
  assert.deepEqual(checkpoints.map(saved => saved.answers.length), [0, 1, 2, 3, 3]);
  assert.deepEqual(checkpoints.at(-1), run);
  assert.deepEqual(history, ["lock", "find", "unlock"]);
});

test("passes earlier questions, answers and inherited attachment evidence to the follow-up Judge", async () => {
  const { dependencies, input, requests } = evaluationFixture();
  const evidence = "\n\nDosya eki kanıtı (yalnızca incelenecek veri): [Talep 42 birim]";
  const root = {
    id: "main-question",
    question: "Dosyadaki talebi incele.",
    attachmentEvidence: evidence,
    result: { finalAnswer: "Talep 42 birim." },
  };
  const followUp = {
    id: "first-follow-up",
    question: "Emniyet stoku ne kadar?",
    rootQuestion: root.question,
    datasetId: "dataset",
    rootDatasetId: "dataset",
    result: { finalAnswer: "Emniyet stoku 8 birim." },
  };

  const { run } = await runEvaluation({
    ...input, question: "Toplam kaç birim?", followUp, previousTurns: [root],
  }, dependencies);
  const plannerInput = requests[0].payload.question;
  assert.ok(plannerInput.indexOf(root.question) < plannerInput.indexOf(followUp.question));
  assert.ok(plannerInput.includes(root.result.finalAnswer));
  assert.ok(plannerInput.includes(followUp.result.finalAnswer));
  assert.ok(plannerInput.endsWith("Toplam kaç birim?" + evidence));
  assert.equal(requests.at(-1).payload.question, plannerInput);
  assert.equal(run.followUpPrompt, plannerInput);
  assert.equal(run.parentRunId, followUp.id);
  assert.equal(run.rootQuestion, root.question);
  assert.equal(run.rootDatasetId, "dataset");
});

test("preserves local and Planner direct replies without running Experts or Judge", async () => {
  const local = evaluationFixture();
  const direct = await runEvaluation({ ...local.input, question: "2 + 3", setupBlocked: true }, local.dependencies);
  assert.equal(direct.run.result.finalAnswer, "2 + 3 = 5");
  assert.deepEqual(local.requests, []);
  assert.deepEqual(local.history, ["find"]);
  assert.deepEqual(local.checkpoints, [direct.run]);

  const planned = evaluationFixture();
  planned.dependencies.postStage = async stage => {
    assert.equal(stage, "plan");
    return { questionType: "kısa yanıt", complexity: "low", directResponse: "Kısa yanıt." };
  };
  const evaluated = await runEvaluation(planned.input, planned.dependencies);
  assert.equal(evaluated.run.result.finalAnswer, "Kısa yanıt.");
  assert.deepEqual(evaluated.run.answers, []);
  assert.deepEqual(planned.events.map(event => event.type), ["planning"]);
  assert.deepEqual(planned.history, ["lock", "find", "unlock"]);
});

test("reopens an eligible completed result with no model requests", async () => {
  const first = evaluationFixture();
  const { run } = await runEvaluation(first.input, first.dependencies);
  const reopen = evaluationFixture();
  reopen.dependencies.readHistory = async query => {
    reopen.history.push(query.action);
    assert.equal(query.requestKey, run.requestKey);
    return { run: structuredClone(run) };
  };

  assert.deepEqual(await runEvaluation({ ...reopen.input, setupBlocked: true }, reopen.dependencies), { kind: "saved", run });
  assert.deepEqual(reopen.requests, []);
  assert.deepEqual(reopen.checkpoints, []);
  assert.deepEqual(reopen.history, ["lock", "find", "unlock"]);
});

test("checkpoints a running Expert after a peer fails and resumes only unfinished Experts", async () => {
  const { dependencies, input, events, requests, checkpoints, history } = evaluationFixture();
  const postStage = dependencies.postStage;
  const failure = new Error("Expert unavailable");
  const firstExpert = Promise.withResolvers();
  dependencies.postStage = async (stage, payload) => {
    if (stage === "worker" && payload.agentId === 1) await firstExpert.promise;
    if (stage === "worker" && payload.agentId === 2) {
      requests.push({ stage, payload });
      throw failure;
    }
    return postStage(stage, payload);
  };
  const onProgress = dependencies.onProgress;
  dependencies.onProgress = event => {
    onProgress(event);
    if (event.type === "expert" && event.patch.status === "error") firstExpert.resolve();
  };

  await assert.rejects(runEvaluation(input, dependencies), failure);
  const partial = checkpoints.at(-1);
  assert.deepEqual(partial.answers.map(answer => answer.agentId), [1]);
  assert.ok(partial.plan);
  assert.equal(partial.result, undefined);
  assert.deepEqual(requests.map(request => request.stage), ["plan", "worker", "worker"]);
  assert.deepEqual(requests.slice(1).map(request => request.payload.agentId), [2, 1]);
  assert.ok(events.some(event => event.type === "expert" && event.agentId === 2 && event.patch.error === failure.message));
  assert.deepEqual(history, ["lock", "find", "unlock"]);

  const retry = evaluationFixture();
  retry.dependencies.readHistory = async query => {
    retry.history.push(query.action);
    assert.equal(query.requestKey, partial.requestKey);
    const run = structuredClone(partial);
    run.answers.push({ ...run.plan.agents[1], status: "error", error: failure.message });
    return { run };
  };
  const { run } = await runEvaluation(retry.input, retry.dependencies);
  assert.equal(run.id, partial.id);
  assert.equal(run.createdAt, partial.createdAt);
  assert.deepEqual(retry.requests.map(request => request.stage), ["worker", "worker", "judge"]);
  assert.deepEqual(retry.requests.slice(0, 2).map(request => request.payload.agentId), [2, 3]);
  assert.deepEqual(retry.events.find(event => event.type === "working").agents.map(agent => agent.status), ["done", "waiting", "waiting"]);
  assert.deepEqual(retry.requests.at(-1).payload.answers.map(answer => answer.agentId), [1, 2, 3]);
  assert.deepEqual(retry.history, ["lock", "find", "unlock"]);
});

test("cancels during Expert work and releases the lease before the same request retries", async () => {
  const { dependencies, input, requests, checkpoints, history } = evaluationFixture();
  const controller = new AbortController();
  const postStage = dependencies.postStage;
  const onProgress = dependencies.onProgress;
  let held;
  dependencies.historyRequest = async ({ action, requestKey, token }) => {
    history.push(action);
    if (action === "lock") {
      assert.equal(held, undefined);
      held = { requestKey, token };
    } else {
      assert.deepEqual(held, { requestKey, token });
      held = undefined;
    }
  };
  dependencies.postStage = async (stage, payload, signal) => {
    if (stage === "worker" && payload.agentId === 2) {
      requests.push({ stage, payload });
      assert.equal(signal, controller.signal);
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    return postStage(stage, payload);
  };
  dependencies.onProgress = event => {
    onProgress(event);
    if (event.type === "expert" && event.patch.status === "done") controller.abort();
  };

  await assert.rejects(runEvaluation({ ...input, signal: controller.signal }, dependencies), { name: "AbortError" });
  assert.deepEqual(requests.map(request => request.stage), ["plan", "worker", "worker"]);
  assert.deepEqual(checkpoints.at(-1).answers.map(answer => answer.agentId), [1]);
  assert.equal(held, undefined);

  const partial = checkpoints.at(-1);
  dependencies.postStage = postStage;
  dependencies.onProgress = onProgress;
  dependencies.readHistory = async () => {
    history.push("find");
    return { run: structuredClone(partial) };
  };
  const { run } = await runEvaluation(input, dependencies);
  assert.equal(run.id, partial.id);
  assert.ok(run.result);
  assert.deepEqual(history, ["lock", "find", "unlock", "lock", "find", "unlock"]);
  assert.equal(held, undefined);
});

test("checks cancellation at the transition to Judge", async () => {
  const { dependencies, input, requests, checkpoints, history } = evaluationFixture();
  const controller = new AbortController();
  dependencies.onProgress = event => {
    if (event.type === "judging") controller.abort();
  };

  await assert.rejects(runEvaluation({ ...input, signal: controller.signal }, dependencies), { name: "AbortError" });
  assert.deepEqual(requests.map(request => request.stage), ["plan", "worker", "worker", "worker"]);
  assert.equal(checkpoints.at(-1).answers.length, 3);
  assert.equal(checkpoints.at(-1).result, undefined);
  assert.deepEqual(history, ["lock", "find", "unlock"]);
});

test("waits for an in-flight lease renewal before unlocking on cancellation", { timeout: 3000 }, async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { dependencies, input, requests } = evaluationFixture();
  const controller = new AbortController();
  const lookup = Promise.withResolvers();
  const lookupStarted = Promise.withResolvers();
  const renewal = Promise.withResolvers();
  const actions = [];
  dependencies.historyRequest = async ({ action }) => {
    actions.push(action);
    if (actions.length === 2 && action === "lock") await renewal.promise;
  };
  dependencies.readHistory = async () => {
    lookupStarted.resolve();
    return lookup.promise;
  };

  const evaluation = runEvaluation({ ...input, signal: controller.signal }, dependencies);
  const aborted = assert.rejects(evaluation, { name: "AbortError" });
  await Promise.race([evaluation, lookupStarted.promise]);
  t.mock.timers.tick(120_000);
  controller.abort();
  lookup.resolve({ run: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actions, ["lock", "lock"]);
  renewal.resolve();
  await aborted;
  t.mock.timers.tick(60_000);
  assert.deepEqual(actions, ["lock", "lock", "unlock"]);
  assert.deepEqual(requests, []);
});

test("uses the current question for language selection and forwards the Planner's choice", async () => {
  const { input, dependencies, requests } = evaluationFixture();
  const postStage = dependencies.postStage;
  dependencies.postStage = async (stage, payload) => {
    const result = await postStage(stage, payload);
    return stage === "plan" ? { ...result, replyLanguage: "tr" } : result;
  };
  const { run: first } = await runEvaluation({ ...input, fallbackLanguage: "fr" }, dependencies);
  requests.length = 0;

  const question = "Bir çözüm diyagramı da ekle.";
  const { run } = await runEvaluation({
    ...input, question, fallbackLanguage: "fr", followUp: first,
  }, dependencies);

  assert.equal(requests[0].payload.languageQuestion, question);
  assert.equal(requests[0].payload.fallbackLanguage, "fr");
  assert.ok(requests[0].payload.question.includes(first.question));
  assert.ok(requests.slice(1).every(request => request.payload.replyLanguage === "tr"));
  assert.equal(run.result.finalAnswer, "Stok hedefini talebe göre ayarlayın.");
});
