# Building Pages for Readers and Screens for Writers

<!-- book:volume=01-fluoblog;chapter=17 -->

[Previous: Protecting Legitimate Users and the Service](./ch16-abuse-protection.md) | [Contents](./toc.md) | [Next: Accepting Cover Images and Attachments](./ch18-uploads.md)

## Reading and Editing Without Understanding the API

The FluoBlog operator now issues accounts to other writers. Yet writers have to copy JSON in developer tools to edit a post, and readers have to find the title in an API response. Even with correct authentication and authorization checks, this is a difficult product to use every day. This chapter adds reading pages and a draft editor to the posts and accounts we have already built. We do not create a separate user table for the frontend or a second post store.

First, identify the incident we want to prevent. A writer opens the same draft in two tabs. They change the title in the first tab, then save the body from the second tab, which has been open for a while. The new title disappears. Briefly disabling the Save button cannot prevent this incident. The two screens might even be in different browsers. We need to include the earlier chapter's `version` in the form and have the server check both that version and the author. The screen does not eliminate conflicts; it makes them understandable to a person.

The code in this chapter is application code to place in the `fluo-blog` you created. It does not mean the repository's `examples/fluo-blog` contains a finished editor. The execution baseline is Node24 and pnpm10. We retain the existing PostgreSQL database, Prisma, `AccountsModule`, `PostsModule`, and publishing transaction. To make the explanation concrete, a post's `id` is a positive integer, and `authorId` is a string matching the verified JWT subject. We do not change the existing schema's user identifier for the sake of the UI.

## A Server-Rendered Document Is Enough for the First Screen

The stable path in `@fluojs/react` is React SSR over HTTP. `@Router` and `@Path` sit on top of existing HTTP route metadata. They do not discover routes automatically from React filenames, and components do not create a new authentication pipeline. The same middleware, guards, DTO binding, and request scope apply as for the API.

First, install the React integration and its peer dependencies in your `fluo-blog`. Keep the existing Fluo, Prisma, and authentication dependencies.

```bash
pnpm add @fluojs/react react react-dom
pnpm add -D @types/react @types/react-dom
```

Merge `jsx: "react-jsx"` into `compilerOptions` in your existing `tsconfig.json`. The following excerpt shows only the setting to add; it is not a replacement file that removes the existing strict, module, target, or decorator settings. If `include` selects only `src/**/*.ts`, add `src/**/*.tsx` to the same array.

```json
{
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

You do not need a client router or hydration yet for reading and simple editing. The server can send HTML, and the browser can submit native forms. Readers can still read and save posts if a JavaScript file fails to download. Keep `GET /posts` and `GET /posts/:id` as the JSON contracts from the previous chapters, and use `GET /posts/:id/read` for HTML and `GET /posts/:id/edit` for editing. This avoids registering a JSON controller and a React router for the same HTTP method and path.

The following `src/posts/post-pages.tsx` is a complete presentation file. It contains no decorators or database imports. We do not pass the author's internal identifier or the editing version to the public screen. Because the body is rendered as a string, React escapes the text. Markdown-to-HTML conversion is not included here, and we do not execute a stored string directly through `dangerouslySetInnerHTML`.

```tsx
import type { ReactNode } from 'react';

export type ReadingPost = {
  readonly id: number;
  readonly title: string;
  readonly content: string;
  readonly slug: string;
  readonly publishedAt: string;
};

export type EditingPost = {
  readonly id: number;
  readonly title: string;
  readonly content: string;
  readonly slug: string;
  readonly version: number;
};

export function Document({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>FluoBlog</title>
      </head>
      <body>
        <header>
          <a href="/posts">FluoBlog posts</a>{' '}
          <a href="/auth/forms/login">Sign in</a>
          <form action="/auth/forms/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </header>
        {children}
      </body>
    </html>
  );
}

export function ReadingPage({ post }: { readonly post: ReadingPost }) {
  return (
    <main>
      <article>
        <h1>{post.title}</h1>
        <time dateTime={post.publishedAt}>{post.publishedAt.slice(0, 10)}</time>
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {post.content}
        </div>
      </article>
    </main>
  );
}

