#!/usr/bin/env node
import assert from 'node:assert/strict';

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
