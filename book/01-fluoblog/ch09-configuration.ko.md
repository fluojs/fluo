# 환경이 달라도 같은 코드 실행하기

<!-- book:volume=01-fluoblog;chapter=09 -->

[이전: 사용자가 이해할 수 있는 API 계약 만들기](./ch08-api-contracts.ko.md) · [1권 목차](./toc.ko.md) · [다음: 메모리의 게시글을 데이터베이스로 옮기기](./ch10-prisma-persistence.ko.md)

## 배포할 때마다 고치는 세 줄

FluoBlog의 게시글 API는 이제 요청과 응답의 모양이 분명하다. 그런데 다른 컴퓨터에서 실행한 동료가 이상한 링크를 보내 왔다. 게시글 주소가 여전히 `http://localhost:3000/posts/1`이었고, 서버는 배포 플랫폼이 지정한 포트 대신 개발자의 포트에서 기다리고 있었다. 운영자는 이를 고치려고 `src/main.ts`와 링크 생성 서비스의 문자열을 수정했다. 개발 환경으로 돌아오자 이번에는 운영 주소가 로컬 응답에 나타났다.

코드는 같은데 실행 장소만 다른 문제를 소스 수정으로 풀면 빌드 산출물의 의미가 흐려진다. 검증한 산출물과 실제 배포한 산출물이 달라지고, 장애가 설정 때문인지 코드 때문인지 구분하기 어렵다. 다음 장에서 데이터베이스까지 붙으면 이 실수는 잘못된 링크를 넘어 다른 데이터베이스에 게시글을 쓰는 사고가 된다. 이 장의 목표는 환경을 없애는 것이 아니라, 환경이 애플리케이션으로 들어오는 입구를 하나로 만드는 것이다.

본문은 독자가 CLI로 만든 `fluo-blog`를 확장한다. 실행 기준은 Node.js 24와 pnpm 10이며, 표준 데코레이터를 변환하는 앞 장의 빌드 구성을 유지한다. 저장소의 `examples/fluo-blog`는 초기 HTTP와 DI의 실행 근거이지, 여기서 정의할 설정·데이터베이스 파일을 이미 갖춘 완성 애플리케이션이 아니다. 아래에서 완전한 파일이라고 표시한 것은 독자의 애플리케이션에 만들 파일 전체를 뜻한다.

## 문자열을 읽는 일과 설정을 결정하는 일

처음 떠오르는 수정은 사용처마다 `process.env.PORT`나 `process.env.PUBLIC_ORIGIN`을 읽는 것이다. 그러나 환경 변수의 값은 문자열 또는 `undefined`다. `"false"`는 자바스크립트에서 참으로 평가되고, `Number('')`는 `0`이며, `parseInt('3000oops', 10)`은 `3000`을 반환한다. “문자열을 숫자로 바꾸었다”는 사실만으로 유효한 설정이 되지는 않는다.

기본값도 사용처가 정하면 충돌한다. HTTP 시작 코드는 포트를 `3000`으로 잡고, 게시글 링크 코드는 `8080`으로 잡을 수 있다. 테스트가 실행 중 `process.env`를 변경하면 늦게 만들어진 서비스만 다른 설정을 읽기도 한다. 따라서 설정은 **입력 수집, 우선순위에 따른 병합, 검증과 변환, 읽기 전용 접근**의 순서로 결정한다. 도메인 서비스는 마지막 단계만 알아야 한다.

`@fluojs/config`는 이 흐름에서 파일 로드, 병합, 동기 검증, `ConfigService` 제공을 담당한다. 환경 변수 전체를 자동으로 수집하지는 않는다. 어떤 키를 허용할지 애플리케이션이 `processEnv`에 명시해야 한다. 우선순위는 낮은 쪽부터 `defaults`, env 파일, 명시적인 `processEnv`, `runtimeOverrides`다. 여러 env 파일은 `envFilePaths`의 뒤쪽 파일이 앞쪽 파일을 이긴다.

