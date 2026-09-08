# The First Release and Operational Retrospective

<!-- book:volume=01-fluoblog;chapter=24 -->

[Previous: Designing Startup and Shutdown](./ch23-lifecycle-and-readiness.md) - [Volume 1 Contents](./toc.md) - [Next Volume: Adding a Shop to the Existing Blog](../02-fluoshop/ch01-grow-the-blog.md)

The operator has now built much more than "a server that returns one post." Authors log in with their accounts to edit drafts, publish reviewed posts, or schedule a publication time. Readers read public posts and subscribe to new-post notifications. The cache reduces the load of reading popular posts, while metrics and request records show where responses are slow. There are also boundaries for starting and stopping instances during deployment.

The first release is not a declaration that every feature is perfect. It is a decision to open a version to real readers after checking which user journeys it provides, which failures it detects, and how far it can recover when something fails. Rather than adding many new framework features, this chapter combines the promises of earlier chapters into a release criterion. In particular, facts proven by tests and operational assumptions not yet verified do not belong in the same column.

The "first week" incidents below are fictional scenarios for explaining the retrospective method. No actual service was deployed and no email was sent to readers while writing this manuscript. Nor does this mean the repository already contains a single complete app implementing all 24 chapters. The release candidate is the result of readers integrating the earlier partial implementations into their own `fluo-blog`; `examples/fluo-blog` is a smaller path for checking the initial HTTP and DI behavior.

## Defining Release Scope in the User's Words

Posts are the center of the first release. The public list and detail reads show only published posts. Authors edit only their own drafts, and published content is immutable. Keep the contract that post IDs are positive integers while account IDs and `authorId` are strings. Do not decide ownership from an `authorId` in an edit request or the display name on the login screen. The verified JWT subject carries the same account identity into the next volume.

Checking this promise only through HTTP status codes leaves gaps. Returning 403 for an attempt to edit another author's draft is not safe if the content changes internally. Returning 409 for editing a published post still breaks immutability if `version` or `publishedAt` changes. Failure-response checks must therefore compare data before and after the request. Check not only that the content is unchanged, but also that the version, scheduled time, and number of publication records are preserved.

Successful scheduled publication is not merely "the Cron callback ran." A draft must not become public before its due time; after that time, only one valid version may be published, and reruns or restarts must not duplicate publication records. With a cache, explain the gap between database publication and the reader seeing the new list as part of the product's delay budget. Subscription notifications have delivery states separate from publication. Do not cancel public state because notification delivery fails, or declare every recipient's delivery successful because publication succeeded.

This is where the temptation to keep adding features appears. Recommendation algorithms, CDNs in every region, and real-time collaborative editing may be useful, but they are not needed to prove the current promise. Narrowing release scope does not mean ignoring failure; it means making time to follow through on the failures of the features actually offered.

## Organizing Tests Without Mixing Types of Evidence

Domain tests quickly check the rules for moving from draft to published and for version conflicts. Database integration tests verify conditional updates and transaction rollback in actual PostgreSQL. Request tests check that authentication, authorization, validation, and response transformation work together in the HTTP pipeline. Finally, tests using a real Fastify listener check host boundaries: ports, headers, shutdown signals, and response transfer.

`createTestApp` from `@fluojs/testing` is the default tool for the third boundary. Because `request(...).send()` executes runtime dispatch and request-scoped DI, it provides stronger evidence than calling a controller method directly. It does not, however, automatically create a real TCP connection or PostgreSQL instance. When a test double is injected, record that systems beyond it were not verified.

Choose `createTestingModule` when the subject is DI visibility or provider replacement. Replace external boundaries with `overrideProvider` or `overrideModule` before `.compile()`, and explicitly specify the root module actually used. Bootstrap and lifecycle hooks also run, so dispose of the container at the end of the test. Making test cleanup optional allows the next test to pass or fail because of a previous connection or timer.

Avoid copying the same test at every level. A request test need not enumerate dozens of date strings again, but it should verify that validation failure maps to 400 and never reaches the service's write path. Also avoid replacing database tests with updates to an in-memory array and labeling them "safe for concurrent publication." Obtain evidence about real concurrency at the real storage boundary.

## Bringing Operational Boundaries Together in One Request Test

