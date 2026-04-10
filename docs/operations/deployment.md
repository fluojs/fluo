# Deployment

<p>
  <strong>English</strong> | <a href="./deployment.ko.md">한국어</a>
</p>

This document defines the production deployment standards, containerization patterns, and runtime health indicators for the fluo framework. It ensures that applications remain resilient, observable, and easy to manage across diverse cloud environments.

## When this document matters

- **Production Readiness**: When preparing a fluo application for a live environment.
- **Infrastructure Configuration**: When setting up Kubernetes probes, resource limits, or cloud-native scaling.
- **Troubleshooting**: When diagnosing startup failures, unexpected restarts, or graceful shutdown issues.

---

## Containerization

fluo recommends a multi-stage Docker build to minimize image size and reduce the attack surface.

### Recommended Dockerfile Pattern
```dockerfile
# Stage 1: Builder
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
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
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 fluo
USER fluo

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Optional: Add a healthcheck for container runtimes that support it
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

EXPOSE 3000
CMD ["node", "dist/main.js"]
```

---

## Health and Readiness Probes

fluo provides built-in endpoints for automated health monitoring. These integrate directly with Kubernetes `livenessProbe` and `readinessProbe`.

- **Liveness (`/health`)**: Returns `200 OK` as long as the process is running. Used to trigger container restarts.
- **Readiness (`/ready`)**: Returns `200 OK` only after the application bootstrap is complete and all registered dependency checks (e.g., Database, Redis) pass. Returns `503 Service Unavailable` during startup or dependency failure.

### Global Prefix Handling
If a `globalPrefix` is configured (e.g., `/api`), probes must use the prefixed path (e.g., `/api/health`) unless they are explicitly excluded via the `globalPrefixExclude` configuration.

### Kubernetes Configuration Example
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /ready
    port: 3000
  initialDelaySeconds: 2
  periodSeconds: 5
```

---

## Graceful Shutdown

The fluo runtime (specifically `runNodeApplication` from `@fluojs/runtime/node`) automatically listens for `SIGTERM` and `SIGINT` signals to initiate a clean shutdown.

1. **Stop Ingress**: The HTTP adapter stops accepting new connections.
2. **Request Drain**: The runtime waits for active requests to finish within the `shutdownTimeoutMs` window (default: 10s).
3. **Lifecycle Hooks**: `onModuleDestroy` and `onApplicationShutdown` hooks are executed in reverse order.
4. **Exit**: The process terminates once all connections and hooks are cleared.

> **Tip**: Align your Kubernetes `terminationGracePeriodSeconds` to be slightly higher than your `shutdownTimeoutMs` to avoid abrupt process kills.

---

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `NODE_ENV` | Sets the execution mode (e.g., `production`, `development`). | `development` |
| `PORT` | The port the HTTP adapter binds to. | `3000` |
| `LOG_LEVEL` | Controls the verbosity of the framework logger. | `info` |

---

## Related Docs
- [Behavioral Contract Policy](./behavioral-contract-policy.md)
- [Testing Guide](./testing-guide.md)
- [Release Governance](./release-governance.md)