export function EditingPage({
  post, notice,
}: {
  readonly post: EditingPost;
  readonly notice?: string;
}) {
  return (
    <main>
      <h1>Edit draft</h1>
      {notice ? <p role="alert">{notice}</p> : null}
      <form action={`/posts/${post.id}/edit`} method="post"
        encType="multipart/form-data">
        <input type="hidden" name="version" value={post.version} />
        <p>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" defaultValue={post.title}
            maxLength={120} />
        </p>
        <p>
          <label htmlFor="content">Content</label>
          <textarea id="content" name="content" defaultValue={post.content}
            maxLength={50000} rows={18} />
        </p>
        <p>
          <label htmlFor="slug">Public slug</label>
          <input id="slug" name="slug" defaultValue={post.slug} maxLength={80} />
        </p>
        <button type="submit">Save draft</button>
      </form>
    </main>
  );
}
```

A label is different from a placeholder. It preserves the field's meaning after input and lets keyboards and assistive technology locate the input element. Error messages have `role="alert"`. With a native form that receives an error screen as a new document, it is also important not to indicate success or failure through color alone. The example screen's strings and document language are all English so that the code can remain unchanged in translation.

## Connecting the UI Contract to the Post Store

If a page depends on an entire Prisma object, adding a secret field to the schema also changes what the screen might expose. Here we separate only the two queries the screens need. The following `src/posts/posts-page-store.ts` is a complete file. Interfaces disappear at runtime, so `POSTS_PAGE_STORE` is the actual DI token. We do not add a new save method here. Text editing has a single owner: `PostEditingService.edit(actor, command)` from Chapter 15.

```ts
import type { Token } from '@fluojs/core';
import type { EditingPost, ReadingPost } from './post-pages.js';

export interface PostsPageStore {
  readPublished(id: number): Promise<ReadingPost | null>;
  readOwnedDraft(id: number, authorId: string): Promise<EditingPost | null>;
}

export const POSTS_PAGE_STORE: Token<PostsPageStore> =
  Symbol('blog.posts-page-store');
```

The following is the complete query adapter in `src/posts/prisma-posts-page-store.ts`. It uses the same `@prisma/client` types as the `prisma-client-js` generator from Chapter 10. It receives the `PrismaService` provided globally by the root `BlogDatabaseModule` and calls `current()` for each query. It does not create a new client or a second transaction wrapper.

```ts
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import type { PostsPageStore } from './posts-page-store.js';
import type { EditingPost, ReadingPost } from './post-pages.js';

export class PrismaPostsPageStore implements PostsPageStore {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async readPublished(id: number): Promise<ReadingPost | null> {
    const row = await this.prisma.current().post.findFirst({
      where: { id, status: 'published' },
      select: {
        id: true, title: true, content: true, slug: true, publishedAt: true,
      },
    });
    if (!row || !row.publishedAt) return null;
    return { ...row, publishedAt: row.publishedAt.toISOString() };
  }

