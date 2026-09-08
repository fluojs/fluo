# Explaining Slow Requests and Failures

<!-- book:volume=01-fluoblog;chapter=22 -->

[Previous: Building Scheduled Publishing and Recurring Jobs](./ch21-scheduled-publishing.md) - [Volume 1 Contents](./toc.md) - [Next: Designing Startup and Shutdown](./ch23-lifecycle-and-readiness.md)

On the morning a scheduled post went public, a reader reported, "The list opens quickly, but clicking a post sometimes takes a long time." The operator cannot reproduce it on their own computer. The server is alive, and there are few error logs. That day's scheduled job recorded success, but one successful job cannot explain every reader's experience.

Observability is not about writing more logs. It is about being able to narrow a user's symptoms to particular requests and jobs, and explain the decisions the system made at the time. FluoBlog has three distinct questions: which routes have slowed down, and by how much; where a particular request failed; and whether jobs outside HTTP, such as scheduled publishing, are actually progressing. The first needs aggregate metrics, the second structured request records, and the third job metrics and persistent publication records.

This chapter's code targets Node.js 24 and pnpm 10. We do not install a Prometheus server or send logs externally. We build the application's scrape response and request observation boundary, then verify which facts that boundary represents. Do not assume the repository's small HTTP example already contains all of these observability settings.

## How Average Response Time Hides an Incident

If 99 out of 100 requests take 20 milliseconds and one takes 2 seconds, the average is about 40 milliseconds. Looking only at the average, the service may appear fine for most readers, while one reader waits 2 seconds every time they open the same large post. Examine latency distributions and request counts together for each route. Nor can you interpret the p95 of a route with only two samples with the same confidence as the p95 of one with tens of thousands of requests.

Fluo's `MetricsModule.forRoot` records `http_requests_total`, `http_errors_total`, and `http_request_duration_seconds` when HTTP instrumentation is explicitly enabled. It requires `http: true` or an HTTP options object. The mere presence of `/metrics` does not mean HTTP request counts accumulate automatically. Default process metrics and HTTP metrics have separate settings.

Also, despite its name, `http_errors_total` does not count only server errors. It includes 4xx and 5xx responses and errors that pass through the instrumentation boundary. Combining a 404 for a missing post, a 403 for an account that is not the author, and a 500 for a database failure into one failure rate confuses product behavior with server faults. For release decisions, choose a numerator that matches the question, such as selecting `status=~"5.."` from `http_requests_total`. Treat increases in 401 and 403 at the security boundary as a separate signal.

Be precise about collection scope, too. The built-in HTTP histogram uses a monotonic clock to measure the interval during which the middleware awaits `next()`. It does not combine browser rendering, DNS and TLS connection time, and the time until every response byte reaches the client. Application metrics alone also cannot count requests Fastify rejects before handing them to Fluo dispatch, or connections that never reach the process. Connect reader experience to server processing without calling them the same measurement.

## Do Not Turn Post IDs into Metric Labels

At first, putting the raw request path in a label is tempting. Seeing `/posts/1` and `/posts/2` separately seems convenient. But each new post adds time series, and requests for arbitrary nonexistent paths can expand the label space on their own. Adding request IDs or user IDs as labels makes the growth much larger. Metrics are aggregates across limited dimensions, not searchable detailed records.

Fluo's default template mode normalizes paths using request params. This chapter chooses a stricter, product-owned path classification. Rather than retaining arbitrary unmatched paths verbatim, it groups them under `UNKNOWN`. The classification below distinguishes read routes in detail while grouping authentication and subscription subroutes by feature. The cost is having to review the classification whenever a new route is added; in return, we get a clear upper bound on the number of time series.

The following is the **complete `src/observability/observability.module.ts`**. Call the factory once within the same composition and reuse the returned module identity. `scrapeToken` is an operational value supplied by the configuration boundary, not a user JWT. Passing `false` removes only the scrape route while retaining HTTP and job instrumentation. The code distinguishes these cases so a public service without a network boundary does not expose unprotected metrics.

