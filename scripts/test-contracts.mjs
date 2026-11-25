#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function normalizePlanner(content, question, openaiModel) {
  let plan;
  try { plan = JSON.parse(content); }
  catch (error) { throw new Error(`Planner ayrıştırma hatası: geçersiz JSON (${error.message}).`); }
  if (!Array.isArray(plan.agents) || plan.agents.length === 0) throw new Error('Planner doğrulama hatası: agents boş olmayan bir dizi olmalıdır.');
  if (!['low', 'medium', 'high'].includes(plan.complexity)) throw new Error('Planner doğrulama hatası: complexity low, medium veya high olmalıdır.');

  const forbiddenRolePattern = /(judge|jüri|hakem|sentez|sentezleyici|rapor yazarı|doküman yazarı|sonuçlandırma|sonuç yazarı|nihai (cevap|yanıt|sonuç)|final (answer|response|report)|baş editör|genel editör)/i;
  const forbiddenTaskPattern = /(tüm (uzman|agent|yanıt|cevap).{0,40}(birleştir|sentezle|özetle)|nihai (cevabı|yanıtı|sonucu|raporu) (yaz|oluştur|hazırla)|final (answer|response|report))/i;
  const genericRolePattern = /^(uzman|expert|assistant|agent|analist|genel analist|soruya özel uzman)(\s*\d+)?$/i;
  const seenRoles = new Set();
  const seenTasks = new Set();
  const accepted = [];

  for (const candidate of plan.agents) {
    if (accepted.length === 10) break;
    const role = typeof candidate?.role === 'string' ? candidate.role.trim() : '';
    const task = typeof candidate?.task === 'string' ? candidate.task.trim() : '';
    if (!role || !task || forbiddenRolePattern.test(role) || forbiddenTaskPattern.test(task) || genericRolePattern.test(role)) continue;
    const roleKey = role.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/gi, ' ').trim();
    const taskKey = task.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/gi, ' ').trim();
    if (seenRoles.has(roleKey) || seenTasks.has(taskKey)) continue;
    seenRoles.add(roleKey);
    seenTasks.add(taskKey);
    accepted.push({ role, task });
  }

  if (accepted.length === 0) accepted.push({ role: 'Konu Alanı Analisti', task: 'Temel olguları, ölçütleri ve belirsizlikleri incele.' });
  const agents = accepted.map((agent, index) => ({ agent_id: index + 1, ...agent }));
  return { question, openaiModel, questionType: plan.question_type?.trim() || 'genel', complexity: plan.complexity, agentCount: agents.length, agents };
}

const originalQuestion = 'Bir ERP şirketi müşteri destek sürecini nasıl iyileştirmeli?';
const centralModel = 'gpt-5-mini';
const simple = normalizePlanner(JSON.stringify({
  question_type: 'tanım',
  complexity: 'low',
  agents: [{ agent_id: 9, role: 'Veritabanı Eğitmeni', task: 'Birincil anahtarı kısa bir örnekle açıkla.' }],
}), originalQuestion, centralModel);
assert.equal(simple.agentCount, 1);
assert.equal(simple.agents[0].agent_id, 1);
assert.equal(simple.question, originalQuestion);
assert.equal(simple.openaiModel, centralModel);