Now combine Chapter 22's observability module with Chapter 23's traffic gate. The following `src/operations/release-boundary.spec.ts` is a **complete local test file**. It requires the `createObservabilityModule`, `TrafficGate`, `TrafficIndicator`, and `TrafficMiddleware` files from the previous chapters and the Vitest configuration for standard decorators.

This is a narrow integration test of the operational composition, not an acceptance test of the entire posts application. `ReadProbeController` uses manual signals instead of a database to control completion. The optional Terminus diagnostic is a state test double that does not call a real email system. The gate, middleware, endpoint registration, Registry, and request dispatch, in contrast, use actual code. This lets the test catch regressions where traffic blocking is not connected to readiness or internal endpoints are blocked as well.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { createTestApp } from '@fluojs/testing';
import { TerminusModule } from '@fluojs/terminus';
import { expect, it } from 'vitest';
import { createObservabilityModule } from '../observability/observability.module.js';
import {
  TrafficGate,
  TrafficIndicator,
  TrafficMiddleware,
} from './traffic.js';

it('keeps diagnostics available while admitted work drains', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const gate = new TrafficGate();
  const READ_POST = Symbol('release.read-post');
  let reads = 0;

  interface PublicPost {
    id: number;
    title: string;
    content: string;
    slug: string;
  }
  type ReadPost = () => Promise<PublicPost>;

  @Module({
    providers: [{ provide: TrafficGate, useValue: gate }],
    exports: [TrafficGate],
  })
  class TestTrafficModule {}

  @Controller('/posts')
  @Inject(READ_POST)
  class ReadProbeController {
    constructor(private readonly readPost: ReadPost) {}

    @Get('/:id/read')
    async read(): Promise<PublicPost> {
      return this.readPost();
    }
  }

  @Module({
    imports: [
      TestTrafficModule,
      createObservabilityModule('local-release-token'),
      TerminusModule.forRoot({
        path: '/internal',
        imports: [TestTrafficModule],
        indicatorProviders: [TrafficIndicator],
        indicators: [{
          key: 'notification-history',
          readiness: false,
          async check(key) {
            return { [key]: { status: 'down' } };
          },
        }],
      }),
    ],
    controllers: [ReadProbeController],
    providers: [
      TrafficMiddleware,
      {
        provide: READ_POST,
        useValue: async (): Promise<PublicPost> => {
          reads += 1;
          entered.resolve();
          await release.promise;
          return {
            id: 1,
            title: 'Hello, Fluo!',
            content: 'My first post.',
            slug: 'hello-fluo',
          };
        },
      },
    ],
  })
  class ReleaseProbeModule {}

  const app = await createTestApp({
    rootModule: ReleaseProbeModule,
    middleware: [TrafficMiddleware],
  });
  let first: ReturnType<ReturnType<typeof app.request>['send']> | undefined;
  try {
    expect((await app.request('GET', '/internal/health').send()).status).toBe(503);
    expect((await app.request('GET', '/internal/ready').send()).status).toBe(200);

    first = app.request('GET', '/posts/1/read').send();
    await Promise.race([
      entered.promise,
      first.then(() => { throw new Error('Read finished before reaching its handler.'); }),
    ]);
    gate.stopAccepting();

    const readiness = await app.request('GET', '/internal/ready').send();
    expect(readiness.status).toBe(503);
    expect(readiness.body).toEqual({ status: 'unavailable' });
    expect((await app.request('GET', '/posts/2/read').send()).status).toBe(503);
    expect(reads).toBe(1);

    release.resolve();
    expect((await first).status).toBe(200);
    await gate.waitForIdle();

    expect((await app.request('GET', '/internal/metrics').send()).status).toBe(403);
    const scrape = await app.request('GET', '/internal/metrics')
      .header('x-metrics-token', 'local-release-token')
      .send();
    expect(scrape.status).toBe(200);
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="/posts/:id/read",status="200"} 1',
    ));
  } finally {
    release.resolve();
    try {
      await first;
    } finally {
      await app.close();
    }
  }
}, 5_000);
```

The initial `/health = 503` and `/ready = 200` are not contradictory. Only the optional diagnostic registered in the test is down, while the gate is open. To permit the same distinction in production, the features that continue without that dependency must be explicit. Do not use this test double as evidence that the actual subscription queue is optional too.

The second phase prepares for shutdown. Close the gate after receiving the signal that the first request has entered its handler. The test result therefore does not depend on a lucky request execution order. The second request must return 503, and the repository double's call count must not increase. The first request completes normally after receiving the release signal. A readiness state of unavailable does not mean every request already admitted must fail.

The final scrape must remain possible while traffic is blocked. If the gate also blocks the path that shows metrics to operators, the very incident being investigated becomes unobservable. The access policy still applies, however, so a request without a token returns 403. The assertion that one successful post request is recorded under the template label is evidence that MetricsModule is connected to the same HTTP pipeline. Check only the required machine-consumed time series, without pinning the complete metrics string or help text.

This test closes the app after releasing the in-flight request. Even if assertions fail, `finally` performs release and close. The shutdown boundary we want to observe in operation also applies to test resources. The test's five-second limit bounds an infinite wait caused by an error; it is not a condition that succeeds after waiting five seconds.

## An Acceptance Fixture That Opens the Actual AppModule

The ReadProbeController above verifies only the operational boundary. The following **complete `test/release-app.spec.ts`** imports the actual `src/app.ts` assembled from Chapters 9 through 23 and opens a Fastify listener. It does not redefine AccountsModule or PostsModule for testing. Chapter 17's FormsAuthModule and FormsPagesModule, Chapter 18's uploads, Chapter 19's SubscriptionsModule, Chapter 20's reading cache, Chapter 21's scheduling API, and Chapters 22 and 23's observability and operations registrations must all remain in that graph.

Before running, prepare a migrated **empty, dedicated PostgreSQL database**, an **isolated practice Redis instance** at local `127.0.0.1:6379`, and the RecordingEmailTransport retained in Chapter 22. Do not run this test in an app that has been switched to a real SMTP transport. Set the existing `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_ORIGIN`, and `PORT` according to the validation contracts in Chapters 9, 14, and 17, and supply non-empty test values for the optional `METRICS_TOKEN` and `HEALTH_TOKEN` as well. If `NODE_ENV=production`, provide all existing required configuration through process input instead of file input. The fixture leaves accounts, posts, attachments, and unconfirmed subscriptions in the dedicated database for inspection; it does not delete production data.

```typescript
import { randomUUID } from 'node:crypto';
import { ensureMetadataSymbol } from '@fluojs/core';
import { createCorrelationMiddleware } from '@fluojs/http';
import { bootstrapFastifyApplication } from '@fluojs/platform-fastify';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { z } from 'zod';

