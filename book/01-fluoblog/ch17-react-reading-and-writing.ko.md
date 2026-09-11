# 독자가 볼 페이지와 작성자가 쓸 화면 만들기

<!-- book:volume=01-fluoblog;chapter=17 -->

[이전: 정상 사용자와 서비스 보호하기](./ch16-abuse-protection.ko.md) · [목차](./toc.ko.md) · [다음: 표지 이미지와 첨부파일 받기](./ch18-uploads.ko.md)

## API를 이해하지 않아도 글을 읽고 고칠 수 있게

FluoBlog 운영자는 이제 다른 작성자에게도 계정을 발급한다. 그런데 작성자는 글을 고치려고 개발자 도구에서 JSON을 복사하고, 독자는 API 응답에서 제목을 찾아야 한다. 인증과 권한 검사가 정확해도 이런 제품을 매일 쓰기는 어렵다. 이번 장은 앞에서 만든 게시글과 계정 위에 읽기 페이지와 초안 편집 화면을 붙인다. 별도의 프런트엔드용 사용자 테이블이나 두 번째 게시글 저장소를 만들지 않는다.

먼저 해결할 사고를 정하자. 작성자가 두 탭에서 같은 초안을 열었다. 첫 탭에서 제목을 고쳤고, 오래 열어 둔 두 번째 탭에서 본문을 저장했더니 새 제목이 사라졌다. 저장 버튼을 잠깐 비활성화해도 이 사고는 막히지 않는다. 두 화면은 다른 브라우저일 수도 있다. 앞 장의 `version`을 폼에 포함하고, 서버가 그 버전과 작성자를 함께 확인해야 한다. 화면은 충돌을 없애는 장치가 아니라 충돌을 사람이 이해하도록 드러내는 장치다.

이 장의 코드는 독자가 만든 `fluo-blog`에 넣는 애플리케이션 구현이다. 저장소의 `examples/fluo-blog`에 완성된 편집기가 있다는 뜻은 아니다. 실행 기준은 Node24와 pnpm10이다. 기존 PostgreSQL, Prisma, `AccountsModule`, `PostsModule`과 발행 트랜잭션은 유지한다. 설명을 구체적으로 하기 위해 게시글 `id`는 양의 정수, `authorId`는 검증된 JWT subject와 같은 문자열로 사용한다. 기존 스키마의 사용자 식별자를 화면 때문에 바꾸지 않는다.

## 첫 화면은 서버가 만든 문서로 충분하다

`@fluojs/react`의 안정 경로는 HTTP를 통한 React SSR이다. `@Router`와 `@Path`는 기존 HTTP 라우트 메타데이터 위에 놓인다. React 파일 이름을 보고 라우트를 자동 발견하지 않으며, 컴포넌트가 새로운 인증 파이프라인을 만들지도 않는다. API와 같은 미들웨어, 가드, DTO 바인딩, 요청 범위가 적용된다.

먼저 독자의 `fluo-blog`에서 React 통합과 peer dependency를 설치한다. 기존 Fluo·Prisma·인증 의존성은 그대로 둔다.

```bash
pnpm add @fluojs/react react react-dom
pnpm add -D @types/react @types/react-dom
```

기존 `tsconfig.json`의 `compilerOptions`에 `jsx: "react-jsx"`를 합친다. 다음은 추가할 설정만 표시한 부분이며 기존 strict·module·target과 데코레이터 설정을 지우는 교체 파일이 아니다. `include`가 `src/**/*.ts`만 선택하고 있다면 같은 배열에 `src/**/*.tsx`를 추가한다.

