# Building Scheduled Publishing and Recurring Jobs

<!-- book:volume=01-fluoblog;chapter=21 -->

[Previous: Serving Popular Posts Quickly](./ch20-caching.md) - [Volume 1 Contents](./toc.md) - [Next: Explaining Slow Requests and Failures](./ch22-observability.md)

A post intended for Monday morning is ready on Sunday night. Rather than log in again at 9 a.m., the operator wants to specify a publication time. FluoBlog already has draft and published states, author permissions, PostgreSQL storage, subscription notifications, and a cache for public reads. Scheduled publishing must not become a second publisher that bypasses these features. What changes is who presses the publish button: a time-based job takes the user's place.

Yet saving a time and setting a timer is not enough. A deployment might restart the process at 8:59 a.m. Two instances might discover the same post, or the author might edit its content after scheduling it. Publication might commit, only for the connection to drop before the job writes its success log. This chapter aims not to "call a function once at an exact instant," but to "eventually make a valid draft whose publication time has passed public through a single state transition."

## The Clock Wakes the Job; the Database Remembers

The smallest attempt is to use `setTimeout` to wait the remaining milliseconds and then publish. But an in-memory timer disappears on restart. Switching to `@Timeout` does not change that. Fluo's `@Timeout(ms)` is a delayed job measured from application startup, not a way to persistently schedule a specific date. Nor is `@Cron` an absolute-time scheduling API that accepts a `Date`. It accepts a string Cron expression.

Keep the authoritative schedule in the database and use Cron as an alarm that periodically checks it. There is no need to replay ticks missed while the job was down. Querying posts where `scheduledAt <= current time` also finds posts that became due during the interruption. In contrast, searching only the current minute with a condition such as `scheduledAt = current minute` can permanently miss a post after even a brief process pause.

The product's promise must fit this structure. This chapter processes up to 100 posts every 30 seconds. Under light load with a healthy database, publication is attempted on the next tick, but that is not a promise that "every reader sees the post at exactly 9:00:00.000 a.m." Execution time, the number of waiting posts, and the public list's cache lifetime add to the actual delay. The reader interface must be able to distinguish the scheduled time from the actual publication time.

Convert input that includes a timezone into a single absolute instant before storing the schedule. For example, `2026-09-14T09:00:00+09:00` and `2026-09-14T00:00:00Z` are the same instant. Reject strings without a timezone, such as `2026-09-14 09:00`, at the request boundary. A recurring job that runs every day at 9 a.m. Seoul time can use `timezone: 'Asia/Seoul'`, but do not create a Cron expression for each post to represent an individual user's scheduled time.

## Rules for Adding a Schedule to a Draft

A post's `status` remains either `draft` or `published`. We do not add a third state called `scheduled`. A scheduled post is still an unpublished draft, with a future time at which publication should be attempted. This distinction lets us retain the public list's existing `status = published` condition and author-only draft reads.

First decide what happens when scheduling and editing conflict. Only a draft with a matching author and current `version` can be scheduled. Its title, content, and slug must satisfy Chapter 5's `publishPost`. Changing or canceling a schedule also increments `version`. Store the version immediately after approval and the approver, and cancel approval in the same transaction as every change to content, slug, cover, or attachments. This prevents content from a version that was not approved from being published under an earlier schedule.

The following is the **field-addition fragment** to merge into `prisma/schema.prisma`. Draft slugs may still duplicate one another; only published slugs are protected by Chapter 10's partial unique index. Keep Chapter 11's `PostPublication(id, postId @unique, actorId, version, publishedAt)` and `Post.publication`, and Chapter 19's `PostPublication.deliveries`. Do not redefine the publication record or introduce a new `Publication` model.

```prisma
// Add inside the existing Post model.
scheduledAt DateTime? @db.Timestamptz(3)
scheduleGeneration String?
scheduledById String?
scheduledVersion Int?
scheduleFailure String?
scheduledBy User? @relation("ScheduleApprover", fields: [scheduledById], references: [id], onDelete: Restrict)
@@index([status, scheduledAt, id])

// Add inside the existing User model.
approvedPostSchedules Post[] @relation("ScheduleApprover")
```

```bash
pnpm exec prisma migrate dev --name add_publication_schedule --create-only
```

Append the following constraint to the generated migration, then apply it. A failed generation is excluded by setting `scheduledAt=null`, while retaining the approver, version, generation, and failure code. Only active schedules require all three values, and the approved version must also equal the current version.

```sql
ALTER TABLE "Post" ADD CONSTRAINT "Post_active_schedule_consistent" CHECK (
  "scheduledAt" IS NULL OR (
    "status" = 'draft' AND "scheduleGeneration" IS NOT NULL
    AND "scheduledById" IS NOT NULL AND "scheduledVersion" IS NOT NULL
    AND "scheduledVersion" = "version" AND "scheduleFailure" IS NULL
  )
);
```

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

`scheduleGeneration` is a new UUID created when a schedule is approved. Even with the same time and author, reapproval after cancellation is a different generation. It is a comparison value that prevents an old worker from erasing a new approval while handling a failure, not a separate post ID. Editing or reapproving after a failure clears the previous failure fields. If long-term audit history is needed, design a separate schedule history table; do not call these current-state fields a permanent audit ledger.

## Adding Schedule Conditions to a Single Publication Transaction

Below is the **complete replacement for `src/posts/publishing.service.ts` at this stage**. It includes the delivery-intent recording added in Chapter 19. The three required arguments, `postId`, `actorId`, and `expectedVersion`, remain unchanged; only scheduled callers add the `schedule` condition. The existing manual API calls the same method without changes. The scheduling service does not write `post.status=published` directly or create a separate publication record.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, Transaction } from '@fluojs/prisma';
import { Prisma, type PostPublication, type PrismaClient } from '@prisma/client';
import { publishPost } from './post.js';
import { toPostSnapshot } from './post-row.js';
import { PostsRepository } from './posts.repository.js';
import { PostPublicationsRepository } from './post-publications.repository.js';
import { recordPublicationDeliveries } from '../subscriptions/record-publication-deliveries.js';

