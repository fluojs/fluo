# 로그인 상태를 검증하기

<!-- book:volume=01-fluoblog;chapter=14 -->

[이전: 사용자와 자격 증명 모델링하기](./ch13-accounts-and-credentials.ko.md) · [1권 목차](./toc.ko.md) · [다음: 누가 이 글을 수정할 수 있는가](./ch15-authorization.ko.md)

## 비밀번호를 맞혔다는 사실을 요청 사이에 전달하기

기고자 계정이 생긴 FluoBlog에서 첫 편집 화면을 시험한다. 로그인 버튼은 비밀번호를 확인하고 성공했다고 표시하지만, 다음 게시글 저장 요청에는 사용자를 구별할 정보가 없다. 브라우저가 `userId`를 보내게 했더니 다른 계정의 ID로 바꿔도 서버가 받아들인다. 가입 때 만든 ID는 비밀이 아니므로 신원 증명이 될 수 없다. 서버가 검증한 로그인 결과와 클라이언트가 주장한 사용자 ID 사이에 구별 가능한 형식이 필요하다.

이 장에서는 짧은 수명의 서명된 액세스 토큰을 발행한다. 비밀번호를 보내는 곳은 `POST /auth/login`뿐이고, 보호된 요청은 `Authorization: Bearer <token>`으로 토큰을 전달한다. `@fluojs/jwt`는 서명과 클레임 검증을, `@fluojs/passport`는 HTTP 요청에서 자격 증명을 꺼내 인증 전략을 실행하고 `RequestContext.principal`을 만드는 일을 맡는다. 전자는 데이터 형식과 암호학적 검증의 경계이고 후자는 요청 실행의 경계다. 어느 패키지도 우리 데이터베이스의 계정 정지 상태를 저절로 알아내지는 못한다.

앞 장의 `AccountsModule`, `AccountsService`, `PasswordHasher`와 Prisma 스키마를 그대로 사용한다. 여기서 `subject`와 JWT의 `sub`는 `User.id`다. 게시글의 `authorId`, 나중에 추가할 주문의 `customerId`도 같은 사용자 ID를 따른다. 토큰으로 인증 방식을 바꾼다고 사람의 식별자를 다시 발급하지 않는다. 아래 파일은 독자의 `fluo-blog/src/auth/`에 추가할 구현이며, 저장소에 이 단계의 완성 애플리케이션이 별도로 제공된다는 뜻은 아니다.

## 토큰에 넣을 것과 넣지 않을 것

JWT는 payload를 암호화하는 형식이 아니다. 토큰을 가진 사람은 payload를 읽을 수 있다. 따라서 비밀번호 해시, 이메일 주소, 내부 운영 메모를 넣지 않는다. 이 제품에서 필요한 클레임은 사용자 ID인 `sub`, 발행자 `iss`, 대상 서비스 `aud`, 발행·만료 시각, 서버가 정한 `scopes`, 계정 인증 세대인 `authVersion`이다. 브라우저가 보낸 `roles`, `scopes`, `sub`를 복사해 서명하면 서버가 공격자의 주장에 도장을 찍는 셈이다.

액세스 토큰은 900초 동안 유효하게 한다. 이 값은 다시 로그인하는 불편과 유출된 토큰이 사용될 수 있는 시간을 절충한 제품 설정이다. 긴 유효기간은 로그인 화면을 덜 보여 주지만 폐기 정책의 중요성을 높인다. 토큰만 검증하는 완전한 무상태 방식에서는 비밀번호를 바꾸거나 사용자를 정지해도 만료 전까지 기존 토큰이 살아 있다. FluoBlog는 글을 쓰는 계정을 빠르게 정지할 수 있어야 하므로 현재 계정 상태를 요청마다 확인하는 방식을 선택한다.