이 순서는 운영상의 계약이다. 개발자의 `.env.local`보다 배포 시스템이 주입한 `DATABASE_URL`이 강해야 하고, 테스트가 전달한 입력은 실제 컴퓨터의 환경 변수에 오염되지 않아야 한다. 반대로 우선순위가 가장 높은 `runtimeOverrides`에 개발용 DB 주소를 남기면 배포 환경 변수를 아무리 고쳐도 바뀌지 않는다. 이를 “설정 캐시 문제”로 오해해 재시작을 반복하기 전에 소스의 우선순위를 확인해야 한다.

## FluoBlog가 받아들일 값을 정의하기

이번 장에서는 HTTP 포트, 공개 주소, 데이터베이스 주소의 세 가지 키만 받는다. 공개 주소는 게시글 링크의 기준이지 서버가 실제로 바인딩할 주소가 아니다. 리버스 프록시 뒤에서는 내부 포트가 `3000`이어도 공개 주소는 `https://blog.example.test`일 수 있다. 둘을 하나의 설정에서 억지로 유도하지 않는다.

다음 명령은 독자의 `fluo-blog` 디렉터리에서 필요한 직접 의존성을 추가하는 명령이다. `@fluojs/runtime`을 설치했다고 `@fluojs/config`가 애플리케이션 의존성으로 보장되는 것은 아니다.

```bash
pnpm add @fluojs/config zod@^4
```

아래는 `src/config/blog-config.ts`의 완전한 파일이다. Zod 스키마는 동기 Standard Schema로 `schema` 옵션에 전달된다. PostgreSQL 접속 가능 여부는 이 스키마가 검사하지 않는다. 여기서는 주소의 구조를 검증하고, 실제 연결은 다음 장의 Prisma 초기화가 책임진다.

```ts
import type { ConfigModuleOptions, ConfigProcessEnv } from '@fluojs/config';
import { z } from 'zod';

const PortSchema = z.string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

const PublicOriginSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === 'https:' || url.protocol === 'http:')
    && url.username === ''
    && url.password === ''
    && url.pathname === '/'
    && url.search === ''
    && url.hash === '';
}).transform((value) => new URL(value).origin);

const DatabaseUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === 'postgresql:' || url.protocol === 'postgres:')
    && url.hostname.length > 0
    && url.pathname.length > 1;
});

export const BlogConfigSchema = z.object({
  PORT: PortSchema,
  PUBLIC_ORIGIN: PublicOriginSchema,
  DATABASE_URL: DatabaseUrlSchema,
});

export type BlogConfig = z.infer<typeof BlogConfigSchema>;

export function blogConfigOptions(
  env: ConfigProcessEnv,
  envFilePaths: readonly string[],
): ConfigModuleOptions {
  return {
    global: true,
    envFilePaths,
    defaults: { PORT: '3000' },
    processEnv: {
      PORT: env.PORT,
      PUBLIC_ORIGIN: env.PUBLIC_ORIGIN,
      DATABASE_URL: env.DATABASE_URL,
    },
    schema: BlogConfigSchema,
  };
}
```

포트 입력을 십진 숫자의 문자열로 제한했으므로 빈 문자열, 음수, 소수, `3000oops`는 통과하지 못한다. 변환 후의 범위 검사도 필요하다. 숫자로만 이루어진 `"999999"`를 올바른 TCP 포트로 받아들여서는 안 된다. 공개 URL은 마지막 `/`를 정규화하는 한편, `/blog`와 같은 배치 경로를 거부한다. 이 단계의 FluoBlog는 사이트 루트에 배치하는 계약이기 때문이다. 하위 경로 배포를 시작한다면 이 조건만 풀지 말고 라우팅과 링크 생성을 함께 바꿔야 한다.

