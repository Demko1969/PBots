#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const workflowPath = resolve(
  import.meta.dirname,
  '..',
  'workflows',
  process.argv[2] || 'multi-agent-main.json'
);
const workflow = JSON.parse(await readFile(workflowPath, 'utf8'));
const code = workflow.nodes.find(node => node.name === 'Build Google Docs Report')?.parameters?.jsCode;
assert.equal(typeof code, 'string', 'Build Google Docs Report code node is missing');
const sample = {
  question: 'Örnek soru\n\nCSV analysis context\nPRIVATE_RAW_JSON',
  questionType: 'analiz',
  complexity: 'high',
  model: 'gpt-5-mini',
  openaiModel: 'gpt-5-mini',
  agentCount: 1,
  summaryPoints: ['Önemli bulgu'],
  finalAnswer: [
    '[İncele]\n↓\n[Doğrula]\n↓\n[Ölç]',
    '## Sonuç',
    '**Önemli bulgu**',
    'Kayıt 9',
    '**Belirti: kapanmamış kalın işareti',
    'Kârlılık analizi gereklidir.',
    'Proje kârlılığı ve %22 yeniden çalışma oranı izlenmelidir.',
  ].join('\n'),
  answers: [{
    agentId: 1,
    role: 'Süreç Analisti',
    task: 'Tabloyu değerlendir.',
    answer: [
      '| Aksiyon | Sahip | Risk |',
      '|---|---|---|',
      '| Teklif kontrolü | Satış | Direnç |',
      '* Normal madde',
      'Risk:**',
    ].join('\n'),
  }],
  unresolvedContradictions: [],
};

const context = vm.createContext({
  $input: {
    first: () => ({ json: sample }),
  },
  Date,
  Map,
  String,
  Array,
  Number,
  Error,
});
const script = new vm.Script('(async () => {\n' + code + '\n})()');
const items = await script.runInContext(context);

assert.ok(Array.isArray(items) && items.length === 1);
const output = items[0].json;
assert.ok(!output.reportText.includes('|---|'));
assert.ok(!output.reportText.includes('**'));
assert.ok(!output.reportText.includes('##'));
assert.ok(!output.reportText.includes('* Normal madde'));
assert.ok(!output.reportText.match(/Kayıt\s+\d+/i));
assert.ok(output.reportText.includes('Aksiyon: Teklif kontrolü'));
assert.ok(!output.reportText.includes('PRIVATE_RAW_JSON'));
assert.ok(!output.reportText.includes('CSV analysis context'));
assert.ok(output.reportText.includes('UZMAN YANITLARI'));
assert.ok(output.reportText.includes('[İncele]\n↓\n[Doğrula]'));
assert.ok(output.reportText.includes('• Normal madde'));
assert.ok(output.reportText.includes('Kârlılık analizi gereklidir.'));
assert.ok(output.reportText.includes('Proje kârlılığı ve %22 yeniden çalışma oranı izlenmelidir.'));
assert.ok(output.reportText.includes('Belirti: kapanmamış kalın işareti'));

assert.ok(!output.reportText.includes('Kullanılan model:'));
assert.ok(!output.reportText.includes('kalite puanı'));
assert.ok(!output.reportText.includes('kapsama puanı'));
assert.ok(Array.isArray(output.docsStyleRequests));
assert.ok(output.docsStyleRequests.length > 0);
assert.ok(output.docsStyleRequests.every(request => {
  const range = request.updateTextStyle.range;
  return range.endIndex - range.startIndex < 200;
}));

console.log('Google Docs formatting test passed: Markdown headings, bold markers, bullets, and tables are normalized; bold ranges are emitted.');