FluoBlog가 나중에 session renewal을 추가한다면 한 경로를 따른다. refresh secret, lifetime, rotation, atomic store는 `JwtModule.forRoot({ global: true, refreshToken: ... })`에 구성하고, `RefreshTokenModule.forRoot()`를 등록한 뒤 `@UseAuth('refresh-token')`로 교환 endpoint를 노출한다. Passport는 또 다른 refresh service나 store를 만들지 않는다. 이 endpoint는 bearer header보다 `body.refreshToken`을 먼저 읽고 malformed body 값에는 fallback하지 않으며, 누락·invalid/reused·expired credential을 문서화된 authentication error로 변환한다. 이 장은 위의 더 짧은 access-token-only 제품 흐름을 의도적으로 유지한다.

다음은 **완전한 파일 `src/auth/jwt-options.ts`**이다. 환경 값을 읽는 곳은 애플리케이션 설정 경계다. 9장에서 설정 객체로 값을 관리했다면 같은 검증을 그 경계로 옮기되 JWT 제공자나 요청 핸들러가 매번 환경 변수를 읽게 하지 않는다. 개발 서버를 다시 띄워도 같은 키를 쓰도록 외부 설정으로 주입한다.

```ts
import type { JwtVerifierOptions } from '@fluojs/jwt';

export const ACCESS_TOKEN_TTL_SECONDS = 900;

const secret = process.env.JWT_SECRET;
if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret)) {
  throw new Error('JWT_SECRET must contain 64 hexadecimal characters.');
}

export const jwtOptions: JwtVerifierOptions = {
  algorithms: ['HS256'],
  secret,
  issuer: 'fluo-blog',
  audience: 'fluo-blog-web',
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  requireExp: true,
  clockSkewSeconds: 0,
};
```

키는 암호학적 난수 32바이트를 64자리 16진 문자열로 표현한 값으로 준비한다. 단순히 정규식에 맞는 반복 문자열을 쓰면 길이 검사만 통과할 뿐이다. 환경 파일은 저장소에 넣지 않는다. 개발용 값을 만들 때 사용할 명령은 다음과 같으며, 이 명령의 실제 출력이나 운영 키를 책에 기록하지 않는다.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

허용 알고리즘을 서버가 `HS256` 하나로 고정했으므로 토큰 헤더가 검증 방식을 임의로 결정하지 못한다. 같은 키라도 다른 `issuer`나 `audience`의 토큰은 거부한다. 시간이 어긋나는 배포에서 유예를 줄 수 있지만 `clockSkewSeconds`는 실제 허용 시간을 넓힌다. 무조건 큰 숫자를 넣기보다 호스트 시계를 먼저 맞춘다. Node.js 24가 본문의 실행 기준인 이유도 명확하다. 현재 JWT 패키지의 서명과 검증은 Node 호환 `node:crypto` 연산을 필요로 하며, 루트 import가 안전하다는 사실이 모든 호스트에서 서명할 수 있다는 뜻은 아니다.

## 로그인 서비스는 신원만 발행한다

다음은 **완전한 파일 `src/auth/auth.service.ts`**이다. 해시 비교는 앞 장의 서비스에 맡기고, 성공한 계정에서만 토큰을 만든다. `AccountInputError`는 로그인에서는 일반적인 미인증으로 바꾼다. 없는 이메일, 틀린 비밀번호, 정지된 계정을 서로 다른 응답으로 설명하지 않기 위해서다. 데이터베이스 연결 장애나 잘못된 JWT 설정은 이 분기에 잡히지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { UnauthorizedException } from '@fluojs/http';
import { JwtService } from '@fluojs/jwt';
import { AccountInputError } from '../accounts/account-input.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './jwt-options.js';

export type LoginResult = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { id: string; displayName: string };
};

