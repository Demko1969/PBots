import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_FILES, CORE_WORKFLOW_IDS, PUBLISHED_IDS, OPENAI_CREDENTIAL_ID, WEBHOOK_CREDENTIAL_ID, secureWebhooks, prepareWorkflow } from './workflows.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const marker = '/home/node/.n8n/ortak-akil-installed.json';
const tokenFile = '/run/ortak-akil/token';
try { await writeFile(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const internalToken = (await readFile(tokenFile, 'utf8')).trim();
if (!/^[a-f0-9]{64}$/.test(internalToken)) throw new Error('Internal access token is invalid. Restore the access-token volume from backup.');
const webhookCredential = { id: WEBHOOK_CREDENTIAL_ID, name: 'Ortak Akıl internal access', type: 'httpHeaderAuth', data: { name: 'X-Multi-Agent-Key', value: internalToken } };
let configured = await access(marker).then(() => true, () => false);
let installing = false;
let shuttingDown = false;
let child;
let childExit;
let lastError = '';
let lastSetupAttempt = 0;

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

async function install(apiKey) {
  const directory = await mkdtemp('/tmp/ortak-akil-');
  try {
    await stopN8n();
    const credentials = [webhookCredential, { id: OPENAI_CREDENTIAL_ID, name: 'OpenAI API', type: 'httpHeaderAuth', data: { name: 'Authorization', value: `Bearer ${apiKey}` } }];
    const credentialsFile = join(directory, 'credentials.json');
    await writeFile(credentialsFile, JSON.stringify(credentials), { mode: 0o600 });
    await cli(['import:credentials', `--input=${credentialsFile}`]);
    await rm(credentialsFile);
    const exportedCredentials = join(directory, 'credential-check.json');
    await cli(['export:credentials', `--id=${OPENAI_CREDENTIAL_ID}`, `--output=${exportedCredentials}`]);
    const savedCredentials = JSON.parse(await readFile(exportedCredentials, 'utf8'));
    if (savedCredentials.length !== 1 || savedCredentials[0].id !== OPENAI_CREDENTIAL_ID || typeof savedCredentials[0].data !== 'string') {
      throw new Error('Credential import verification failed. Retry setup.');
    }
    await rm(exportedCredentials);
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
    await writeFile(marker, JSON.stringify({ installedAt: new Date().toISOString(), workflowCount: 8, authVersion: 1, pipelineVersion: 1 }), { mode: 0o600 });
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

// Upgrade only the stored webhook workflows, preserving operator edits and Google credentials.
if (configured) {
  const installation = JSON.parse(await readFile(marker, 'utf8'));
  if (installation.authVersion !== 1) {
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
      const published = patched.filter(workflow => workflow.active).map(workflow => workflow.id);
      for (const workflow of patched) {
        secureWebhooks(workflow);
        for (const field of ['shared', 'activeVersionId', 'createdAt', 'updatedAt']) delete workflow[field];
        workflow.active = false;
        workflow.versionId = randomUUID();
      }
      await writeFile(workflowFile, JSON.stringify(patched), { mode: 0o600 });
      await cli(['import:workflow', `--input=${workflowFile}`]);
      for (const id of published) await cli(['publish:workflow', `--id=${id}`]);
      await writeFile(marker, JSON.stringify({ ...installation, authVersion: 1 }), { mode: 0o600 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const currentInstallation = JSON.parse(await readFile(marker, 'utf8'));
  if (currentInstallation.pipelineVersion !== 1) {
    for (const id of CORE_WORKFLOW_IDS) await cli(['publish:workflow', `--id=${id}`]);
    await writeFile(marker, JSON.stringify({ ...currentInstallation, pipelineVersion: 1 }), { mode: 0o600 });
  }
}
startN8n();
const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ready: true });
  const suppliedToken = request.headers['x-multi-agent-key'];
  if (typeof suppliedToken !== 'string' || !/^[a-f0-9]{64}$/.test(suppliedToken) ||
      !timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(internalToken))) return json(response, 401, { error: 'Unauthorized.' });
  if (request.method === 'GET' && request.url === '/status') {
    return json(response, 200, { configured, installing, connected: await ready(), ownerSetupRequired: await ownerSetupRequired(), error: lastError });
  }
  if (request.method !== 'POST' || request.url !== '/configure') return json(response, 404, { error: 'Unknown action.' });
  if (configured) return json(response, 409, { error: 'Setup is already complete. Manage credentials in n8n.' });
  if (installing) return json(response, 409, { error: 'Setup is already running.' });
  if (Date.now() - lastSetupAttempt < 10000) return json(response, 429, { error: 'Wait before retrying setup.' });
  if (!await ready()) return json(response, 503, { error: 'n8n is starting. Try again shortly.' });
  if (await ownerSetupRequired()) return json(response, 409, { error: 'Create your n8n owner account before entering the API key.' });
  let text = '';
  try {
    for await (const chunk of request) {
      text += chunk;
      if (Buffer.byteLength(text) > 4096) return json(response, 413, { error: 'Request is too large.' });
    }
    const body = JSON.parse(text);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(apiKey) || apiKey.length > 512) return json(response, 400, { error: 'Enter a valid OpenAI API key.' });
    // Reserve setup before yielding to prevent concurrent submissions.
    if (installing || configured) return json(response, 409, { error: 'Setup is already running or complete.' });
    installing = true;
    lastSetupAttempt = Date.now();
    lastError = '';
    try {
      const check = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      if (!check.ok) throw new Error(`OpenAI key verification failed (${check.status}). Check the key and its permissions.`);
      await install(apiKey);
      json(response, 200, { configured: true });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Setup failed. Try again.';
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