const candidates = [
  { role: 'Süreç Analisti', task: 'Destek akışındaki darboğazları incele.' },
  { role: 'Strateji Dokümanı Yazarı', task: 'Tüm uzman yanıtlarını birleştirip nihai raporu yaz.' },
  { role: 'Süreç Analisti', task: 'Aynı darboğazları tekrar incele.' },
  ...Array.from({ length: 12 }, (_, i) => ({ role: `Alan Uzmanı ${i + 1}`, task: `Bağımsız boyut ${i + 1} için bulgu üret.` })),
];
const normalized = normalizePlanner(JSON.stringify({ question_type: 'analiz', complexity: 'high', agents: candidates }), originalQuestion, centralModel);
assert.equal(normalized.agentCount, 10);
assert.deepEqual(normalized.agents.map(agent => agent.agent_id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert.ok(!normalized.agents.some(agent => /rapor yazarı|sentez|nihai rapor/i.test(`${agent.role} ${agent.task}`)));
assert.equal(normalized.agents.filter(agent => agent.role === 'Süreç Analisti').length, 1);

assert.throws(() => normalizePlanner('{not json', 'x'), /ayrıştırma/);
assert.throws(() => normalizePlanner(JSON.stringify({ complexity: 'low', agents: [] }), 'x'), /boş olmayan/);
assert.throws(() => normalizePlanner(JSON.stringify({ complexity: 'extreme', agents: [{}] }), 'x'), /complexity/);

// Exercise the exported Planner node, including the roles omitted by the old four-agent cap.
const plannerWorkflow = JSON.parse(readFileSync(new URL('../workflows/multi-agent-planner.json', import.meta.url), 'utf8'));
const plannerRequest = plannerWorkflow.nodes.find(node => node.name === 'Call OpenAI Planner').parameters.jsonBody;
const normalizeNode = plannerWorkflow.nodes.find(node => node.name === 'Validate and Normalize Plan');
const roles = ['Üretim Planlama', 'Finans', 'Veri Göçü', 'Siber Güvenlik', 'Lojistik', 'Değişim Yönetimi'];
const modelPlan = {
  question_type: 'ERP geçişi',
  complexity: 'high',
  agents: [
    ...roles.map(role => ({ role, task: `${role} açısından kendi geçiş risklerini ve eşiklerini incele.` })),
    { role: 'Eylem Planlama Uzmanı', task: 'Her uzmanın bulgularına dayanarak önceliklendirilmiş yol haritası hazırla.' },
    { role: 'ERP Geçiş Danışmanı', task: 'Her uzmanın bulgularına dayanarak düzeltmeleri sırala.' },
    { role: 'ERP Strateji Uzmanı', task: 'Altı değerlendirmeye dayanarak üç geçiş seçeneğini puanla, yol haritası ve bütçe hazırla, en uygun stratejiyi seç.' },
    { role: 'Geçiş Programı Danışmanı', task: 'Diğer uzmanların görüşlerine dayanarak ortak puanları hesapla.' },
    { role: 'Karar ve Yol Haritası Koordinatörü', task: 'Üç geçiş seçeneğini puanla, yol haritası ve geri dönüş eşiklerini bütünleştir.' },
  ],
};
const runPlannerNode = new Function('$input', '$', normalizeNode.parameters.jsCode);
const execution = runPlannerNode(
  { first: () => ({ json: { output: [{ content: [{ type: 'output_text', text: JSON.stringify(modelPlan) }] }] } }) },
  () => ({ first: () => ({ json: { question: originalQuestion, model: centralModel } }) }),
)[0].json;
assert.match(plannerRequest, /maxItems: 10/);
const csvQuestion = originalQuestion + '\n\nCSV analysis context\n{"columns":[{"name":"cozum_saat"}]}';
const planModelInput = new Function('$json', `return (${plannerRequest.slice(3, -2)});`);
assert.ok(planModelInput({ question: csvQuestion }).input.includes(csvQuestion));
assert.equal(execution.agentCount, 6);
assert.deepEqual(execution.agents.map(agent => agent.role), roles);
assert.match(execution.planIssue, /ortak karar/);

const workerWorkflow = JSON.parse(readFileSync(new URL('../workflows/multi-agent-worker.json', import.meta.url), 'utf8'));
const validateWorker = new Function('$input', workerWorkflow.nodes.find(node => node.name === 'Validate Worker Input').parameters.jsCode);
const workerInput = { question: originalQuestion, openaiModel: centralModel, agentId: 1, role: 'ERP Geçiş Testi Uzmanı' };
const runWorker = task => validateWorker({ first: () => ({ json: { ...workerInput, task } }) });
assert.throws(() => runWorker('Her uzmanın bulgularına dayanarak düzeltmeleri sırala.'), /bağımsız/);
assert.equal(runWorker('Geçişte stok aktarımı için kabul testleri tasarla.')[0].json.agentId, 1);

const workerRequest = workerWorkflow.nodes.find(node => node.name === 'Call OpenAI Worker').parameters.jsonBody;
const makeWorkerRequest = new Function('$json', `return (${workerRequest.slice(3, -2)});`);
const readEvidence = new Function('$input', '$', workerWorkflow.nodes.find(node => node.name === 'Normalize Worker Output').parameters.jsCode);
for (const [name, mime, type] of [
  ['grafik.png', 'image/png', 'input_image'],
  ['fotograf.jpg', 'image/jpeg', 'input_image'],
  ['rapor.pdf', 'application/pdf', 'input_file'],
]) {
  const input = { question: 'Dosyada ne var?', openaiModel: centralModel, attachment: { name, mime, base64: 'YWJj' } };
  const normalizedInput = validateWorker({ first: () => ({ json: input }) })[0].json;
  const request = makeWorkerRequest(normalizedInput);
  const item = request.input[0].content[1];
  assert.equal(request.store, false);
  assert.equal(item.type, type);
  assert.equal(item.image_url ?? item.file_data, `data:${mime};base64,YWJj`);
  const output = { output: [{ content: [{ type: 'output_text', text: 'Dosyadan gözlem' }] }] };
  const result = readEvidence({ first: () => ({ json: output }) }, () => ({ first: () => ({ json: normalizedInput }) }));
  assert.deepEqual(result, [{ json: { evidence: 'Dosyadan gözlem' } }]);
}

const judgeWorkflow = JSON.parse(readFileSync(new URL('../workflows/multi-agent-judge.json', import.meta.url), 'utf8'));
const validateComparison = new Function('$input', '$', judgeWorkflow.nodes.find(node => node.name === 'Validate Comparison Notes').parameters.jsCode);
const judgeInput = { question: originalQuestion, answers: [{ agentId: 1, answer: 'İnceleme eşiği önerildi.' }, { agentId: 2, answer: 'Geçiş eşiği açıklanmadı.' }] };
const comparisonResult = response => validateComparison(
  { first: () => ({ json: response }) },
  () => ({ first: () => ({ json: judgeInput }) }),
)[0].json;
const note = { kind: 'evidence_gap', agentIds: [1, 2], detail: 'Nihai kabul eşiği gerekçelendirilmemiş.' };
const notes = [note, { ...note, agentIds: [99] }, { ...note, kind: 'conflict', agentIds: [1, 1] }];
const reviewed = comparisonResult({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ notes }) }] }] });
assert.deepEqual(reviewed.comparisonNotes, [note]);
assert.deepEqual(reviewed.answers, judgeInput.answers);
assert.deepEqual(comparisonResult({ error: 'Timeout' }).comparisonNotes, []);