@Inject(AccountsService, JwtService)
export class AuthService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly jwt: JwtService,
  ) {}

  async login(input: { email: unknown; password: unknown }): Promise<LoginResult> {
    let account;
    try {
      account = await this.accounts.verifyPassword(input.email, input.password);
    } catch (error: unknown) {
      if (error instanceof AccountInputError) {
        throw new UnauthorizedException('Invalid login credentials.');
      }
      throw error;
    }
    if (!account) {
      throw new UnauthorizedException('Invalid login credentials.');
    }
    const accessToken = await this.jwt.sign({
      sub: account.id,
      authVersion: account.authVersion,
      scopes: ['posts:write'],
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: { id: account.id, displayName: account.displayName },
    };
  }
}
```

`AuthService.login`의 정확한 성공 결과는 `LoginResult`다. `accessToken`은 JWT 문자열, `tokenType`은 항상 `Bearer`, `expiresIn`은 이 구성에서 900초, `user`는 `id`와 `displayName`만 가진다. 다른 transport는 이 같은 결과를 받아 전달 방식만 결정한다. `AuthModule`은 `AuthService`와 `BlogTokenAuthenticator`를 export하므로 별도 서명자나 계정 검증기를 등록하지 않는다.

여기서는 활성 계정 모두가 자기 글을 쓸 수 있다. `posts:write`를 가진다는 사실이 다른 사람 글을 수정해도 된다는 허가는 아니다. 그 판단은 다음 장의 리소스 정책이 한다. 이후 읽기 전용 계정 등급을 도입한다면 scope 목록을 계정 정책에서 계산해야 하고, 권한 변경 시 기존 토큰의 인증 세대도 갱신해야 한다. 토큰의 권한이 데이터베이스보다 오래 남는 문제를 로그인 코드 한 줄의 조건문으로 해결할 수는 없다.

계정 조회와 토큰 서명 사이에 비밀번호가 바뀔 수도 있다. 서비스는 해시 비교 당시 읽은 `authVersion`을 서명하므로 그 뒤 세대가 증가하면 방금 발행한 토큰이라도 다음 인증에서 거부된다. 성공 응답을 받았다고 모든 후속 요청의 성공을 보장하는 것은 아니다. 클라이언트는 401을 만나면 로컬 토큰을 지우고 재인증하도록 설계해야 한다. 계정 변경과 토큰 발행을 하나의 긴 데이터베이스 트랜잭션으로 감쌀 필요는 없다.

## 서명 검증 다음에 현재 계정을 확인하기

서명·클레임·현재 계정 검증은 transport와 분리한 **`src/auth/blog-token-authenticator.ts` 전체**에 모은다. `authenticateToken(token)`은 검증된 `JwtPrincipal`을 반환한다. 서명·issuer·audience·만료는 같은 `JwtService`와 `jwtOptions`를 쓰며, 현재 계정과 `authVersion` 확인도 이 경계를 통과한다. 만료·위조·정지는 Passport 인증 오류로, 설정·DB 장애는 원래 오류로 전파된다.

```ts
import { Inject } from '@fluojs/core';
import {
  JwtService, JwtExpiredTokenError, JwtInvalidTokenError, type JwtPrincipal,
} from '@fluojs/jwt';
import { AuthenticationExpiredError, AuthenticationFailedError } from '@fluojs/passport';
import { AccountsService } from '../accounts/accounts.service.js';

@Inject(JwtService, AccountsService)
export class BlogTokenAuthenticator {
  constructor(
    private readonly jwt: JwtService,
    private readonly accounts: Pick<AccountsService, 'findActiveSubject'>,
  ) {}