```typescript
import { Module } from '@fluojs/core';
import {
  ForbiddenException,
  type MiddlewareContext,
  type Next,
} from '@fluojs/http';
import { MetricsModule } from '@fluojs/metrics';
import { PublishingMetrics } from './publishing-metrics.js';

export function createObservabilityModule(scrapeToken: string | false) {
  if (scrapeToken !== false && scrapeToken.trim().length === 0) {
    throw new Error('A non-empty metrics token is required.');
  }

  class MetricsAccessMiddleware {
    async handle(context: MiddlewareContext, next: Next): Promise<void> {
      if (context.request.headers['x-metrics-token'] !== scrapeToken) {
        throw new ForbiddenException('Metrics access denied.');
      }
      await next();
    }
  }

  @Module({
    imports: [
      MetricsModule.forRoot({
        path: scrapeToken === false ? false : '/internal/metrics',
        endpointMiddleware: [MetricsAccessMiddleware],
        http: {
          durationHistogramBuckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10],
          pathLabelNormalizer: ({ path }) => {
            if (/^\/posts\/?$/.test(path)) return '/posts';
            if (/^\/posts\/[^/]+\/read\/?$/.test(path)) return '/posts/:id/read';
            if (/^\/posts\/[^/]+\/?$/.test(path)) return '/posts/:id';
            if (path.startsWith('/auth/')) return '/auth/*';
            if (path.startsWith('/subscriptions')) return '/subscriptions/*';
            if (path === '/internal/metrics') return '/internal/metrics';
            if (path === '/internal/health') return '/internal/health';
            if (path === '/internal/ready') return '/internal/ready';
            return 'UNKNOWN';
          },
        },
      }),
    ],
    providers: [PublishingMetrics],
    exports: [PublishingMetrics],
  })
  class ObservabilityModule {}

  return ObservabilityModule;
}
```

`endpointMiddleware` matters because protecting metrics must not turn into authentication for every post request. This class attaches only to the scrape route. The separate `middleware` option defines a module-level boundary, so do not confuse the two. A 403 denying metrics access is itself included in HTTP instrumentation. If the collector's token is configured incorrectly, you can investigate both scrape failures and the rise in 403 responses on that route.

Buckets are measured in seconds. Here, one boundary is 300 milliseconds, a candidate target for public reads. Bucket values must be finite and strictly increasing; invalid configuration is rejected at startup. More closely spaced buckets improve the resolution of estimates but also add time series for each label combination. There is no reason to add ten-minute buckets for long-running jobs not yet in use to HTTP metrics in advance.

Token comparison is a small application-level access boundary. Real deployments also need TLS and a network policy for the internal scrape path. Send the token in a header, not a URL query, and do not add it to the access-log allowlist. If the protective boundary is not ready, call this function with `false`. Do not use an empty string or empty path as the disabling signal. In Fluo, `path: false` disables a route.

## Registering the Same Observability Module Only Once

Operational token input is also parsed at startup. The following **complete `src/config/operations-config.ts`** adds only two optional keys for operational endpoints; it does not replace Chapter 9's database, port, and JWT configuration. An unspecified metrics token creates no route, while an unspecified health token selects Chapter 23's loopback/internal-network path. Unlike an unspecified value, an empty string is a configuration error. Never log the raw tokens.

```typescript
import { z } from 'zod';

const TokenSchema = z.string().refine((value) => value.trim().length > 0);
const OperationsConfigSchema = z.object({
  METRICS_TOKEN: TokenSchema.optional(),
  HEALTH_TOKEN: TokenSchema.optional(),
});

export const operationsConfig = Object.freeze(OperationsConfigSchema.parse({
  METRICS_TOKEN: process.env.METRICS_TOKEN,
  HEALTH_TOKEN: process.env.HEALTH_TOKEN,
}));
```

The factory is called only once in the **complete `src/observability/blog-observability.module.ts`**. PostsModule below and the root AppModule import the same identity. Calling the factory again at every import location can create separate Registries and duplicate scrape routes.

```typescript
import { operationsConfig } from '../config/operations-config.js';
import { createObservabilityModule } from './observability.module.js';

export const ObservabilityModule = createObservabilityModule(
  operationsConfig.METRICS_TOKEN ?? false,
);
```

For local verification, set the `METRICS_TOKEN` and `HEALTH_TOKEN` environment variables before running. This file reads operational credentials only from process input; it does not claim to inherit Chapter 9's .env file merging policy automatically. Do not overwrite the `blogConfig` and `AppSettings` validated in earlier chapters with a new configuration object.

