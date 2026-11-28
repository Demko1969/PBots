# Ortak Akıl web app

See the [main guide](../README.md) for Docker or the [manual installation
steps](../deployment/README.md#standalone-with-an-existing-local-n8n)
to use an existing local n8n instance. For manual setup, copy the root
`.env.example` template to `ui/.env.local` and set the server-side n8n webhook
credential there.

The web interface supports English, French, and Turkish. The AI can answer in
a different language from the interface. See the [technical language
contract](../PROJECT_SPEC.md#language) and the [browser demo guide](demo/README.md).

## Verify locally

```sh
pnpm install --frozen-lockfile
npm test
npm run lint
pnpm exec tsc --noEmit --incremental false
```