  async authenticateToken(token: string): Promise<JwtPrincipal> {
    let principal: JwtPrincipal;
    try {
      principal = await this.jwt.verify(token);
    } catch (error: unknown) {
      if (error instanceof JwtExpiredTokenError) {
        throw new AuthenticationExpiredError('Access token has expired.', { cause: error });
      }
      if (error instanceof JwtInvalidTokenError) {
        throw new AuthenticationFailedError('Access token verification failed.', { cause: error });
      }
      throw error;
    }
    const generation = principal.claims.authVersion;
    if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1) {
      throw new AuthenticationFailedError('The login is no longer valid.');
    }
    const account = await this.accounts.findActiveSubject(principal.subject);
    if (!account || account.authVersion !== generation) {
      throw new AuthenticationFailedError('The login is no longer valid.');
    }
    return principal;
  }
}
```

**`src/auth/blog-jwt.strategy.ts` 전체**는 bearer 추출과 challenge 헤더만 소유하고 위 인증기에 위임한다. 추출 문법과 배열 헤더의 첫 항목 사용은 내장 bearer 계약과 같다. 다른 transport도 토큰 문자열을 얻은 뒤 같은 인증기를 호출할 수 있지만 쿠키의 Origin·scope 보호까지 이 함수가 대신하지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { getRequestHeader, type GuardContext } from '@fluojs/http';
import {
  AuthenticationExpiredError, AuthenticationFailedError, AuthenticationRequiredError,
  type AuthStrategy, type AuthStrategyResult,
} from '@fluojs/passport';
import { BlogTokenAuthenticator } from './blog-token-authenticator.js';

@Inject(BlogTokenAuthenticator)
export class BlogJwtStrategy implements AuthStrategy {
  constructor(private readonly tokens: BlogTokenAuthenticator) {}

  async authenticate(context: GuardContext): Promise<AuthStrategyResult> {
    const header = getRequestHeader(context.requestContext.request, 'Authorization');
    const authorization = Array.isArray(header) ? header[0] : header;
    if (typeof authorization !== 'string' || authorization.length === 0) {
      context.requestContext.response.setHeader('WWW-Authenticate', 'Bearer');
      throw new AuthenticationRequiredError('Authorization header is required.');
    }
    const token = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization)?.[1];
    if (!token) {
      context.requestContext.response.setHeader('WWW-Authenticate', 'Bearer');
      throw new AuthenticationFailedError('Authorization header must use Bearer token format.');
    }
    try {
      return await this.tokens.authenticateToken(token);
    } catch (error: unknown) {
      if (error instanceof AuthenticationExpiredError || error instanceof AuthenticationFailedError) {
        context.requestContext.response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      }
      throw error;
    }
  }
}
```

JWT 서명 검증 전에 payload의 `sub`를 읽어 사용자를 조회하거나 권한을 부여하지 않는다. `JwtService.decode()`는 서명·만료·발행자를 확인하지 않는 디코더다. 여기서 principal은 공유 인증기의 서명 검증이 성공한 뒤에만 나온다. 이후에도 `authVersion`의 타입을 확인하는 이유는 암호학적으로 유효한 토큰이라고 애플리케이션이 요구하는 모든 클레임이 올바른 것은 아니기 때문이다. 이전 버전 앱이나 다른 발행 경로가 같은 키로 잘못된 클레임을 만들 수 있다.

이 전략은 데이터베이스가 내려갔을 때 인증을 허용하지 않는다. 동시에 데이터베이스 오류를 `AuthenticationFailedError`로 포장하지도 않는다. 그렇지 않으면 운영 장애가 사용자의 비밀번호 오류처럼 보인다. Passport의 `AuthGuard`는 인증 관련 오류를 401로 매핑하고, 알려지지 않은 기반 시스템 오류는 원래 오류 처리 경로로 넘긴다. 사용자에게 연결 문자열을 노출하지 않는 HTTP 오류 응답과 운영 로그의 오류 분류는 서로 다른 책임이다.

이 bearer 전략은 내장 계약과 같이 누락된 헤더에는 `WWW-Authenticate: Bearer`, 잘못되거나 만료된 토큰에는 `Bearer error="invalid_token"`을 설정한다. 헤더 배열이 전달되면 첫 항목만 읽는 것이 현재 계약이다. 그러므로 프록시와 서버가 중복 Authorization 헤더를 어떻게 다루는지도 배포 경계에서 일치시켜야 한다. 애플리케이션이 마지막 항목을 다시 읽어 앞선 전략과 다른 자격 증명을 쓰지 않는다.