## Observing Scheduled-Job Success and Failure Separately

Scheduled jobs are not HTTP requests, so they can be completely stalled even when the HTTP error rate is low. `src/observability/publishing-metrics.ts` is a **complete file** that exposes this distinction. It separates creating metric names from updating values. Publication scanning and queue dispatch of pending mail have different failure boundaries, so `stage` is limited to two values: `publication_scan` and `email_dispatch`. Post, delivery, and account IDs are not labels.

```typescript
import { Inject } from '@fluojs/core';
import { MetricsService } from '@fluojs/metrics';

@Inject(MetricsService)
export class PublishingMetrics {
  private readonly runs: ReturnType<MetricsService['counter']>;
  private readonly active: ReturnType<MetricsService['gauge']>;
  private readonly duration: ReturnType<MetricsService['histogram']>;

  constructor(metrics: MetricsService) {
    this.runs = metrics.counter({
      name: 'blog_background_runs_total',
      help: 'Completed background stages by outcome',
      labelNames: ['stage', 'outcome'],
    });
    this.active = metrics.gauge({
      name: 'blog_background_active',
      help: 'Background stages active in this process',
      labelNames: ['stage'],
    });
    this.duration = metrics.histogram({
      name: 'blog_background_duration_seconds',
      help: 'Background stage duration in seconds',
      labelNames: ['stage'],
      buckets: [0.01, 0.1, 0.5, 1, 5, 15, 30],
    });
  }

  async observe<T>(
    stage: 'publication_scan' | 'email_dispatch',
    work: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    this.active.inc({ stage });
    try {
      const result = await work();
      this.runs.inc({ stage, outcome: 'success' });
      return result;
    } catch (error: unknown) {
      this.runs.inc({ stage, outcome: 'failure' });
      throw error;
    } finally {
      this.duration.observe({ stage }, (performance.now() - startedAt) / 1000);
      this.active.dec({ stage });
    }
  }
}
```

`MetricsService` is not global. The composition above can resolve it because the module that owns `PublishingMetrics` directly imports `MetricsModule.forRoot`. In contrast, importing MetricsModule in the root app does not make MetricsService visible for direct injection into the sibling PostsModule. Connect the modules by exporting `PublishingMetrics` from the observability module and importing that module into PostsModule.

Creating each collector once in the constructor is also part of the behavior. Calling `metrics.counter` again on every request or tick attempts to register the same name in the same Registry and fails. Store the returned collectors and repeat only `inc`, `observe`, and `dec`. Decrement the active value in `finally` so a failed run is not shown as running forever. Rethrow the failure so instrumentation does not change the original job's error semantics.

Replace the previous chapter's `PublishingSchedule` with the following **complete replacement file**. Keep the path `src/posts/publishing-schedule.ts` and the job name `posts.publish-due`. Retain the existing CronModule, ScheduledPublishingService, and SubscriptionsModule registrations as well. Even if the scan fails, pending mail from earlier publications should still be dispatched, so attempt both stages before returning the failures to Cron.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { PublishingMetrics } from '../observability/publishing-metrics.js';
import { PendingEmailDispatcher } from '../subscriptions/email-jobs.js';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';

