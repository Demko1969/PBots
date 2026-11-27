import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { providers } from '../ui/lib/provider-catalog.mjs';
import { generate, testProvider } from './provider-adapters.mjs';
import { openProviderSettings } from './provider-settings.mjs';

const key = 'test-credential-do-not-log';
const routes = {
  openai: {
    url: 'https://api.openai.com/v1/responses',
    keyHeader: 'Authorization', expectedKey: `Bearer ${key}`,
    reply: text => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
  },
  claude: {
    url: 'https://api.anthropic.com/v1/messages',
    keyHeader: 'x-api-key', expectedKey: key,
    reply: text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }),
  },
  gemini: {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${providers.gemini.model}:generateContent`,
    keyHeader: 'x-goog-api-key', expectedKey: key,
    reply: text => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thought', thought: true }, { text }] } }] }),
  },
};

const jsonText = '{"agents":[]}';
const schema = {
  type: 'object', required: ['agents'], additionalProperties: false,
  properties: { agents: { type: 'array', maxItems: 10, items: { type: 'string' } } },
};

function stub(provider, check) {
  const route = routes[provider];
  return async (url, options) => {
    assert.equal(url, route.url);
    assert.equal(options.headers[route.keyHeader], route.expectedKey);
    assert.equal(options.redirect, 'error');
    check(JSON.parse(options.body));
    return Response.json(route.reply(jsonText));
  };
}

for (const [provider, { model }] of Object.entries(providers)) {
  test(`${provider} uses the selected model for a connection probe and sends structured analysis`, async () => {
    await testProvider(provider, key, undefined, stub(provider, body => {
      assert.equal(body.model ?? model, model);
    }));
    const response = await generate({
      model, input: 'Question\nCSV analysis context\nSample rows', instructions: 'Plan',
      max_output_tokens: 3000, text: { format: { type: 'json_schema', schema } },
    }, key, undefined, stub(provider, body => {
      assert.match(JSON.stringify(body), /Sample rows/);
      const format = body.text?.format?.schema ?? body.output_config?.format?.schema ?? body.generationConfig.responseJsonSchema;
      assert.deepEqual(format.required, ['agents']);
      const agents = format.properties.agents;
      if (provider === 'claude') {
        assert.equal(agents.maxItems, undefined);
        assert.match(agents.description, /maxItems: 10/);
      } else assert.equal(agents.maxItems, 10);
    }));
    assert.equal(response.output[0].content[0].text, jsonText);
  });

  for (const mime of ['image/jpeg', 'image/png', 'application/pdf']) {
    test(`${provider} sends ${mime} as inline attachment evidence input`, async () => {
      const data = 'AQID';
      const url = `data:${mime};base64,${data}`;
      const part = mime === 'application/pdf'
        ? { type: 'input_file', filename: 'input.pdf', file_data: url }
        : { type: 'input_image', image_url: url };
      await generate({
        model, instructions: 'Read the attached evidence', max_output_tokens: 4500,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Read the evidence' }, part] }],
      }, key, undefined, stub(provider, body => {
        if (provider === 'openai') {
          assert.deepEqual(body.input[0].content[1], part);
          assert.equal(body.store, false);
        } else if (provider === 'claude') {
          const actual = body.messages[0].content[1];
          assert.equal(actual.type, mime === 'application/pdf' ? 'document' : 'image');
          assert.deepEqual(actual.source, { type: 'base64', media_type: mime, data });
        } else assert.deepEqual(body.contents[0].parts[1].inlineData, { mimeType: mime, data });
      }));
    });
  }
}

test('connection failure exposes neither the upstream body nor the key', async () => {
  const fetcher = async () => Response.json({ error: key }, { status: 401 });
  await assert.rejects(testProvider('openai', key, undefined, fetcher), error =>
    error.status === 401 && !error.message.includes(key));
});

test('keeps separate encrypted keys and persists the selected default across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pbots-provider-test-'));
  try {
    const path = join(directory, 'providers.json');
    const settings = await openProviderSettings(path, 'secret');
    await Promise.all([
      settings.save('openai', key + '-openai'),
      settings.save('claude', key + '-claude'),
    ]);
    await settings.setDefault('claude');
    assert.doesNotMatch(await readFile(path, 'utf8'), /test-credential/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const restored = await openProviderSettings(path, 'secret');
    assert.equal(restored.key('openai'), key + '-openai');
    assert.equal(restored.key('claude'), key + '-claude');
    assert.equal(restored.status().defaultProvider, 'claude');
    assert.deepEqual(restored.status().providers.map(option => option.configured), [true, true, false]);
    assert.doesNotMatch(JSON.stringify(restored.status()), /test-credential/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