이 `1..65535` 범위와 문자열 검증은 FluoBlog의 정책이다. CLI가 생성하는 `Number.parseInt(..., 10)`와 유한하지 않은 결과의 `3000` fallback을 재현하는 스키마가 아니다. Fastify의 숫자 옵션은 포트 `0`도 허용하지만 이 앱은 사용하지 않는다. 1장의 작은 `readPort`를 이번 설정 스키마로 옮기는 것이며, CLI나 어댑터의 입력 계약을 바꾸는 작업은 아니다.

`DATABASE_URL`에 기본값을 두지 않은 점도 중요하다. 연결할 곳이 불분명할 때 개발 DB로 연결하는 것보다 시작을 중단하는 편이 원인을 찾기 쉽다. 스키마가 받아들인 URL이어도 비밀번호가 틀리거나 네트워크가 끊어질 수 있다. 문법의 정확성, 연결 가능성, 수행할 작업에 대한 권한은 별도의 검사다.

`PORT`의 스키마 입력은 문자열이고 출력은 숫자다. `ConfigService<BlogConfig>`에 전달하는 타입은 입력이 아니라 이 출력이다. 타입 인수를 쓴다고 실행 시 검증이 생기는 것은 아니다. 여기서는 등록에 쓰는 스키마와 소비하는 타입을 같은 정의에서 만들어 대응을 유지한다.

## 등록한 설정을 DI로 전달하기

다음은 `src/config/app-settings.ts`의 완전한 파일이다. 애플리케이션 서비스가 필요로 하는 이름을 getter로 공개한다. 이로써 `DATABASE_URL`이라는 배포용 표기가 모든 기능 파일에 퍼지는 것을 피할 수 있다. 설정을 반환하기 위한 거대한 추상화는 만들지 않고, 지금 필요한 세 가지로 제한한다.

```ts
import { ConfigService } from '@fluojs/config';
import { Inject } from '@fluojs/core';
import type { BlogConfig } from './blog-config.js';

@Inject(ConfigService)
export class AppSettings {
  constructor(private readonly config: ConfigService<BlogConfig>) {}

  get port(): number {
    return this.config.getOrThrow('PORT');
  }

  get publicOrigin(): string {
    return this.config.getOrThrow('PUBLIC_ORIGIN');
  }

  get databaseUrl(): string {
    return this.config.getOrThrow('DATABASE_URL');
  }
}
```

아래는 `src/config/app-settings.module.ts`의 완전한 파일이다. 클래스 수준의 `@Inject(ConfigService)`만으로 제공자가 생기지는 않는다. `imports`가 설정 등록을 가져오고, `providers`가 `AppSettings`를 만들며, `exports`가 다른 모듈에 공개한다.

```ts
import { ConfigModule } from '@fluojs/config';
import { Module } from '@fluojs/core';
import { AppSettings } from './app-settings.js';
import { blogConfigOptions, type BlogConfig } from './blog-config.js';

const envFiles = process.env.NODE_ENV === 'production'
  ? []
  : ['.env', '.env.local'];

export const blogConfig: Readonly<BlogConfig> = Object.freeze(
  ConfigModule.load(blogConfigOptions(process.env, envFiles)) as BlogConfig,
);

const configRegistration = ConfigModule.forRoot({
  global: true,
  envFilePaths: [],
  runtimeOverrides: blogConfig,
});

@Module({
  global: true,
  imports: [configRegistration],
  providers: [AppSettings],
  exports: [AppSettings],
})
export class AppSettingsModule {}
```

이 파일의 환경 판단은 Fluo의 자동 기능이 아니라 우리가 선택한 정책이다. `NODE_ENV=production`에서는 파일 입력을 비활성화하고, 나머지 실행에서는 두 파일을 지정 순서대로 읽는다. CI에서는 `production`을 명시하거나 단위 테스트처럼 함수에 빈 목록을 전달한다. `envFilePaths: []`는 기본 `.env`로의 대체 동작도 비활성화한다. `envFilePaths`를 생략하면 file-capable load에서만 이 기본값을 선택하고, 명시적 in-memory source는 이를 억제한다. 파일을 지정한 경우 상대 경로는 시작 디렉터리를 기준으로 하므로 개발 명령은 항상 `fluo-blog` 루트에서 실행한다.