export type PublishCommand = {
  postId: number;
  actorId: string;
  expectedVersion: number;
  schedule?: { generation: string; now: Date };
};
export type PublicationReceipt = { postId: number; version: number; publishedAt: string };
export type PublishRejectionCode = 'not_found' | 'forbidden' | 'conflict' | 'slug_conflict';
export class PublishRejected extends Error {
  constructor(readonly code: PublishRejectionCode) {
    super(code);
    this.name = 'PublishRejected';
  }
}

function receipt(record: PostPublication): PublicationReceipt {
  return { postId: record.postId, version: record.version, publishedAt: record.publishedAt.toISOString() };
}

@Inject(PrismaService, PostsRepository, PostPublicationsRepository)
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly posts: PostsRepository,
    private readonly publications: PostPublicationsRepository,
  ) {}

  @Transaction({ isolationLevel: 'ReadCommitted', timeout: 5000 })
  async publish(command: PublishCommand): Promise<PublicationReceipt> {
    const row = await this.posts.findById(command.postId);
    if (!row) throw new PublishRejected('not_found');
    if (row.authorId !== command.actorId) throw new PublishRejected('forbidden');
    const schedule = command.schedule;
    if (schedule && (
      row.scheduleGeneration !== schedule.generation
      || row.scheduledById !== command.actorId
      || row.scheduledVersion !== command.expectedVersion
      || row.scheduledAt === null || row.scheduledAt > schedule.now
    )) throw new PublishRejected('conflict');
    const next = publishPost(
      toPostSnapshot(row), command.expectedVersion, schedule?.now ?? new Date(),
    );
    const publishedAt = new Date(next.publishedAt);
    try {
      const changed = await this.prisma.current().post.updateMany({
        where: {
          id: row.id, authorId: command.actorId,
          status: 'draft', version: command.expectedVersion,
          ...(schedule ? {
            scheduleGeneration: schedule.generation,
            scheduledById: command.actorId,
            scheduledVersion: command.expectedVersion,
            scheduledAt: { lte: schedule.now },
          } : {}),
        },
        data: {
          status: 'published', publishedAt, version: { increment: 1 },
          scheduledAt: null, scheduleGeneration: null, scheduledById: null,
          scheduledVersion: null, scheduleFailure: null,
        },
      });
      if (changed.count !== 1) throw new PublishRejected('conflict');
    } catch (error: unknown) {
      // Only this update can violate the published-slug unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PublishRejected('slug_conflict');
      }
      throw error;
    }
    const publication = await this.publications.record({
      postId: row.id, actorId: command.actorId, version: next.version, publishedAt,
    });
    await recordPublicationDeliveries(this.prisma.current(), publication.id);
    return receipt(publication);
  }
}
```

The `POST_NOT_PUBLISHABLE`, `POST_NOT_DRAFT`, and version errors from `publishPost` remain the existing `PostDomainError`. A published-slug conflict in the database is `PublishRejected('slug_conflict')`. Preserve these error classes and codes rather than guessing new names, so the existing `runPostCommand` and the batch classification below agree. Catch `P2002` only around the UPDATE that transitions the post to public. Do not misclassify duplicate delivery rows or other constraint violations as slug conflicts.

If schedule cancellation, editing, or manual publication succeeds after the candidate query but before scheduled publication, the final `updateMany` rechecks the schedule generation, version, and state. Checking only the initial read and leaving generation out of the final UPDATE can execute an already canceled schedule. If manual publication wins, the schedule is cleared in the same transaction. Cron will not find that post again afterward.

## Approval, Cancellation, and Isolating Failed Candidates

In the following **complete `src/posts/scheduled-publishing.service.ts`**, `schedule` and `cancel` use the `PostActor` received from the authentication boundary. Approval time can be compared against an explicit `now` supplied by a test instead of the default real clock. The highest approvable version is limited to 2,147,483,645, leaving room for the two increments at approval and publication.

```ts
import { randomUUID } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { BadRequestException, ForbiddenException } from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { canEditPost, type PostActor } from './post-edit-policy.js';
import { PostDomainError, publishPost } from './post.js';
import { toPostSnapshot } from './post-row.js';
import { PublishingService, PublishRejected } from './publishing.service.js';

function permanentFailure(error: unknown): string | undefined {
  if (error instanceof PublishRejected) {
    switch (error.code) {
      case 'not_found': case 'forbidden': case 'slug_conflict': return error.code;
      case 'conflict': return undefined;
    }
  }
  if (error instanceof PostDomainError) {
    switch (error.code) {
      case 'POST_NOT_FOUND': case 'POST_INVALID_TEXT': case 'POST_NOT_DRAFT':
      case 'POST_NOT_PUBLISHABLE': case 'POST_SLUG_CONFLICT': return error.code;
      case 'POST_VERSION_CONFLICT': return undefined;
    }
  }
  throw error;
}

