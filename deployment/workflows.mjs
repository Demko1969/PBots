import { randomUUID } from 'node:crypto';

export const WEBHOOK_CREDENTIAL_ID = 'ortakAkilWebhook';
export const OPENAI_CREDENTIAL_ID = 'ortakAkilOpenAi';
export const WORKFLOW_FILES = [
  'multi-agent-planner.json', 'multi-agent-worker.json', 'multi-agent-judge.json',
  'multi-agent-main.json', 'multi-agent-ui-plan.json', 'multi-agent-ui-worker.json',
  'multi-agent-ui-judge.json', 'multi-agent-ui-docs.json',
];
export const CORE_WORKFLOW_IDS = ['eCWvLGwule5hEaJL', 'd4eiJ2ZTu87WU8eC', 'SE1azDIAs87vFUna'];
export const PUBLISHED_IDS = [...CORE_WORKFLOW_IDS, 'FQaBhDfItsZvVTNf', 'dWKIaKeVID1i2XTs', 'mOkdCDiQB67MDpCB'];

export function secureWebhooks(workflow) {
  for (const node of workflow.nodes) {
    if (node.type === 'n8n-nodes-base.webhook') {
      node.parameters.authentication = 'headerAuth';
      node.credentials = { ...node.credentials, httpHeaderAuth: { id: WEBHOOK_CREDENTIAL_ID, name: 'Ortak Akıl internal access' } };
    }
  }
  return workflow;
}

export function prepareWorkflow(source) {
  const workflow = structuredClone(source);
  for (const key of ['shared', 'createdAt', 'updatedAt', 'activeVersionId', 'versionCounter', 'triggerCount', 'meta', 'sourceWorkflowId']) delete workflow[key];
  workflow.active = false;
  workflow.versionId = randomUUID();
  workflow.pinData = {};
  workflow.staticData = null;
  workflow.tags = [];
  for (const node of workflow.nodes) {
    if (node.credentials?.httpHeaderAuth) {
      node.credentials.httpHeaderAuth = { id: OPENAI_CREDENTIAL_ID, name: 'OpenAI API' };
    }
    for (const type of ['googleDriveOAuth2Api', 'googleDocsOAuth2Api']) {
      if (node.credentials?.[type]) delete node.credentials[type];
    }
  }
  return secureWebhooks(workflow);
}