여기서는 전체에서 하나만 가지는 설정을 전역으로 공개했다. `ConfigModule`의 기본값도 `global: true`지만 구성 의도를 읽을 수 있도록 명시했다. 설정을 플러그인별로 격리하는 애플리케이션이라면 `global: false`와 명시적 모듈 가져오기를 선택한다. 전역 공개가 타입이나 값 검증을 약하게 하지는 않지만, 의존 관계가 덜 드러나므로 사용하는 클래스에서는 `@Inject`를 생략하지 않는다.

이번에는 어댑터 생성 전에 포트를 알아야 하므로 `ConfigModule.load(...)`로 한 번 검증하고 그 결과를 등록한다. 공개 반환 타입은 일반 설정 딕셔너리다. 여기의 `as BlogConfig`는 입력 검증을 대신하는 단언이 아니라, 바로 앞에서 실행한 `BlogConfigSchema`의 출력과 타입 사이의 대응을 나타낸다. 원시 환경 변수에 같은 단언을 붙여서는 안 된다. 모든 필드가 원시값인 결과를 동결하고, DI에는 이 스냅샷만 넘겨 파일을 두 번 읽지 않는다. 이미 숫자가 된 포트에 문자열 입력용 스키마를 다시 적용하지도 않는다.

등록과 검증의 시점은 다르다. `ConfigModule.forRoot(...)`는 동기적으로 provider를 등록하며, 일반적인 schema 등록에서는 bootstrap이 `ConfigService`를 해석할 때 설정을 로드하고 listen 전에 동기 검증한다. 여기서는 명시적 `ConfigModule.load(...)`가 이 모듈을 평가하는 도중 실행되므로 그보다 먼저 검증한다. 스키마 실패는 `INVALID_CONFIG`이며, 아래 dynamic import와 `FluoFactory.create()`까지 도달하지 않는다. 이미 검증한 snapshot을 다시 등록하는 이 흐름을 “`forRoot` 호출만으로 파일 로드가 끝났다”는 설명과 혼동하지 않는다.

`src/app.ts`의 기존 `AppModule`에는 `AppSettingsModule`을 가져와 `imports`에 추가한다. 다음은 기존 모듈과의 합성 부분이며 HTTP 설정을 모두 대체하는 파일은 아니다. `PostsModule`은 앞 장까지의 `src/posts/posts.module.ts`다. 생성된 greeting·health와 기존 기능 등록은 유지하며, 생성 때의 config 등록도 같은 키를 다시 읽는 두 번째 설정 원본으로 남기지 않고 이 snapshot 경로로 합성한다.

```ts
import { Module } from '@fluojs/core';
import { AppSettingsModule } from './config/app-settings.module.js';
import { PostsModule } from './posts/posts.module.js';

@Module({
  imports: [AppSettingsModule, PostsModule],
})
export class AppModule {}
```

이제 실제 시작 포트도 연결한다. 아래는 이 설정을 사용하는 `src/main.ts`의 최소 완전한 파일이다. 앞 장에서 추가한 미들웨어나 요청 처리 옵션이 있다면 같은 static factory의 한 options 객체에 유지한다. 메타데이터 심벌을 준비한 뒤 장식된 앱 그래프를 동적으로 가져오므로 응답 모델의 데코레이터보다 준비가 늦어지지 않는다. `ensureMetadataSymbol()` 아래에 static import를 놓는 것만으로는 이 순서를 만들 수 없다. 그 import는 진입점 본문보다 먼저 평가된다.

