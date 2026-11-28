# Ortak Akıl browser demo

The [GitHub Pages demo](https://demko1969.github.io/ortak-akil/) uses the main
chat interface and a prepared ERP support scenario. Choose English, French, or
Turkish in the top bar. You can switch languages during the conversation and
stay on the same turn.

1. Submit the prepared question about which ERP tickets breach their SLA and
   what to fix first. Select each of the three expert robots to see what the SLA,
   support process, and ticket prioritization specialists found. Open the solution
   diagram next to the final recommendation.
2. Send the first-week measurement question.
3. Submit the question about an overdue Finance ticket. The **+** menu previews
   the attachment. Select the screenshot in the conversation to enlarge it.
4. Ask how to set an alert before the ticket’s SLA deadline. The installation
   guide appears after the last answer.

**Settings** shows the fixed sample model. The CSV is downloadable from the
attachment menu. All four turns run locally in the browser with prepared
answers. There are no model calls, API credentials, or visitor uploads.

## Preview locally

From the repository root:

```sh
pnpm --dir ui install --frozen-lockfile
npm run demo:build
python3 -m http.server 4173 --bind 127.0.0.1 --directory output/web-demo
```

Open [the local preview](http://127.0.0.1:4173/). To check the GitHub Pages
project path, serve `index.html` and `assets/` under `/ortak-akil/`.

## Publish to GitHub Pages

The Pages workflow builds and tests the demo on pull requests. To publish,
set **Settings → Pages → Source → GitHub Actions** in `Demko1969/ortak-akil`.
After merging the workflow into the default branch, run **Actions → Ortak Akıl
web demo → Run workflow** on that branch and verify the [Pages
site](https://demko1969.github.io/ortak-akil/).