const mixedPlan = runPlannerNode(
  { first: () => ({ json: { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
    complexity: 'medium', agents: [
      { role: 'Veri Kalitesi Uzmanı', task: 'Stok kayıtlarındaki uyuşmazlıkları incele.' },
      { role: 'Toparlayıcı', task: 'Bulguları düzenle.' },
      { role: 'Finansal riskleri hesapla', task: 'Kredi ve nakit risklerini karşılaştır.' },
      { role: 'Finans Analisti', task: 'Bütçedeki sapmaları incele.' },
    ],
  }) }] }] } }) },
  () => ({ first: () => ({ json: { question: originalQuestion, model: centralModel } }) }),
)[0].json;
assert.deepEqual(mixedPlan.agents.map(agent => agent.role), ['Veri Kalitesi Uzmanı', 'Finans Analisti']);
assert.match(mixedPlan.planIssue, /role kısa/);

const planResponse = 'Bu uygulamada PNG dosyası üretemiyorum. İstersen SVG kodu hazırlayabilirim.';
const blockedPlan = runPlannerNode(
  { first: () => ({ json: { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
    question_type: 'görsel', complexity: 'low', agents: [], direct_response: planResponse,
  }) }] }] } }) },
  () => ({ first: () => ({ json: { question: 'Bir PNG çiz.', model: centralModel } }) }),
)[0].json;
const uiPlanner = JSON.parse(readFileSync(new URL('../workflows/multi-agent-ui-plan.json', import.meta.url), 'utf8'));
const uiResponseNode = uiPlanner.nodes.find(node => node.name === 'Format UI Plan Response');
const formatPlanResponse = new Function('$input', uiResponseNode.parameters.jsCode);
const blockedUIPlan = formatPlanResponse({ first: () => ({ json: blockedPlan }) })[0].json;
assert.equal(blockedUIPlan.directResponse, planResponse);
assert.deepEqual(blockedUIPlan.agents, []);
assert.equal(blockedUIPlan.agentCount, 0);
assert.equal(formatPlanResponse({ first: () => ({ json: execution }) })[0].json.agentCount, 6);
assert.equal(formatPlanResponse({ first: () => ({ json: mixedPlan }) })[0].json.planIssue, mixedPlan.planIssue);

const workerItems = normalized.agents.map(agent => ({ question: normalized.question, openaiModel: normalized.openaiModel, agentId: agent.agent_id, role: agent.role, task: agent.task }));
assert.equal(workerItems.length, normalized.agentCount);
assert.ok(workerItems.every(item => item.question === originalQuestion && item.role && item.task));
assert.ok(workerItems.every(item => item.openaiModel === centralModel));

