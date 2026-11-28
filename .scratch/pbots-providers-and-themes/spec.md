# PBots AI providers and animated themes

## Problem

PBots Live currently uses OpenAI for its Planner → Workers → Judge workflow. Users want to connect other major AI providers, select the model for each question, and personalize PBots with themes that they can switch during a conversation. Demo visitors should be able to try the appearance controls with the prepared conversation and a generic model label.

## Live provider setup

- Support direct API connections to OpenAI, Anthropic Claude, and Google Gemini. Keep Ollama and other providers outside this release.
- Start with one supported model per provider. Select and document the exact model IDs after verifying each model through the complete PBots workflow.
- In **Settings**, give each provider an API key field and a **Test connection** action. Users can save keys for multiple providers and choose one configured provider and model as their default. Keep saved keys server-side and keep them out of browser storage, history, and logs. The browser receives connection status and model information.
- Keep the existing OpenAI setup usable when adding the new providers. A successful connection test confirms access to the configured model. The full evaluation tests below establish feature coverage.

## Model selection and evaluation

- Place a compact provider and model picker beside the Live composer. It starts from the saved default and shows the actual selection for the next question. A pick there applies to upcoming questions in the current conversation. Settings controls the default for new conversations.
- Capture the selected provider and model when a question is submitted. Use that pair for the full evaluation, including the Planner, Workers, and Judge. Keep n8n orchestration and the existing stage contracts. Share provider-specific request formatting and response handling across the stages.
- Allow the next question in the same chat to use another configured provider. Send that provider the new question and the relevant conversation, dataset, and attachment context needed for the follow-up. An evaluation already running keeps its original provider and model.
- Save provider and model per evaluation in history and checkpoints. Reopening history shows the actual model for each saved evaluation. Resume uses the saved pair, and result reuse accounts for both values. Preserve readability of existing history, including records with missing model details.
- If the provider fails, show an actionable error. The user can explicitly choose a different provider and start a new evaluation for that question. Replacing the provider starts the evaluation from the beginning, with its own stage results and checkpoints.

## Appearance in Demo and Live

| Choice | Behavior |
| --- | --- |
| PBots Default | The existing blue-and-white appearance. This is the initial setting in Demo and Live. |
| OpenAI | A distinct OpenAI palette. Final colors are an implementation choice. |
| Claude | Warm copper accents. |
| Gemini | Blue-violet accents. |
| Follow model | In Live, use the palette for the provider selected for the next question. In Demo, use PBots Default. |

- Place these options in **Settings → Appearance** in both builds. A manual theme choice applies independently of the provider selected for evaluation.
- Animate theme changes with a short color transition on shared surfaces, including sidebar selection, the send button, and loading accents. Apply the new colors immediately when reduced motion is enabled. Preserve the existing layout, bot artwork, and diagram styling.
- Allow theme changes mid-conversation and while an answer is loading. Preserve the current chat, composer draft, attachments, scroll position, in-flight evaluation, and ability to ask the next question.
- Use **“Selected AI provider and model”** wherever Demo would display a specific inference provider or model, including the model display in Settings. Provider names in Appearance identify palettes. Demo keeps its scripted answers and sample data across every theme and requires no API key.

## Acceptance criteria

1. A Live user can save multiple provider keys, test each connection, set a default, and select a different configured provider beside the composer. A failed connection provides feedback without exposing the key.
2. Each supported model completes an end-to-end PBots run for text, CSV, JPG/PNG photos, chart screenshots, and PDFs. Verify the Planner, Worker, and Judge outputs and confirm that the solution diagram renders for a case that calls for one.
3. Ask a question with one provider, switch models, and ask a follow-up in the same chat. Verify that the follow-up uses the new provider and receives the relevant prior context. History identifies both runs correctly. Switching the next selection during a run leaves that run on its original pair.
4. Interrupt and resume a saved evaluation with a different provider selected for new questions. Verify that resume uses the original provider and model. Verify that an equivalent question sent to another provider cannot reuse the first provider’s saved result, and that existing OpenAI history still opens.
5. Simulate a provider failure, then explicitly restart the question with another configured provider. Verify the failure is visible and that the new provider executes the evaluation from the Planner.
6. In Demo and Live, open the same shared surfaces under each theme. Switch themes while an answer loads and then continue the conversation. Check the visible transition, reduced-motion behavior, retained draft and scroll position, readable controls and loading states, and the existing bot artwork and diagram styling.
7. Complete the scripted Demo conversation with multiple theme changes. Verify that the model display uses the generic label and that the prepared questions, attachments, responses, and diagrams still work.

## Out of scope

Ollama, additional providers, multiple supported models per provider, automatic provider fallback, and mixing providers within one evaluation.
