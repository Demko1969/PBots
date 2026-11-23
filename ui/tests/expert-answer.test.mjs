import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/expert-answer.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { splitExpertAnswer, publicExpert } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('keeps findings while isolating both inline and standalone diagram notes', () => {
  const long = 'Ana bulgu: Fark 750 TL. Diyagram yolu: İncele → Düzelt → Kontrol.';
  assert.deepEqual(splitExpertAnswer(long), { answer: 'Ana bulgu: Fark 750 TL.', diagramNotes: 'İncele → Düzelt → Kontrol.' });
  const multiline = 'Ana bulgu: Fark 750 TL.\nÇözüm akışı (metin diyagramı):\nBaşla → Düzelt → Kontrol\n\nKanıt: GL-8102.';
  assert.deepEqual(splitExpertAnswer(multiline), {
    answer: 'Ana bulgu: Fark 750 TL.\n\nKanıt: GL-8102.',
    diagramNotes: 'Başla → Düzelt → Kontrol',
  });
  const fence = ['Bulgu.', '```mermaid', 'flowchart TD', '', 'A --> B', '```', 'Kaynak: kayıt.'].join('\n');
  assert.equal(splitExpertAnswer(fence).answer, 'Bulgu.\nKaynak: kayıt.');
  assert.deepEqual(publicExpert({ answer: long, diagramNotes: 'İç not', role: 'Finans Uzmanı' }), {
    answer: 'Ana bulgu: Fark 750 TL.', role: 'Finans Uzmanı',
  });
  assert.equal(splitExpertAnswer('En kısa rota Giriş → Koridor → Çıkış.').answer, 'En kısa rota Giriş → Koridor → Çıkış.');
});
