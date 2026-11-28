# Ortak Akıl · Multi-Expert Workspace

**[Try the browser demo on GitHub Pages](https://demko1969.github.io/PBots/)**

Use the **English · Français · Türkçe** selector, then submit the prepared ERP support question. Three specialists examine the same 20-ticket sample from different angles: SLA breaches, reopened tickets, and the slow first responses of critical tickets. Select each expert’s robot to read their findings, return to the final recommendation, and open the solution diagram.

Send the three prepared follow-up questions to choose a first-week metric, inspect the localized screenshot of an overdue Finance ticket, and propose an alert. The **+** menu shows the sample attachment, and the CSV is available to download. The demo runs entirely in the browser with prepared answers. It needs no installation, API key, typing, or uploads.

The local app accepts your own questions, CSVs, images, and PDFs. A Planner assigns independent tasks, the Workers run in parallel, and a Judge combines their findings using the OpenAI Responses API. The web app uses a supported browser language on first use and remembers your selection. The AI uses the language of the current question unless you request another supported reply language. If the question’s language is unclear, it uses the interface language. The solution diagram follows the reply language. Saved evaluations retain their original language.

## Local installation with Docker

Start Docker Desktop or Docker Engine with Compose. On Windows, use Linux containers.

```sh
git clone https://github.com/Demko1969/PBots.git
cd PBots
bash scripts/start.sh
```

On Windows, run `scripts/start.cmd`. The launcher builds the containers from source. Then [open Ortak Akıl](http://localhost:3000), select **Settings**, and follow the link to create your local n8n owner account. Return to Ortak Akıl and enter your OpenAI API key to install the eight workflows.

Attach [the sample CSV](ui/tests/fixtures/support.csv) and enter “Where are our ERP support tickets missing their SLA, and what should we fix first?” to try the demo’s input in the local app. Live evaluations use your OpenAI API account. Optional Google Docs export requires a Google connection.

See the [local installation guide](deployment/README.md) for backups, manual installation, and Google Docs. Review the [repository history notes](SECURITY.md#repository-history) before sharing a clone.

## Evaluation history

Docker stores results, expert responses, diagrams, and Google Docs links in the `evaluation_history` volume. Manual installations use `~/.ortak-akil/evaluations.sqlite` by default. Browsers connected to the same local installation share that history. Older browser history is imported when each browser first connects.

Submitting the same question, model, and attachment can reopen a saved result without another OpenAI request. When resuming an interrupted run, the app reuses any saved plan and expert responses. Calls that were still in flight may repeat. Follow-up questions use the conversation and relevant attachment context and are saved in the same thread.

The local history endpoint accepts same-origin JSON requests. Evaluation text and CSV samples can appear in history. Recognized credential patterns are redacted from previews in new records. See the [history and backup instructions](deployment/README.md#existing-history-and-backups) for existing records.

## Project structure

| Path | Purpose |
| --- | --- |
| `workflows/multi-agent-planner.json` | Defines the list of independent specialist tasks. |
| `workflows/multi-agent-worker.json` | Runs one specialist task. |
| `workflows/multi-agent-judge.json` | Combines the findings and creates a solution diagram when appropriate. |
| `workflows/multi-agent-main.json` | Provides the n8n Chat Trigger for the editor. |
| `workflows/multi-agent-ui-*.json` | Provides the web app’s Plan, Worker, Judge, and Docs webhooks. |
| `ui/` | Contains the main web app and the GitHub Pages demo. |
| `scripts/sync-n8n.sh` | Exports the eight supported workflows from n8n. |

n8n is the workflow source of truth. To refresh the tracked workflow exports, run `./scripts/sync-n8n.sh`. For a custom container name, run `N8N_CONTAINER=my-n8n ./scripts/sync-n8n.sh`. The script removes pinned sample data and writes inactive exports. Review changes for private data and environment-specific settings before committing.

## Manual installation with an existing n8n instance

Use a security-patched Node.js release, pnpm, and a local n8n installation. Bind the web app and n8n to loopback. The [manual installation steps](deployment/README.md#standalone-with-an-existing-local-n8n) cover prerequisites, credentials, publication order, and startup. All four UI webhooks use a separate Header Auth credential shared with the local web server. The OpenAI key stays in n8n. See the [optional Google Docs setup](deployment/README.md#optional-google-docs-export).

## CSV analysis

Upload a UTF-8 CSV with your question. The app detects the delimiter, previews the table, and calculates full-file statistics for numeric columns and missing values.

- Files can contain up to 5,000 data rows and 30 columns, with a 1 MB size limit. Headers must be nonempty and unique.
- A period is the decimal separator for numeric recognition. Dates, localized currency formats, and decimal commas are kept as text. Calculations use JavaScript floating-point arithmetic.
- OpenAI receives the filename, summarized column statistics, and up to ten sample rows along with the question. CSV analysis context is limited to 24,000 characters. The Google Docs report omits raw sample rows and technical JSON.
- The bundled support-ticket schema uses `cozum_saat`, `sla_hedef_saat`, `yeniden_acildi` (0 or 1), and `memnuniyet_1_5` (1–5 or empty). It produces SLA compliance, median resolution time, missing-rating scenarios, and group breakdowns by available `modul`, `oncelik`, and `yeniden_acildi` columns. Breakdowns with more than 30 groups are skipped. Other schemas receive general column statistics.
- The shared table contract is `DataTable` in `ui/lib/table.ts`, with `name`, `columns`, and `rows`.

JPG, PNG, and PDF attachments are sent to OpenAI in full for analysis. Quoted findings can appear in evaluation history. See the [security notes](SECURITY.md) for network, storage, and data flow details.

## Verification

```sh
npm run validate
npm --prefix ui test
npm run demo:build
```

See the [demo development guide](ui/demo/README.md) for local preview and GitHub Pages deployment.