@Inject(ScheduledPublishingService, PendingEmailDispatcher, PublishingMetrics)
export class PublishingSchedule {
  constructor(
    private readonly publishing: ScheduledPublishingService,
    private readonly emails: PendingEmailDispatcher,
    private readonly metrics: PublishingMetrics,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'posts.publish-due' })
  async tick(): Promise<void> {
    const failures: unknown[] = [];
    try {
      const published = await this.metrics.observe(
        'publication_scan', () => this.publishing.publishDue(new Date()),
      );
      console.info(JSON.stringify({ event: 'posts.publish_due', published }));
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      const dispatched = await this.metrics.observe(
        'email_dispatch', () => this.emails.dispatchPending(),
      );
      console.info(JSON.stringify({ event: 'posts.email_dispatch', dispatched }));
    } catch (error: unknown) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more background stages failed.');
    }
  }
}
```

The number of successful runs is not the number of posts published. A query that works normally succeeds even when no posts are due. An increase in `blog_background_runs_total{stage="publication_scan",outcome="success"}` therefore does not prove there is no backlog. Expected version races recognized by Chapter 21's scanner are skipped, while propagated errors such as database or unexpected publication failures count as a failure of that stage. A later failure does not cancel posts already committed.

Success for `email_dispatch` means the call that enqueues pending delivery rows completed. It is not a count of SMTP acceptance or inbox arrival. A publication scan may remain a success even if queue dispatch fails; investigate the worker's `rejected` and `uncertain` states separately in Chapter 19's `PostDelivery` ledger. Check publication records and the oldest unprocessed scheduled time as well. Forced process termination may prevent `finally` or the final scrape from running, so do not use in-memory counters as the ledger of record for consistency.

## Changing Callers and Module Visibility Together

Chapters 19 through 21 registered `EmailDispatchSchedule` and `PublishingSchedule` separately. This chapter combines the work so the single tick above attempts pending dispatch after scanning. Accordingly, **remove only the schedule provider from `src/subscriptions/subscriptions.module.ts`**, keeping the dispatcher, worker, subscriptions controller, FormsAuthModule, Redis, Queue, and Email registrations. Do not leave both callers in place and allow overlapping calls to the same dispatcher.

```diff
-import { EmailDispatchSchedule } from './email-dispatch-schedule.js';
@@
-      Subscriptions, PendingEmailDispatcher, PostEmailWorker, EmailDispatchSchedule,
+      Subscriptions, PendingEmailDispatcher, PostEmailWorker,
```

Add the following **singleton registration** after the factory and RecordingEmailTransport declarations in the same file. This relocates the existing root's inline factory call; it is not a second subscription system. Preserve the local Redis address and recording transport, without configuring actual SMTP.

```typescript
export const SubscriptionsModule = createSubscriptionsModule(
  { host: '127.0.0.1', port: 6379 }, new RecordingEmailTransport(),
);
```

In **`src/posts/posts.module.ts`**, add only the two imports and imports entries below. `BlogJobsModule`, the `PostEditingService` exported for pages, the scheduling API, and existing post registrations remain in place. `PendingEmailDispatcher` resolves from SubscriptionsModule's exports and `PublishingMetrics` from ObservabilityModule's exports. Do not replace the entire PostsModule with a new list of classes.

```diff
+import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
+import { ObservabilityModule } from '../observability/blog-observability.module.js';
@@ imports
+    SubscriptionsModule, ObservabilityModule,
```

In **`src/app.ts`**, replace Chapter 19's inline subscription registration with the same identity and add the observability module. Leave all other imports and OpenAPI sources in place. Do not remove `FormsPagesModule`, `createPostsPagesModule` with Chapter 20's cache, Chapter 18's uploads module, or Chapter 21's `PostSchedulePagesModule`.

```diff
-import { createSubscriptionsModule, RecordingEmailTransport } from './subscriptions/subscriptions.module.js';
+import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
+import { ObservabilityModule } from './observability/blog-observability.module.js';
@@ imports
-    createSubscriptionsModule({ host: '127.0.0.1', port: 6379 }, new RecordingEmailTransport()),
+    SubscriptionsModule, ObservabilityModule,
```

`BlogJobsModule` remains the only Cron registration. After this change, the registered job name is `posts.publish-due`; the former `subscriptions.dispatch-pending` job is no longer discovered among the providers. Delivery records and the `blog-post-email-v1` queue job identity do not change. Known permanent domain rejections are isolated in Chapter 21's `scheduleFailure`, so a successful scan may still include such candidates. Do not interpret losing a race, permanent rejection, and infrastructure failure as the same failure counter.

## Verifying Both Stages Through the Actual Cron Callback

The following **complete `src/observability/background-stages.spec.ts`** uses the actual PublishingSchedule, PublishingMetrics, and Cron registration. Only the database and Queue are replaced at the call seams; this does not prove publication atomicity or actual Redis delivery. A manual scheduler captures the callback, allowing the registered job itself to run without a 30-second wait.

```typescript
import { Module } from '@fluojs/core';
import { CronModule, type CronScheduler } from '@fluojs/cron';
import { createTestApp } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { PublishingSchedule } from '../posts/publishing-schedule.js';
import { ScheduledPublishingService } from '../posts/scheduled-publishing.service.js';
import { PendingEmailDispatcher } from '../subscriptions/email-jobs.js';
import { createObservabilityModule } from './observability.module.js';