```json
{
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

읽기와 간단한 편집을 위해 당장 클라이언트 라우터나 hydration을 도입할 필요는 없다. 서버가 HTML을 보내고 브라우저가 기본 폼을 제출하면 된다. 자바스크립트 파일 다운로드가 실패해도 글을 읽고 저장할 수 있다. `GET /posts`와 `GET /posts/:id`는 앞 장의 JSON 계약으로 남기고, HTML은 `GET /posts/:id/read`, 편집은 `GET /posts/:id/edit`로 구분한다. 같은 HTTP method와 경로에 JSON 컨트롤러와 React 라우터를 중복 등록하지 않는 선택이다.

다음 `src/posts/post-pages.tsx`는 완전한 표현 파일이다. 이 파일에는 데코레이터나 데이터베이스 import가 없다. 공개 화면에는 작성자의 내부 식별자나 편집 버전을 전달하지 않는다. 본문을 문자열로 렌더링하므로 React가 텍스트를 이스케이프한다. Markdown을 HTML로 변환하는 기능은 여기 포함하지 않으며, `dangerouslySetInnerHTML`로 저장된 문자열을 그대로 실행하지 않는다.

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

라벨은 placeholder와 다르다. 입력 후에도 필드의 의미가 남고, 키보드와 보조 기술이 입력 요소를 찾을 수 있다. 오류 메시지에는 `role="alert"`를 둔다. 오류 화면을 새로운 문서로 받는 기본 폼에서는 성공 여부를 색 하나로만 나타내지 않는 것도 중요하다. 예제 화면의 문자열과 문서 언어는 번역판에서도 코드를 보존하기 위해 영어로 통일했다.

## 화면용 계약을 게시글 저장소에 연결하기

페이지가 Prisma 객체 전체에 의존하면 스키마에 비밀 필드가 추가될 때 화면의 노출 범위까지 변한다. 여기서는 화면에 필요한 두 조회만 분리한다. 다음 `src/posts/posts-page-store.ts`는 완전한 파일이다. 인터페이스는 실행 중 사라지므로 `POSTS_PAGE_STORE`가 실제 DI 토큰이다. 저장 메서드를 여기에 새로 만들지 않는다. 텍스트 수정은 15장의 `PostEditingService.edit(actor, command)` 한 곳이 소유한다.

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

다음은 `src/posts/prisma-posts-page-store.ts`의 완전한 조회 어댑터다. 10장의 `prisma-client-js` 생성기와 같은 `@prisma/client` 타입을 사용한다. 루트의 `BlogDatabaseModule`이 전역으로 제공한 `PrismaService`를 받으며, 조회할 때마다 `current()`를 호출한다. 새 클라이언트나 두 번째 트랜잭션 래퍼를 만들지 않는다.

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

조회 뒤 저장 전까지 다른 탭이 수정하거나 발행할 수 있다. 화면에서 본인 초안을 확인한 뒤에도 `PostEditingService`가 작성자와 scope를 확인하고 `reviseDraft`를 거쳐 상태·버전 조건부 쓰기를 수행해야 한다. 같은 규칙을 Prisma 페이지 어댑터에서 다시 구현하면 길이 제한이나 발행본 불변성이 한쪽에서 빠진다.

`src/posts/posts.module.ts`는 15장의 providers와 controllers를 그대로 두고, 이미 등록된 `PostEditingService`를 exports에도 추가한다. 해당 배열의 교체 부분은 다음과 같다. 새 provider 인스턴스를 페이지 모듈에 중복 등록하지 않는다.

```ts
exports: [
  PostsService, PostsRepository, PublishingService, PostFeed, PostEditingService,
],
```

## 인증된 폼도 서버에서 다시 판단한다

네이티브 폼은 임의의 `Authorization` 헤더를 넣지 못한다. 14장의 Bearer API를 바꾸는 대신 `/auth/forms/login`에서 같은 `AuthService.login`을 호출하고 반환된 JWT를 쿠키에 저장한다. 이후 쿠키에서 얻은 토큰도 `BlogTokenAuthenticator.authenticateToken(token)`으로 검증한다. 이 서비스는 서명·issuer·audience·만료와 현재 계정 상태·`authVersion`을 함께 확인하며 `AuthModule`이 export한다. 쿠키의 사용자 ID만 읽거나 기본 JWT verifier만 호출하면 계정 정지 정책을 우회하게 된다.

다음 `src/auth/forms-auth.module.ts`는 완전한 재사용 모듈이다. 기존 `PassportModule.forRoot()`를 하나 더 등록하면 공통 `AuthGuard` 토큰과 전략 레지스트리가 경쟁할 수 있다. 여기서는 폼 전용 `FormsAuthGuard`와 `OptionalFormsAuthGuard`를 별도 토큰으로 등록한다. 두 가드는 같은 `BlogFormsStrategy`를 주입받고, 이 전략은 Passport의 공개 `AuthStrategy` 계약과 기존 토큰 검증 서비스를 사용한다. 기존 API의 `blog-jwt` 등록과 `AuthGuard`는 그대로 남는다.

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

`readFormToken`은 원시 `Cookie` 헤더를 파싱하므로 존재하지 않는 cookie middleware를 전제로 하지 않는다. 중복 이름과 비정상 토큰은 인증 실패이고, 누락만 `OptionalFormsAuthGuard`에서 익명으로 통과한다. 폼 가드가 검증된 principal을 `context.principal`에 기록하고 인증 실패를 401로 바꾼다. 쓰기 handler는 `requireFormWriter(context)`로 `posts:write`를 추가 검사해 부족하면 403을 보낸다. DB 장애 같은 예상 밖 실패를 익명 사용자로 숨기지 않는다. 19장의 구독 폼은 `FormsAuthModule`을 import하고 `@UseGuards(FormsAuthGuard, FormOriginGuard)`를 사용할 수 있다. 독자 구독에는 글 쓰기 scope를 요구하지 않으므로 `requireFormWriter`를 호출하지 않는다.

운영에서는 `PUBLIC_ORIGIN=https://blog.example.test`처럼 외부 HTTPS 출처를 설정한다. 쿠키는 `Secure; HttpOnly; SameSite=Lax; Path=/`이며 Domain을 생략한 host-only 쿠키다. `Secure`는 HTTPS에서만 전송하게 하고 `HttpOnly`는 스크립트의 직접 읽기를 막는다. 둘 다 XSS를 해결하는 기능은 아니다. `SameSite=Lax`는 외부 링크의 최상위 GET 이동을 허용하지만 일반적인 cross-site POST에는 쿠키를 보내지 않는다. 같은 site의 다른 origin까지 모두 차단하지는 않으므로 아래 출처 검사가 여전히 필요하다.

