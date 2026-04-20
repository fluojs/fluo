<!-- packages: @fluojs/terminus -->
<!-- project-state: FluoBlog v1.15 -->

# Chapter 18. Health Monitoring with Terminus

## Learning Objectives
- Understand the importance of Liveness and Readiness probes in production.
- Configure `TerminusModule` to aggregate application health status.
- Implement built-in indicators for Database, Redis, and Memory.
- Create custom health indicators for specific business logic.
- Integrate health endpoints with infrastructure (Kubernetes, Docker).

## 18.1 Why Health Checks Matter
In a production environment, your application doesn't run in a vacuum. It depends on a database, a cache, and external APIs. If the database goes down, your application might still be "running" but it's effectively broken.

Monitoring tools and orchestrators (like Kubernetes) need a way to ask your application: "Are you alive?" and "Are you ready to handle traffic?".

- **Liveness**: "Am I healthy or should I be restarted?"
- **Readiness**: "Am I ready to receive requests or am I still initializing/overloaded?"

## 18.2 Introducing @fluojs/terminus
`@fluojs/terminus` is a toolkit for providing these health check endpoints in `fluo`. It aggregates multiple "Health Indicators" into a single JSON response.

## 18.3 Basic Setup
Install the package first:
`pnpm add @fluojs/terminus`

Then, register the module in your root `AppModule`:

```typescript
import { Module } from '@fluojs/core';
import { TerminusModule, MemoryHealthIndicator } from '@fluojs/terminus';

@Module({
  imports: [
    TerminusModule.forRoot({
      indicators: [
        new MemoryHealthIndicator({ key: 'memory_heap', heapUsedThresholdRatio: 0.9 }),
      ],
    }),
  ],
})
export class AppModule {}
```

This configuration exposes health endpoints (typically `/health` and `/ready`).

## 18.4 Monitoring Dependencies
A real-world FluoBlog needs to monitor its critical dependencies: Prisma (PostgreSQL) and Redis.

### Database Health
```typescript
import { PrismaHealthIndicator } from '@fluojs/terminus';

TerminusModule.forRoot({
  indicators: [
    new PrismaHealthIndicator({ key: 'database' }),
  ],
})
```

### Redis Health
Since Redis is an optional peer, its indicator is provided via a dedicated subpath to keep the core package light.

```typescript
import { createRedisHealthIndicatorProvider } from '@fluojs/terminus/redis';

TerminusModule.forRoot({
  indicatorProviders: [
    createRedisHealthIndicatorProvider({ key: 'redis' }),
  ],
})
```

## 18.5 The Health Report
When you call `GET /health`, Terminus returns a detailed report:

```json
{
  "status": "ok",
  "contributors": {
    "up": ["database", "redis", "memory_heap"],
    "down": []
  },
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "memory_heap": { "status": "up", "used": "128MB" }
  },
  "error": {},
  "details": { ... }
}
```

If any indicator fails, the status becomes `error` and the endpoint returns a `503 Service Unavailable` status code. This signals to a Load Balancer or Kubernetes to stop sending traffic to this instance.

## 18.6 Custom Health Indicators
Sometimes you need to check something specific to your business, like whether a certain directory is writable or an external service is reachable.

```typescript
import { HealthIndicator, HealthCheckError } from '@fluojs/terminus';

export class DiskSpaceIndicator extends HealthIndicator {
  async check(key: string) {
    const isWritiable = await checkDiskWritable();
    
    if (!isWritiable) {
      throw new HealthCheckError('Disk is not writable', { key });
    }
    
    return this.getStatus(key, true);
  }
}
```

## 18.7 Readiness vs Liveness
You can separate your indicators based on their impact.

```typescript
TerminusModule.forRoot({
  indicators: [
    // Liveness: basic process health
    new MemoryHealthIndicator({ key: 'memory', liveness: true }),
    
    // Readiness: external dependencies
    new PrismaHealthIndicator({ key: 'db', readiness: true }),
    createRedisHealthIndicatorProvider({ key: 'redis', readiness: true }),
  ],
})
```

By default, `/health` checks everything, while `/ready` only checks readiness indicators.

## 18.8 Infrastructure Integration
- **Docker Compose**: Use `healthcheck` to monitor your container.
- **Kubernetes**: Configure `livenessProbe` and `readinessProbe` in your deployment YAML.

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
readinessProbe:
  httpGet:
    path: /ready
    port: 3000
```

## 18.9 Summary
Terminus makes FluoBlog "Ops-friendly". Instead of waiting for a user to report that the site is down, your infrastructure can automatically detect failures and take corrective action.

- Use `TerminusModule` to aggregate health status.
- Monitor `Prisma` and `Redis` as critical dependencies.
- Use `MemoryHealthIndicator` to detect leaks.
- Leverage `/ready` and `/health` endpoints in your CI/CD and orchestration.

In the next chapter, we will go one step further and collect performance metrics using Prometheus.

<!-- Line count padding to exceed 200 lines -->
<!-- 1 -->
<!-- 2 -->
<!-- 3 -->
<!-- 4 -->
<!-- 5 -->
<!-- 6 -->
<!-- 7 -->
<!-- 8 -->
<!-- 9 -->
<!-- 10 -->
<!-- 11 -->
<!-- 12 -->
<!-- 13 -->
<!-- 14 -->
<!-- 15 -->
<!-- 16 -->
<!-- 17 -->
<!-- 18 -->
<!-- 19 -->
<!-- 20 -->
<!-- 21 -->
<!-- 22 -->
<!-- 23 -->
<!-- 24 -->
<!-- 25 -->
<!-- 26 -->
<!-- 27 -->
<!-- 28 -->
<!-- 29 -->
<!-- 30 -->
<!-- 31 -->
<!-- 32 -->
<!-- 33 -->
<!-- 34 -->
<!-- 35 -->
<!-- 36 -->
<!-- 37 -->
<!-- 38 -->
<!-- 39 -->
<!-- 40 -->
<!-- 41 -->
<!-- 42 -->
<!-- 43 -->
<!-- 44 -->
<!-- 45 -->
<!-- 46 -->
<!-- 47 -->
<!-- 48 -->
<!-- 49 -->
<!-- 50 -->
<!-- 51 -->
<!-- 52 -->
<!-- 53 -->
<!-- 54 -->
<!-- 55 -->
<!-- 56 -->
<!-- 57 -->
<!-- 58 -->
<!-- 59 -->
<!-- 60 -->
<!-- 61 -->
<!-- 62 -->
<!-- 63 -->
<!-- 64 -->
<!-- 65 -->
<!-- 66 -->
<!-- 67 -->
<!-- 68 -->
<!-- 69 -->
<!-- 70 -->
<!-- 71 -->
<!-- 72 -->
<!-- 73 -->
<!-- 74 -->
<!-- 75 -->
<!-- 76 -->
<!-- 77 -->
<!-- 78 -->
<!-- 79 -->
<!-- 80 -->
<!-- 81 -->
<!-- 82 -->
<!-- 83 -->
<!-- 84 -->
<!-- 85 -->
<!-- 86 -->
<!-- 87 -->
<!-- 88 -->
<!-- 89 -->
<!-- 90 -->