for (const failure of ['none', 'publication_scan', 'email_dispatch'] as const) {
  it(`runs both scheduled stages when failure is ${failure}`, async () => {
    const callbacks: Array<() => Promise<void>> = [];
    const calls: string[] = [];
    const scheduler: CronScheduler = (_expression, _options, callback) => {
      callbacks.push(callback);
      return { stop() {} };
    };
    @Module({
      imports: [
        CronModule.forRoot({ scheduler }),
        createObservabilityModule('stage-test-token'),
      ],
      providers: [
        PublishingSchedule,
        {
          provide: ScheduledPublishingService,
          useValue: {
            async publishDue() {
              calls.push('publication_scan');
              if (failure === 'publication_scan') throw new Error('Database unavailable.');
              return 1;
            },
          },
        },
        {
          provide: PendingEmailDispatcher,
          useValue: {
            async dispatchPending() {
              calls.push('email_dispatch');
              if (failure === 'email_dispatch') throw new Error('Queue unavailable.');
              return 2;
            },
          },
        },
      ],
    })
    class StageProbeModule {}

    const app = await createTestApp({ rootModule: StageProbeModule });
    try {
      expect(callbacks).toHaveLength(1);
      const tick = callbacks[0];
      if (!tick) throw new Error('Publishing callback was not registered.');
      await tick();
      expect(calls).toEqual(['publication_scan', 'email_dispatch']);
      const scrape = await app.request('GET', '/internal/metrics')
        .header('x-metrics-token', 'stage-test-token').send();
      expect(scrape.status).toBe(200);
      for (const stage of ['publication_scan', 'email_dispatch'] as const) {
        const outcome = failure === stage ? 'failure' : 'success';
        expect(scrape.body).toEqual(expect.stringContaining(
          `blog_background_runs_total{stage="${stage}",outcome="${outcome}"} 1`,
        ));
        expect(scrape.body).toEqual(expect.stringContaining(
          `blog_background_active{stage="${stage}"} 0`,
        ));
      }
    } finally {
      await app.close();
    }
  }, 5_000);
}
```

Cron's callback passes job exceptions to logging and the error hook, then performs disposal. Even in failure cases, the test therefore checks each stage's failure time series and execution of the other stage rather than expecting the callback Promise to reject. The final five seconds are an upper bound that prevents a broken implementation from holding the test indefinitely. Verify the batch's classification of actual database failures and permanent rejections separately with Chapter 21's PostgreSQL tests.

## Connecting the Beginning and End of a Request

Once metrics reveal rising latency for HTML reads at `/posts/:id/read` or JSON reads at `/posts/:id`, the next question is, "Which request was it?" `createAccessLogObserver` from `@fluojs/http` creates a start record, dispatch-error records, and a final end record. The end record includes `durationMs`, the final status, and `outcome`. The values `success`, `handled_error`, `unhandled_error`, `not_found`, and `aborted` classify observed dispatch outcomes; they do not automatically determine success at the product level.

The following is the **complete `src/observability/access-log.ts`**. The example sink uses only local stdout. When no route matched, it replaces the path with a fixed string so slugs in raw paths or accidentally received sensitive paths are not stored verbatim. Incident investigations that need raw paths require a separate, limited retention policy, not indiscriminate storage of every request detail in the default log.

```typescript
import { createAccessLogObserver } from '@fluojs/http';

export const blogAccessObserver = createAccessLogObserver({
  headers: {
    allow: ['x-request-id'],
    redact: ['x-metrics-token', 'x-health-token'],
  },
  sink: {
    emit(event) {
      console.info(JSON.stringify({
        ...event,
        path: event.matchedRoute ?? '/unmatched',
      }));
    },
  },
});
```

Generating a request ID is a separate responsibility from the observer. Merge the following **partial options implementation** into the existing Fastify run options in `src/main.ts`. `AppModule` is the application in `src/app.ts` that combines the existing accounts, posts, and observability modules. This block does not replace that application's other settings or registrations.

```typescript
import { ensureMetadataSymbol } from '@fluojs/core';
import { createCorrelationMiddleware } from '@fluojs/http';
import { runFastifyApplication } from '@fluojs/platform-fastify';

ensureMetadataSymbol();
const { AppModule } = await import('./app.js');
const { blogConfig } = await import('./config/app-settings.module.js');
const { blogAccessObserver } = await import('./observability/access-log.js');