it('keeps auth, uploads, subscriptions and operations in the assembled app', async () => {
  ensureMetadataSymbol();
  const { AppModule } = await import('../src/app.js');
  const { blogConfig } = await import('../src/config/app-settings.module.js');
  const { operationsConfig } = await import('../src/config/operations-config.js');
  const { blogAccessObserver } = await import('../src/observability/access-log.js');
  const { TrafficGate, TrafficMiddleware } = await import('../src/operations/traffic.js');
  const { FORM_COOKIE_NAME } = await import('../src/auth/forms-auth.module.js');
  const metricsToken = operationsConfig.METRICS_TOKEN;
  const healthToken = operationsConfig.HEALTH_TOKEN;
  if (!metricsToken || !healthToken) throw new Error('Set both test operations tokens.');

  const listening = Promise.withResolvers<string>();
  const app = await bootstrapFastifyApplication(AppModule, {
    host: '127.0.0.1', port: 0,
    maxBodySize: 6 * 1024 * 1024,
    multipart: {
      maxFileSize: 5 * 1024 * 1024, maxFiles: 1, maxTotalSize: 6 * 1024 * 1024,
    },
    shutdownTimeoutMs: 5_000,
    middleware: [createCorrelationMiddleware(), TrafficMiddleware],
    observers: [blogAccessObserver],
    configureFastify(server) {
      server.addHook('onListen', async () => {
        const address = server.server.address();
        if (!address || typeof address === 'string') {
          listening.reject(new Error('Expected a TCP listen address.'));
          return;
        }
        listening.resolve(`http://127.0.0.1:${address.port}`);
      });
    },
  });
  try {
    await app.listen();
    const base = await listening.promise;
    const prisma = await app.get<PrismaService<PrismaClient>>(PrismaService);
    const gate = await app.get(TrafficGate);
    async function request(path: string, init: RequestInit = {}) {
      const response = await fetch(new URL(path, base), {
        ...init, redirect: 'manual', signal: AbortSignal.timeout(5_000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      const body: unknown = response.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(text) : text;
      return { status: response.status, headers: response.headers, body, bytes };
    }
    function form(fields: Record<string, string>): FormData {
      const data = new FormData();
      for (const [key, value] of Object.entries(fields)) data.set(key, value);
      return data;
    }

    const suffix = randomUUID();
    const credentials = { email: `writer-${suffix}@example.test`, password: 'test-only-long-password' };
    const register = await request('/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...credentials, displayName: 'Release fixture' }),
    });
    expect(register.status).toBe(201);
    const login = await request('/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    expect(login.status).toBe(200);
    const session = z.object({
      accessToken: z.string().min(1), user: z.object({ id: z.string().min(1) }),
    }).parse(login.body);
    const apiHeaders = {
      'content-type': 'application/json', authorization: `Bearer ${session.accessToken}`,
    };
    const browserLogin = await request('/auth/forms/login', {
      method: 'POST', headers: { origin: blogConfig.PUBLIC_ORIGIN },
      body: form({ ...credentials, next: '/posts' }),
    });
    expect(browserLogin.status).toBe(303);
    const cookie = browserLogin.headers.getSetCookie()
      .find((value) => value.startsWith(`${FORM_COOKIE_NAME}=`))?.split(';')[0];
    if (!cookie) throw new Error('The form login did not issue its access cookie.');
    const formHeaders = { cookie, origin: blogConfig.PUBLIC_ORIGIN };

    const created = await request('/posts', {
      method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ title: '', content: '', slug: '' }),
    });
    expect(created.status).toBe(201);
    const draft = z.object({ id: z.number().int().positive(), version: z.literal(1) }).parse(created.body);
    const postPath = `/posts/${draft.id}`;
    expect((await request(`${postPath}/read`)).status).toBe(404);
    expect((await request(`${postPath}/edit`)).status).toBe(401);
    expect((await request(`${postPath}/edit`, { headers: { cookie } })).status).toBe(200);

    const text = { title: 'Release fixture post', content: 'Preserve every registered feature.', slug: `release-${suffix}` };
    expect((await request(`${postPath}/edit`, {
      method: 'POST', headers: formHeaders, body: form({ ...text, version: '1' }),
    })).status).toBe(303);
    const upload = form({ kind: 'attachment', version: '2' });
    upload.set('file', new Blob([new Uint8Array([1, 2, 3])]), 'fixture.bin');
    expect((await request(`${postPath}/assets`, {
      method: 'POST', headers: formHeaders, body: upload,
    })).status).toBe(303);
    const asset = await prisma.current().postAsset.findFirstOrThrow({ where: { postId: draft.id } });
    expect(asset.size).toBe(3);
    const oversized = form({ kind: 'attachment', version: '3' });
    oversized.set('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), 'too-large.bin');
    expect((await request(`${postPath}/assets`, {
      method: 'POST', headers: formHeaders, body: oversized,
    })).status).toBe(413);
    expect((await prisma.current().post.findUniqueOrThrow({ where: { id: draft.id } })).version).toBe(3);

    expect((await request('/subscriptions', { headers: { cookie } })).status).toBe(200);
    expect((await request('/subscriptions/request', {
      method: 'POST', headers: formHeaders, body: form({ address: credentials.email }),
    })).status).toBe(303);
    const subscription = await prisma.current().subscription.findUniqueOrThrow({ where: { userId: session.user.id } });
    expect(subscription.active).toBe(false);
    expect(subscription.address).toBe(credentials.email);

    expect((await request(`${postPath}/publish`, {
      method: 'POST', headers: apiHeaders, body: JSON.stringify({ expectedVersion: 3 }),
    })).status).toBe(200);
    const published = await prisma.current().post.findUniqueOrThrow({ where: { id: draft.id } });
    expect(published.version).toBe(4);
    const publication = await prisma.current().postPublication.findUniqueOrThrow({ where: { postId: draft.id } });
    expect(publication.actorId).toBe(session.user.id);
    expect(publication.version).toBe(4);
    expect((await request(`${postPath}/publish`, {
      method: 'POST', headers: apiHeaders, body: JSON.stringify({ expectedVersion: 4 }),
    })).status).toBe(409);
    expect(await prisma.current().postPublication.count({ where: { postId: draft.id } })).toBe(1);
    expect((await request(postPath)).status).toBe(200);
    const page = await request(`${postPath}/read`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.body).toEqual(expect.stringContaining(text.title));
    const download = await request(`${postPath}/assets/${asset.id}`);
    expect(download.status).toBe(200);
    expect([...download.bytes]).toEqual([1, 2, 3]);
    expect((await request(postPath, {
      method: 'PUT', headers: apiHeaders, body: JSON.stringify({ ...text, title: 'Changed', expectedVersion: 4 }),
    })).status).toBe(409);
    expect(await prisma.current().post.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(published);

    expect((await request('/internal/health')).status).toBe(403);
    expect((await request('/internal/health', { headers: { 'x-health-token': healthToken } })).status).toBe(200);
    expect((await request('/internal/ready')).status).toBe(403);
    expect((await request('/internal/ready', { headers: { 'x-health-token': healthToken } })).status).toBe(200);
    gate.stopAccepting();
    expect((await request(postPath)).status).toBe(503);
    expect((await request('/internal/ready', { headers: { 'x-health-token': healthToken } })).status).toBe(503);
    expect((await request('/internal/metrics')).status).toBe(403);
    const scrape = await request('/internal/metrics', { headers: { 'x-metrics-token': metricsToken } });
    expect(scrape.status).toBe(200);
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="/posts/:id/read",status="200"} 1',
    ));
    await gate.waitForIdle();
  } finally {
    await app.close('release-fixture');
  }
}, 30_000);
```

The fixture's port 0 is a test setting that lets the OS choose an available port, avoiding conflicts with development servers running in parallel. It does not change the host or `blogConfig.PORT` in Chapter 23's production entry point. The test sends cookies and `Origin` directly to verify server policy; it does not prove a browser's Secure or SameSite transmission behavior. All response bytes are read before assertions, so this fixture's close is not a test of "safe shutdown of an in-flight SSR stream" either. Verify that shutdown boundary separately through the manual-signal test above and an actual signal experiment.

The subscription request's 303 and unconfirmed row show that the subscription routes, service, and recording transport remain present. They do not prove end-to-end verification of the confirmation code, worker, or SMTP acceptance. This fixture creates neither scheduled candidates nor active subscribers, so its results must not depend on when Cron happens to tick. Separate scheduling and email tests use Chapter 21 and 22's explicit times and callback seams. Without the empty, dedicated database prerequisite, pending work from previous runs can become mixed in.

```bash
pnpm exec vitest run test/release-app.spec.ts --maxWorkers=1
```

## Completing Acceptance Tests with Real Data and Users

Passing the operational test above does not automatically approve a release. In your own app, separately run request tests that include the actual AccountsModule and PostsModule. Create two accounts and two drafts, and send requests through each account's verified authentication path. `.principal(...)` is useful for narrow authorization-boundary tests, but it is not evidence that signature verification ran. At least one test must also pass through login and JWT verification.

Rejecting edits to published posts is a particularly important cross-feature check. Using the author's own valid authentication, send a new title and the current version to the existing edit endpoint and check for 409. Then compare the title, content, slug, `version`, and `publishedAt` in the database and public detail read to confirm they are unchanged. For the same request from another author, check whether the authorization boundary's 403 takes precedence according to your API contract. Check 404 for missing posts and 401 for unauthenticated requests under that contract as well. Record the order in which failure statuses are selected in the test names and API documentation.

The test for editing a scheduled draft is slightly different. An edit with the correct author and version may succeed because the post is still a draft, but the same change must cancel its schedule. Running the publication job after the scheduled time must then not make the edited post public automatically. It can be published only after the author schedules the new content again. Without this connection, authorization and Cron tests may each pass while the product's approval rule is broken.

Connect duplicate requests and failures to user journeys too. Let two instances read the same scheduled candidate and check that only one publication record exists. If publication-record insertion fails, public state must roll back. Even while the cache returns a stale list, detail reads must not expose private drafts. Record subscription jobs' external delivery through a test double and verify the duplicate-processing policy for the same delivery key. Do not send to actual reader addresses during testing.

These tests need dedicated PostgreSQL and, when the feature uses it, dedicated Redis. Do not copy production connection strings for testing. Record results from test doubles separately from results obtained with the real database. Do not mark an item whose environment is not yet available as passed because "the code looks fine." If the feature is part of this release, collect the evidence before deciding to ship it.

## Building the Deployment Artifact Is Part of the Product

Verify and deploy the same build artifact, not merely the source. Record Node.js 24 and pnpm 10, the lockfile, the actual generated Prisma client, and the startup entry point together. Run the artifact corresponding to `src/main.ts` from the actual production build so decorators transformed internally by the development server in a test environment are not left untransformed in production. A supported range of `>=24.0.0 <27` is not a reason to change this book's execution baseline to a different Node version each time.

Deploying the app and releasing Fluo packages to npm are separate tasks. This chapter prepares the reader's application for operation; it is not a procedure for locally publishing `@fluojs/*`. Package versions and releases follow the repository's Changesets and GitHub Actions policy. Starting to operate an app does not require republishing the framework packages.

Consider database changes separately from starting the new app. If old and new code may briefly coexist, check what the added nullable schedule fields and publication records mean to each version. Expanding the schema, letting the new code use it, and removing obsolete structures later is easier to reverse than renaming a column in one step. Do not assume a command that rolls back a database migration restores user data.

A backup file's existence is not enough either. Restore it to a database separate from production, then check the relationships among posts, accounts, and publication records, along with actual reads. Document the point in time to which recovery is possible, where to check changes that arrive during recovery, and what to reprocess if subscription delivery history and database state disagree. The first day of an outage should not be the first time the restore procedure's commands are run.

For the first release on a single instance, announcing a brief outage and replacing it with the verified artifact is a realistic option. With multiple instances, verify the new instance's readiness before moving traffic, and dispose of the old instance using Chapter 23's gate and shutdown order. This manuscript does not perform actual traffic switching or infrastructure changes. Whichever approach is chosen, check public reads, authentication failures, internal endpoint access, and requests during shutdown on the actual listener.

## Interpreting the First Week's Numbers and Setting Stop Criteria

Before release, retain a baseline interval for comparison. With the same data size and request shape, record detail-read latency, server-error ratio, scheduled-job duration, and the number of overdue scheduled posts. Early samples are small, so explaining which user inconvenience to detect matters more than setting a goal such as "a p95 below this value means we are safe forever." If public reads use a 300-millisecond boundary, align it with Chapter 22's histogram buckets.

Incident-response criteria connect observations to actions. For example, if 5xx responses on the same route keep increasing in the new version but cannot be reproduced in the old version, stop expanding traffic to the new version and investigate. If every instance is unavailable because of the same database error, do not repeatedly restart apps without a reason. First separate why readiness fell from the database's own condition. A rollback has different effects depending on whether the problem belongs to a particular version or a shared dependency.

Again, successful scraping is not business success. `/internal/metrics` may return 200 even if the scheduled job has never run. A job counter can increase while an old scheduled candidate remains after failing. Even with `/health` at 503, public reads may be normal if only an explicitly optional diagnostic has failed. Metrics, readiness, and persistent records answer different questions; keep them distinct in operational views too.

At minimum, the release record should include the artifact identifier, applied schema changes, test commands actually run and their results, actual listener-check results, remaining limitations, and the artifact to roll back to. A list of commands with blank results is not evidence. If a failed check was rerun, also record what changed and how the result differed. What matters is whether the next operator can reestablish the same facts, not how polished the wording is.

## A Retrospective Attributes Causes to Boundaries, Not People

Consider Monday in the fictional first week. A scheduled post became public in the database at 9:00:18 a.m., but it was briefly absent from one reader's list. The initial response assumed Cron had failed. There was exactly one publication record, and the scheduled job had completed normally. A detail read returned the new post, but the list used the previous cache for the TTL described earlier. The cause was not that "the operator scheduled it incorrectly," but that the promise about publication time had not been communicated separately from list visibility.

Begin the retrospective with what the user saw and the timeline. Then record confirmed facts, keeping unverified hypotheses separate. In this incident, the confirmed facts are the publication record, the detail response, and the cache's remaining lifetime. If no cache-invalidation failure was directly observed, do not assert it as the cause. Normal TTL behavior and a missing dispatch task call for different code changes.

Attach improvements to concrete boundaries too. Product wording can distinguish schedule processing from visibility delay, and an operational read can add the age of the oldest unprocessed schedule. If the invalidation path has a real defect, fix it with a test that reproduces the failure. This one incident does not justify removing every cache or moving all jobs to a new messaging system.

If deployment shutdown exceeds its budget on another day, "increase the timeout" should not be the first conclusion. First separate time spent waiting at the HTTP gate, running Cron jobs, draining database transactions, and closing the adapter. If one long-running job is responsible, consider reducing its batch size. Publication may have committed even when the client received no response, so inspect persistent records before reprocessing. Do not entrust both root-cause analysis and data-recovery decisions to the same single log line.

A retrospective should end with a small change to verify in the next release. Record its owner, completion condition, and verification method. Instead of "improve observability," write something like, "When overdue drafts exist, expose their count and oldest scheduled time in the operational read, and test both an empty result and a backlog of one." The ability to explain behavior accumulated this way becomes the foundation for handling the shop's more complex failures later.

## What Comes After the Blog Succeeds

The first volume ends here, but the product does not. Readers have started enjoying the posts and ask for logo T-shirts and stickers in comments and subscription replies. That demand brings a shop in the next volume. This is not a story about abandoning a failed blog and building an unrelated online store from scratch.

We carry forward the account IDs and JWT subjects, author and reader identities, PostgreSQL and Prisma, configuration and deployment entry points, observability modules, and readiness policies. We do not rebuild AccountsModule or PostsModule. Customer information extends the existing accounts, and the new responsibilities of products, inventory, carts, and orders are added as they become necessary. Initially, we begin as a modular monolith within the same process.

The scheduled-publication lesson that "time is the trigger, and data is the source of truth" leads into work that reconciles incomplete orders. Separating publication records from email delivery helps us understand partial failures across payments, fulfillment, and notifications. Bounded metric labels, request IDs, readiness, and lifecycle boundaries provide the same foundation when sales events bring a surge of traffic. Order and monetary consistency, however, impose stronger requirements than post rules and are designed separately in the next volume.

Completing the first release does not mean implementing future commerce in advance. It means verifying the blog user journeys currently promised, recording the scope of that verification, and being able to turn operational findings into the next change. The next volume begins by adding a small product catalog to this same successful blog.

## Verification Scope and Implementation References

During the manuscript's integration review, the code and public APIs were cross-checked, and six narrow request, Cron, and lifecycle tests passed after code blocks were transformed in memory and connected to existing package artifacts. Global async Prisma registration and the Terminus access boundary were also checked with a driver test double. Strict TypeScript checking of the operational code and narrow tests produced no diagnostics across 17 virtual files, with four external application connection points represented by declaration-only doubles. This was not a typecheck of the complete application including generated Prisma models. The `test/release-app.spec.ts` above and actual PostgreSQL, Redis, SMTP, browser, and SIGTERM tests were not run. The Korean book structure check, `pnpm book:check:ko`, passed all 72 chapters; the full governance and package build suite was not rerun. In the reader application, use `pnpm exec vitest run src/operations/release-boundary.spec.ts test/release-app.spec.ts --maxWorkers=1` to verify both the narrow gate test and the actual assembled-app fixture, supplementing them with separate browser, email, and signal experiments. The fictional release and retrospective in this chapter are not execution results.

- [Official testing tools and request-level test boundaries](../../packages/testing/README.md)
- [createTestApp bootstrap, dispatch, and close implementation](../../packages/testing/src/app.ts)
- [Public types for test apps and provider overrides](../../packages/testing/src/types.ts)
- [Test layers and lifecycle disposal contracts](../../docs/contracts/testing-guide.md)
- [Metrics HTTP, Registry, and platform telemetry contracts](../../packages/metrics/README.md)
- [Request tests for scraping and access denial](../../packages/metrics/src/metrics-module.request.test.ts)
- [Terminus diagnostics and readiness participation contracts](../../packages/terminus/README.md)
- [Indicator results and diagnostic aggregation tests](../../packages/terminus/src/health-check.test.ts)
- [Startup and shutdown order and host ownership](../../docs/architecture/lifecycle-and-shutdown.md)
