#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly WORKFLOW_DIR="${REPO_ROOT}/workflows"
readonly N8N_CONTAINER="${N8N_CONTAINER:-n8n}"

command -v docker >/dev/null 2>&1 || {
  echo "Error: docker is required to export workflows from n8n." >&2
  exit 1
}

docker inspect "${N8N_CONTAINER}" >/dev/null 2>&1 || {
  echo "Error: n8n container '${N8N_CONTAINER}' was not found." >&2
  echo "Set N8N_CONTAINER to the name or ID of the running n8n container." >&2
  exit 1
}

readonly STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sync-n8n.XXXXXX")"
declare -a CONTAINER_TEMP_FILES=()

cleanup() {
  rm -rf "${STAGING_DIR}"

  if ((${#CONTAINER_TEMP_FILES[@]})); then
    docker exec "${N8N_CONTAINER}" rm -f "${CONTAINER_TEMP_FILES[@]}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Keep this list explicit: n8n is the source of truth, but only these workflow
# IDs are allowed to overwrite their corresponding repository files.
readonly WORKFLOWS=$(cat <<'EOF'
nf1usCSYXipWNQH9|multi-agent-main.json
BdWFAQzKCellIUN5|multi-agent-ui-docs.json
FQaBhDfItsZvVTNf|multi-agent-ui-plan.json
SE1azDIAs87vFUna|multi-agent-judge.json
d4eiJ2ZTu87WU8eC|multi-agent-worker.json
dWKIaKeVID1i2XTs|multi-agent-ui-worker.json
eCWvLGwule5hEaJL|multi-agent-planner.json
mOkdCDiQB67MDpCB|multi-agent-ui-judge.json
EOF
)

# Check every destination before exporting anything, so a bad mapping cannot
# leave the repository only partly updated.
while IFS='|' read -r workflow_id filename; do
  if [[ ! -f "${WORKFLOW_DIR}/${filename}" ]]; then
    echo "Error: expected destination does not exist: workflows/${filename}" >&2
    exit 1
  fi
done <<< "${WORKFLOWS}"

while IFS='|' read -r workflow_id filename; do
  container_output="/tmp/sync-n8n-${workflow_id}.json"
  staged_output="${STAGING_DIR}/${filename}"
  CONTAINER_TEMP_FILES+=("${container_output}")

  echo "Exporting ${workflow_id} -> workflows/${filename}"
  docker exec "${N8N_CONTAINER}" n8n export:workflow \
    --id="${workflow_id}" \
    --output="${container_output}" \
    --pretty
  docker cp "${N8N_CONTAINER}:${container_output}" "${staged_output}" >/dev/null

  # n8n CLI exports a JSON array. Repository workflow files contain one JSON
  # object each, so unwrap the single requested workflow and reject surprises.
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const exported = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(exported) || exported.length !== 1) {
      throw new Error(`Expected exactly one exported workflow in ${file}`);
    }
    const workflow = exported[0];
    for (const node of workflow.nodes ?? []) {
      if (node.type === "n8n-nodes-base.webhook") {
        if (node.parameters?.authentication !== "headerAuth") {
          throw new Error("Every UI webhook must require Header Auth before sync.");
        }
        if (node.credentials) delete node.credentials.httpHeaderAuth;
      }
      if (node.type === "@n8n/n8n-nodes-langchain.chatTrigger") {
        node.parameters.public = false;
        node.parameters.authentication = "n8nUserAuth";
      }
    }
    workflow.active = false;
    workflow.pinData = {};
    workflow.staticData = null;
    for (const key of ["shared", "meta", "activeVersionId"]) delete workflow[key];
    const unauthenticatedOpenAiNodes = (workflow.nodes ?? []).filter((node) => {
      if (node.type !== "n8n-nodes-base.httpRequest") return false;
      if (node.parameters?.url !== "https://api.openai.com/v1/responses") return false;

      const credential = node.credentials?.httpHeaderAuth;
      return node.parameters?.authentication !== "genericCredentialType"
        || node.parameters?.genericAuthType !== "httpHeaderAuth"
        || !credential?.id;
    });
    if (unauthenticatedOpenAiNodes.length) {
      const names = unauthenticatedOpenAiNodes.map((node) => node.name).join(", ");
      throw new Error(
        `OpenAI HTTP nodes must use an n8n Header Auth credential before sync: ${names}`,
      );
    }
    fs.writeFileSync(file, `${JSON.stringify(workflow, null, 2)}\n`);
  ' "${staged_output}"
done <<< "${WORKFLOWS}"

# Commit the complete staged set only after all eight exports succeed.
while IFS='|' read -r workflow_id filename; do
  mv "${STAGING_DIR}/${filename}" "${WORKFLOW_DIR}/${filename}"
done <<< "${WORKFLOWS}"

echo "Synced 8 n8n workflows."
