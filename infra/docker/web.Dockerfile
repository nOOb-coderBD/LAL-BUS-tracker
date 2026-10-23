FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci
ARG VITE_MAP_TILE_URL
ARG VITE_MAP_ATTRIBUTION
ENV VITE_MAP_TILE_URL=$VITE_MAP_TILE_URL
ENV VITE_MAP_ATTRIBUTION=$VITE_MAP_ATTRIBUTION
RUN npm run build -w @lal/shared && npm run build -w @lal/web

FROM nginx:1.28-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/security.conf /etc/nginx/snippets/security.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