```ts
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger, createNodeShutdownSignalRegistration } from '@fluojs/platform-nodejs';
import { ensureMetadataSymbol } from '@fluojs/core';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';

ensureMetadataSymbol();
const { AppModule } = await import('./app.js');
const { blogConfig } = await import('./config/app-settings.module.js');

const app = await FluoFactory.create(AppModule, {
  adapter: FastifyHttpApplicationAdapter.create({
    host: '127.0.0.1',
    port: blogConfig.PORT,
  }),
  logger: createConsoleApplicationLogger(),
  shutdownRegistration: createNodeShutdownSignalRegistration(),
});
await app.listen();
```

`FluoFactory.create()`에 전달할 adapter는 이미 검증한 `blogConfig.PORT`로 구성한다. `app.listen()`을 기다리면 수신과 선택한 shutdown 등록이 끝난다. 서비스의 `AppSettings.port`도 같은 snapshot을 사용한다. 검증 실패는 생성 전에 멈추며, 수신 뒤 주입된 설정으로 port를 옮기는 동작은 없다.

검증된 snapshot을 canonical `FluoFactory.create()`와 `app.listen()` recipe와 함께 유지한다. Factory는 공통 middleware를 조합하고 생성이나 시작이 실패하면 확보한 자원을 정리한다. 앱은 logger와 host 소유 signal 등록을 명시적으로 선택하며, 기존에 구성한 middleware와 adapter 업로드 제한도 유지한다. 다음 장의 `BlogDatabaseModule`은 같은 `AppSettings.databaseUrl`을 사용하고, 뒤에서 인증 설정을 확장할 때도 이 검증 경로를 이어 간다. DB·인증 설정을 위해 환경을 다시 읽는 별도 설정 원본을 만들지 않는다.

## 공개 링크에서 환경 의존 제거하기

설정 도입을 등록 코드로 끝내지 말고 실제 문제를 하나 해결하자. 아래는 `src/posts/post-links.ts`의 완전한 파일이다. 기존 `/posts/:id` 계약에 맞춰 ID로 링크를 만든다. `slug`를 만든 것과 slug 기반 HTTP 경로를 공개한 것은 같은 일이 아니다.

```ts
import { Inject } from '@fluojs/core';
import { AppSettings } from '../config/app-settings.js';

@Inject(AppSettings)
export class PostLinks {
  constructor(private readonly settings: AppSettings) {}

  detail(id: number): string {
    return new URL(`/posts/${id}`, this.settings.publicOrigin).href;
  }
}
```

`PostLinks`를 `PostsModule.providers`에 추가하고, 공개 응답을 조립하는 기존 서비스가 `@Inject(PostLinks)`로 받도록 한다. 반환용 ID는 앞 장까지의 경계에서 확인한 양의 정수를 사용한다. 요청의 `Host` 헤더를 공개 링크의 기준으로 그대로 쓰지 않는다. 이용자가 보낸 호스트 이름과 운영자가 공개하는 정식 주소는 서로 다른 신뢰 경계에 있다.

설정 파일의 예도 정해 둔다. 아래는 `.env.example`의 완전한 내용이며 연결 주소와 자격 증명은 로컬 실습용 예시다. 실제로 사용하는 `.env`와 `.env.local`은 버전 관리에서 제외한다. 제외 설정을 추가한다고 이미 추적한 비밀이 기록에서 사라지는 것은 아니다.

```dotenv
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://fluo:local_only@127.0.0.1:5432/fluo_blog
```

운영 로그에 설정 전체를 출력하는 확인 방법은 쓰지 않는다. DB URL에는 사용자 이름과 비밀번호가 포함될 수 있다. 시작 진단에서는 포트, 공개 origin, 설정 검증 성공 여부를 구별해 기록하면 된다. 오류의 `cause`나 validator의 issue를 외부 응답에 통째로 반환하지 않는 것도 중요하다. 오류의 존재를 숨기는 것이 아니라 연결에 필요한 비밀과 진단에 필요한 사실을 나누는 것이다.

## 컴퓨터 상태에 좌우되지 않는 테스트

