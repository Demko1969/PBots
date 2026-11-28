FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS apk-tools
RUN apk add --no-cache apk-tools-static

FROM n8nio/n8n:2.46.6@sha256:8602f5dfacbe2c931eeafd010de0e68182310e9f309921e780ab69182e92b3ae
USER root
RUN --mount=from=apk-tools,source=/sbin/apk.static,target=/sbin/apk,readonly \
    apk add --no-cache --upgrade \
      'brotli-libs>=1.2.1-r0' 'openssh>=10.3_p1-r2' \
      'libcurl>=8.23.0-r0' 'libexpat>=2.10.0-r0'
RUN mkdir -p /run/ortak-akil && chown node:node /run/ortak-akil
USER node
COPY --chown=node:node workflows /opt/ortak-akil/workflows
COPY --chown=node:node deployment/setup-server.mjs deployment/workflows.mjs deployment/provider-adapters.mjs deployment/provider-settings.mjs /opt/ortak-akil/deployment/
COPY --chown=node:node ui/lib/provider-catalog.mjs /opt/ortak-akil/ui/lib/
ENTRYPOINT ["tini", "--", "node", "/opt/ortak-akil/deployment/setup-server.mjs"]