  readOwnedDraft(id: number, authorId: string): Promise<EditingPost | null> {
    return this.prisma.current().post.findFirst({
      where: { id, authorId, status: 'draft' },
      select: { id: true, title: true, content: true, slug: true, version: true },
    });
  }
}
```

Another tab may edit or publish the post between the query and the save. Even after the screen has confirmed that this is the user's own draft, `PostEditingService` must check the author and scope, go through `reviseDraft`, and perform a conditional write on state and version. Reimplementing the same rules in the Prisma page adapter would allow one side to miss length limits or published-post immutability.

In `src/posts/posts.module.ts`, retain the providers and controllers from Chapter 15 and add the already registered `PostEditingService` to exports as well. Replace that array with the following. Do not register a duplicate provider instance in the page module.

```ts
exports: [
  PostsService, PostsRepository, PublishingService, PostFeed, PostEditingService,
],
```

## The Server Rechecks Even Authenticated Forms

Native forms cannot set an arbitrary `Authorization` header. Instead of changing the Bearer API from Chapter 14, we call the same `AuthService.login` at `/auth/forms/login` and store the returned JWT in a cookie. Tokens subsequently obtained from the cookie are also verified through `BlogTokenAuthenticator.authenticateToken(token)`. This service checks the signature, issuer, audience, expiration, current account status, and `authVersion` together, and `AuthModule` exports it. Reading only a user ID from the cookie or calling only a basic JWT verifier would bypass the account suspension policy.

The following `src/auth/forms-auth.module.ts` is a complete reusable module. Registering another `PassportModule.forRoot()` could make the shared `AuthGuard` token and strategy registries compete. Instead, we register the form-specific `FormsAuthGuard` and `OptionalFormsAuthGuard` as separate tokens. Both guards receive the same `BlogFormsStrategy`, which uses Passport's public `AuthStrategy` contract and the existing token authentication service. The existing API's `blog-jwt` registration and `AuthGuard` remain in place.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  ForbiddenException, UnauthorizedException, getRequestHeader,
  type Guard, type GuardContext, type Principal, type RequestContext,
} from '@fluojs/http';
import {
  AuthenticationExpiredError, AuthenticationFailedError, CookieManager,
  type AuthStrategy,
} from '@fluojs/passport';
import { AppSettings } from '../config/app-settings.js';
import { AuthModule } from './auth.module.js';
import { BlogTokenAuthenticator } from './blog-token-authenticator.js';

export const FORM_COOKIE_NAME = 'fluo_blog_access';

export class FormCookiePolicy {
  readonly secure: boolean;
  constructor(readonly origin: string) {
    const url = new URL(origin);
    this.secure = url.protocol === 'https:';
    if (!this.secure && origin !== 'http://127.0.0.1:3000') {
      throw new Error('Forms require HTTPS or the explicit local development origin.');
    }
  }
}

export function readFormToken(header: string | string[] | undefined): string | undefined {
  const values = (Array.isArray(header) ? header.join(';') : header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.split('=', 1)[0] === FORM_COOKIE_NAME);
  if (values.length === 0) return undefined;
  const token = values[0]?.slice(FORM_COOKIE_NAME.length + 1);
  if (values.length !== 1 || !token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new AuthenticationFailedError('Invalid access token cookie.');
  }
  return token;
}

@Inject(BlogTokenAuthenticator)
export class BlogFormsStrategy implements AuthStrategy {
  constructor(private readonly tokens: BlogTokenAuthenticator) {}

  async authenticate(context: GuardContext): Promise<Principal | { authenticated: false }> {
    const token = readFormToken(getRequestHeader(context.requestContext.request, 'Cookie'));
    if (token === undefined) return { authenticated: false };
    return this.tokens.authenticateToken(token);
  }
}

@Inject(BlogFormsStrategy)
export class FormsAuthGuard implements Guard {
  constructor(protected readonly strategy: BlogFormsStrategy) {}

  protected async establish(context: GuardContext, required: boolean): Promise<true> {
    try {
      const result = await this.strategy.authenticate(context);
      if ('authenticated' in result) {
        if (required) throw new UnauthorizedException('Sign in first.');
        return true;
      }
      context.requestContext.principal = result;
      return true;
    } catch (error: unknown) {
      if (error instanceof AuthenticationExpiredError || error instanceof AuthenticationFailedError) {
        throw new UnauthorizedException('Sign in again.', { cause: error });
      }
      throw error;
    }
  }

  canActivate(context: GuardContext): Promise<true> {
    return this.establish(context, true);
  }
}

@Inject(BlogFormsStrategy)
export class OptionalFormsAuthGuard extends FormsAuthGuard {
  override canActivate(context: GuardContext): Promise<true> {
    return this.establish(context, false);
  }
}

export function requireFormWriter(context: RequestContext) {
  const principal = context.principal;
  if (!principal) throw new UnauthorizedException('Sign in first.');
  const scopes = principal.scopes ?? [];
  if (!scopes.includes('posts:write')) throw new ForbiddenException('Write scope is required.');
  return { id: principal.subject, scopes };
}

@Inject(FormCookiePolicy)
export class FormOriginGuard implements Guard {
  constructor(private readonly policy: FormCookiePolicy) {}

  canActivate(context: GuardContext): true {
    if (getRequestHeader(context.requestContext.request, 'Origin') !== this.policy.origin) {
      throw new ForbiddenException('Unexpected form origin.');
    }
    return true;
  }
}

@Module({
  imports: [AuthModule],
  providers: [
    BlogFormsStrategy, FormsAuthGuard, OptionalFormsAuthGuard, FormOriginGuard,
    {
      provide: FormCookiePolicy,
      inject: [AppSettings],
      useFactory: (settings: unknown) => {
        if (!(settings instanceof AppSettings)) throw new Error('Expected AppSettings.');
        return new FormCookiePolicy(settings.publicOrigin);
      },
    },
    {
      provide: CookieManager,
      inject: [FormCookiePolicy],
      useFactory: (policy: unknown) => {
        if (!(policy instanceof FormCookiePolicy)) throw new Error('Expected FormCookiePolicy.');
        return CookieManager.create({
          accessTokenCookieName: FORM_COOKIE_NAME,
          cookieOptions: {
            path: '/', httpOnly: true, secure: policy.secure, sameSite: 'lax',
          },
        });
      },
    },
  ],
  exports: [FormsAuthGuard, OptionalFormsAuthGuard, FormOriginGuard, CookieManager],
})
export class FormsAuthModule {}
```

