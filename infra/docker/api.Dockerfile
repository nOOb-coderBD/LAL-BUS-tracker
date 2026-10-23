FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci
RUN npm run build -w @lal/shared && npm run build -w @lal/api
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/packages ./packages
COPY --chown=node:node data ./data
COPY --chown=node:node docs ./docs
USER node
EXPOSE 4000
CMD ["sh", "-c", "node apps/api/dist/cli.js migrate && node apps/api/dist/server.js"]
