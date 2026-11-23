# Local installation

This project is designed for one trusted operator on one machine. Keep the UI
and n8n editor on loopback. The UI origin check and webhook credentials protect
different boundaries. Neither provides separate user accounts for UI history.

## Docker

1. Start Docker Desktop or Docker Engine with Compose. On Windows use Linux
   containers and run `scripts/start.cmd`. On macOS or Linux run
   `bash scripts/start.sh` from the checkout.
2. Open the [local UI](http://localhost:3000). Follow the setup link and create
   the n8n owner account. Return to the UI and enter your OpenAI API key.
3. Setup creates a separate random webhook token, imports eight workflows and
   publishes the three analysis webhooks and their three sub-workflows. Run the
   example question to verify model access. Setup's key check reads the model
   list. Actual evaluations use paid API calls.

The launcher ignores a root `.env`. Override the ports or model using shell
environment variables, for example `APP_PORT=3001 bash scripts/start.sh`.
The n8n build obtains signed Alpine package updates. First builds require
access to the image and package registries.
Docker uses named volumes for the n8n database and encryption key, the internal
webhook token, and SQLite history. Keep all three private and back them up
together. Stop the services without removing their volumes.

```sh
COMPOSE_DISABLE_ENV_FILE=1 docker compose stop
COMPOSE_DISABLE_ENV_FILE=1 docker compose logs --tail=100
```

On Windows set `COMPOSE_DISABLE_ENV_FILE=1` in the shell before using raw Compose
commands. Review any logs locally before sharing them.

### Updating an existing Docker installation

Back up the volumes and rebuild with the launcher. The authentication migration
updates the installed UI triggers and restricts the packaged chat trigger to
the editor. The analysis migration updates the shipped OpenAI request nodes.
Keep custom workflow backups and inspect changes to these nodes after updating.
The removed `deployment/compose.env` used to enable the Docs button by default.
If you already configured Docs, set `GOOGLE_DOCS_ENABLED=true` in the launcher
environment on each rebuild or restart. The Docker-managed token and history
paths remain in the existing volumes.

## Standalone with an existing local n8n

Use a security-patched Node.js release, pnpm and a supported local n8n 2.x
instance. For Node.js 22, use 22.23.4 or later. The
packaged workflow version is n8n 2.46.6. Before updating an existing manual
installation, unpublish the old UI webhooks and any public chat workflow.

1. Bind n8n to loopback and create its owner account. Disable saved successful,
   failed and manual execution payloads if you do not need them.
2. Import the eight files in `workflows/`. Confirm the sub-workflow selections
   after import. Keep the Google Docs and chat workflows unpublished for the
   initial analysis-only setup. Keep **Make Chat Publicly Available** off.
3. In n8n create a **Header Auth** credential with name `Authorization` and
   value `Bearer <OPENAI_API_KEY>`. Select it on **Call OpenAI Planner**,
   **Call OpenAI Worker**, **Compare Independent Findings** and **Call Final
   Judge Synthesis**.
4. Generate a separate 32-byte random token locally and enter its 64-character
   lowercase hexadecimal representation in a second n8n **Header Auth**
   credential. Use the header name `X-Multi-Agent-Key`. Set **Authentication**
   to **Header Auth** on each of the four UI Webhook nodes, select that
   credential and save. This includes the Docs webhook even if it is unpublished.
5. Publish the Planner, Worker and Judge sub-workflows first. Publish the UI
   Plan, Worker and Judge webhooks next. Confirm that a request without the
   webhook credential receives an authentication error before connecting a
   paid provider. Keep the HTTP endpoints on a local interface.
6. From the repository root, run the following once. If `ui/.env.local` exists,
   edit it instead of copying over it.

   ```sh
   cp .env.example ui/.env.local
   chmod 600 ui/.env.local
   cd ui
   pnpm install --frozen-lockfile
   SELF_HOSTED=true pnpm build
   pnpm start
   ```

   Before starting, set `N8N_WEBHOOK_SECRET` in `ui/.env.local` to the value
   from step 4 and set `N8N_WEBHOOK_BASE_URL` to your local n8n webhook URL.
   Keep the OpenAI key exclusively in the n8n credential store. On PowerShell
   use `$env:SELF_HOSTED='true'` before `pnpm build` and restrict access to
   `ui/.env.local` with the file's permissions.

Open [the UI](http://127.0.0.1:3000). `pnpm start` binds to loopback and loads
the server settings from `ui/.env.local`. History and duplicate-run locks use
`~/.ortak-akil/evaluations.sqlite` by default. Set `HISTORY_DB_PATH` to an
absolute path if moving data or preserving an existing standalone database.
Use a private directory. Run a question twice to verify the history result is
reused when eligible.

## Existing history and backups

The update redacts recognized key and bearer-token patterns from new CSV
previews. It does not edit old SQLite data, backup copies, or browser storage in
other profiles. If an older version evaluated CSV files that may have contained
credentials, revoke and replace those credentials through their providers.

To start fresh without deleting history, first stop the UI and back up the
database and any SQLite sidecar files together while the UI is stopped. Keep the
backup in private storage. Then point `HISTORY_DB_PATH` to a new file in a
private directory. With Docker, use a new filename inside the existing
`/app/history` volume via a local Compose override:

```yaml
services:
  ui:
    environment:
      HISTORY_DB_PATH: /app/history/evaluations-clean.sqlite
```

Apply the same override on subsequent starts and keep the original volume
private. Use a fresh browser profile if a previous release stored evaluations
in the browser. The app automatically imports those records when that profile
connects. To keep using old SQLite evaluations, review and sanitize
an offline working copy with an authorized SQLite operator before restoring it.
Deleted rows can leave bytes behind in databases, sidecars, snapshots and
backups. A fresh database avoids copying those artifacts.

## Optional Google Docs export

Enable Google Drive and Google Docs in Google Cloud, create OAuth credentials
and select the Drive and Docs credentials in n8n's **Multi-Agent UI - Google
Docs API** workflow. Replace `REPLACE_WITH_GOOGLE_DRIVE_FOLDER_ID` with the
intended folder. Check the folder's sharing permissions and the webhook's
`X-Multi-Agent-Key` Header Auth before publishing it. With Docker use
`GOOGLE_DOCS_ENABLED=true bash scripts/start.sh`. For standalone, set
`GOOGLE_DOCS_ENABLED=true` in `ui/.env.local` and restart the UI.

## Development checks

```sh
npm run validate
node --test deployment/workflows.test.mjs
npm --prefix ui test
npm --prefix ui run lint
COMPOSE_DISABLE_ENV_FILE=1 docker compose config --quiet
```

Build a source ZIP from a reviewed commit with `python3 scripts/package-release.py`.
The ZIP excludes Git history and separately stored data. See the repository
history and runtime limits in [SECURITY.md](../SECURITY.md) before sharing a
clone or configuring provider access.