`readFormToken` parses the raw `Cookie` header, so it does not assume cookie middleware that does not exist. Duplicate names and malformed tokens are authentication failures; only an absent token passes anonymously through `OptionalFormsAuthGuard`. The form guard writes the verified principal to `context.principal` and converts authentication failures to 401. Write handlers additionally check `posts:write` through `requireFormWriter(context)` and return 403 if it is missing. Unexpected failures such as a database outage are not hidden as anonymous users. The subscription form in Chapter 19 can import `FormsAuthModule` and use `@UseGuards(FormsAuthGuard, FormOriginGuard)`. Reader subscriptions do not require a writing scope, so they do not call `requireFormWriter`.

In production, configure the external HTTPS origin, for example `PUBLIC_ORIGIN=https://blog.example.test`. The cookie has `Secure; HttpOnly; SameSite=Lax; Path=/` and is host-only because Domain is omitted. `Secure` restricts transmission to HTTPS, and `HttpOnly` prevents scripts from reading it directly. Neither feature solves XSS. `SameSite=Lax` allows top-level GET navigation from external links but does not send the cookie with ordinary cross-site POST requests. It does not block all other origins on the same site, so the origin check below is still necessary.

For local development, explicitly set the following two values in the `.env.local` from Chapter 9 and **always connect to `http://127.0.0.1:3000`**. Keep the other existing keys, including DATABASE_URL and JWT_SECRET. Secure is disabled only for this exact development origin. Using `localhost` or a different port creates a different origin, so cookies or the Origin check will not match. If you need another development address, change both this explicit allowed value and the configuration, or use local HTTPS. Even behind a proxy, the comparison uses validated configuration, not the request's `Host` or `X-Forwarded-Host`.

```dotenv
PORT=3000
PUBLIC_ORIGIN=http://127.0.0.1:3000
```

`Origin` is not a credential. Non-browser clients can send any value they choose. Login establishes identity through the password, and editing through the token; the origin is an additional check. The login POST also checks the origin to prevent requests that log a browser into someone else's account. A missing or different origin always produces 403.

## The Actual Route for Browser Login and Return Navigation

The following `src/auth/form-login-page.tsx` is a complete presentation file. It does not echo the password or place it in a URL. `next` accepts only relative paths permitted by the server.

```tsx
export function FormLoginPage({ next, failed = false }: {
  readonly next: string;
  readonly failed?: boolean;
}) {
  return (
    <main>
      <h1>Sign in to FluoBlog</h1>
      {failed ? <p role="alert">Sign in failed. Check your credentials.</p> : null}
      <form action="/auth/forms/login" method="post" encType="multipart/form-data">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username"
          required maxLength={254} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password"
          autoComplete="current-password" required />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
```

The following `src/auth/forms-pages.module.ts` is also a complete file. Login applies the same limit as Chapter 16: five attempts per 60 seconds. The existing `AuthService` and `AccountsService` check the password rule of 12 to 128 code points. We do not recreate the password policy using the UTF-16 units of HTML `maxLength`.