아래는 `test/config.test.ts`의 완전한 파일이다. 먼저 이 테스트를 쓰면 사용처에서 직접 `process.env`를 읽는 구현에는 기대한 입력 격리가 없음을 알 수 있다. 테스트 자체는 실제 환경 변수를 변경하지 않고, 파일도 건드리지 않으며, 대기 시간에도 의존하지 않는다. 앞 장까지의 Vitest 구성으로 실행한다.

```ts
import { ConfigModule, ConfigService } from '@fluojs/config';
import { describe, expect, it } from 'vitest';
import { blogConfigOptions } from '../src/config/blog-config.js';

const validEnv = {
  PUBLIC_ORIGIN: 'https://blog.example.test/',
  DATABASE_URL: 'postgresql://fluo:local_only@127.0.0.1:5432/fluo_blog',
};

describe('FluoBlog configuration', () => {
  it('transforms inputs and keeps only the explicit application keys', () => {
    const values = ConfigModule.load(blogConfigOptions({
      ...validEnv,
      PORT: '4100',
      UNRELATED_SECRET: 'not-part-of-the-blog',
    }, []));

    expect(values).toEqual({
      PORT: 4100,
      PUBLIC_ORIGIN: 'https://blog.example.test',
      DATABASE_URL: validEnv.DATABASE_URL,
    });
  });

  it('does not let an absent process value erase the default', () => {
    const values = ConfigModule.load(blogConfigOptions(validEnv, []));
    expect(values.PORT).toBe(3000);
  });

  it('applies explicit overrides above the environment', () => {
    const options = blogConfigOptions({ ...validEnv, PORT: '4100' }, []);
    const values = ConfigModule.load({
      ...options,
      runtimeOverrides: { PORT: '4200' },
    });
    expect(values.PORT).toBe(4200);
  });

  it.each(['', '0', '-1', '3.5', '3000oops', '65536'])(
    'rejects invalid PORT %j',
    (PORT) => {
      expect(() => ConfigModule.load(
        blogConfigOptions({ ...validEnv, PORT }, []),
      )).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    },
  );

  it('rejects a missing database and a public address with a path', () => {
    expect(() => ConfigModule.load(blogConfigOptions({
      PUBLIC_ORIGIN: validEnv.PUBLIC_ORIGIN,
    }, []))).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));

    expect(() => ConfigModule.load(blogConfigOptions({
      ...validEnv,
      PUBLIC_ORIGIN: 'https://blog.example.test/private',
    }, []))).toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('returns detached object values', () => {
    const config = new ConfigService({ links: { origin: validEnv.PUBLIC_ORIGIN } });
    const links = config.getOrThrow('links');
    links.origin = 'https://changed.example.test';
    expect(config.getOrThrow('links.origin')).toBe(validEnv.PUBLIC_ORIGIN);
  });
});
```

```bash
pnpm exec vitest run test/config.test.ts
```

성공 시 관측할 것은 포트의 숫자 변환, 마지막 `/`의 정규화, 불필요한 키의 부재, `INVALID_CONFIG`를 통한 거부, 반환 객체 변경으로부터의 격리다. 이 장의 집필 시점에 이 애플리케이션용 테스트를 실행했다고 주장하지 않는다. 패키지 구현과 계약 테스트를 근거로 구성한 재현용 테스트이며 독자의 프로젝트에 파일을 추가한 뒤 실행한다.

파일 계층을 확인하는 실험에서는 로컬 전용 `.env`를 `PORT=3100`, `.env.local`을 `PORT=3200`으로 하고 프로세스 입력은 `PORT=3300`으로 시작한다. 기대값은 `3300`이며 프로세스 입력을 제거하면 `3200`이 된다. 상위 파일을 삭제하면 하위 파일로 돌아가지만 필수 DB URL까지 사라졌다면 시작 실패가 올바르다. 테스트에서 파일이 존재한다는 것과 필수 값이 모두 있다는 것을 혼동하지 않는다.

