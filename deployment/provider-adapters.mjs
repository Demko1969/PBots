import { providerForModel, providers } from '../ui/lib/provider-catalog.mjs';

export class ProviderError extends Error {
  constructor(status) {
    super('Provider request failed.');
    this.status = status;
  }
}

function contentParts(input) {
  if (typeof input === 'string') return [{ text: input }];
  return input.flatMap(message => message.content).map(part => {
    if (part.type === 'input_text') return { text: part.text };
    const dataUrl = part.type === 'input_file' ? part.file_data : part.image_url;
    const match = /^data:(image\/(?:jpeg|png)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new ProviderError(400);
    return { mimeType: match[1], data: match[2] };
  });
}

// The existing n8n validators still enforce the original limits after generation.
function claudeSchema(schema) {
  const { properties, items, minItems, maxItems, minimum, maximum, minLength, maxLength, ...rest } = schema;
  const limits = Object.entries({ minItems: minItems > 1 ? minItems : undefined, maxItems, minimum, maximum, minLength, maxLength })
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}: ${value}`);
  return {
    ...rest,
    ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, claudeSchema(value)])) } : {}),
    ...(items ? { items: claudeSchema(items) } : {}),
    ...(minItems === 0 || minItems === 1 ? { minItems } : {}),
    ...(limits.length ? { description: [rest.description, limits.join(', ')].filter(Boolean).join(' ') } : {}),
  };
}

function claudeRequest(input, key) {
  const schema = input.text?.format?.schema;
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: {
      model: input.model,
      system: input.instructions,
      max_tokens: input.max_output_tokens,
      messages: [{
        role: 'user',
        content: contentParts(input.input).map(part => 'text' in part
          ? { type: 'text', text: part.text }
          : {
              type: part.mimeType === 'application/pdf' ? 'document' : 'image',
              source: { type: 'base64', media_type: part.mimeType, data: part.data },
            }),
      }],
      ...(schema ? { output_config: { format: { type: 'json_schema', schema: claudeSchema(schema) } } } : {}),
    },
    extract: data => data.stop_reason !== 'max_tokens' && data.stop_reason !== 'refusal'
      ? data.content?.filter(part => part.type === 'text').map(part => part.text).join('') : '',
  };
}

function geminiRequest(input, key) {
  const schema = input.text?.format?.schema;
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
    headers: { 'x-goog-api-key': key },
    body: {
      systemInstruction: { parts: [{ text: input.instructions }] },
      contents: [{ role: 'user', parts: contentParts(input.input).map(part => 'text' in part ? part : { inlineData: part }) }],
      generationConfig: {
        maxOutputTokens: input.max_output_tokens,
        thinkingConfig: { thinkingLevel: 'low' },
        ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}),
      },
    },
    extract(data) {
      const candidate = data.candidates?.[0];
      return candidate?.finishReason === 'STOP'
        ? candidate.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('') : '';
    },
  };
}

function openaiRequest(input, key) {
  return {
    url: 'https://api.openai.com/v1/responses',
    headers: { Authorization: `Bearer ${key}` },
    body: { ...input, store: false },
    extract: data => data.status === 'completed' && data.output
      ?.flatMap(item => item.type === 'message' ? item.content : [])
      .filter(part => part?.type === 'output_text').map(part => part.text).join(''),
  };
}

const adapters = { openai: openaiRequest, claude: claudeRequest, gemini: geminiRequest };

export async function generate(input, key, signal, fetcher = fetch) {
  if (typeof input.model !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,159}$/i.test(input.model)) throw new ProviderError(400);
  if (!key) throw new ProviderError(409);
  const { url, headers, body, extract } = adapters[providerForModel(input.model)](input, key);
  const response = await fetcher(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body), signal, redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(response.status);
  }
  const text = extract(await response.json());
  if (typeof text !== 'string' || !text.trim()) throw new ProviderError(502);
  return { output_text: text, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
}

export function testProvider(provider, key, signal, fetcher = fetch) {
  return generate({
    model: providers[provider].model,
    instructions: 'Reply with OK.',
    input: 'Connection test.',
    max_output_tokens: 512,
    ...(provider === 'openai' ? { reasoning: { effort: 'minimal' } } : {}),
  }, key, signal, fetcher);
}
