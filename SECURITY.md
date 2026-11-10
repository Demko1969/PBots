# Security review and distribution status

Reviewed on 6 November 2026. This is a local preview package. The review found
issues and applied fixes, but it does not certify that the software is free of
vulnerabilities. Container findings described below remain a release concern.
Public multi-user hosting requires a separate access-control and deployment review.

## Verified controls

| Area | Implemented protection | Verification |
| --- | --- | --- |
| Local exposure | Published ports bind to 127.0.0.1. Setup port is internal. | Compose configuration and isolated runtime checks |
| Browser writes | Origin, content type and configured allowed origins are checked. Hostname forgery is rejected. | Unit tests and HTTP integration tests |
| First installation | Owner account is required before saving an OpenAI key. Concurrent and repeat setup is rejected. | Disposable first-run installation |
| Service authentication | Random 256-bit local token protects setup and all four UI webhooks. The UI mounts its token volume read-only. | Direct webhook and setup requests without a token rejected |
| Credential storage | n8n encrypts OpenAI credentials. Private temporary import files use memory-backed storage and are removed. Credential imports are verified. | CLI export checked for encrypted data without printing its value |
| Request limits | Setup JSON is capped at 4096 bytes. Analysis JSON is capped at 512 KiB. Upstream response JSON is capped at 2 MiB. Four concurrent requests and 60 requests/minute are allowed per UI process. | Stream-limit, malformed JSON and concurrency tests |
| Error responses | Analysis API returns generic errors, without upstream bodies or stack traces. Authenticated requests reject HTTP redirects. | Dummy-key failure path and source inspection |
| Browser rendering | React renders result content as text. Docs links require HTTPS and the docs.google.com document path. Security headers restrict framing, content sniffing and connections. | Render tests, URL validation and HTTP header checks |
| CSV handling | Files are parsed in the browser, with size/row/column limits. Table contents are labelled untrusted in the AI context. | CSV edge-case and calculation tests |
| Containers | Both run without root privileges, with capabilities dropped, privilege escalation disabled and process counts capped. Runtime images are pinned by digest. | Image definitions and Compose checks |
| n8n | Community packages, public API, template catalog and version notifications disabled; node access to environment blocked, SSRF protection enabled. Successful and failed execution-payload persistence disabled. | Packaged environment configuration |
| Distribution | Allowlisted source ZIP excludes local environments, reports, temporary data, dependencies and Git history. Workflow exports have pinned data and source ownership metadata removed. | ZIP inventory and secret-pattern inspection |

These controls apply to the packaged Docker deployment. Manually imported n8n
workflows require the operator to configure webhook authentication and credential
references themselves. The standalone chat workflow and Google Docs webhook are
not automatically published.

## Dependency and image checks

The initial UI lockfile scan reported 91 advisories, including five critical.
After direct upgrades and pinned transitive fixes, `pnpm audit` reported zero
known advisories across 606 dependency entries. This is a database snapshot,
not a guarantee about all runtime behavior.

