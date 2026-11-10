import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/server-security.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { checkRequest, readJson, reserveRequest } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function request(origin = 'http://localhost:3000', body = '{}', extraHeaders = {}) {
  return new Request('http://localhost:3000/api/n8n/plan', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', ...extraHeaders }, body });
}

test('protects writes against cross-origin, simple-form and DNS-rebinding requests', () => {
  process.env.APP_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';
  assert.doesNotThrow(() => checkRequest(request()));
  assert.throws(() => checkRequest(request('https://attacker.example')), error => error.status === 403);
  assert.throws(() => checkRequest(new Request('http://attacker.example:3000/api/setup'), false), error => error.status === 403);
  assert.throws(() => checkRequest(request('http://localhost:3000', '{}', { 'Content-Type': 'text/plain' })), error => error.status === 415);
  assert.throws(() => checkRequest(request('http://localhost:3000', '{}', { 'Sec-Fetch-Site': 'cross-site' })), error => error.status === 403);
  delete process.env.APP_ALLOWED_ORIGINS;
});

test('bounds streamed request bytes, including Unicode, and rejects non-object JSON', async () => {
  await assert.rejects(readJson(request(undefined, JSON.stringify({ text: 'é'.repeat(100) })), 100), error => error.status === 413);
  for (const body of ['[]', 'null', '"text"', '{']) {
    await assert.rejects(readJson(request(undefined, body), 100), error => error.status === 400);
  }
  assert.deepEqual(await readJson(request(undefined, '{"question":"hi"}'), 100), { question: 'hi' });
});

test('caps simultaneous paid workflow requests and releases completed slots', () => {
  const releases = Array.from({ length: 4 }, () => reserveRequest());
  assert.throws(() => reserveRequest(), error => error.status === 429);
  releases.pop()();
  const release = reserveRequest();
  release();
  for (const done of releases) done();
  for (let index = 0; index < 55; index++) reserveRequest()();
  assert.throws(() => reserveRequest(), error => error.status === 429);
});
