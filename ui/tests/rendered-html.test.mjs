import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const handler = typeof worker === "function" ? worker : worker.fetch.bind(worker);
  return handler(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the multi-agent workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Ortak Akıl/);
  assert.match(html, /Değerlendirilecek soru/);
  assert.match(html, /<aside[^>]+aria-labelledby="history-title"/);
  assert.ok(html.indexOf("Uzmanları çalıştır") < html.indexOf("id=\"evaluation-settings\""));
  assert.match(html, /Uzmanları çalıştır/);
  assert.match(html, /<button[^>]+id="openai-model"[^>]+aria-controls="model-choices"/);
  assert.match(html, /<div[^>]+id="model-choices"[^>]+popover="manual"/);
  assert.match(html, /Başka bir model kullan/);
  assert.doesNotMatch(html, /datalist|csv-delimiter|<footer|UTF-8 ·/);
  assert.ok(html.indexOf('data-model="gpt-6-astra"') < html.indexOf('data-model="gpt-6.1-sol"'));
  assert.ok(html.indexOf('data-model="gpt-6.1-sol"') < html.indexOf('data-model="gpt-6.1-terra"'));
  assert.ok(html.indexOf('data-model="gpt-6.1-terra"') < html.indexOf('data-model="gpt-6-luna"'));
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps n8n behind a same-origin server route", async () => {
  const [page, route, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/n8n/[stage]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/api\/n8n\/\$\{stage\}/);
  assert.match(page, /Math\.min\(2, plannedAgents\.length\)/);
  assert.match(page, /Google Docs’a kaydet/);
  assert.match(route, /N8N_WEBHOOK_BASE_URL/);
  assert.match(route, /multi-agent-ui-plan/);
  assert.match(route, /multi-agent-ui-worker/);
  assert.match(route, /multi-agent-ui-judge/);
  assert.match(route, /multi-agent-ui-docs/);
  assert.match(layout, /lang="tr"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