## HTTP 경계와 DI 그래프를 끝까지 연결하기

다음은 **완전한 파일 `src/auth/auth.controller.ts`**이다. `unknown` 입력과 서비스 검증을 조합하므로 DTO 필드 타입만 보고 외부 값이 이미 올바르다고 가정하지 않는다. 필수 body 필드 바인딩 오류는 400이고, 로그인 자격 증명 확인 실패는 401이다. 가입 중복은 409로 구분한다. 이 공개 가입 API는 중복 여부를 어느 정도 드러내는 정책이므로, 계정 존재 자체를 숨겨야 하는 제품에서는 이메일 확인을 포함한 다른 가입 응답 설계가 필요하다.

```ts
import { Inject } from '@fluojs/core';
import {
  BadRequestException,
  ConflictException,
  Controller,
  FromBody,
  Get,
  Header,
  HttpCode,
  Post,
  RequestDto,
  UnauthorizedException,
  type RequestContext,
} from '@fluojs/http';
import { UseAuth } from '@fluojs/passport';
import {
  AccountConflictError,
  AccountInputError,
} from '../accounts/account-input.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthService } from './auth.service.js';

class LoginInput {
  @FromBody() email: unknown = '';
  @FromBody() password: unknown = '';
}

class RegisterInput {
  @FromBody() email: unknown = '';
  @FromBody() password: unknown = '';
  @FromBody() displayName: unknown = '';
}

@Controller('/auth')
@Inject(AuthService, AccountsService)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accounts: AccountsService,
  ) {}

  @Post('/login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequestDto(LoginInput)
  login(input: LoginInput) {
    return this.auth.login(input);
  }

  @Post('/register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequestDto(RegisterInput)
  async register(input: RegisterInput) {
    try {
      return await this.accounts.register(input);
    } catch (error: unknown) {
      if (error instanceof AccountInputError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof AccountConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Get('/me')
  @UseAuth('blog-jwt')
  @Header('Cache-Control', 'no-store')
  me(_input: unknown, context: RequestContext) {
    const principal = context.principal;
    if (!principal) throw new UnauthorizedException();
    return { id: principal.subject };
  }
}
```

로그인 응답의 토큰은 예외적으로 클라이언트에 전달하는 비밀 값이다. 응답 본문 로깅을 켜 두거나 분석 도구에 로그인 응답을 보내지 않는다. `no-store`는 성공 응답의 캐시 금지 정책이며 로그 마스킹을 대신하지 않는다. 에러 응답이나 프록시의 별도 캐시 규칙도 확인해야 한다. `/auth/me`는 전체 principal을 그대로 반환하지 않고 필요한 ID만 내보낸다.

다음은 **완전한 파일 `src/auth/auth.module.ts`**이다. 등록 이름, 클래스 토큰, 가시성을 한 번에 읽을 수 있게 만든다. `PassportModule`의 전역 설정은 `AuthGuard`를 다른 기능 모듈의 라우트에서도 resolve하게 하지만, 전략 클래스까지 자동으로 전역 제공하지는 않는다. `PostsModule`은 이 `AuthModule`을 import해서 export된 `BlogJwtStrategy`를 보게 된다.

```ts
import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import { PassportModule } from '@fluojs/passport';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { BlogJwtStrategy } from './blog-jwt.strategy.js';
import { BlogTokenAuthenticator } from './blog-token-authenticator.js';
import { jwtOptions } from './jwt-options.js';

@Module({
  imports: [
    AccountsModule,
    JwtModule.forRoot(jwtOptions),
    PassportModule.forRoot(
      { defaultStrategy: 'blog-jwt', global: true },
      [{ name: 'blog-jwt', token: BlogJwtStrategy }],
    ),
  ],
  providers: [BlogTokenAuthenticator, BlogJwtStrategy, AuthService],
  controllers: [AuthController],
  exports: [BlogJwtStrategy, BlogTokenAuthenticator, AuthService],
})
export class AuthModule {}
```