로컬 개발에서는 9장의 `.env.local`에 다음 두 값을 명시하고 **항상 `http://127.0.0.1:3000`으로 접속한다**. 기존 DATABASE_URL·JWT_SECRET 등 다른 키는 유지한다. 이 정확한 개발 출처에만 Secure를 끈다. `localhost`로 접속하거나 포트를 달리하면 별개 출처라서 쿠키나 Origin 검사가 맞지 않는다. 다른 개발 주소가 필요하면 이 명시적 허용값과 설정을 함께 변경하거나 로컬 HTTPS를 사용한다. 프록시 뒤에서도 비교 기준은 검증된 설정이고 요청 `Host`나 `X-Forwarded-Host`가 아니다.

```dotenv
PORT=3000
PUBLIC_ORIGIN=http://127.0.0.1:3000
```

`Origin`은 인증 정보가 아니다. 비브라우저 클라이언트는 이를 임의로 보낼 수 있다. 로그인은 비밀번호로, 편집은 토큰으로 신원을 확인한 뒤 출처를 추가 검사한다. 로그인 POST도 출처를 확인해 타인의 계정으로 브라우저를 로그인시키는 요청을 막는다. 출처가 없거나 다르면 모두 403이다.

## 브라우저가 로그인하고 돌아올 실제 경로

다음 `src/auth/form-login-page.tsx`는 완전한 표현 파일이다. 비밀번호를 다시 출력하거나 URL에 넣지 않는다. `next`는 서버가 허용한 상대 경로만 받는다.

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

다음 `src/auth/forms-pages.module.ts`도 완전한 파일이다. 로그인은 16장과 같은 60초당 5회 제한을 적용한다. 비밀번호의 12~128 코드 포인트 규칙은 기존 `AuthService`와 `AccountsService`에서 확인한다. HTML `maxLength`의 UTF-16 단위로 비밀번호 정책을 다시 만들지 않는다.

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

예를 들어 `/auth/forms/login?next=/posts/2/edit`에서 로그인하면 303 뒤의 GET이 해당 편집 화면으로 간다. 외부 URL, `//host`, 역슬래시, 제어 문자, 임의 경로는 허용 목록에 맞지 않아 `/posts`로 돌아간다. 토큰은 HTML이나 응답 JSON에 내보내지 않는다. 새 인증 성공 때 같은 host/path의 쿠키를 교체하며 만료는 JWT와 같은 900초다.

로그아웃은 GET 링크가 아니라 같은 출처 POST이고 동일한 이름·path의 쿠키를 `Max-Age=0`으로 지운다. 만료된 쿠키도 지울 수 있도록 이 경로에 토큰 인증을 강제하지 않는다. 브라우저의 자격 증명을 제거할 뿐 이미 복사된 Bearer 토큰까지 폐기하는 기능은 아니다. 모든 기기의 로그인 취소는 기존 계정의 `authVersion` 정책으로 처리한다.

## 텍스트 폼도 기존 편집 명령을 사용한다

`src/posts/post-form-input.ts`는 완전한 HTTP 경계 파일이다. ID는 1~2,147,483,647이고, 저장할 version은 증가할 자리를 남겨 1~2,147,483,646이다. `parseEditPost`가 15장의 UTF-16 상한 120/50,000/80과 빈 값 허용 규칙을 그대로 적용한다.

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