await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  port: blogConfig.PORT,
  maxBodySize: 6 * 1024 * 1024,
  multipart: {
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 1,
    maxTotalSize: 6 * 1024 * 1024,
  },
  middleware: [createCorrelationMiddleware()],
  observers: [blogAccessObserver],
});
```

Correlation middleware adopts an incoming `x-request-id` or the older `x-correlation-id`; if neither exists, it generates an ID before the start record. The same ID is carried into the response header. This ID is for finding correlations, not an authenticated user identifier or proof of global uniqueness. Do not substitute a customer-supplied ID for authorization or an idempotency key.

The default header allowlist is empty. Sensitive headers such as `authorization`, `cookie`, and `set-cookie` remain redacted even if added to the allowlist. This example does not log request bodies, passwords, or raw JWTs. It also omits `clientIdentity` because the client IP is unnecessary. Blindly trusting proxy headers to record an IP lets an attacker change the address in operational records. Configure an exact trusted-proxy range only when an address is actually needed.

An observer's sink may await asynchronous completion. Awaiting delivery to an external log server on every request adds the logging system's latency to the request lifetime. This example's stdout is not an unlimited store either. The operating host must own collection, retention, and capacity policies; if an external sink is introduced, verify its bounded buffer and failure policy separately. Using structured logs must not make the business response depend on successful log delivery.

## Reading Metrics at the Actual Request Boundary

The following `src/observability/observability.spec.ts` is a **complete local request experiment file**. Both post paths and access denials pass through actual virtual HTTP dispatch. This is not a test that merely increments a collector directly and reads its value, so it fails if HTTP instrumentation registration is missing or endpoint middleware is incorrectly applied to the whole app.

```typescript
import { Module } from '@fluojs/core';
import { Controller, Get, NotFoundException } from '@fluojs/http';
import { createTestApp } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { createObservabilityModule } from './observability.module.js';