`src/app.ts`에는 `AuthModule`을 import해 기존 `AppModule.imports`에 추가한다. Prisma 등록은 10장에서 만든 `BlogDatabaseModule`의 단일 비동기 전역 등록을 유지한다. 이 모듈 안의 `BlogTokenAuthenticator`는 import한 `JwtModule`의 `JwtService`와 `AccountsModule`의 서비스를 보고, `BlogJwtStrategy`는 이 인증기에 위임한다. `AuthService`도 같은 계정 모듈을 사용한다. 표준 class-level `@Inject`의 토큰 순서는 생성자 매개변수 순서와 같다. `experimentalDecorators`나 `emitDecoratorMetadata`를 켜서 누락된 등록을 보완하려 하지 않는다.

## 만료·위조·정지를 서로 다른 실패로 시험하기

서명 검증은 실제 JWT 연산으로 시험할 수 있다. 다음은 **완전한 파일 `src/auth/jwt-policy.test.ts`**이다. 테스트 전용 키만 사용하고 `Date.now`를 고정해 만료 경계에 정확히 도달한다. 15분 동안 기다리거나 만료 직전 요청이 우연히 성공하기를 기대하지 않는다. 이 테스트는 토큰 검증의 경계만 다루며 HTTP 전략이나 PostgreSQL을 검증했다고 주장하지 않는다.

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  DefaultJwtSigner,
  DefaultJwtVerifier,
  JwtExpiredTokenError,
  JwtInvalidTokenError,
  type JwtVerifierOptions,
} from '@fluojs/jwt';

describe('blog access token policy', () => {
  it('checks subject, audience, signature, and the exact expiration boundary', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const options: JwtVerifierOptions = {
      algorithms: ['HS256'],
      secret: 'test-only-key-not-for-production',
      issuer: 'fluo-blog',
      audience: 'fluo-blog-web',
      accessTokenTtlSeconds: 900,
      requireExp: true,
      clockSkewSeconds: 0,
    };
    const signer = new DefaultJwtSigner(options);
    const verifier = new DefaultJwtVerifier(options);
    const otherAudience = new DefaultJwtVerifier({
      ...options,
      audience: 'another-client',
    });
    try {
      const token = await signer.signAccessToken({
        sub: 'reader-1',
        authVersion: 1,
        scopes: ['posts:write'],
      });
      expect((await verifier.verifyAccessToken(token)).subject).toBe('reader-1');
      await expect(otherAudience.verifyAccessToken(token))
        .rejects.toBeInstanceOf(JwtInvalidTokenError);
      const [header, , signature] = token.split('.');
      const forgedPayload = Buffer.from(JSON.stringify({
        sub: 'another-reader',
        exp: 1_800_000_900,
      })).toString('base64url');
      await expect(verifier.verifyAccessToken(`${header}.${forgedPayload}.${signature}`))
        .rejects.toBeInstanceOf(JwtInvalidTokenError);
      clock.mockReturnValue(1_800_000_900_000);
      await expect(verifier.verifyAccessToken(token))
        .rejects.toBeInstanceOf(JwtExpiredTokenError);
    } finally {
      clock.mockRestore();
      verifier.dispose();
      otherAudience.dispose();
    }
  });
});
```

```bash
pnpm exec vitest run src/auth/jwt-policy.test.ts
```

공유 인증기의 회귀는 **`src/auth/blog-token-authenticator.test.ts` 전체**로 검사한다. 실제 서명자와 검증기를 쓰고 계정 조회만 상태를 제어할 수 있는 좁은 경계로 대체한다. 따라서 이 검증은 DB 통합 실험이 아니다.

```ts
import { describe, expect, it, vi } from 'vitest';
import { DefaultJwtSigner, DefaultJwtVerifier, JwtService, type JwtVerifierOptions } from '@fluojs/jwt';
import { AuthenticationExpiredError, AuthenticationFailedError } from '@fluojs/passport';
import { BlogTokenAuthenticator } from './blog-token-authenticator.js';

