# Ortak Akıl technical contract

## Evaluation flow

1. Planner receives the question and model and generates one to ten independent specialist roles, or a direct response when no specialist is needed.
2. Each Worker receives the question, model, role, and task and produces an independent answer.
3. Judge combines the Worker answers using the OpenAI Responses API and returns a final answer and, when appropriate, a solution diagram.
4. The UI shows the result and can optionally export a report to Google Docs.

## Language

The main web app and the public browser demo support English, French, and Turkish. The UI uses the browser’s preferred supported language on first visit and falls back to English. A manual selection is stored locally.

For new web evaluations, the Planner receives the isolated current question as `languageQuestion` and the selected interface language as `fallbackLanguage`. It chooses the reply language in this order: explicit request, current question language, interface fallback. It reports `replyLanguage` to the Workers and Judge. This controls user-visible role and task text, expert findings, the final answer, and the diagram’s node and edge labels. Technical identifiers keep their original values. Saved results retain their original language.

The public demo stores canonical script turns and applies the selected translation at presentation time. Changing language keeps the current turn and can localize the displayed CSV preview, ticket screenshot, expert findings, and diagram. The download provides the original sample CSV so it can also be used with the local app.

## Model

The web server offers `OPENAI_MODEL` as its initial model choice, defaulting to `gpt-5-mini`. The workflows propagate the selected model through every OpenAI request.

## Security and storage

n8n holds the OpenAI API key in a Header Auth credential. UI webhooks use a separate `X-Multi-Agent-Key` credential. The web server requires a valid server-side key before calling a webhook. Exported webhook and chat workflows are inactive. The chat workflow is restricted to the n8n editor.

Local SQLite stores history and leases that prevent simultaneous evaluations of the same request. History retains diagram availability and validation results. New CSV previews redact recognized credential patterns.

## Workflow exports

n8n is the workflow source of truth. `scripts/sync-n8n.sh` validates the eight configured workflow IDs, removes pinned sample data, and updates the files in `workflows/`. Review the exports before committing them.