```ts
import { createElement } from 'react';
import { Inject } from '@fluojs/core';
import {
  FromBody, FromQuery, Header, Optional, Post, RequestDto,
  UnauthorizedException, UseGuards, type RequestContext,
} from '@fluojs/http';
import { CookieManager } from '@fluojs/passport';
import { Path, ReactModule, Router, createReactServerEntry } from '@fluojs/react';
import { Throttle, ThrottlerGuard } from '@fluojs/throttler';
import { Document } from '../posts/post-pages.js';
import { AuthModule } from './auth.module.js';
import { AuthService } from './auth.service.js';
import { FormOriginGuard, FormsAuthModule } from './forms-auth.module.js';
import { FormLoginPage } from './form-login-page.js';

export function safeFormDestination(value: unknown): string {
  if (value === '/posts') return value;
  if (typeof value !== 'string') return '/posts';
  const match = /^\/posts\/([1-9][0-9]*)\/(edit|read)$/.exec(value);
  if (!match || Number(match[1]) > 2_147_483_647) return '/posts';
  return value;
}

class LoginQuery {
  @FromQuery('next') @Optional() next: unknown = '/posts';
}

class LoginForm {
  @FromBody('email') email: unknown = '';
  @FromBody('password') password: unknown = '';
  @FromBody('next') @Optional() next: unknown = '/posts';
}

@Inject(AuthService, CookieManager)
@Router('/auth/forms')
class FormsPages {
  constructor(private readonly auth: AuthService, private readonly cookies: CookieManager) {}

  @Path('/login')
  @Header('Cache-Control', 'private, no-store')
  @RequestDto(LoginQuery)
  show(input: LoginQuery) {
    return createElement(FormLoginPage, { next: safeFormDestination(input.next) });
  }

  @Post('/login')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(FormOriginGuard, ThrottlerGuard)
  @Throttle({ limit: 5, ttl: 60 })
  @RequestDto(LoginForm)
  async login(input: LoginForm, context: RequestContext) {
    const next = safeFormDestination(input.next);
    try {
      const result = await this.auth.login({ email: input.email, password: input.password });
      this.cookies.setAccessTokenCookie(context.response, result.accessToken, result.expiresIn);
    } catch (error: unknown) {
      if (!(error instanceof UnauthorizedException)) throw error;
      context.response.setStatus(401);
      return createReactServerEntry(createElement(Document, null,
        createElement(FormLoginPage, { next, failed: true }),
      ));
    }
    context.response.setHeader('Cache-Control', 'private, no-store');
    context.response.redirect(303, next);
  }

  @Post('/logout')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(FormOriginGuard)
  logout(_input: unknown, context: RequestContext) {
    this.cookies.clearAccessTokenCookie(context.response);
    context.response.setHeader('Cache-Control', 'private, no-store');
    context.response.redirect(303, '/auth/forms/login');
  }
}

export const FormsPagesModule = ReactModule.forRoot({
  imports: [AuthModule, FormsAuthModule],
  controllers: [FormsPages],
  renderPage: (page) => createReactServerEntry(createElement(Document, null, page)),
});
```

For example, logging in at `/auth/forms/login?next=/posts/2/edit` sends the GET following the 303 to that editor. External URLs, `//host`, backslashes, control characters, and arbitrary paths do not match the allowlist and return to `/posts`. The token is not exposed in HTML or response JSON. Each successful authentication replaces the cookie for the same host and path, with the same 900-second expiration as the JWT.

Logout is a same-origin POST, not a GET link, and removes the cookie with the same name and path using `Max-Age=0`. This route does not require token authentication, so an expired cookie can also be removed. It removes credentials from the browser; it does not revoke a Bearer token that has already been copied. Revoking login on all devices uses the existing account's `authVersion` policy.

## Text Forms Use the Existing Editing Command Too

`src/posts/post-form-input.ts` is a complete HTTP boundary file. IDs range from 1 to 2,147,483,647, and the version to save ranges from 1 to 2,147,483,646, leaving room for an increment. `parseEditPost` applies the same UTF-16 limits of 120/50,000/80 and the rules permitting empty values from Chapter 15.

```ts
import { BadRequestException } from '@fluojs/http';
import { parseEditPost } from './post-edit-input.js';

export function positiveInt(value: unknown, maximum = 2_147_483_647): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new BadRequestException('Expected a positive integer.');
  }
  const result = Number(value);
  if (!Number.isInteger(result) || result > maximum) {
    throw new BadRequestException('Integer is out of range.');
  }
  return result;
}

export function parseDraftForm(input: {
  readonly id: unknown; readonly version: unknown;
  readonly title: unknown; readonly content: unknown; readonly slug: unknown;
}) {
  return parseEditPost({
    id: input.id, title: input.title, content: input.content, slug: input.slug,
    expectedVersion: positiveInt(input.version, 2_147_483_646),
  });
}
```