@Inject(PrismaService, PublishingService)
export class ScheduledPublishingService {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly publishing: PublishingService,
  ) {}

  async schedule(
    actor: PostActor, id: number, expectedVersion: number, when: Date,
    now: Date = new Date(),
  ) {
    if (!Number.isFinite(when.getTime()) || when <= now
      || expectedVersion < 1 || expectedVersion > 2_147_483_645) {
      throw new BadRequestException('Expected a future date and an approvable version.');
    }
    return this.prisma.transaction(async () => {
      const db = this.prisma.current();
      const post = await db.post.findUnique({ where: { id } });
      if (!post) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
      if (!canEditPost(actor, post)) throw new ForbiddenException('Only the author may schedule.');
      publishPost(toPostSnapshot(post), expectedVersion, now);
      const generation = randomUUID();
      const result = await db.post.updateMany({
        where: { id, authorId: actor.id, version: expectedVersion, status: 'draft' },
        data: {
          scheduledAt: when, scheduleGeneration: generation, scheduledById: actor.id,
          scheduledVersion: expectedVersion + 1, scheduleFailure: null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new PublishRejected('conflict');
      return { id, version: expectedVersion + 1, generation, scheduledAt: when.toISOString() };
    });
  }

  async cancel(actor: PostActor, id: number, expectedVersion: number) {
    return this.prisma.transaction(async () => {
      const db = this.prisma.current();
      const post = await db.post.findUnique({ where: { id } });
      if (!post) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
      if (!canEditPost(actor, post)) throw new ForbiddenException('Only the author may cancel.');
      const result = await db.post.updateMany({
        where: { id, authorId: actor.id, version: expectedVersion, status: 'draft' },
        data: {
          scheduledAt: null, scheduleGeneration: null, scheduledById: null,
          scheduledVersion: null, scheduleFailure: null, version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new PublishRejected('conflict');
      return { id, version: expectedVersion + 1 };
    });
  }

  async publishDue(now: Date): Promise<number> {
    const due = await this.prisma.current().post.findMany({
      where: { status: 'draft', scheduledAt: { lte: now } },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, version: true, scheduleGeneration: true, scheduledById: true },
    });

    let published = 0;
    for (const candidate of due) {
      if (!candidate.scheduleGeneration || !candidate.scheduledById) {
        throw new Error('Active schedule violates its database constraint.');
      }
      try {
        await this.publishing.publish({
          postId: candidate.id, actorId: candidate.scheduledById,
          expectedVersion: candidate.version,
          schedule: { generation: candidate.scheduleGeneration, now },
        });
        published += 1;
      } catch (error: unknown) {
        const failure = permanentFailure(error);
        if (failure === undefined) continue;
        // The failed publication transaction has already rolled back.
        await this.prisma.current().post.updateMany({
          where: {
            id: candidate.id, version: candidate.version, status: 'draft',
            scheduleGeneration: candidate.scheduleGeneration,
            scheduledAt: { lte: now },
          },
          data: {
            scheduledAt: null, scheduleFailure: failure, version: { increment: 1 },
          },
        });
      }
    }
    return published;
  }
}
```

Failures are isolated per candidate. If the oldest candidate A has a slug that conflicts with an already published post, A remains with `scheduleFailure=slug_conflict` and `scheduledAt=null`, and processing continues to candidate B. A design that fails the same A at the front of every tick is a permanent outage, not a queue. Because the condition includes A's generation and version, it will not erase a new schedule if the author reapproved it just before failure handling.

`conflict` and `POST_VERSION_CONFLICT` mean the operation lost a race, so skip them without adding to the success count. Isolate only the remaining **known domain rejections** as failed states. Do not swallow Prisma connection failures, transaction timeouts, publication audit or delivery insert errors, or errors saving the failed state. In those cases the batch fails, and valid candidates that are still pending are rediscovered on the next tick. Candidates already committed are not rolled back. Turning database errors into `continue` as well would make "waiting" indistinguishable from "infrastructure failure."

The return value is the number of transitions this run confirmed, not permanently exact publication statistics. If the response is lost after commit, the database has the record even though the caller may see a failure. Do not try to reconstruct database publication history by summing operational metrics. If an exact, accounting-like list is required, query `PostPublication`.

Receive `now` once and use it throughout the batch. Tests can fix the boundary time, and posts at the beginning and end of the batch use the same time reference. This value approximates the actual processing time, not the scheduled time. The operating assumption here is that host clocks are synchronized. If even seconds of clock skew are unacceptable, switch to queries that use database time for candidate selection and recording. Cron's `timezone` option does not correct host clock skew.

## Connecting the Schedule API and Native Forms

The **complete `src/posts/post-schedule-input.ts`** distinguishes integer versions in JSON from string versions in forms. Because `datetime-local` has no timezone, it is not accepted as-is; input must use ISO 8601 UTC or an explicit offset. The date, hours, minutes, and seconds are also checked so `Date` cannot normalize an invalid calendar date into the next month.

```ts
import { BadRequestException, FromBody, FromPath } from '@fluojs/http';
import { positiveInt } from './post-form-input.js';

export class SchedulePathDto {
  @FromPath('id') id: unknown = '';
}
export class CancelScheduleDto {
  @FromPath('id') id: unknown = '';
  @FromBody('expectedVersion') expectedVersion: unknown = 0;
}
export class ApproveScheduleDto {
  @FromPath('id') id: unknown = '';
  @FromBody('expectedVersion') expectedVersion: unknown = 0;
  @FromBody('scheduledAt') scheduledAt: unknown = '';
}

export function scheduleVersion(value: unknown, form: boolean, approval: boolean): number {
  const maximum = approval ? 2_147_483_645 : 2_147_483_646;
  const version = form ? positiveInt(value, maximum) : value;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > maximum) {
    throw new BadRequestException('Invalid expected version.');
  }
  return version;
}

export function scheduleDate(value: unknown): Date {
  if (typeof value !== 'string' || value.length > 35) throw new BadRequestException('Invalid date.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new BadRequestException('An explicit timezone is required.');
  const [, year, month, day, hour, minute, second, zone] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(year) < 1000 || Number(month) < 1 || Number(month) > 12
    || Number(day) < 1 || Number(day) > days || Number(hour) > 23
    || Number(minute) > 59 || Number(second) > 59
    || (zone !== 'Z' && (!zone || Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw new BadRequestException('Invalid calendar date.');
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new BadRequestException('Invalid date.');
  return result;
}
```

The **complete `src/posts/post-schedule.controller.ts`** registers the Bearer API in the existing API module. GET inspects approval state and the reason for failure, POST approves, and DELETE cancels. The request body does not supply an approver ID. Reuse the existing `runPostCommand` for mapping domain errors to HTTP errors.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, Delete, Get, Header, HttpCode, Post, RequestDto,
  UnauthorizedException, ForbiddenException, UseGuards, type RequestContext,
} from '@fluojs/http';
import { RequireScopes, UseAuth } from '@fluojs/passport';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { Throttle, ThrottlerGuard } from '@fluojs/throttler';
import { PostDomainError } from './post.js';
import { canEditPost, type PostActor } from './post-edit-policy.js';
import { positiveInt } from './post-form-input.js';
import { runPostCommand } from './post-http-error.js';
import {
  ApproveScheduleDto, CancelScheduleDto, SchedulePathDto, scheduleDate, scheduleVersion,
} from './post-schedule-input.js';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';

export function scheduleActor(context: RequestContext): PostActor {
  if (!context.principal) throw new UnauthorizedException();
  return { id: context.principal.subject, scopes: context.principal.scopes ?? [] };
}

@Inject(PrismaService)
export class ScheduleReader {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}
  async read(id: number, actor: PostActor) {
    const row = await this.prisma.current().post.findUnique({ where: { id } });
    if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    if (!canEditPost(actor, row)) throw new ForbiddenException('Only the author may inspect.');
    return {
      id: row.id, version: row.version, status: row.status,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      generation: row.scheduleGeneration, approvedBy: row.scheduledById,
      approvedVersion: row.scheduledVersion, failure: row.scheduleFailure,
    };
  }
}

@Inject(ScheduledPublishingService, ScheduleReader)
@Controller('/posts')
@UseAuth('blog-jwt')
@RequireScopes('posts:write')
@Header('Cache-Control', 'private, no-store')
export class PostScheduleController {
  constructor(private readonly scheduling: ScheduledPublishingService, private readonly reader: ScheduleReader) {}

  @Get('/:id/schedule')
  @RequestDto(SchedulePathDto)
  inspect(input: SchedulePathDto, context: RequestContext) {
    return runPostCommand(() => this.reader.read(positiveInt(input.id), scheduleActor(context)));
  }

  @Post('/:id/schedule')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  @RequestDto(ApproveScheduleDto)
  approve(input: ApproveScheduleDto, context: RequestContext) {
    return runPostCommand(() => this.scheduling.schedule(
      scheduleActor(context), positiveInt(input.id),
      scheduleVersion(input.expectedVersion, false, true), scheduleDate(input.scheduledAt),
    ));
  }

  @Delete('/:id/schedule')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  @RequestDto(CancelScheduleDto)
  cancel(input: CancelScheduleDto, context: RequestContext) {
    return runPostCommand(() => this.scheduling.cancel(
      scheduleActor(context), positiveInt(input.id), scheduleVersion(input.expectedVersion, false, false),
    ));
  }
}
```

The **complete `src/posts/post-schedule-pages.module.ts`** provides separate HTML routes that use the same service. Open `/posts/:id/schedule/edit` directly or follow a link from the editing page. `FormsAuthGuard` and `FormOriginGuard` are actual exports of Chapter 17's `FormsAuthModule`, and `requireFormWriter(context)` checks the writing scope. The POST uses exactly the version read from the page; an error must not trigger an automatic retry with the latest version.

```ts
import { createElement } from 'react';
import { Inject } from '@fluojs/core';
import { Header, Post, RequestDto, UseGuards, type RequestContext } from '@fluojs/http';
import { Path, ReactModule, Router, createReactServerEntry } from '@fluojs/react';
import { Throttle, ThrottlerGuard } from '@fluojs/throttler';
import {
  FormsAuthModule, FormsAuthGuard, FormOriginGuard, requireFormWriter,
} from '../auth/forms-auth.module.js';
import { Document } from './post-pages.js';
import { PostsModule } from './posts.module.js';
import { positiveInt } from './post-form-input.js';
import { runPostCommand } from './post-http-error.js';
import { ScheduleReader } from './post-schedule.controller.js';
import {
  ApproveScheduleDto, CancelScheduleDto, SchedulePathDto, scheduleDate, scheduleVersion,
} from './post-schedule-input.js';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';

@Inject(ScheduledPublishingService, ScheduleReader)
@Router('/posts')
@Header('Cache-Control', 'private, no-store')
class PostSchedulePages {
  constructor(private readonly scheduling: ScheduledPublishingService, private readonly reader: ScheduleReader) {}

  @Path('/:id/schedule/edit')
  @UseGuards(FormsAuthGuard)
  @RequestDto(SchedulePathDto)
  async show(input: SchedulePathDto, context: RequestContext) {
    const actor = requireFormWriter(context);
    const state = await runPostCommand(() => this.reader.read(positiveInt(input.id), actor));
    return createElement('main', null,
      createElement('h1', null, 'Publication schedule'),
      createElement('p', null, `Approved: ${state.approvedVersion ?? '-'}; actor: ${state.approvedBy ?? '-'}`),
      createElement('p', { role: 'status' }, state.failure ?? state.scheduledAt ?? 'Not scheduled'),
      createElement('a', { href: `/posts/${state.id}/edit` }, 'Back to draft'),
      createElement('form', {
        action: `/posts/${state.id}/schedule/approve`, method: 'post', encType: 'multipart/form-data',
      },
      createElement('input', { type: 'hidden', name: 'expectedVersion', value: state.version }),
      createElement('label', { htmlFor: 'scheduledAt' }, 'Publication time including timezone'),
      createElement('input', {
        id: 'scheduledAt', name: 'scheduledAt', required: true, maxLength: 35,
        placeholder: '2026-09-14T09:00:00+09:00', defaultValue: state.scheduledAt ?? '',
      }),
      createElement('button', { type: 'submit' }, 'Approve schedule')),
      createElement('form', {
        action: `/posts/${state.id}/schedule/cancel`, method: 'post', encType: 'multipart/form-data',
      },
      createElement('input', { type: 'hidden', name: 'expectedVersion', value: state.version }),
      createElement('button', { type: 'submit' }, 'Cancel schedule')),
    );
  }

  @Post('/:id/schedule/approve')
  @UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  @RequestDto(ApproveScheduleDto)
  async approve(input: ApproveScheduleDto, context: RequestContext) {
    const actor = requireFormWriter(context);
    const id = positiveInt(input.id);
    await runPostCommand(() => this.scheduling.schedule(
      actor, id, scheduleVersion(input.expectedVersion, true, true), scheduleDate(input.scheduledAt),
    ));
    context.response.redirect(303, `/posts/${id}/schedule/edit`);
  }

  @Post('/:id/schedule/cancel')
  @UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  @RequestDto(CancelScheduleDto)
  async cancel(input: CancelScheduleDto, context: RequestContext) {
    const actor = requireFormWriter(context);
    const id = positiveInt(input.id);
    await runPostCommand(() => this.scheduling.cancel(
      actor, id, scheduleVersion(input.expectedVersion, true, false),
    ));
    context.response.redirect(303, `/posts/${id}/schedule/edit`);
  }
}

export const PostSchedulePagesModule = ReactModule.forRoot({
  imports: [PostsModule, FormsAuthModule],
  controllers: [PostSchedulePages],
  renderPage: (page) => createReactServerEntry(createElement(Document, null, page)),
});
```

## Placing the Scheduler Inside the Module

Before that, close the gaps in the editing paths after scheduling. Perform the replacements below **only after applying this chapter's schema migration**. Do not make Chapters 15, 17, and 18 use schedule columns that did not yet exist there.

### The Owner of JSON Editing and the Internal Save Path

The following is the **complete replacement for `src/posts/post-editing.service.ts`**. Keep the existing `PostEditingController` for `PUT /posts/:id` and Chapter 16's limit, authentication, DTO, and serialization registrations. The same `PostEditingService` token receives the implementation below, so the API does not need to choose a new path. Saving text and canceling the schedule form one UPDATE.

```ts
import { Inject } from '@fluojs/core';
import { ForbiddenException } from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { canEditPost, type PostActor } from './post-edit-policy.js';
import type { EditPostCommand } from './post-edit-input.js';
import { PostDomainError, reviseDraft } from './post.js';
import { toPostSnapshot } from './post-row.js';

@Inject(PrismaService)
export class PostEditingService {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async edit(actor: PostActor, command: EditPostCommand) {
    return this.prisma.transaction(async () => {
      const db = this.prisma.current();
      const row = await db.post.findUnique({ where: { id: command.postId } });
      if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
      if (!canEditPost(actor, row)) {
        throw new ForbiddenException('Only the author may edit this post.');
      }
      const next = reviseDraft(toPostSnapshot(row), command.expectedVersion, {
        title: command.title, content: command.content, slug: command.slug,
      });
      const changed = await db.post.updateMany({
        where: {
          id: command.postId, authorId: actor.id,
          version: command.expectedVersion, status: 'draft',
        },
        data: {
          title: next.title, content: next.content, slug: next.slug,
          version: { increment: 1 }, scheduledAt: null, scheduleGeneration: null,
          scheduledById: null, scheduledVersion: null, scheduleFailure: null,
        },
      });
      if (changed.count !== 1) {
        throw new PostDomainError('POST_VERSION_CONFLICT', 'The post changed while it was being saved.');
      }
      return next;
    });
  }
}
```

The internal `PostsRepository.editDraft` left from Chapter 10 must not overlook the schedule columns either. Although the service above now owns HTTP and React writes, replace **only the `editDraft` method in `src/posts/posts.repository.ts`** with the following to keep existing internal calls and repository experiments safe as well. Keep the existing imports and the other read and create methods, and leave the direct publication path removed in Chapter 11 removed.

```ts
async editDraft(id: number, expectedVersion: number, input: DraftEdit) {
  const result = await this.prisma.current().post.updateMany({
    where: { id, status: 'draft', version: expectedVersion },
    data: {
      ...normalizeText(input), version: { increment: 1 },
      scheduledAt: null, scheduleGeneration: null, scheduledById: null,
      scheduledVersion: null, scheduleFailure: null,
    },
  });
  return result.count === 1;
}
```

### React Does Not Request Schedule Cancellation Separately

**Replace the `PostsPages.save` method and its decorators in `src/posts/posts-pages.module.ts` with the block below.** Reuse `PostEditingService`, `parseDraftForm`, `PostDomainError`, `FormsAuthGuard`, `FormOriginGuard`, `requireFormWriter`, and the HTTP/React imports already in that file, adding only the imports below. Retain Chapter 20's cache factory replacement, Chapter 18's `cover` and `attachments` reads, and the other GET handlers.

```ts
import { Throttle, ThrottlerGuard } from '@fluojs/throttler';
import { runPostCommand } from './post-http-error.js';
```

```ts
@Post('/:id/edit')
@UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
@Throttle({ ttl: 60, limit: 20 })
@Header('Cache-Control', 'private, no-store')
@RequestDto(EditInput)
async save(input: EditInput, context: RequestContext) {
  const actor = requireFormWriter(context);
  const id = positiveInt(input.id);
  const version = positiveInt(input.version, 2_147_483_646);
  const current = await this.posts.readOwnedDraft(id, actor.id);
  if (!current) throw new NotFoundException('Draft not found');
  if (typeof input.title !== 'string' || typeof input.content !== 'string'
    || typeof input.slug !== 'string') throw new BadRequestException('Expected text fields');
  const post = {
    ...current, title: input.title, content: input.content, slug: input.slug, version,
  };
  try {
    await this.editing.edit(actor, parseDraftForm(input));
  } catch (error: unknown) {
    if (error instanceof PostDomainError && error.code === 'POST_NOT_FOUND') {
      throw new NotFoundException('Draft not found');
    }
    const invalid = error instanceof BadRequestException
      || (error instanceof PostDomainError && error.code === 'POST_INVALID_TEXT');
    const conflict = error instanceof PostDomainError
      && (error.code === 'POST_VERSION_CONFLICT' || error.code === 'POST_NOT_DRAFT');
    if (!invalid && !conflict) return runPostCommand(async () => { throw error; });
    context.response.setStatus(invalid ? 400 : 409);
    return createReactServerEntry(createElement(Document, null,
      createElement(EditingPage, {
        post, notice: invalid ? 'Check the field lengths.'
          : 'Draft changed. Copy your edits, then reload and compare.',
      }),
    ));
  }
  context.response.redirect(303, `/posts/${id}/edit`);
}
```

One successful `editing.edit` also commits schedule cancellation. If React calls the cancellation API before saving, a save failure removes only the approval. In the reverse order, Cron can run between saving and cancellation. Put both meanings into a single database write instead of coordinating two HTTP requests. Input-error and 409 pages preserve the submitted text and existing asset metadata; do not retry with an old version and cancel a new approval.

Add the following JSX immediately after the existing `<h1>Edit draft</h1>` in `EditingPage` in `src/posts/post-pages.tsx` to make the actual scheduling page reachable. Leave the upload and text forms in place.

```tsx
<p><a href={`/posts/${post.id}/schedule/edit`}>Review publication schedule</a></p>
```

### Covers and Attachments Are Part of the Approved Content

Replace the **entire `PostAssets.attach` method in `src/uploads/post-assets.ts`** with the following. The imports, constructor, and `download` remain as in Chapter 18. Do not change the policy's 2 MiB cover and 5 MiB attachment limits, MIME/name checks, HTTP `FormOriginGuard`, scope and version checks, or returned URLs. Attachments are also content intended for readers, so cancel the schedule even when the asset is not a cover.

```ts
async attach(
  postId: number, authorId: string, version: number, asset: PreparedAsset,
) {
  const id = randomUUID();
  return this.prisma.transaction(async () => {
    const tx = this.prisma.current();
    const post = await tx.post.findFirst({
      where: { id: postId, authorId, status: 'draft' },
      select: { coverAssetId: true },
    });
    if (!post) throw new NotFoundException('Draft not found');
    const changed = await tx.post.updateMany({
      where: { id: postId, authorId, status: 'draft', version },
      data: {
        version: { increment: 1 },
        scheduledAt: null, scheduleGeneration: null, scheduledById: null,
        scheduledVersion: null, scheduleFailure: null,
        ...(asset.kind === 'cover' ? { coverAssetId: id } : {}),
      },
    });
    if (changed.count !== 1) throw new ConflictException('Draft changed');
    await tx.postAsset.create({
      data: { id, postId, ownerId: authorId, ...asset },
    });
    if (asset.kind === 'cover' && post.coverAssetId) {
      await tx.postAsset.deleteMany({
        where: { id: post.coverAssetId, postId, kind: 'cover' },
      });
    }
    return {
      id, version: version + 1,
      assetUrl: `/posts/${postId}/assets/${id}`,
      editUrl: `/posts/${postId}/edit#asset-${id}`,
      readUrl: `/posts/${postId}/read`,
    };
  });
}
```

If creating the file or deleting the old cover fails, the version increment and schedule cancellation roll back together. There must be no state where bytes have changed but approval remains, or an upload has failed but only approval has disappeared. If publication wins first, the `status=draft` condition fails, so the cover or attachments of the published post cannot change. The same contract will be needed for any future delete or replace API, but do not describe routes that do not yet exist as if they did.

`src/posts/publishing-schedule.ts` is a **complete file**. Register it as a singleton provider without HTTP request scope. Apply `@Cron` to a public instance method, not to a private or static method.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';

@Inject(ScheduledPublishingService)
export class PublishingSchedule {
  constructor(private readonly publishing: ScheduledPublishingService) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'posts.publish-due' })
  async tick(): Promise<void> {
    const published = await this.publishing.publishDue(new Date());
    console.info(JSON.stringify({ event: 'posts.publish_due', published }));
  }
}
```

The following is the **complete `src/posts/posts.module.ts` at this stage**. Keep the root-owned `BlogDatabaseModule` in `src/database/blog-database.module.ts` and the `AppSettings`-based `PrismaModule.forRootAsync({ global: true })`. Reusing Chapter 19's `BlogJobsModule` also leaves a single Cron registration. This includes Chapter 15's API providers, Chapter 17's editing service export, and Chapter 20's cache import.

```ts
import { Module } from '@fluojs/core';
import { SerializerInterceptor } from '@fluojs/serialization';
import { AuthModule } from '../auth/auth.module.js';
import { BlogJobsModule } from '../jobs/blog-jobs.module.js';
import { ReadingCacheModule } from './reading-cache.module.js';
import { PostEditingController } from './post-editing.controller.js';
import { PostEditingService } from './post-editing.service.js';
import { PostWritingController } from './post-writing.controller.js';
import { PostWritingService } from './post-writing.service.js';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';
import { PostsRepository } from './posts.repository.js';
import { PostLinks } from './post-links.js';
import { PostPublicationsRepository } from './post-publications.repository.js';
import { PublishingService } from './publishing.service.js';
import { PostFeed } from './post-feed.js';
import { PublishingSchedule } from './publishing-schedule.js';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';
import { PostScheduleController, ScheduleReader } from './post-schedule.controller.js';

@Module({
  imports: [AuthModule, ReadingCacheModule, BlogJobsModule],
  controllers: [
    PostsController, PostEditingController, PostWritingController, PostScheduleController,
  ],
  providers: [
    PostsService, PostsRepository, PostLinks, PostIdConverter, SerializerInterceptor,
    PostPublicationsRepository, PublishingService, PostFeed,
    PostEditingService, PostWritingService,
    ScheduledPublishingService, PublishingSchedule, ScheduleReader,
  ],
  exports: [
    PostsService, PostsRepository, PublishingService, PostFeed, PostEditingService,
    ScheduledPublishingService, ScheduleReader,
  ],
})
export class PostsModule {}
```

In **`src/app.ts`**, add the page module once to the existing imports and add the API controller to the existing OpenAPI `sources`. Do not remove Chapter 19's subscriptions module or `EmailDispatchSchedule`. This connects the two responsibilities: the publication tick records intent, and the mail tick actually calls `dispatchPending`.

```diff
+import { PostSchedulePagesModule } from './posts/post-schedule-pages.module.js';
+import { PostScheduleController } from './posts/post-schedule.controller.js';
@@ imports
+    PostSchedulePagesModule,
@@ OpenApiModule.forRoot sources
+        { controllerToken: PostScheduleController },
```

The scheduler registers jobs in `onApplicationBootstrap`. Do not describe it as equivalent to a Queue worker that waits for the entire application's bootstrap-ready signal. If another tick arrives while the same job is running, the scheduler skips it instead of accumulating executions. There is no need to copy `waitForCompletion`, which is not a public option. However, calling `tick()` twice directly bypasses the scheduler's execution guard. That is why the service's database conditions are needed regardless of the timer type.

With multiple servers, a Redis distributed lock can reduce the cost of duplicate queries. Choosing `CronModule.forRoot({ distributed: { enabled: true, lockTtlMs: 30_000 } })` also requires an actual Redis module registration and token visibility. The minimum enabled TTL is 1,000 milliseconds, and the lock is renewed. Even so, a network interruption or lost lease does not undo SQL already in progress. The lock coordinates execution; version conditions and transactions form the data consistency boundary. For that reason, this implementation defends against duplicate publication even without a distributed lock.

## A Scheduler Experiment Without Waiting for Time to Pass

A timer test that waits a real 30 seconds is slow and becomes unreliable when the execution environment is busy. The public `scheduler` option on `CronModule` lets you capture registered callbacks and trigger a tick directly. The following is a **standalone contract experiment file** you can place in `src/posts/publishing-scheduler.spec.ts`. It uses the application's existing Vitest transformation configuration for standard decorators. It uses neither the database nor the real publication service and verifies only the scheduler's protection against overlapping execution.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Cron, CronModule, type CronScheduler } from '@fluojs/cron';
import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';

it('skips an overlapping publishing tick', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const callbacks: Array<() => Promise<void>> = [];
  const WORK = Symbol('publishing.work');
  let calls = 0;

  const scheduler: CronScheduler = (_expression, _options, callback) => {
    callbacks.push(callback);
    return { stop() { } };
  };

  @Inject(WORK)
  class ScheduleProbe {
    constructor(private readonly work: () => Promise<void>) { }

    @Cron('*/30 * * * * *', { name: 'posts.publish-due' })
    async tick(): Promise<void> {
      await this.work();
    }
  }

  @Module({
    imports: [CronModule.forRoot({ scheduler })],
    providers: [
      ScheduleProbe,
      {
        provide: WORK,
        useValue: async () => {
          calls += 1;
          started.resolve();
          await release.promise;
        },
      },
    ],
  })
  class ProbeModule { }

  const app = await FluoFactory.create(ProbeModule);
  let first: Promise<void> | undefined;
  try {
    expect(callbacks).toHaveLength(1);
    const tick = callbacks[0];
    if (!tick) throw new Error('The publishing callback was not registered.');
    first = tick();
    await started.promise;
    await tick();
    expect(calls).toBe(1);
    release.resolve();
    await first;
    await tick();
    expect(calls).toBe(2);
  } finally {
    release.resolve();
    await first;
    await app.close();
  }
}, 5_000);
```

`started` signals that the first execution has actually reached the work body. The signal is created before the tick is triggered, so there is no timing guess that it has "probably started." A second tick before `release` is resolved must not increase the work count. A tick after release must run again. The second assertion is also necessary to catch an incorrect implementation that permanently prevents further execution. The final five seconds are an upper bound that prevents a broken implementation from holding the test forever, not a wait that creates the success condition.

Verify database consistency separately from this experiment. In a dedicated PostgreSQL test database, not the production database, create a draft with a valid title, content, and slug, and schedule it for a sufficiently distant future time `T`. Read its version after scheduling, then check that both the return value of `publishDue(one millisecond before T)` and the publication record count are 0. Next, call `publishDue(T)` twice concurrently in separate contexts. The two return values must sum to 1, the state must be `published`, the version must be one higher than immediately after scheduling, and there must be one publication record.

Also introduce partial failures. If publication-record insertion fails in the test database, the same post's `status` and `publishedAt` must retain their previous values. When schedule cancellation races with publication, only the first operation to satisfy the valid version condition wins; if cancellation completes first, there must be no publication record. Restart recovery is not a test of restoring memory state. Save a draft with an overdue `scheduledAt`, start a new application, and execute its first tick to see whether the draft becomes public.

### Does B Publish Even After A's Permanent Conflict?

The following is the **complete `test/scheduled-publishing.integration.test.ts`**. It requires a **dedicated PostgreSQL test database with no other schedules**, migrated through Chapter 21. Fixed `approvedAt`, `dueA`, and `dueB` values are injected into the service, so there is no waiting for real time or changing the system clock. Establish A and B's schedule order, and occupy A's slug with a post published first. This is not merely an experiment in which a publisher mock throws: the actual partial unique index must reject the publication UPDATE.

```ts
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { PostsRepository } from '../src/posts/posts.repository.js';
import { PostPublicationsRepository } from '../src/posts/post-publications.repository.js';
import { PublishingService } from '../src/posts/publishing.service.js';
import { ScheduledPublishingService } from '../src/posts/scheduled-publishing.service.js';

