import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rename, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_FILES, CORE_WORKFLOW_IDS, PUBLISHED_IDS, OPENAI_CREDENTIAL_ID, WEBHOOK_CREDENTIAL_ID, secureWebhooks, prepareWorkflow, routeProviderRequests } from './workflows.mjs';

import { isProvider, providerForModel } from '../ui/lib/provider-catalog.mjs';
import { generate, ProviderError, testProvider } from './provider-adapters.mjs';
import { openProviderSettings, validProviderKey } from './provider-settings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const marker = '/home/node/.n8n/ortak-akil-installed.json';
const tokenFile = '/run/ortak-akil/token';
try { await writeFile(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const internalToken = (await readFile(tokenFile, 'utf8')).trim();
if (!/^[a-f0-9]{64}$/.test(internalToken)) throw new Error('Internal access token is invalid. Restore the access-token volume from backup.');
const webhookCredential = { id: WEBHOOK_CREDENTIAL_ID, name: 'Ortak Akıl internal access', type: 'httpHeaderAuth', data: { name: 'X-Multi-Agent-Key', value: internalToken } };
const assessmentVersion = 17;
const authVersion = 2;
const providerVersion = 1;
const providerSettings = await openProviderSettings('/home/node/.n8n/pbots-providers.json', internalToken);
let configured = await access(marker).then(() => true, () => false);
let installing = false;
let shuttingDown = false;
let child;
let childExit;
let lastError = '';
let lastSetupAttempt = 0;

async function writeInstallation(installation) {
  const pending = marker + '.pending';
  await writeFile(pending, JSON.stringify(installation), { mode: 0o600 });
  await rename(pending, marker);
}

function startN8n() {
  child = spawn('n8n', ['start'], { stdio: 'inherit' });
  childExit = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve(1));
  });
  childExit.then(result => {
    if (!installing && !shuttingDown) {
      console.error('n8n stopped unexpectedly; restarting the container.', result);
      process.exit(1);
    }
  });
}

async function stopN8n() {
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  try { await childExit; }
  finally { clearTimeout(timer); }
}

async function cli(args) {
  // Credential import errors must never echo a secret into container logs.
  await new Promise((resolve, reject) => {
    const command = spawn('n8n', args, { stdio: 'ignore' });
    const timer = setTimeout(() => command.kill('SIGKILL'), 120000);
    command.once('error', () => { clearTimeout(timer); reject(new Error('n8n command could not start.')); });
    command.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`n8n ${args[0]} failed. Setup can be retried.`));
    });
  });
}