The following `src/posts/posts-pages.module.ts` is a complete module file. Binding results are received as `unknown` because TypeScript field declarations alone do not validate strings or their lengths. After checking the input, we narrow it to integers and strings. The reading DTO and form DTO are declared independently rather than through inheritance so that body-field metadata does not leak into the read route. Form errors return 400 or 409 while preserving the entered content and safe guidance in the response body. The second tab's content is not automatically written over the latest version.

```ts
import { createElement } from 'react';
import { Inject } from '@fluojs/core';
import {
  BadRequestException, FromBody, FromPath, Header, NotFoundException,
  Post, RequestDto, UseGuards, type RequestContext,
} from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import { Path, ReactModule, Router, createReactServerEntry } from '@fluojs/react';
import {
  FormOriginGuard, FormsAuthGuard, FormsAuthModule, requireFormWriter,
} from '../auth/forms-auth.module.js';
import { Document, EditingPage, ReadingPage } from './post-pages.js';
import { POSTS_PAGE_STORE, type PostsPageStore } from './posts-page-store.js';
import { PrismaPostsPageStore } from './prisma-posts-page-store.js';
import { PostEditingService } from './post-editing.service.js';
import { PostsModule } from './posts.module.js';
import { PostDomainError } from './post.js';
import { parseDraftForm, positiveInt } from './post-form-input.js';

class PostPath {
  @FromPath('id')
  id: unknown = '';
}

class EditInput {
  @FromPath('id')
  id: unknown = '';

  @FromBody('title')
  title: unknown = '';

  @FromBody('content')
  content: unknown = '';

  @FromBody('slug')
  slug: unknown = '';

  @FromBody('version')
  version: unknown = '';
}

@Inject(POSTS_PAGE_STORE, PostEditingService)
@Router('/posts')
class PostsPages {
  constructor(
    private readonly posts: PostsPageStore,
    private readonly editing: PostEditingService,
  ) {}

  @Path('/:id/read')
  @RequestDto(PostPath)
  async read(input: PostPath) {
    const post = await this.posts.readPublished(positiveInt(input.id));
    if (!post) throw new NotFoundException('Post not found');
    return createElement(ReadingPage, { post });
  }

  @Path('/:id/edit')
  @UseGuards(FormsAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  @RequestDto(PostPath)
  async edit(input: PostPath, context: RequestContext) {
    const actor = requireFormWriter(context);
    const post = await this.posts.readOwnedDraft(
      positiveInt(input.id), actor.id,
    );
    if (!post) throw new NotFoundException('Draft not found');
    return createElement(EditingPage, { post });
  }

  @Post('/:id/edit')
  @UseGuards(FormsAuthGuard, FormOriginGuard)
  @Header('Cache-Control', 'private, no-store')
  @RequestDto(EditInput)
  async save(input: EditInput, context: RequestContext) {
    const actor = requireFormWriter(context);
    const id = positiveInt(input.id);
    const version = positiveInt(input.version, 2_147_483_646);
    const current = await this.posts.readOwnedDraft(id, actor.id);
    if (!current) throw new NotFoundException('Draft not found');
    if (typeof input.title !== 'string' || typeof input.content !== 'string' ||
        typeof input.slug !== 'string') {
      throw new BadRequestException('Expected text fields');
    }
    const post = {
      ...current, title: input.title, content: input.content, slug: input.slug, version,
    };
    try {
      const command = parseDraftForm(input);
      await this.editing.edit(actor, command);
    } catch (error: unknown) {
      if (error instanceof PostDomainError && error.code === 'POST_NOT_FOUND') {
        throw new NotFoundException('Draft not found');
      }
      const invalid = error instanceof BadRequestException ||
        (error instanceof PostDomainError && error.code === 'POST_INVALID_TEXT');
      const conflict = error instanceof PostDomainError &&
        (error.code === 'POST_VERSION_CONFLICT' || error.code === 'POST_NOT_DRAFT');
      if (!invalid && !conflict) throw error;
      context.response.setStatus(invalid ? 400 : 409);
      return createReactServerEntry(createElement(Document, null,
        createElement(EditingPage, {
          post, notice: invalid ? 'Check the field lengths.' :
            'Draft changed. Copy your edits, then reload and compare.',
        }),
      ));
    }
    context.response.setHeader('Cache-Control', 'private, no-store');
    context.response.redirect(303, `/posts/${id}/edit`);
  }
}

export function createPostsPagesModule() {
  return ReactModule.forRoot({
    imports: [PostsModule, FormsAuthModule],
    controllers: [PostsPages],
    providers: [
      {
        provide: POSTS_PAGE_STORE,
        inject: [PrismaService],
        useFactory: (prisma: unknown) => {
          if (!(prisma instanceof PrismaService)) throw new Error('Expected PrismaService.');
          return new PrismaPostsPageStore(prisma);
        },
      },
    ],
    renderPage: (page) => createReactServerEntry(
      createElement(Document, null, page),
    ),
  });
}
```