it('groups post paths and keeps scrape access separate', async () => {
  @Controller('/posts')
  class ReadProbeController {
    @Get('/:id')
    read() {
      return { title: 'Hello, Fluo!' };
    }

    @Get('/:id/read')
    readPage() {
      return '<article>Hello, Fluo!</article>';
    }
  }

  @Controller('/failure')
  class FailureProbeController {
    @Get('/')
    fail() {
      throw new NotFoundException('Post not found.');
    }
  }

  @Module({
    imports: [createObservabilityModule('local-probe-token')],
    controllers: [ReadProbeController, FailureProbeController],
  })
  class ProbeModule {}

  const app = await createTestApp({ rootModule: ProbeModule });
  try {
    expect((await app.request('GET', '/posts/1').send()).status).toBe(200);
    expect((await app.request('GET', '/posts/2').send()).status).toBe(200);
    expect((await app.request('GET', '/posts/1/read').send()).status).toBe(200);
    expect((await app.request('GET', '/posts/2/read').send()).status).toBe(200);
    expect((await app.request('GET', '/not-a-route').send()).status).toBe(404);
    expect((await app.request('GET', '/failure').send()).status).toBe(404);
    expect((await app.request('GET', '/internal/metrics').send()).status).toBe(403);

    const scrape = await app.request('GET', '/internal/metrics')
      .header('x-metrics-token', 'local-probe-token')
      .send();
    expect(scrape.status).toBe(200);
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="/posts/:id",status="200"} 2',
    ));
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="/posts/:id/read",status="200"} 2',
    ));
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="UNKNOWN",status="404"} 1',
    ));
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_errors_total{method="GET",path="/internal/metrics",status="403"} 1',
    ));
    expect(scrape.body).not.toEqual(expect.stringContaining('path="/posts/1"'));
    expect(scrape.body).not.toEqual(expect.stringContaining('path="/posts/2"'));
    expect(scrape.body).not.toEqual(expect.stringContaining('path="/posts/1/read"'));
    expect(scrape.body).not.toEqual(expect.stringContaining('path="/posts/2/read"'));
    expect(scrape.body).not.toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="UNKNOWN",status="200"}',
    ));
  } finally {
    await app.close();
  }
});
```

The current scrape request itself completes after the collector serializes its results. Do not assert that "this scrape must already be included in the request count." Compare only requests that have already completed. Each test's new app owns a default isolated Registry, preventing earlier tests' counters from leaking in. If you share `METRICS_REGISTRY` as a bootstrap provider for a specific reason, you are also responsible for isolation in the tests. `/failure` throws a 404 inside a matched handler, creating one sample in the `UNKNOWN` time series. In contrast, the unmatched 404 at `/not-a-route` does not enter this instrumentation middleware and does not increment the counter. Do not generalize this to mean that all 404s are counted. The two HTML paths are label tests using small responses instead of the actual React renderer; Chapter 24 checks the assembled SSR path.

For a request-ID experiment, replace the `createAccessLogObserver` sink with an array collector and pass a function returning manually controlled numbers as `clock`. Set the start time to 100 and change it to 350 before the handler finishes; the expected `durationMs` in the end record is 250. Attach the same middleware and observer to an error route to check that the start, error, and end records have the same ID and there is only one end record. There is no need to wait a real 250 milliseconds. This verifies the clock-calculation contract, not network performance.

During the manuscript's integration review, the code blocks above were transformed as TypeScript in memory and connected to existing package artifacts. The JSON/HTML label request test and the three actual Cron callback cases--normal execution, database-call failure, and Queue-call failure--passed. The database and Queue calls used test doubles; this was not verification of actual publication, Redis, or SMTP. The reader application's Node24/Vitest command was not run, so after assembling the files, verify them again with `pnpm exec vitest run src/observability/observability.spec.ts src/observability/background-stages.spec.ts`. Content type, access policy, and transfer time on the actual listener need separate checks.

## The Order of Questions That Explain an Incident

The following operational PromQL statements are **example queries**. Prometheus must be separately configured to scrape this endpoint. The first query gives per-path p95 for JSON detail and HTML reads; the second gives the server-error ratio for each of those same paths. The regular expression selects only the two fixed labels, and `path` remains an aggregation key so SSR and JSON are not mixed.

```promql
histogram_quantile(
  0.95,
  sum by (path, le) (
    rate(http_request_duration_seconds_bucket{method="GET",path=~"/posts/:id(/read)?"}[5m])
  )
)
```

```promql
sum by (path) (rate(http_requests_total{method="GET",path=~"/posts/:id(/read)?",status=~"5.."}[5m]))
/
sum by (path) (rate(http_requests_total{method="GET",path=~"/posts/:id(/read)?"}[5m]))
```

An interval with no denominator is not evidence of a zero error rate. There may have been no requests, or collection may have stopped. p95 is estimated from histogram buckets; do not simply average the p95 values of individual instances. When comparing before and after deployment, also check that request volume, cache warmth, and content size are comparable. A lower number alone does not prove the change caused it.

Return to the opening incident. If only detail-read latency has risen and 5xx responses have not increased, find the end records of slow requests instead of restarting the server unconditionally. If scheduled-job execution time increased at the same time, database contention becomes a hypothesis, not yet a conclusion. Inspect query scope and connection-pool state, and compare before and after job execution with the same content and cache conditions. Conversely, if publication records are correct but only the list is stale, separate that as a cache visibility issue.

Observability code does not need to know every product detail. Creating labels for each post or switching every service to a tracing system at once increases costs first. What we need now is bounded path aggregation, correlation for an individual request, and execution signals for scheduled jobs. Add further instrumentation when a specific incident arises that these three cannot explain.

FluoBlog is now ready to explain its state after a slowdown or failure. But what about requests arriving during deployment? A live process may not yet have its database connection ready, or may already have begun disposal. The next chapter connects observed state to the decision to admit traffic and designs startup and shutdown as part of service behavior.

## Implementation References

- [Metrics registration, Registry ownership, and endpoint protection contracts](../../packages/metrics/README.md)
- [HTTP collector implementation for labels, errors, and measurement intervals](../../packages/metrics/src/http-metrics-middleware.ts)
- [Custom collector creation API](../../packages/metrics/src/metrics-service.ts)
- [Scrape and access-failure tests through actual requests](../../packages/metrics/src/metrics-module.request.test.ts)
- [HTTP observation and correlation contracts](../../packages/http/README.md)
- [AccessLogEvent and observer implementation](../../packages/http/src/access-log-observer.ts)
- [Tests for correlation, end outcomes, and awaiting sinks](../../packages/http/src/access-log-observer.test.ts)
