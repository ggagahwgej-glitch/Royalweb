# ROYALWEB AUTOPILOT — production image.
#
# The app keeps its state in SQLite and a media directory, so it needs a real
# disk. Mount a volume at /app/data (see docs/DEPLOY.md) and it is durable;
# without one it behaves exactly like the Vercel deployment (ephemeral).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && cp -r node_modules /prod_node_modules

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ROYALWEB_DATA_DIR=/app/data

# sqlite3 headers are not needed (node:sqlite is built in); tini reaps children
# and ca-certificates keeps outbound HTTPS (platform APIs) working.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /prod_node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docs ./docs

RUN groupadd --system --gid 1001 royalweb \
 && useradd --system --uid 1001 --gid royalweb royalweb \
 && mkdir -p /app/data/uploads /app/data/snapshots \
 && chown -R royalweb:royalweb /app/data

USER royalweb
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start"]