다음 `src/posts/posts-pages.module.ts`는 완전한 모듈 파일이다. 바인딩 결과를 `unknown`으로 받는 이유는 필드의 TypeScript 선언만으로 문자열과 길이가 검증되지 않기 때문이다. 입력을 검사한 뒤 정수와 문자열로 좁힌다. 읽기 DTO와 폼 DTO는 상속하지 않고 독립 선언해 읽기 경로에 본문 필드 메타데이터가 섞이지 않게 한다. 폼 오류는 본문에 안전한 안내와 입력 내용을 유지하며 400 또는 409로 응답한다. 두 번째 탭의 내용을 최신 버전에 자동으로 덮어씌우지 않는다.

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

다음은 이 시점의 `src/app.ts` 합성이다. 기존 `AppSettingsModule`, `BlogDatabaseModule`, 계정·인증·게시글·`ProtectionModule`과 OpenAPI 등록을 유지하고 두 페이지 모듈을 추가한다. 16장에서 선택한 분산 제한 모듈이나 별도 로그·종료 옵션이 있다면 해당 선택도 유지한다. DB나 인증 callback을 모듈 밖에서 만들지 않는다.

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

공개 읽기에는 인증 가드를 붙이지 않아 쿠키가 없거나 만료되어도 발행 글을 읽을 수 있다. 편집 GET·POST는 폼 쿠키 인증과 `posts:write`를 요구한다. 기존 API 수정은 여전히 `PUT /posts/:id`이고, 네이티브 폼의 `POST /posts/:id/edit`도 동일한 `PostEditingService`를 호출한다. 서버에서 텍스트를 문자열로 좁힌 뒤 기존 파서와 서비스를 호출하며, HTML도 빈 값 허용과 동일한 UTF-16 상한을 사용한다. `slug`를 폼에서 빠뜨려 저장 때 지우거나 별도로 검증하지 않는다. 입력 오류와 충돌 화면은 제출한 텍스트와 옛 버전을 보존한다. 이미 발행된 글은 편집용 조회에 없고, 조회 직후 발행되는 경합은 서비스가 409로 막는다.

타인의 초안은 존재 여부를 숨기기 위해 404로 응답한다. 이는 모든 권한 오류를 404로 처리한다는 뜻은 아니다. 미인증은 401, 출처 거부는 403이다. 공개 글은 공개 조회로만 읽고, 초안 페이지는 `private, no-store`다. 직접 `redirect()`하거나 `send()`하면 응답이 이미 커밋되므로 뒤의 라우트 헤더 적용에 기대지 않는다. 위 성공 redirect에서도 `Cache-Control`을 명시적으로 먼저 설정했다. 사용자별 내용을 공개 캐시에 넣지 않는 경계가 20장에서 중요해진다.

## 빌드 경계와 점진적인 상호작용

다음은 `vite.config.ts`의 서버 빌드에 합치는 설정 조각이다. 이미 있는 출력 경로, external 설정, 플러그인을 제거하는 교체 파일이 아니다.

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

`.ts`의 표준 데코레이터는 `fluoDecoratorsPlugin()`이 Babel로 먼저 변환한다. 이 플러그인은 `.tsx`, 선언 파일, 테스트 파일을 같은 방식으로 변환하지 않는다. 그래서 라우터와 DTO를 `.ts`, JSX 컴포넌트를 `.tsx`로 나누었다. `experimentalDecorators`나 `emitDecoratorMetadata`를 켜서 해결하려는 접근은 현재 계약과 다르다. 테스트의 데코레이터 변환은 기존 Vitest 설정의 전용 경계를 유지한다.

지금은 hydration 자산을 등록하지 않았으므로 클릭 이벤트나 React 상태가 브라우저에서 실행된다고 주장하지 않는다. 긴 글 자동 저장, 미리보기, 제출 중 상태처럼 실제 요구가 생기면 서버와 클라이언트가 같은 tree를 만들도록 hydration을 추가한다. 그때 `@fluojs/react/vite`의 manifest 처리는 명시적으로 읽은 Vite manifest를 입력받는다. 루트 패키지가 파일을 탐색하거나 브라우저 번들을 자동 생성하지 않는다. 초기 렌더에 현재 시간이나 무작위 값을 따로 계산하면 hydration 불일치가 생기므로 서버의 스냅샷을 전달해야 한다.

## 성공 화면보다 오래된 탭을 먼저 시험한다

이 장의 브라우저 시나리오는 독자가 조립한 앱에서 수행하는 재현 절차이며, 이 원고 작성 중 실행 통과를 주장하지 않는다. 먼저 발행된 글의 `/posts/1/read`를 연다. HTML 본문과 날짜가 보이고, 저장된 본문에 `<script>` 문자열을 넣어도 코드가 아니라 텍스트로 보여야 한다. 자바스크립트를 비활성화한 뒤 같은 경로를 다시 읽어도 결과가 같아야 한다.