## 변경 가능하게 만들지 않는 판단

`ConfigService`가 읽기 전용이라는 말은 조회할 때마다 상수가 같은 참조로 반환된다는 뜻이 아니다. 객체 값은 분리된 clone으로 반환되므로 가져온 객체를 변경해도 활성 스냅샷은 바뀌지 않는다. 큰 설정 트리 전체를 매 요청마다 가져올 필요는 없다. 필요한 말단 값만 읽는 편이 복사 비용과 의존 관계를 모두 줄인다.

패키지에는 reload와 watch도 있지만 이 단계에서는 켜지 않는다. DB URL을 바꾼다고 기존 Prisma 연결이 자동으로 새 DB로 전환되는 것은 아니다. 포트를 바꿔도 열린 소켓은 이동하지 않는다. 설정 스냅샷 갱신과 설정을 바탕으로 만든 자원의 재생성은 별개 작업이다. 우선은 설정 변경을 검증이 포함된 재시작에 연결한다.

나중에 화면의 기능 플래그만 갱신하고 싶어진다면 변경 가능한 값과 시작 시 고정하는 값을 나누어 reload를 설계한다. 설정 listener가 실패했을 때 스냅샷을 복구한다는 계약은 이미 수행한 외부 작업까지 되돌린다는 보장이 아니다. 또한 `ConfigModule.forRootAsync()`라는 등록 API는 없다. 비동기 비밀 관리 서비스가 필요하다면 애플리케이션 소유 시작 처리에서 먼저 해결하고 그 결과를 동기 등록으로 전달한다.

FluoBlog는 이제 개발용과 운영용 주소를 소스 코드에서 분리했다. 다음 문제는 올바른 환경에서 실행해도 재시작하면 게시글이 사라진다는 점이다. 다음 장에서는 `AppSettings.databaseUrl`을 사용해 PostgreSQL 연결을 하나 등록하고 메모리의 게시글을 영속화한다. 여기서 정한 입력 경계는 나중에 같은 블로그에 상품 기능을 추가할 때도 이어 간다.

## 기준 Docs

이 장은 Docs의 설정·시작 순서를 하나의 FluoBlog snapshot으로 설명한다. 허용 URL과 엄격한 포트, env 파일 선택은 앱의 정책이며, 등록 API 자체의 기본값과 구별한다.

- [문서 권위와 Book의 역할](../../docs/contracts/documentation-authority.ko.md)
- [설정 로드, 우선순위와 검증 계약](../../docs/architecture/config-and-environments.ko.md)
- [설정 검증·metadata 준비와 bootstrap 경계](../../docs/getting-started/bootstrap-paths.ko.md)

## 근거가 되는 구현과 계약

- [설정 패키지의 등록·우선순위·실행 환경 계약](../../packages/config/README.ko.md)
- [공개 export](../../packages/config/src/index.ts)와 [설정 옵션 타입](../../packages/config/src/types.ts)
- [파일 입력, 미정의 값 제거, 병합, 검증 구현](../../packages/config/src/load.ts)
- [모듈 등록과 스냅샷 제공](../../packages/config/src/module.ts)
- [읽기와 clone 구현](../../packages/config/src/service.ts)
- [다중 env 파일, 빈 목록, watch 계약 테스트](../../packages/config/src/load-env-file-paths.test.ts)
- [객체와 배열의 병합 계약 테스트](../../packages/config/src/load-merge-contract.test.ts)
- [설정 스냅샷과 HTTP 어댑터의 시작 순서 계약](../../docs/getting-started/migrate-from-nestjs.ko.md)
- [Fastify static factory와 시작 옵션](../../packages/platform-fastify/src/adapter.ts)

[이전: 사용자가 이해할 수 있는 API 계약 만들기](./ch08-api-contracts.ko.md) · [1권 목차](./toc.ko.md) · [다음: 메모리의 게시글을 데이터베이스로 옮기기](./ch10-prisma-persistence.ko.md)