The following is the composition of `src/app.ts` at this point. Retain the existing `AppSettingsModule`, `BlogDatabaseModule`, account, authentication, and post modules, `ProtectionModule`, and OpenAPI registration, then add the two page modules. If you chose a distributed rate-limiting module in Chapter 16 or separate logging or shutdown options, retain those choices as well. Do not create database or authentication callbacks outside the modules.

```ts
import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';
import { AppSettingsModule } from './config/app-settings.module.js';
import { BlogDatabaseModule } from './database/blog-database.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthController } from './auth/auth.controller.js';
import { FormsPagesModule } from './auth/forms-pages.module.js';
import { PostsModule } from './posts/posts.module.js';
import { PostsController } from './posts/posts.controller.js';
import { PostEditingController } from './posts/post-editing.controller.js';
import { PostWritingController } from './posts/post-writing.controller.js';
import { createPostsPagesModule } from './posts/posts-pages.module.js';
import { ProtectionModule } from './protection/protection.module.js';

@Module({
  imports: [
    AppSettingsModule, BlogDatabaseModule, AccountsModule, AuthModule, PostsModule,
    ProtectionModule, FormsPagesModule, createPostsPagesModule(),
    OpenApiModule.forRoot({
      title: 'FluoBlog API', version: '1.0.0',
      sources: [
        { controllerToken: PostsController }, { controllerToken: PostEditingController },
        { controllerToken: PostWritingController }, { controllerToken: AuthController },
      ],
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      documentPath: '/openapi.json', uiPath: '/docs', ui: true,
      defaultErrorResponsesPolicy: 'inject',
    }),
  ],
})
export class AppModule {}
```

Public reading has no authentication guard, so published posts remain readable when the cookie is absent or expired. The editing GET and POST require form-cookie authentication and `posts:write`. The existing editing API remains `PUT /posts/:id`, and the native form's `POST /posts/:id/edit` calls the same `PostEditingService`. The server narrows text to strings before calling the existing parser and service, while the HTML permits empty values and uses the same UTF-16 limits. We do not omit `slug` from the form, thereby clearing it on save, or validate it separately. Input-error and conflict screens preserve the submitted text and old version. Already published posts do not appear in the editing query, and the service rejects a race where publication occurs immediately after the query with 409.

Another user's draft returns 404 to conceal its existence. This does not mean that all authorization errors become 404. Unauthenticated requests receive 401, and rejected origins receive 403. Public posts are read only through the public query, and draft pages use `private, no-store`. Calling `redirect()` or `send()` directly commits the response, so do not rely on route headers being applied afterward. The successful redirects above explicitly set `Cache-Control` first as well. Keeping user-specific content out of public caches becomes important in Chapter 20.

## Build Boundaries and Progressive Interaction