그다음 본인 초안의 편집 화면을 두 탭으로 연다. 두 탭의 hidden version을 같은 값으로 유지한 채 첫 탭에서 저장한다. 관찰할 결과는 POST의 303과 뒤따르는 GET이다. 새로고침은 POST를 재전송하지 않아야 한다. 두 번째 탭의 저장은 409이며, 사용자가 입력한 본문이 남고 DB version은 첫 저장에서 증가한 값 그대로여야 한다. 오래된 version을 최신 것으로 몰래 바꾸지 않았으므로 사용자가 비교하지 않고 다시 제출해도 충돌이 유지된다.

서버 테스트에서도 이 경합은 고정된 지연으로 만들지 않는다. 같은 버전의 폼 POST 두 개를 `Promise.all`로 보내고 redirect를 수동 처리했을 때 상태가 303 하나와 409 하나인지 확인한다. PostgreSQL에서 실행해야 `PostEditingService`의 조건부 쓰기를 검증한다. 저장소 더블이 두 요청을 무조건 성공시키면 화면 테스트는 통과해도 실제 덮어쓰기 사고를 놓친다.

세 번째 실험에서는 정상 폼의 `Origin`을 다른 출처로 바꾸고 동일 쿠키로 POST한다. 결과는 403, DB 쓰기는 0회다. 올바른 Origin만 넣고 쿠키를 빼면 인증은 되지 않는다. 다른 사용자로 로그인해 초안의 GET과 POST를 호출하면 404여야 하며, 공개 글의 읽기는 계속 가능해야 한다. scope 없는 유효한 JWT는 본인 글이어도 403이다. 브라우저의 `maxLength`를 지우고 121자 제목이나 이모지 61개를 제출하면 400이다. 세 텍스트 필드를 빈 문자열로 저장하면 성공하고 버전만 하나 증가해야 한다. ID 2,147,483,648, version 0 또는 2,147,483,647은 DB 호출 전에 400이어야 한다.

로그인 실험에서는 네트워크 탭에서 303 응답의 `Set-Cookie`와 뒤따르는 GET을 확인한다. 잘못된 비밀번호는 401이며 비밀번호와 토큰이 오류 HTML에 없어야 한다. 만료·서명 위조·계정 정지·`authVersion` 변경은 쿠키 편집에서도 기존 Bearer와 동일하게 실패해야 한다. 외부 `next`는 `/posts`로 돌아가고, 로그아웃 POST 뒤 편집은 401이 된다. HTTPS의 Secure 쿠키 동작과 로컬 HTTP 예외는 실제 브라우저로 각각 검증해야 한다. 이 원고에서는 DB·브라우저 통합 실험을 실행했다고 주장하지 않는다.

이 방식은 복잡한 편집기의 최종 형태는 아니다. 실패 때 전체 문서를 다시 받는 비용과, 충돌 시 수동 비교가 필요하다는 비용이 있다. 반대로 클라이언트 데이터 캐시와 서버 데이터 사이의 두 번째 정합성 문제를 아직 만들지 않는다. FluoBlog가 지금 얻은 것은 글을 읽고 초안을 안전하게 저장하는 실제 작업 경로다. 다음 장에서는 이 폼에 파일을 넣되, 텍스트 필드처럼 파일 이름과 형식을 믿지 않는 저장 경계를 만든다.

## 구현 근거

- [React README: 모듈, SSR, 네이티브 폼](../../packages/react/README.ko.md)
- [React 공개 export](../../packages/react/src/index.ts), [ReactModule 등록 구현](../../packages/react/src/module.ts)
- [직접 ReactElement 반환 테스트](../../packages/react/src/direct-page-return.test.ts), [SSR 요청 수명주기 테스트](../../packages/react/src/lifecycle-pipeline.test.ts)
- [Vite README](../../packages/vite/README.ko.md), [데코레이터 변환 대상과 순서](../../packages/vite/src/decorators-plugin.ts)
- [HTTP 요청·응답·principal 타입](../../packages/http/src/types.ts), [Fastify의 multipart 지원](../../packages/platform-fastify/README.ko.md)
- [Passport 전략·지역 등록](../../packages/passport/README.ko.md), [principal 설정과 scope 검사](../../packages/passport/src/guard.ts)
- [쿠키 쓰기와 삭제](../../packages/passport/src/cookie/cookie-manager.ts), [Prisma의 current·transaction](../../packages/prisma/README.ko.md)