const options: JwtVerifierOptions = {
  algorithms: ['HS256'], secret: 'test-only-key-not-for-production',
  issuer: 'fluo-blog', audience: 'fluo-blog-web',
  accessTokenTtlSeconds: 900, requireExp: true, clockSkewSeconds: 0,
};

describe('shared blog token authentication', () => {
  it('keeps signature, expiration, current account, and authVersion in one path', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const signer = new DefaultJwtSigner(options);
    const verifier = new DefaultJwtVerifier(options);
    let active = true;
    let generation = 1;
    let lookupFailure: Error | undefined;
    const accounts = {
      async findActiveSubject(id: string) {
        if (lookupFailure) throw lookupFailure;
        return active && id === 'account-a'
          ? { id, displayName: 'Writer', authVersion: generation }
          : null;
      },
    };
    const jwt = new JwtService(options, signer, verifier);
    const authenticator = new BlogTokenAuthenticator(jwt, accounts);
    try {
      const token = await signer.signAccessToken({
        sub: 'account-a', authVersion: 1, scopes: ['posts:write'],
      });
      expect(await authenticator.authenticateToken(token)).toMatchObject({
        subject: 'account-a', scopes: ['posts:write'],
      });
      generation = 2;
      await expect(authenticator.authenticateToken(token)).rejects.toBeInstanceOf(AuthenticationFailedError);
      generation = 1;
      active = false;
      await expect(authenticator.authenticateToken(token)).rejects.toBeInstanceOf(AuthenticationFailedError);
      active = true;
      const [header, , signature] = token.split('.');
      const payload = Buffer.from(JSON.stringify({ sub: 'account-b', exp: 1_800_000_900 })).toString('base64url');
      await expect(authenticator.authenticateToken(header + '.' + payload + '.' + signature))
        .rejects.toBeInstanceOf(AuthenticationFailedError);
      lookupFailure = new Error('Database unavailable');
      await expect(authenticator.authenticateToken(token)).rejects.toBe(lookupFailure);
      lookupFailure = undefined;
      clock.mockReturnValue(1_800_000_900_000);
      await expect(authenticator.authenticateToken(token)).rejects.toBeInstanceOf(AuthenticationExpiredError);
    } finally {
      verifier.dispose();
      clock.mockRestore();
    }
  });
});
```

```bash
pnpm exec vitest run src/auth/blog-token-authenticator.test.ts
```

HTTP 통합 실험에는 마이그레이션한 개발 PostgreSQL, 설정된 `JWT_SECRET`, Node.js 24로 실행 중인 앱이 필요하다. `POST /auth/register`로 `writer@example.test` 계정을 만들고 201과 공개 계정 정보를 확인한다. 같은 자격 증명으로 `POST /auth/login`을 호출하면 200과 `accessToken`, `expiresIn: 900`이 나와야 한다. 받은 토큰을 Authorization 헤더에 넣어 `/auth/me`를 호출하면 가입 시 반환한 ID와 같은 값이 나온다. 본문에 다른 `userId`를 넣어도 응답 ID가 바뀌어서는 안 된다.

다음으로 헤더를 빼거나 `Basic` 스킴을 보내고 401과 bearer challenge를 확인한다. 토큰 payload만 바꾸되 서명은 유지한 경우도 401이다. 정상 토큰으로 성공한 뒤 별도의 테스트 DB 연결에서 해당 사용자의 `authVersion`을 증가시키고 커밋 완료를 기다린 다음 같은 토큰을 보낸다. 이번에는 401이어야 한다. 다른 사용자의 토큰은 계속 성공해야 하므로 전체 키 변경으로 모든 사용자를 로그아웃시켜 시험을 통과시키지 않는다. 상태를 `disabled`로 바꾸는 실험도 같은 순서로 수행한다.

마지막으로 데이터베이스 연결을 실패시키는 테스트 대역을 계정 조회 경계에 넣고, 응답이 비밀번호 오류 401로 둔갑하지 않는지 확인한다. 앱 코드의 실제 전략·서명자·가드는 그대로 두고 기반 시스템 경계만 대체해야 인증 통합이 실패할 여지가 남는다. 비밀 값이 응답 오류나 접근 로그에 포함되지 않는지도 함께 검사한다. 이 원고 작성에서는 위 테스트나 데이터베이스 연결 실험을 실행하지 않았다. 현재 패키지 소스의 계약과 책에서 제시한 재현 절차를 구분해서 읽어야 한다.

## 세션을 늘리기 전에 남은 책임 이해하기

브라우저가 토큰을 메모리에만 두면 새로고침 후 다시 로그인해야 할 수 있다. 영속 저장소에 두면 편리하지만 스크립트 실행 취약점이 있을 때 토큰이 노출될 범위가 늘어난다. 이 장은 API의 bearer 계약을 확정하며, 브라우저 보관과 화면 흐름은 17장에서 연결한다. 쿠키로 전환한다면 HttpOnly만 붙이는 것으로 끝나지 않는다. 브라우저가 자격 증명을 자동 전송하므로 SameSite, Secure, CSRF 방어, 명시적인 origin 정책을 함께 설계해야 한다.

리프레시 토큰을 아직 만들지 않은 것도 의도적이다. 15분 뒤 재로그인하는 현재 기능은 완결되어 있다. 장기 세션을 추가하려면 원문 토큰을 안전하게 다루고, 재사용 감지와 회전·폐기를 저장소의 원자적 작업으로 구현해야 한다. `@fluojs/jwt`의 `RefreshTokenStore.rotate`는 이전 토큰 소비와 후속 토큰 저장을 한 작업으로 묶는 확장 지점이지 영속 데이터베이스 자체가 아니다. 메모리 저장소를 붙여 놓고 서버 재시작 뒤에도 세션이 보존된다고 말할 수 없다.

현재 클라이언트의 로그아웃은 보관한 액세스 토큰을 지우는 행위다. 이미 복사된 토큰을 서버에서 취소한 것과는 다르다. 계정 전체 폐기가 필요하면 13장의 `authVersion` 증가 정책을 사용하고, 기기별 폐기가 필요하면 별도 세션 모델을 선택한다. 이 차이를 API 설명과 사용자 화면에 숨기지 않는다.

이제 요청의 `principal.subject`가 어디서 왔는지 설명할 수 있다. 그렇지만 로그인한 독자가 다른 작성자의 글을 고쳐도 되는지는 아직 판단하지 않았다. 다음 장은 검증된 신원과 실제 게시글 행을 결합해, 권한 확인과 저장 사이의 경합까지 다룬다.

## 근거와 더 읽을 소스

- [JWT 등록·키·클레임·런타임 계약](../../packages/jwt/README.ko.md)
- [JWT 공개 export와 타입](../../packages/jwt/src/index.ts), [검증 옵션](../../packages/jwt/src/types.ts)
- [서명 구현](../../packages/jwt/src/signing/signer.ts), [시간·발행자·대상 검증](../../packages/jwt/src/signing/verifier.ts)
- [Passport 등록·전략·오류 매핑 계약](../../packages/passport/README.ko.md)
- [Passport 공개 export](../../packages/passport/src/index.ts), [bearer 전략](../../packages/passport/src/bearer/bearer-jwt.ts)
- [인증과 scope 검사 구현](../../packages/passport/src/guard.ts), [실패 응답 테스트](../../packages/passport/src/guard.test.ts)
- [HTTP 예외의 상태 코드와 응답 형태](../../packages/http/src/exceptions.ts)

[이전 장](./ch13-accounts-and-credentials.ko.md) · [1권 목차](./toc.ko.md) · [다음 장](./ch15-authorization.ko.md)
