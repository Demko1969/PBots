# Security and privacy

This project is a single-operator local application. Docker publishes the UI
and n8n editor on `127.0.0.1`. The standalone launch command also binds the
UI to loopback. Browser writes require a same-origin JSON request and a
permitted host. Loopback services share the operator's trust boundary. An
untrusted local process, shared OS account, authenticated n8n editor, or access
to Docker and its volumes can access sensitive data or trigger paid requests.
Shared or public operation requires separate authentication, per-user data
isolation, HTTPS and spending controls.

## Webhook and provider access

The four imported UI webhooks require an n8n Header Auth credential for
`X-Multi-Agent-Key`. Docker creates a 256-bit token and mounts it read-only
in the UI. In a standalone setup, select the credential on every UI Webhook
node and store the matching token in the UI server's private environment file.
Missing or malformed server credentials stop forwarding at the UI proxy.
The chat workflow is distributed inactive and limited to the n8n editor.
See the [installation and migration guide](deployment/README.md).

In Docker, setup requires the n8n owner account before saving the first key.
n8n encrypts provider credentials. Its database and encryption key live in
the same private volume. Temporary credential import files use memory-backed
storage. OpenAI HTTP nodes reject redirects and request `store: false`.
Provider retention also depends on the account, provider policies and the
applicable endpoint. Docker disables saved successful, failed and manual
execution data. Operational logs and backups still require private handling.
Analysis API errors avoid returning upstream payloads.

## Data sent and retained

- OpenAI receives questions, applicable follow-up context, independent
  responses, and the selected CSV columns, profiles, aggregate metrics and
  up to ten sample rows. CSV parsing and full-table calculations run locally.
- JPG, PNG and PDF attachments are sent in full to OpenAI for analysis.
  Attachment evidence and small image previews can appear in local history.
- Optional Google Docs export sends a question and short decision report to
  Google. The report itself can still contain details from the analysis.
  Check the destination folder's sharing permissions before exporting.
- SQLite history contains questions, previews and results and persists across
  restarts. Browsers on the same installation share it. New saves redact
  recognized OpenAI key and bearer-token formats from text and CSV previews.
  Images and arbitrary secrets need separate care. Records and backups
  created before the fix may contain unredacted values. Follow the [history
  and backup procedure](deployment/README.md#existing-history-and-backups)
  to rotate credentials and start with a fresh history file while retaining a
  private backup.
- CSV accepts up to 1 MB, 5,000 rows and 30 columns. The UI proxy accepts
  attachments up to 5 MiB, other analysis requests up to 512 KiB and upstream
  JSON responses up to 2 MiB. Four concurrent and 60 accepted analysis requests
  per minute are allowed per UI process. SQLite leases prevent overlapping
  identical UI evaluations against the same history file. Configure provider
  usage limits separately. Direct authorized n8n calls do not pass through
  the UI's rate limits.

## Dependencies and container images

Both runtimes run as non-root with dropped capabilities and privilege
escalation disabled. Their base images are pinned by digest. The n8n build
uses signed Alpine packages to update Brotli, OpenSSH, libcurl and Expat.
The UI's distroless base includes the Debian zlib update.

The 19 November 2026 Trivy rescan of the built Linux ARM64 images reported
zero critical package occurrences. The UI image had zero high occurrences
and the n8n image had 24 high occurrences in bundled dependencies.
The UI lockfile registry audit reported zero known advisories. The two checks
cover different package sets. See [the scan summary](deployment/security-findings.json)
for the remaining advisories and package versions. Review them before
distributing the images or changing the deployment's network exposure.

## Repository history

An earlier Git commit contains generated Atlas ERP reports and extracted
copies. Removing the paths from the current source tree does not remove
entries from earlier commits, other branches, remote refs, clones or backups.
Before publishing a branch or making the repository visible to more people,
verify which refs already contain the affected history and review access
with the repository owner. A rewrite or other history cleanup is a separate
operation. The source ZIP is produced from the reviewed current commit and
excludes Git history and project data directories.
