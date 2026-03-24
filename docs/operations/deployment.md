# deployment

<p><strong><kbd>English</kbd></strong> <a href="./deployment.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the production deployment requirements and patterns for Konekti applications.

## Docker multi-stage build

The recommended production Dockerfile uses a multi-stage build to keep the runner image small and secure. It assumes a `pnpm` workspace or a standard `pnpm` project structure.

```dockerfile
# Stage 1: Builder
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm build

# Stage 2: Runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 konekti
USER konekti

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

CMD ["node", "dist/main.js"]
```

## Kubernetes probes

Konekti runtime provides built-in health and readiness endpoints. If a `globalPrefix` is configured, probes must either use the prefixed paths or you must exclude `/health` and `/ready` explicitly via `globalPrefixExclude`.

The Docker `HEALTHCHECK` above assumes no `globalPrefix` (or that `/health` is explicitly excluded). If your app uses `globalPrefix: '/api'`, probe `http://localhost:3000/api/health` instead.

- `/health`: Liveness probe. Returns `200 { status: 'ok' }` when the process is up.
- `/ready`: Readiness probe. Returns `200` once the application bootstrap is complete and all registered readiness checks pass. Returns `503` during startup or when a dependency check fails.

If you register `@konekti/terminus`, `/health` can return enriched indicator details and HTTP `503` when any registered indicator is down.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: konekti-app
spec:
  template:
    spec:
      containers:
      - name: app
        image: konekti-app:latest
        ports:
        - containerPort: 3000
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /api/ready
            port: 3000
          initialDelaySeconds: 2
          periodSeconds: 5
          failureThreshold: 3
```

## Graceful shutdown

`runNodeApplication()` automatically wires `SIGTERM` and `SIGINT` signals to the application shutdown sequence.

When a shutdown signal is received:
1. The HTTP adapter stops accepting new connections.
2. The runtime waits for active requests to finish.
3. Idle keep-alive connections are closed.
4. Lifecycle hooks (`onModuleDestroy` and `onApplicationShutdown`) are called in reverse order.
5. The process exits once all hooks and connections are drained.

### Configuration

You can override the default 10-second drain window using `shutdownTimeoutMs`. Ensure your Kubernetes `terminationGracePeriodSeconds` is aligned with this value (it should be slightly higher than `shutdownTimeoutMs`).

```typescript
import { runNodeApplication } from '@konekti/runtime';
import { AppModule } from './app.module';

await runNodeApplication(AppModule, {
  mode: 'prod',
  shutdownTimeoutMs: 15000, // 15 seconds
});
```

## Environment variables

Konekti uses `@konekti/config` for application-level configuration. The runtime manages these core variables:

- `NODE_ENV`: Set to `production` in your runner image. This affects log formatting and default behavior in several packages.
- `PORT`: The port the HTTP adapter binds to. Defaults to `3000` if not specified in config or bootstrap options.

App-level secrets and configuration should be passed as environment variables and mapped via the `config` object in `runNodeApplication()`.

## Docker Compose for local development

Use Docker Compose to run your application alongside its dependencies during development.

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=dev
      - DATABASE_URL=postgresql://user:pass@db:5432/konekti
    depends_on:
      - db
      - redis

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: konekti
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```
