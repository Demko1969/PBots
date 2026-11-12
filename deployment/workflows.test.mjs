import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WORKFLOW_FILES, PUBLISHED_IDS, OPENAI_CREDENTIAL_ID, WEBHOOK_CREDENTIAL_ID, prepareWorkflow } from './workflows.mjs';

test('prepares all eight workflows with connected subworkflows and local credentials', async () => {
  const source = await Promise.all(WORKFLOW_FILES.map(async file => JSON.parse(await readFile(new URL(`../workflows/${file}`, import.meta.url), 'utf8'))));
  const sourceSnapshot = JSON.stringify(source);
  const prepared = source.map(prepareWorkflow);
  const ids = new Set(prepared.map(workflow => workflow.id));
  assert.equal(ids.size, 8);
  for (const id of PUBLISHED_IDS) assert.ok(ids.has(id));
  let openAiNodes = 0;
  for (const workflow of prepared) {
    assert.equal(workflow.active, false);
    assert.equal(workflow.shared, undefined);
    assert.equal(workflow.activeVersionId, undefined);
    for (const node of workflow.nodes) {
      if (node.type === 'n8n-nodes-base.webhook') {
        assert.equal(node.parameters.authentication, 'headerAuth');
        assert.equal(node.credentials.httpHeaderAuth.id, WEBHOOK_CREDENTIAL_ID);
      }
      if (node.type === 'n8n-nodes-base.executeWorkflow') {
        assert.ok(ids.has(node.parameters.workflowId.value));
        assert.ok(PUBLISHED_IDS.includes(node.parameters.workflowId.value), 'sub-workflow dependencies must be published');
      }
      if (node.parameters.url === 'https://api.openai.com/v1/responses') {
        assert.equal(node.credentials.httpHeaderAuth.id, OPENAI_CREDENTIAL_ID);
        openAiNodes++;
      }
      assert.equal(node.credentials?.googleDriveOAuth2Api, undefined);
      assert.equal(node.credentials?.googleDocsOAuth2Api, undefined);
    }
  }
  assert.equal(openAiNodes, 3);
  assert.equal(JSON.stringify(source), sourceSnapshot, 'source exports remain intact');
});
