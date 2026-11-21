# syntax=docker/dockerfile:1
FROM node:22-alpine AS frontend-base

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
    && sha256sum package-lock.json | cut -d ' ' -f 1 > node_modules/.package-lock-hash

COPY . .

FROM frontend-base AS development

EXPOSE 5173
CMD ["sh", "./dev-entrypoint.sh"]

FROM frontend-base AS frontend-build

ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT=production
ARG VITE_SENTRY_RELEASE
ARG VITE_SENTRY_TRACES_SAMPLE_RATE=0.05
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT \
    VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE \
    VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    SENTRY_AUTH_TOKEN="$(tr -d '\r\n' < /run/secrets/sentry_auth_token 2>/dev/null || true)" npm run build

FROM nginx:1.29-alpine AS production

COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