The following is a configuration fragment to merge into the server build in `vite.config.ts`. It is not a replacement file that removes existing output paths, external settings, or plugins.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    ssr: 'src/main.ts',
    target: 'node24',
  },
});
```

`fluoDecoratorsPlugin()` first transforms standard decorators in `.ts` through Babel. The plugin does not transform `.tsx`, declaration files, or test files in the same way. That is why we separated routers and DTOs into `.ts` and JSX components into `.tsx`. Trying to solve this by enabling `experimentalDecorators` or `emitDecoratorMetadata` does not match the current contract. Decorator transforms for tests retain their dedicated boundary in the existing Vitest configuration.

We have not registered hydration assets, so we do not claim that click events or React state run in the browser. When a real need arises, such as autosaving long posts, previewing, or showing submission state, add hydration so the server and client produce the same tree. At that point, manifest handling in `@fluojs/react/vite` takes an explicitly read Vite manifest as input. The root package does not search for files or automatically generate a browser bundle. Calculating the current time or random values independently during the initial render causes hydration mismatches, so pass the server's snapshot instead.

## Test the Stale Tab Before the Success Screen

The browser scenarios in this chapter are reproduction procedures to perform in the app you assembled; we do not claim that they passed during the writing of this manuscript. First, open `/posts/1/read` for a published post. The HTML body and date should appear, and even if the stored body contains a `<script>` string, it should appear as text rather than code. Disable JavaScript and read the same route again; the result should be unchanged.

Next, open your own draft's editor in two tabs. Keep both hidden version fields at the same value and save from the first tab. Observe the POST's 303 and the GET that follows. Refreshing must not resubmit the POST. Saving from the second tab should return 409, retain the body the user entered, and leave the database version at the value incremented by the first save. Since we did not secretly update the stale version to the latest one, the conflict remains even if the user submits again without comparing.

Do not create this race with fixed delays in server tests either. Send two form POST requests with the same version using `Promise.all` and handle redirects manually, then check that the statuses are one 303 and one 409. Run against PostgreSQL to verify the conditional write in `PostEditingService`. If a store double makes both requests succeed unconditionally, the screen test may pass while missing an actual overwrite incident.

In the third experiment, change a valid form's `Origin` to a different origin and POST with the same cookie. The result should be 403, with zero database writes. Supplying only the correct Origin without a cookie must not authenticate the request. Log in as another user and call the draft's GET and POST: both should return 404, while public posts should remain readable. A valid JWT without the scope receives 403 even for the user's own post. Remove the browser's `maxLength` and submit a 121-character title or 61 emoji: the result should be 400. Saving all three text fields as empty strings should succeed and increment only the version by one. ID 2,147,483,648, version 0, and version 2,147,483,647 must produce 400 before any database call.

For the login experiment, inspect the 303 response's `Set-Cookie` and the subsequent GET in the network tab. A wrong password should return 401, and neither the password nor the token should appear in the error HTML. Expiration, forged signatures, account suspension, and an `authVersion` change must fail for cookie-based editing just as they do for the existing Bearer path. An external `next` returns to `/posts`, and editing returns 401 after a logout POST. Verify Secure-cookie behavior over HTTPS and the local HTTP exception separately in a real browser. This manuscript does not claim that the database and browser integration experiments were executed.

This approach is not the final form of a sophisticated editor. It carries the cost of receiving the entire document again on failure and of manually comparing changes on a conflict. In exchange, it does not yet create a second consistency problem between a client data cache and server data. What FluoBlog now has is a real workflow for reading posts and safely saving drafts. In the next chapter, we add files to this form while establishing a storage boundary that trusts neither filenames nor file formats, just as we do not trust text fields.

## Implementation References

- [React README: Modules, SSR, and Native Forms](../../packages/react/README.md)
- [React Public Exports](../../packages/react/src/index.ts), [ReactModule Registration Implementation](../../packages/react/src/module.ts)
- [Direct ReactElement Return Tests](../../packages/react/src/direct-page-return.test.ts), [SSR Request Lifecycle Tests](../../packages/react/src/lifecycle-pipeline.test.ts)
- [Vite README](../../packages/vite/README.md), [Decorator Transform Targets and Order](../../packages/vite/src/decorators-plugin.ts)
- [HTTP Request, Response, and Principal Types](../../packages/http/src/types.ts), [Fastify Multipart Support](../../packages/platform-fastify/README.md)
- [Passport Strategies and Local Registration](../../packages/passport/README.md), [Setting the Principal and Checking Scopes](../../packages/passport/src/guard.ts)
- [Writing and Clearing Cookies](../../packages/passport/src/cookie/cookie-manager.ts), [Prisma current and transaction](../../packages/prisma/README.md)