it('excludes conflicting schedule A and publishes valid schedule B in the same batch', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required');
  const client = new PrismaClient({ datasources: { db: { url } } });
  const prisma = new PrismaService(client, { strictTransactions: true });
  const userId = randomUUID();
  const ids: number[] = [];
  try {
    await prisma.onModuleInit();
    await client.user.create({
      data: { id: userId, emailKey: `${userId}@example.test`, displayName: 'Schedule test' },
    });
    const publishing = new PublishingService(
      prisma, new PostsRepository(prisma), new PostPublicationsRepository(prisma),
    );
    const scheduling = new ScheduledPublishingService(prisma, publishing);
    const slug = `schedule-${userId}`;
    const blocker = await client.post.create({
      data: { authorId: userId, title: 'Existing post', content: 'Already public.', slug },
    });
    ids.push(blocker.id);
    await publishing.publish({ postId: blocker.id, actorId: userId, expectedVersion: 1 });
    await client.subscription.create({
      data: { userId, address: `${userId}@example.test`, active: true },
    });
    const a = await client.post.create({
      data: { authorId: userId, title: 'A', content: 'Conflicting draft.', slug },
    });
    ids.push(a.id);
    const b = await client.post.create({
      data: { authorId: userId, title: 'B', content: 'Valid draft.', slug: `${slug}-b` },
    });
    ids.push(b.id);
    const actor = { id: userId, scopes: ['posts:write'] };
    const approvedAt = new Date('2026-09-14T00:00:00.000Z');
    const dueA = new Date('2026-09-14T00:01:00.000Z');
    const dueB = new Date('2026-09-14T00:02:00.000Z');
    const approvedA = await scheduling.schedule(actor, a.id, 1, dueA, approvedAt);
    const approvedB = await scheduling.schedule(actor, b.id, 1, dueB, approvedAt);

    const published = await scheduling.publishDue(dueB);

    expect(published).toBe(1);
    expect(await client.post.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'draft', scheduledAt: null, scheduleFailure: 'slug_conflict',
      scheduleGeneration: approvedA.generation, scheduledById: userId,
      scheduledVersion: approvedA.version, version: approvedA.version + 1,
    });
    expect(await client.post.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
      status: 'published', scheduledAt: null, scheduleFailure: null,
      version: approvedB.version + 1, publishedAt: dueB,
    });
    expect(await client.postPublication.count({ where: { postId: a.id } })).toBe(0);
    const publication = await client.postPublication.findUniqueOrThrow({ where: { postId: b.id } });
    expect(publication).toMatchObject({
      actorId: userId, version: approvedB.version + 1, publishedAt: dueB,
    });
    expect(await client.postDelivery.findMany({
      where: { publicationId: publication.id, subscriberId: userId },
    })).toMatchObject([{ status: 'pending', address: `${userId}@example.test` }]);
    expect(await client.post.count({
      where: { id: { in: [a.id, b.id] }, status: 'draft', scheduledAt: { lte: dueB } },
    })).toBe(0);
  } finally {
    try {
      await client.postDelivery.deleteMany({ where: { publication: { postId: { in: ids } } } });
      await client.postPublication.deleteMany({ where: { postId: { in: ids } } });
      await client.post.deleteMany({ where: { id: { in: ids } } });
      await client.subscription.deleteMany({ where: { userId } });
      await client.user.deleteMany({ where: { id: userId } });
    } finally {
      await prisma.onApplicationShutdown();
    }
  }
}, 15_000);
```

```bash
pnpm exec vitest run test/scheduled-publishing.integration.test.ts src/posts/publishing-scheduler.spec.ts
```

In this scenario A is the first candidate in the same batch, so a try/catch outside the loop leaves B unpublished and fails the test. Changing it to only `catch { continue; }` leaves A in the next candidate query and fails the final check. Catch a regression that saves failure state without generation in a separate race experiment. After observing the signal that A's `publish` was rejected, pause failure persistence and reapprove A with a new version. When the gate is reopened, the new generation's `scheduledAt` must remain. Control this sequence with Promise signals, not sleeps.

When an actual database connection error is injected, `publishDue` must reject rather than turn it into a business failure such as `scheduleFailure=slug_conflict`. For each of body editing, React POST, cover upload, and attachment upload, begin with a scheduled draft and check that `scheduledAt`, `scheduleGeneration`, `scheduledById`, and `scheduledVersion` are null immediately after a successful save. If the upload's asset insert fails, the existing schedule and version must both be preserved. Published posts must remain unchanged in every experiment.

The PostgreSQL, HTTP, and browser integration experiments above were not run while writing this manuscript. Before following the commands, prepare the generated Prisma client, schema migrations, and a dedicated test database. The existing `examples/fluo-blog` provides evidence for the initial HTTP and DI paths; it is not a complete application with this scheduling schema and mail ledger. No SMTP or external delivery experiments beyond the recording transport were performed either.

## When Recurring Jobs Become an Operational Feature

With a cache, database publication and visibility to readers may occur at different times. Even when a direct read sees the database's public state, the list cache may still contain an earlier result. Include Chapter 20's per-query 30-second TTL in scheduled publication's visibility delay. Do not assume an immediate-invalidation caller already exists. Published detail reads use the `reading-v2-assets` key to include asset metadata. Do not hide this distinction by keeping the database transaction open while waiting for cache deletion to finish.

As workload grows, the numbers 30 seconds and 100 become important operational variables. If a batch takes longer than the interval, ticks may be skipped and the backlog may grow. Simply shortening the interval is not a solution. Look at how long posts have been overdue, execution time, and database load before adjusting the batch size or switching to parallel distribution of candidates. Small periodic cleanup tasks fit Cron well, but queues are better suited to per-reader delivery retries and throughput control for large jobs.

On shutdown, Cron first closes admission for new ticks, stops scheduled handles, and then waits for running jobs for a bounded period. The default drain limit is 10 seconds; the registration above selected 5 seconds. Do not assume that passing the limit cancels the job's Promise or database operations. Publication jobs should therefore commit quickly and be able to resume from data after process interruption. Chapter 23 addresses the overall shutdown budget and database disposal alongside this boundary.

FluoBlog now attempts publication even while the operator is offline. In return, it has a responsibility to answer, "I scheduled it, so why can't I see it yet?" We need evidence that distinguishes a job that did not run, a database failure, and a publication that succeeded while the cache still holds old data. The next chapter connects request and background-job state through metrics and structured records.

## Implementation References

- [Cron registration, timezones, overlapping execution, and shutdown contracts](../../packages/cron/README.md)
- [Public Cron types and the scheduler replacement boundary](../../packages/cron/src/types.ts)
- [Scheduler lifecycle and tick admission control](../../packages/cron/src/service.ts)
- [Job invocation and error-hook handling](../../packages/cron/src/task-runner.ts)
- [Tests for pending ticks and lease races during shutdown](../../packages/cron/src/lifecycle-race.test.ts)
- [Prisma registration, transaction, and shutdown contracts](../../packages/prisma/README.md)
