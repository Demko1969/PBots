FROM n8nio/n8n:2.46.6@sha256:8602f5dfacbe2c931eeafd010de0e68182310e9f309921e780ab69182e92b3ae
USER root
RUN mkdir -p /run/ortak-akil && chown node:node /run/ortak-akil
USER node
COPY --chown=node:node workflows /opt/ortak-akil/workflows
COPY --chown=node:node deployment /opt/ortak-akil/deployment
ENTRYPOINT ["tini", "--", "node", "/opt/ortak-akil/deployment/setup-server.mjs"]
