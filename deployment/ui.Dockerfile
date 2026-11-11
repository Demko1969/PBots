FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
COPY ui/package.json ui/pnpm-lock.yaml ui/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY ui/ ./
RUN mkdir -p /app/history
RUN SELF_HOSTED=true pnpm build

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:8ad9cc935b7843c4024b7e1487b5ef472c354ea847b97c667023e2618552607e
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=1000:1000 /app /app
USER 1000:1000
EXPOSE 3000
CMD ["node_modules/vinext/dist/cli.js", "start", "--hostname", "0.0.0.0"]