const answers = workerItems.map(item => ({ ...item, answer: `Uzman yanıtı ${item.agentId}` }));
assert.equal(answers.length, normalized.agentCount);
assert.ok(answers.every(item => item.question === originalQuestion && item.answer));

const judgeOutput = {
  question: originalQuestion,
  answers,
  finalAnswer: 'Konuya uygun adaptif nihai cevap.',
  unresolvedContradictions: [],
};
const report = [
  judgeOutput.question,
  judgeOutput.finalAnswer,
  ...judgeOutput.answers.flatMap(answer => [answer.role, answer.task, answer.answer]),
].join('\n');
assert.ok(report.indexOf(judgeOutput.finalAnswer) < report.indexOf(judgeOutput.answers[0].answer));
for (const answer of judgeOutput.answers) assert.ok(report.includes(answer.role) && report.includes(answer.task) && report.includes(answer.answer));

console.log('Contract tests passed: original-question and OpenAI-model preservation, 1-10 Planner cap, forbidden-role filtering, deduplication, per-agent split, full aggregation, Judge output, and report ordering.');

// The n8n wrappers must retain the selected language between OpenAI calls.
function evaluateCode(workflow, name, json) {
  const node = workflow.nodes.find(node => node.name === name);
  return new Function('$input', node.parameters.jsCode)({ first: () => ({ json }) })[0].json;
}
function webhookWorkflow(name) {
  return JSON.parse(readFileSync(new URL('../workflows/multi-agent-ui-' + name + '.json', import.meta.url), 'utf8'));
}

const languageQuestion = 'Comment gérer ces demandes ? Please answer in English.';
const localizedBody = { question: csvQuestion, languageQuestion, fallbackLanguage: 'fr' };
const plannerUIInput = evaluateCode(uiPlanner, 'Prepare UI Plan Input', { body: localizedBody });
const plannerInput = evaluateCode(plannerWorkflow, 'Validate Planner Input', plannerUIInput);
const localizedRequest = planModelInput(plannerInput);
assert.equal(plannerInput.languageQuestion, languageQuestion);
assert.equal(plannerInput.fallbackLanguage, 'fr');
assert.ok(localizedRequest.input.includes(JSON.stringify(languageQuestion)));
assert.match(localizedRequest.instructions, /interface fallback \(fr\)/);
assert.deepEqual(localizedRequest.text.format.schema.properties.reply_language.enum, ['en', 'fr', 'tr']);

const simulatedPlan = {
  reply_language: 'en',
  question_type: 'Support analysis',
  complexity: 'low',
  agents: [{ role: 'Support Analyst', task: 'Identify the slowest response.' }],
};
const localizedPlan = runPlannerNode(
  { first: () => ({ json: { output: [{ content: [{ type: 'output_text', text: JSON.stringify(simulatedPlan) }] }] } }) },
  () => ({ first: () => ({ json: plannerInput }) }),
)[0].json;
const { agents: localizedAgents, ...localizedStage } = evaluateCode(uiPlanner, 'Format UI Plan Response', localizedPlan);
assert.equal(localizedStage.replyLanguage, 'en');

const workerBody = { ...localizedStage, ...localizedAgents[0] };
const workerUIInput = evaluateCode(webhookWorkflow('worker'), 'Prepare UI Worker Input', { body: workerBody });
const localizedWorker = evaluateCode(workerWorkflow, 'Validate Worker Input', workerUIInput);
assert.match(makeWorkerRequest(localizedWorker).instructions, /Yanıt dili: English/);

const judgeBody = { ...localizedStage, answers: [{ ...localizedAgents[0], answer: 'Finance waited the longest.' }] };
const judgeUIInput = evaluateCode(webhookWorkflow('judge'), 'Prepare UI Judge Input', { body: judgeBody });
const localizedJudge = evaluateCode(judgeWorkflow, 'Validate and Format Judge Input', judgeUIInput);
const judgeRequest = judgeWorkflow.nodes.find(node => node.name === 'Call Final Judge Synthesis').parameters.jsonBody;
const makeJudgeRequest = new Function('$json', `return (${judgeRequest.slice(3, -2)});`);
assert.match(makeJudgeRequest({ ...localizedJudge, comparisonNotes: [] }).instructions, /diagram text .*: English/);
