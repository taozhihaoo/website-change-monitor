# syntax=docker/dockerfile:1

# ---------- build stage: compile server + client ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY client ./client

RUN npm run build \
  && npm prune --omit=dev --no-audit --no-fund

# ---------- runtime stage: app + chromium ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    APP_PORT=3000 \
    DB_PATH=/app/data/wcm.db

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
COPY package.json ./

# Chromium and its system dependencies, installed before dropping privileges.
# Browsers go to /opt/ms-playwright so the non-root user can use them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && npx playwright install --with-deps chromium \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /root/.npm

RUN useradd --system --create-home --home-dir /home/app app \
  && mkdir -p /app/data \
  && chown -R app:app /app /opt/ms-playwright /home/app
USER app

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
