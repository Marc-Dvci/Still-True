# The no-key demo: the site, the fire drill, the demo shop and the MCP endpoint, served by wrangler dev
# (workerd, the Workers runtime) with local Durable Objects. Signing in with Buffer needs your own App
# Client: pass BUFFER_CLIENT_ID and BUFFER_CLIENT_SECRET with --var if you have one.
FROM node:22-bookworm-slim
ENV CI=1 WRANGLER_SEND_METRICS=false
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 app
WORKDIR /app
COPY --chown=app:app package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=app:app . .
RUN npx vite build && chown -R app:app /app
USER app
RUN node scripts/dev_secrets.mjs
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s CMD curl -fs http://127.0.0.1:8788/api/health || exit 1
CMD ["npx", "wrangler", "dev", "--env", "e2e", "--ip", "0.0.0.0", "--port", "8788"]