async function ready() {
  try {
    const response = await fetch('http://127.0.0.1:5678/healthz/readiness', { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch { return false; }
}

async function ownerSetupRequired() {
  try {
    const response = await fetch('http://127.0.0.1:5678/rest/settings', { signal: AbortSignal.timeout(3000) });
    const settings = await response.json();
    return settings.data?.userManagement?.showSetupOnFirstLoad !== false;
  } catch { return true; }
}

async function install() {
  const directory = await mkdtemp('/tmp/ortak-akil-');
  try {
    await stopN8n();
    const credentialsFile = join(directory, 'credentials.json');
    await writeFile(credentialsFile, JSON.stringify([webhookCredential]), { mode: 0o600 });
    await cli(['import:credentials', `--input=${credentialsFile}`]);
    await rm(credentialsFile);
    const workflows = await Promise.all(WORKFLOW_FILES.map(async name => prepareWorkflow(JSON.parse(await readFile(join(root, 'workflows', name), 'utf8')))));
    const workflowsFile = join(directory, 'workflows.json');
    await writeFile(workflowsFile, JSON.stringify(workflows), { mode: 0o600 });
    await cli(['import:workflow', `--input=${workflowsFile}`]);
    for (const id of PUBLISHED_IDS) await cli(['publish:workflow', `--id=${id}`]);
    const exportedWorkflows = join(directory, 'workflow-check.json');
    await cli(['export:workflow', '--all', `--output=${exportedWorkflows}`]);
    const savedWorkflows = JSON.parse(await readFile(exportedWorkflows, 'utf8'));
    if (workflows.some(workflow => !savedWorkflows.some(saved => saved.id === workflow.id)) ||
        PUBLISHED_IDS.some(id => !savedWorkflows.some(saved => saved.id === id && saved.active))) {
      throw new Error('Workflow installation verification failed. Retry setup.');
    }
    // Only mark complete after every import and publication has succeeded.
    await writeInstallation({ installedAt: new Date().toISOString(), workflowCount: 8, authVersion, pipelineVersion: 1, assessmentVersion, providerVersion });
    configured = true;
  } finally {
    await rm(directory, { recursive: true, force: true });
    startN8n();
  }
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

// Secure installed triggers in place, preserving operator edits and Google credentials.
if (configured) {
  const installation = JSON.parse(await readFile(marker, 'utf8'));
  if (installation.authVersion !== authVersion) {
    const directory = await mkdtemp('/tmp/ortak-akil-auth-');
    try {
      const credentialFile = join(directory, 'credential.json');
      await writeFile(credentialFile, JSON.stringify([webhookCredential]), { mode: 0o600 });
      await cli(['import:credentials', `--input=${credentialFile}`]);
      const workflowFile = join(directory, 'workflows.json');
      await cli(['export:workflow', '--all', `--output=${workflowFile}`]);
      const stored = JSON.parse(await readFile(workflowFile, 'utf8'));
      const patched = stored.filter(workflow => workflow.nodes.some(node => node.type === 'n8n-nodes-base.webhook' && node.parameters.path?.startsWith('multi-agent-ui-')));
      if (patched.length !== 4) throw new Error('Expected four installed UI webhooks. Restore the installation backup before retrying.');
      const chat = stored.find(workflow => workflow.id === 'nf1usCSYXipWNQH9');
      if (chat) patched.push(chat);
      const { authUpgradePublished, ...installed } = installation;
      const published = authUpgradePublished ?? patched.filter(workflow => workflow.active).map(workflow => workflow.id);
      if (!authUpgradePublished) await writeInstallation({ ...installed, authUpgradePublished: published });
      for (const workflow of patched) {
        secureWebhooks(workflow);
        for (const field of ['shared', 'activeVersionId', 'createdAt', 'updatedAt']) delete workflow[field];
        workflow.active = false;
        workflow.versionId = randomUUID();
      }
      await writeFile(workflowFile, JSON.stringify(patched), { mode: 0o600 });
      await cli(['import:workflow', `--input=${workflowFile}`]);
      for (const id of published) await cli(['publish:workflow', `--id=${id}`]);
      await writeInstallation({ ...installed, authVersion });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const currentInstallation = JSON.parse(await readFile(marker, 'utf8'));
  if (currentInstallation.pipelineVersion !== 1) {
    for (const id of CORE_WORKFLOW_IDS) await cli(['publish:workflow', `--id=${id}`]);
    await writeInstallation({ ...currentInstallation, pipelineVersion: 1 });
  }
}
// Update the analysis nodes in place so credentials, workflow IDs and custom nodes survive restarts.
if (configured) {
  const installation = JSON.parse(await readFile(marker, 'utf8'));
  if (installation.assessmentVersion !== assessmentVersion) {
    const directory = await mkdtemp('/tmp/ortak-akil-assessment-');
    try {
      const workflowFile = join(directory, 'workflows.json');
      await cli(['export:workflow', '--all', `--output=${workflowFile}`]);
      const stored = JSON.parse(await readFile(workflowFile, 'utf8'));
      const patches = [
        ['multi-agent-planner.json', [['Validate Planner Input', 'jsCode'], ['Call OpenAI Planner', 'jsonBody'], ['Validate and Normalize Plan', 'jsCode']]],
        ['multi-agent-worker.json', [['Validate Worker Input', 'jsCode'], ['Call OpenAI Worker', 'jsonBody'], ['Normalize Worker Output', 'jsCode']]],
        ['multi-agent-ui-worker.json', [['Prepare UI Worker Input', 'jsCode']]],
        ['multi-agent-ui-plan.json', [['Prepare UI Plan Input', 'jsCode'], ['Format UI Plan Response', 'jsCode']]],
        ['multi-agent-ui-judge.json', [['Prepare UI Judge Input', 'jsCode']]],
        ['multi-agent-judge.json', [['Validate and Format Judge Input', 'jsCode'], ['Call Final Judge Synthesis', 'jsonBody'], ['Normalize Final Judge Output', 'jsCode']]],
      ];
      const { assessmentUpgradePublished, ...installed } = installation;
      const previouslyPublished = assessmentUpgradePublished ?? stored.filter(workflow => workflow.active).map(workflow => workflow.id);
      if (!assessmentUpgradePublished) await writeInstallation({ ...installed, assessmentUpgradePublished: previouslyPublished });
      const updated = await Promise.all(patches.map(async ([file, parameters]) => {
        const source = JSON.parse(await readFile(join(root, 'workflows', file), 'utf8'));
        const workflow = stored.find(entry => entry.id === source.id);
        if (!workflow) throw new Error(`Missing assessment workflow ${source.id}.`);
        for (const [name, parameter] of parameters) {
          const node = workflow.nodes.find(entry => entry.name === name);
          const sourceNode = source.nodes.find(entry => entry.name === name);
          const value = sourceNode?.parameters[parameter];
          if (!node || typeof value !== 'string') throw new Error(`Missing assessment node ${name}.`);
          node.parameters[parameter] = value;
          if (parameter === 'jsonBody') {
            node.parameters.options = { ...node.parameters.options, redirect: sourceNode.parameters.options.redirect };
          }
        }
        if (file === 'multi-agent-judge.json') {
          const input = 'Validate and Format Judge Input';
          const compare = 'Compare Independent Findings';
          const validate = 'Validate Comparison Notes';
          const synthesis = 'Call Final Judge Synthesis';
          const existingSynthesis = workflow.nodes.find(node => node.name === synthesis);
          const edge = workflow.connections[input]?.main?.[0]?.find(connection =>
            connection.node === synthesis || connection.node === compare);
          if (!edge) throw new Error('Missing assessment connection to Judge synthesis.');
          for (const name of [compare, validate]) {
            const node = structuredClone(source.nodes.find(entry => entry.name === name));
            if (name === compare) node.credentials = structuredClone(existingSynthesis.credentials);
            const index = workflow.nodes.findIndex(entry => entry.name === name);
            if (index < 0) workflow.nodes.push(node);
            else workflow.nodes[index] = node;
            workflow.connections[name] = source.connections[name];
          }
          edge.node = compare;
        }
        for (const field of ['shared', 'activeVersionId', 'createdAt', 'updatedAt']) delete workflow[field];
        workflow.active = false;
        workflow.versionId = randomUUID();
        return workflow;
      }));
      await writeFile(workflowFile, JSON.stringify(updated), { mode: 0o600 });
      await cli(['import:workflow', `--input=${workflowFile}`]);
      for (const workflow of updated) {
        if (previouslyPublished.includes(workflow.id)) await cli(['publish:workflow', `--id=${workflow.id}`]);
      }
      await writeInstallation({ ...installed, assessmentVersion });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

// Keep published workflow IDs and migrate the existing OpenAI key before switching the transport.
if (configured) {
  const installation = JSON.parse(await readFile(marker, 'utf8'));
  if (installation.providerVersion !== providerVersion) {
    const directory = await mkdtemp('/tmp/pbots-providers-');
    try {
      if (!providerSettings.key('openai')) {
        const credentials = join(directory, 'credentials.json');
        await cli(['export:credentials', `--id=${OPENAI_CREDENTIAL_ID}`, '--decrypted', `--output=${credentials}`]);
        const [credential] = JSON.parse(await readFile(credentials, 'utf8'));
        await rm(credentials);
        const value = credential?.data?.value;
        if (typeof value !== 'string' || !value.startsWith('Bearer ') || !validProviderKey('openai', value.slice(7))) {
          throw new Error('The installed OpenAI credential could not be migrated.');
        }
        await providerSettings.save('openai', value.slice(7));
      }
      const file = join(directory, 'workflows.json');
      await cli(['export:workflow', '--all', `--output=${file}`]);
      const workflows = JSON.parse(await readFile(file, 'utf8')).filter(routeProviderRequests);
      if (workflows.length !== CORE_WORKFLOW_IDS.length) throw new Error('Missing provider workflows.');
      const { providerUpgradePublished, ...installed } = installation;
      const published = providerUpgradePublished ?? workflows.filter(workflow => workflow.active).map(workflow => workflow.id);
      if (!providerUpgradePublished) await writeInstallation({ ...installed, providerUpgradePublished: published });
      for (const workflow of workflows) {
        for (const field of ['shared', 'activeVersionId', 'createdAt', 'updatedAt']) delete workflow[field];
        workflow.active = false;
        workflow.versionId = randomUUID();
      }
      await writeFile(file, JSON.stringify(workflows), { mode: 0o600 });
      await cli(['import:workflow', `--input=${file}`]);
      for (const id of published) await cli(['publish:workflow', `--id=${id}`]);
      await writeInstallation({ ...installed, providerVersion });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new ProviderError(413);
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ProviderError(400);
  return data;
}

function providerFailure(status) {
  if ([401, 403, 404].includes(status)) return 'API anahtarını ve bu modele erişiminizi kontrol edin.';
  if ([402, 429].includes(status)) return 'Kota ve faturalandırma ayarlarınızı kontrol edin.';
  if (status === 409) return 'Önce bir API anahtarı kaydedin.';
  return 'Model yanıt vermedi. Bağlantıyı kontrol edip tekrar deneyin.';
}

startN8n();
const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ready: true });
  const suppliedToken = request.headers['x-multi-agent-key'];
  if (typeof suppliedToken !== 'string' || !/^[a-f0-9]{64}$/.test(suppliedToken) ||
      !timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(internalToken))) return json(response, 401, { error: 'Unauthorized.' });
  if (request.method === 'GET' && request.url === '/status') {
    return json(response, 200, { configured, installing, connected: await ready(), ownerSetupRequired: await ownerSetupRequired(), error: lastError, ...providerSettings.status() });
  }
  if (request.method === 'POST' && request.url === '/generate') {
    if (request.socket.remoteAddress !== '127.0.0.1') return json(response, 403, { error: 'Forbidden.' });
    try {
      const body = await readBody(request, 8 * 1024 * 1024);
      const disconnect = new AbortController();
      response.once('close', () => disconnect.abort());
      const timeout = Array.isArray(body.input) ? 115_000 : 900_000;
      const signal = AbortSignal.any([disconnect.signal, AbortSignal.timeout(timeout)]);
      return json(response, 200, await generate(body, providerSettings.key(providerForModel(body.model)), signal));
    } catch {
      if (!response.destroyed) return json(response, 502, { error: 'Provider request failed.' });
    }
  }
  if (request.method === 'POST' && request.url === '/providers') {
    if (!configured || installing) return json(response, 409, { error: 'Önce kurulumu tamamlayın.' });
    try {
      const { provider, apiKey, action } = await readBody(request, 4096);
      if (!isProvider(provider)) return json(response, 400, { error: 'Geçersiz sağlayıcı.' });
      const key = apiKey === undefined ? providerSettings.key(provider) : apiKey;
      if (action === 'default' && providerSettings.key(provider)) await providerSettings.setDefault(provider);
      else if ((action === 'test' || action === 'save') && validProviderKey(provider, key)) {
        await testProvider(provider, key, AbortSignal.timeout(20_000));
        if (action === 'save') await providerSettings.save(provider, key);
      } else return json(response, 400, { error: 'Geçerli bir API anahtarı girin.' });
      return json(response, 200, providerSettings.status());
    } catch (error) {
      return json(response, 502, { error: providerFailure(error instanceof ProviderError ? error.status : 502) });
    }
  }
  if (request.method !== 'POST' || request.url !== '/configure') return json(response, 404, { error: 'Unknown action.' });
  if (configured) return json(response, 409, { error: 'Setup is already complete. Manage providers in Settings.' });
  if (installing) return json(response, 409, { error: 'Setup is already running.' });
  if (Date.now() - lastSetupAttempt < 10000) return json(response, 429, { error: 'Wait before retrying setup.' });
  if (!await ready()) return json(response, 503, { error: 'n8n is starting. Try again shortly.' });
  if (await ownerSetupRequired()) return json(response, 409, { error: 'Create your n8n owner account before entering the API key.' });
  try {
    const body = await readBody(request, 4096);
    const provider = body.provider ?? 'openai';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!validProviderKey(provider, apiKey)) return json(response, 400, { error: 'Geçerli bir API anahtarı girin.' });
    // Reserve setup before yielding to prevent concurrent submissions.
    if (installing || configured) return json(response, 409, { error: 'Setup is already running or complete.' });
    installing = true;
    lastSetupAttempt = Date.now();
    lastError = '';
    try {
      await testProvider(provider, apiKey, AbortSignal.timeout(20_000));
      await providerSettings.save(provider, apiKey);
      await providerSettings.setDefault(provider);
      await install();
      json(response, 200, { configured: true });
    } catch (error) {
      lastError = providerFailure(error instanceof ProviderError ? error.status : 502);
      json(response, 502, { error: lastError });
    } finally { installing = false; }
  } catch { json(response, 400, { error: 'Invalid setup request.' }); }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(5689, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    shuttingDown = true;
    server.close();
    await stopN8n();
    process.exit(0);
  });
}