The package uses Next.js 16.4.5, React 19.3.1, vinext 1.4.4, Vite 8.3.6,
and n8n 2.46.6. Pinned overrides update vulnerable transitive packages used by
build tools. Builds, lint and tests must be rerun when these pins change.
The n8n selection follows its current stable release. [n8n releases](https://github.com/n8n-io/n8n/releases)

Published advisories were checked alongside the registry audit, including
Next.js image processing, vinext action/cache handling and n8n authenticated
redirect handling. Versions were updated past the corresponding fixes.
[Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2),
[vinext advisory](https://github.com/cloudflare/vinext/security/advisories/GHSA-8969-277p-8rrm),
[n8n advisory](https://github.com/n8n-io/n8n/security/advisories/GHSA-prmc-fg87-r4gh)

Docker Scout required an authenticated Docker account. Trivy scanned local image
archives instead, without access to the Docker socket. Upstream image findings
are listed in `deployment/security-findings.json`. Counts are affected package
occurrences, including unused bundled connectors, rather than confirmed exploits.
Trivy warned that upstream SBOMs can introduce inaccuracies. Findings still need
triage and maintenance as vendors release fixes.

The stable n8n image has an outstanding critical finding in `brotli-libs`
(CVE-2026-111497, installed 1.2.0-r1, fixed 1.2.1-r0), plus high-severity bundled
package findings. The official image does not include a normal package manager.
Replacing individual vendor libraries without an upstream-supported build has
not been treated as a verified remediation. This is a blocker to describing the
container set as cleared for unrestricted distribution.

The final minimal web image scan reports zero critical, two high, 35 medium and
eight low package findings. The two high findings affect the vendor's `zlib1g`
package; the scan supplies no fixed Debian version. The final stable n8n image
reports one critical, 29 high, 39 medium and 27 low findings. These results prevent
a claim that all container vulnerabilities have been remediated.

## Data flow and remaining trust requirements

- API keys travel from the browser to a local HTTP service and from that service
  or n8n to OpenAI over HTTPS. They are absent from app API responses and are not
  deliberately logged by the setup code.
- The n8n encryption key lives alongside its database. A person, malware or agent
  with sufficient local, browser, Docker or n8n access can retrieve or use the API
  credential. Password-field masking does not establish isolation from agents.
- Questions, computed table profiles and supported full-file ticket metrics, column notes and up to ten CSV sample rows
  are sent to OpenAI. The complete CSV remains in the browser. Google Docs export
  sends the short decision report and reader question to Google; the technical CSV context and independent expert answers are excluded. Folder permissions can affect
  who can read the exported document. Provider-side retention was not verified
  by this local review.
- n8n stores credentials and configuration locally. Disabling execution payload
  persistence does not prevent every operational event or error log. Review logs
  and backups before sharing them. Backups of both named volumes are sensitive.
- Request limits reduce accidental load. They do not enforce a financial budget.
  A trusted local process can forge browser headers or access the app. The package
  provides no separation between multiple local users or tenants.
- AI outputs and CSV text can contain misleading instructions. They are never
  evaluated as application code, but they can influence model answers. Numeric
  summaries use floating-point arithmetic. Validated support-ticket columns enable full-file target comparisons and bounded group summaries. Other schemas and date comparisons still require an explicit adapter. Review conclusions before relying
  on them.
- CSP permits inline scripts/styles for framework rendering. It is one layer of
  protection. Local traffic uses HTTP, and the editor's secure-cookie flag is off
  for that local mode. The configuration must be reconsidered for HTTPS hosting.

The built-in n8n configuration audit also flags the required Code and HTTP Request
nodes as risky capabilities and the fresh installation's unused credentials. Code
nodes run repository-authored scripts; model output is not evaluated as code.
Workflow editors must remain fully trusted. Version checking is a separate
maintenance responsibility when version notifications are disabled.

## Checked repository content

Two available Git commits and current textual source outside generated reports
were checked for OpenAI-key and private-key patterns. No matches were found.
This scan does not establish that every possible secret or private datum is
absent. Tracked `.env.local` and `.env.localy` were empty at review time.
Generated reports and renderings are tracked in the existing repository and can
contain private project content. `.gitignore` does not remove already tracked
files or historical copies. The release archive excludes those files, but the
repository itself requires a separate content review before being made public.

The project owner must select a redistribution license. No project license was
chosen during this review.

## Validation and limits

The review includes local builds, eleven UI/security/CSV tests, workflow export
validation, credential/webhook preparation tests, and disposable HTTP installation
tests. Hostile origins, DNS-rebinding Host values, invalid content types,
malformed/oversized JSON, missing webhook credentials and repeat setup were tested.
Restart persistence and the legacy-marker authentication migration were also verified.

The integration installation used a dummy OpenAI key and mocked key verification.
On 8 November 2026, a real browser-to-OpenAI run with the synthetic 20-row CSV
completed Planner, four Workers and both Judge steps. The displayed resolution
mean (20.25 hours) and reopened count (6) matched the input controls. This test
followed a fix that publishes core sub-workflows as well as UI webhooks. On 9 November 2026, the configured Google OAuth connections successfully created
and formatted a short synthetic report through the app’s Docs API (HTTP 200).
Export of longer reports was not covered by this check. The Windows
launcher was reviewed but was not executed on Windows. Docker was tested on the
available Apple Silicon host. Other CPU/OS combinations require their own checks.
This is an engineering review, not an independent penetration test.

Recheck before publishing a release:

```sh
pnpm --dir ui audit
npm --prefix ui test
npm --prefix ui run lint
npm run validate
node --test deployment/workflows.test.mjs
python3 scripts/package-release.py
```

Update and rescan both runtime images when upstream fixes arrive. Keep API keys
out of issues, screenshots and chat messages. If a credential may have been
exposed, revoke it at its provider and replace it through the local n8n editor.
