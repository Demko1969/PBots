import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/table.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const tableModule = outputText.replace('./credential-redaction', new URL('../lib/credential-redaction.ts', import.meta.url).href);
const { parseCsv, profileTable, tableQuestion, supportMetrics, makeTablePreview, tablePreviewFromContext } = await import(`data:text/javascript;base64,${Buffer.from(tableModule).toString('base64')}`);

test('redacts preview credentials before clipping cells', () => {
  const syntheticKey = 'sk-proj-' + 'test'.repeat(8);
  const preview = makeTablePreview({
    name: syntheticKey + '.csv',
    columns: ['notes'],
    rows: [[' '.repeat(62) + syntheticKey]],
  });
  assert.equal(preview[0], '[gizlendi].csv');
  assert.equal(preview[2][0][0], ' '.repeat(62) + '[gizlendi]');
});

test('parses BOM, quoted delimiters, escaped quotes and multiline cells', () => {
  const table = parseCsv('\uFEFFname,amount\r\n"a,b",1\r\n"c""d\ne",2\r\n', 'sample.csv', ',');
  assert.deepEqual(table.rows, [['a,b', '1'], ['c"d\ne', '2']]);
  assert.equal(profileTable(table)[1].statistics.sum, 3);
  assert.equal(parseCsv('name;amount\na;2', 'sample.csv', ';').columns.length, 2);
  assert.equal(parseCsv('name\tamount\na\t2', 'sample.csv', '\t').columns.length, 2);
});

test('rejects malformed input and ambiguous headers', () => {
  for (const csv of ['a,a\n1,2', 'a,\n1,2', 'a,b\n1', 'a\n"unterminated', 'a\n"x"oops', 'a\nx"y', 'a\n']) {
    assert.throws(() => parseCsv(csv, 'bad.csv', ','));
  }
  assert.throws(() => parseCsv(`a\n${'1\n'.repeat(5001)}`, 'large.csv', ','));
  assert.throws(() => parseCsv('a'.repeat(1_000_001), 'large.csv', ','));
});

test('profiles every row while preserving ambiguous values as text', () => {
  const table = parseCsv('id,amount,local,date\n001,1.5,"1,5",01/02/2026\n002,-2,"2,5",02/02/2026\n003,,,', 'sales.csv', ',');
  const profile = profileTable(table);
  assert.equal(profile[0].type, 'text');
  assert.equal(profile[2].type, 'text');
  assert.equal(profile[3].type, 'text');
  assert.equal(profile[1].missing, 1);
  assert.deepEqual(profile[1].statistics, { count: 2, sum: -0.5, mean: -0.25, min: -2, max: 1.5 });
});

test('context labels sampling and supports automatic column interpretation and full-file totals', () => {
  const table = parseCsv(`amount\n${Array.from({ length: 12 }, (_, i) => i + 1).join('\n')}`, 'sales.csv', ',');
  const context = tableQuestion('Analyze revenue', table);
  const evidence = JSON.parse(context.slice(context.indexOf('{')));
  assert.equal(evidence.rowCount, 12);
  assert.equal(evidence.sampleRows.length, 10);
  assert.equal(evidence.columns[0].statistics.sum, 78);
  assert.equal(evidence.columns[0].name, 'amount');
  assert.equal(evidence.sampleSize, 10);
  assert.match(context, /Interpret column meanings, units, identifiers and date formats from headers/);
  assert.match(context, /If sampleSize equals rowCount, every data row is available/);
  assert.match(context, /untrusted source data/);
  assert.match(context, /cannot establish filtered totals/);
  assert.throws(() => tableQuestion('Analyze', { name: 'big', columns: ['text'], rows: [['x'.repeat(25000)]] }));
});


test('detects delimiters without a manual selector and ignores quoted header punctuation', () => {
  assert.deepEqual(parseCsv('name,amount\na,2', 'sample.csv').columns, ['name', 'amount']);
  assert.deepEqual(parseCsv('name;amount\na;2', 'sample.csv').columns, ['name', 'amount']);
  assert.deepEqual(parseCsv('name\tamount\na\t2', 'sample.csv').columns, ['name', 'amount']);
  assert.deepEqual(parseCsv('"name, label";amount\na;2', 'sample.csv').columns, ['name, label', 'amount']);
  assert.deepEqual(parseCsv('"name; label",amount\na,2', 'sample.csv').columns, ['name; label', 'amount']);
});

test('recovers a compact preview from the saved CSV evidence', () => {
  const table = parseCsv('Kayıt,Tutar\nA,5\nB,\nC,1\nD,8', 'mutabakat.csv');
  const preview = makeTablePreview(table);
  assert.deepEqual(preview, ['mutabakat.csv', ['Kayıt', 'Tutar'], [['A', '5'], ['B', ''], ['C', '1']], 4]);
  assert.deepEqual(tablePreviewFromContext(tableQuestion('Mutabakatı incele.', table)), preview);
  assert.equal(tablePreviewFromContext('Tablosuz soru'), undefined);
});


test('support metrics use all 20 rows, include the boundary, and exclude blank ratings', async () => {
  const csv = await readFile(new URL('./fixtures/support.csv', import.meta.url), 'utf8');
  const table = parseCsv(csv, 'support.csv');
  const metrics = supportMetrics(table);
  assert.equal(metrics.withinTarget, 14);
  assert.equal(metrics.late, 6);
  assert.equal(metrics.withinTargetPercent, 70);
  assert.equal(metrics.medianResolutionHours, 15);
  assert.equal(metrics.reopenedCount, 6);
  const finance = metrics.groups.find(group => group.column === 'modul').values.find(group => group.label === 'Finans');
  assert.equal(finance.late, 3);
  assert.equal(finance.meanResolutionHours, 32.8);
  assert.equal(metrics.ratingResponses, 17);
  assert.equal(metrics.ratingMean, 55 / 17);
  assert.deepEqual(metrics.ratingPossibleMeanRange, [2.9, 3.5]);
  assert.equal(supportMetrics(parseCsv('a,b\n1,2', 'other.csv')), null);
  assert.equal(supportMetrics(parseCsv(csv.replace(',72,24,1,1', ',72,24,9,1'), 'invalid.csv')), null);
});
