import assert from "node:assert/strict";
import test from "node:test";

test("requires server credentials before dispatching a paid workflow", async context => {
  const validToken = "a".repeat(64);
  const wrongToken = "b".repeat(64);
  const gateway = "http://mock-n8n.local/webhook/multi-agent-ui-plan";
  let gatewayCalls = 0;
  let providerCalls = 0;
  const realFetch = globalThis.fetch;
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== gateway) return realFetch(input, init);
    gatewayCalls++;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (headers.get("X-Multi-Agent-Key") !== validToken) {
      return new Response(null, { status: 401 });
    }
    providerCalls++;
    return Response.json({ directResponse: "synthetic result" });
  });
  const { default: server } = await import("../dist/server/index.js");
  const handler = typeof server === "function" ? server : server.fetch.bind(server);

  const environment = { ...process.env };
  context.after(() => {
    for (const name of ["N8N_WEBHOOK_BASE_URL", "N8N_WEBHOOK_SECRET", "INTERNAL_TOKEN_FILE"]) {
      if (environment[name] === undefined) delete process.env[name];
      else process.env[name] = environment[name];
    }
  });
  process.env.N8N_WEBHOOK_BASE_URL = "http://mock-n8n.local/webhook";
  delete process.env.INTERNAL_TOKEN_FILE;
  delete process.env.N8N_WEBHOOK_SECRET;
  function plan() {
    return handler(new Request("http://localhost/api/n8n/plan", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "Content-Type": "application/json",
        "X-Multi-Agent-Key": validToken,
      },
      body: JSON.stringify({ question: "Synthetic evaluation" }),
    }));
  }

  assert.equal((await plan()).status, 503);
  process.env.N8N_WEBHOOK_SECRET = "invalid-configuration";
  assert.equal((await plan()).status, 503);
  assert.equal(gatewayCalls, 0);
  assert.equal(providerCalls, 0);
  process.env.N8N_WEBHOOK_SECRET = wrongToken;
  assert.equal((await plan()).status, 502);
  assert.equal(gatewayCalls, 1);
  assert.equal(providerCalls, 0);
  process.env.N8N_WEBHOOK_SECRET = validToken;
  assert.equal((await plan()).status, 200);
  assert.equal(providerCalls, 1);
});
