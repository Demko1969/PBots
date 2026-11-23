#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = resolve(root, 'workflows');
const expected = new Map([
  ['nf1usCSYXipWNQH9', 'multi-agent-main.json'],
  ['BdWFAQzKCellIUN5', 'multi-agent-ui-docs.json'],
  ['FQaBhDfItsZvVTNf', 'multi-agent-ui-plan.json'],
  ['SE1azDIAs87vFUna', 'multi-agent-judge.json'],
  ['d4eiJ2ZTu87WU8eC', 'multi-agent-worker.json'],
  ['dWKIaKeVID1i2XTs', 'multi-agent-ui-worker.json'],
  ['eCWvLGwule5hEaJL', 'multi-agent-planner.json'],
  ['mOkdCDiQB67MDpCB', 'multi-agent-ui-judge.json'],
]);
const errors = [];
const files = (await readdir(workflowDir)).filter(file => file.endsWith('.json')).sort();
const workflows = new Map();

for (const [id, file] of expected) {
  if (!files.includes(file)) {
    errors.push(`missing required file workflows/${file}`);
    continue;
  }

  let workflow;
  try {
    workflow = JSON.parse(await readFile(resolve(workflowDir, file), 'utf8'));
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error.message})`);
    continue;
  }
  workflows.set(id, workflow);

  if (workflow.id !== id) errors.push(`${file}: expected workflow id ${id}, found ${workflow.id}`);
  if (!workflow.name || !Array.isArray(workflow.nodes) || !workflow.connections) {
    errors.push(`${file}: missing required workflow fields`);
    continue;
  }

  const nodeNames = new Set(workflow.nodes.map(node => node.name));
  if (nodeNames.size !== workflow.nodes.length) errors.push(`${file}: duplicate node names`);

  for (const node of workflow.nodes) {
    if (node.type === 'n8n-nodes-base.code') {
      try { new vm.Script(`(async () => {\n${node.parameters?.jsCode ?? ''}\n})()`); }
      catch (error) { errors.push(`${file}/${node.name}: invalid Code-node JavaScript (${error.message})`); }
    }

    if (
      node.type === 'n8n-nodes-base.httpRequest'
      && node.parameters?.url === 'https://api.openai.com/v1/responses'
    ) {
      const credential = node.credentials?.httpHeaderAuth;
      if (node.parameters.authentication !== 'genericCredentialType') {
        errors.push(`${file}/${node.name}: OpenAI request must use generic credential authentication`);
      }
      if (node.parameters.genericAuthType !== 'httpHeaderAuth' || !credential?.id) {
        errors.push(`${file}/${node.name}: OpenAI request must use an n8n Header Auth credential`);
      }
      const headers = node.parameters.headerParameters?.parameters ?? [];
      if (headers.some(header => header.name?.toLowerCase() === 'authorization')) {
        errors.push(`${file}/${node.name}: Authorization must not be stored in workflow headers`);
      }
      const timeout = file === 'multi-agent-judge.json' && node.name === 'Compare Independent Findings' ? 30_000 : 900_000;
      if (node.parameters.options?.timeout !== timeout) {
        errors.push(`${file}/${node.name}: OpenAI timeout must be ${timeout} ms`);
      }
      if (node.parameters.options?.redirect?.redirect?.followRedirects !== false ||
          !/\bstore:\s*false\b/.test(node.parameters.jsonBody)) {
        errors.push(`${file}/${node.name}: disable both redirects and response storage`);
      }
    }
  }

  for (const [source, outputs] of Object.entries(workflow.connections)) {
    if (!nodeNames.has(source)) errors.push(`${file}: connection source does not exist: ${source}`);
    for (const channel of Object.values(outputs)) {
      for (const branch of channel) {
        for (const edge of branch) {
          if (!nodeNames.has(edge.node)) errors.push(`${file}: connection target does not exist: ${edge.node}`);
        }
      }
    }
  }
}

if (files.length !== expected.size) {
  errors.push(`expected exactly ${expected.size} workflow JSON files, found ${files.length}`);
}

const expectedRefs = new Map([
  ['nf1usCSYXipWNQH9', ['eCWvLGwule5hEaJL', 'd4eiJ2ZTu87WU8eC', 'SE1azDIAs87vFUna']],
  ['FQaBhDfItsZvVTNf', ['eCWvLGwule5hEaJL']],
  ['dWKIaKeVID1i2XTs', ['d4eiJ2ZTu87WU8eC']],
  ['mOkdCDiQB67MDpCB', ['SE1azDIAs87vFUna']],
]);

for (const [id, requiredRefs] of expectedRefs) {
  const workflow = workflows.get(id);
  if (!workflow) continue;
  const refs = workflow.nodes
    .filter(node => node.type === 'n8n-nodes-base.executeWorkflow')
    .map(node => node.parameters?.workflowId?.value);
  for (const ref of requiredRefs) {
    if (!refs.includes(ref)) errors.push(`${workflow.name}: missing sub-workflow reference ${ref}`);
  }
  for (const ref of refs) {
    if (!expected.has(ref)) errors.push(`${workflow.name}: unknown sub-workflow reference ${ref}`);
  }
}

for (const id of ['FQaBhDfItsZvVTNf', 'dWKIaKeVID1i2XTs', 'mOkdCDiQB67MDpCB', 'BdWFAQzKCellIUN5']) {
  const workflow = workflows.get(id);
  if (!workflow) continue;
  const webhooks = workflow.nodes.filter(node => node.type === 'n8n-nodes-base.webhook');
  const responses = workflow.nodes.filter(node => node.type === 'n8n-nodes-base.respondToWebhook');
  if (webhooks.length !== 1 || responses.length !== 1) {
    errors.push(`${workflow.name}: expected one Webhook and one Respond to Webhook node`);
  }
  if (workflow.active !== false || webhooks.some(node => node.parameters.authentication !== 'headerAuth')) {
    errors.push(`${workflow.name}: webhook exports must be inactive and require Header Auth`);
  }
}

const chat = workflows.get('nf1usCSYXipWNQH9');
const chatTrigger = chat?.nodes.find(node => node.type === '@n8n/n8n-nodes-langchain.chatTrigger');
if (chat?.active !== false || chatTrigger?.parameters.public !== false || chatTrigger?.parameters.authentication !== 'n8nUserAuth') {
  errors.push('Chat Trigger must be exported inactive and restricted to the n8n editor');
}

const serialized = [...workflows.values()].map(workflow => JSON.stringify(workflow)).join('\n');
if (/ollama|gpt-oss|host\.docker\.internal/i.test(serialized)) {
  errors.push('workflow files still contain obsolete Ollama configuration');
}

if (errors.length) {
  console.error(`Validation failed (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log(`Validated ${expected.size} OpenAI/n8n workflows, credentials, code nodes, connections, webhooks, and sub-workflow IDs.`);
