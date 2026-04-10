# 파트 III 개요 — 기능 확장과 생태계

> **기준 소스**: [ex:realworld-api/README.md] [repo:docs/concepts/auth-and-jwt.md] [repo:docs/concepts/observability.md] [repo:docs/reference/package-chooser.md]

이 파트는 독자를 core 경로에서 실전 기능 개발로 확장시킨다. real module, auth, observability, persistence 선택, package 선택 기준이 여기서 본격적으로 등장한다.

## 파트 목표

1. feature slice 접근이 실제로 확장 가능한 구조임을 보여준다.
2. 개념 문서와 실행 가능한 예제를 촘촘히 연결한다.
3. 패키지 이름 외우기보다 문제별 선택 기준을 익히게 한다.

## 포함될 챕터

### 11장. 실전 CRUD 패턴

realworld-api 예제를 첫 번째 실전 해설 대상으로 삼는다. 이 예제는 config loading, DTO validation, explicit DI token, CRUD surface를 한 번에 보여준다 `[ex:realworld-api/README.md]`.

### 12장. 인증과 Principal 흐름

auth 개념 문서는 `@fluojs/jwt`, `@fluojs/passport`, `@fluojs/http`의 책임 분리를 설명하고, auth 예제는 bearer-token 흐름을 실행 가능한 형태로 제공한다 `[repo:docs/concepts/auth-and-jwt.md]` `[ex:auth-jwt-passport/README.md]`.

```ts
// source: ex:auth-jwt-passport/src/auth/auth.service.ts
@Inject(DefaultJwtSigner)
export class AuthService {
  constructor(private readonly signer: DefaultJwtSigner) {}

  async issueToken(username: string): Promise<{ accessToken: string }> {
    const accessToken = await this.signer.signAccessToken({
      sub: username,
      roles: ['user'],
      scopes: ['profile:read'],
    });

    return { accessToken };
  }
}
```

### 13장. 관측 가능성과 운영

observability 문서와 ops 예제는 `/metrics`, `/health`, `/ready`, request correlation, custom instrumentation을 함께 설명한다 `[repo:docs/concepts/observability.md]` `[ex:ops-metrics-terminus/README.md]`.

```ts
// source: ex:ops-metrics-terminus/src/app.ts
@Module({
  imports: [
    MetricsModule.forRoot({ registry: sharedRegistry }),
    TerminusModule.forRoot({
      indicators: [new MemoryHealthIndicator({ key: 'memory', rssThresholdBytes: Number.MAX_SAFE_INTEGER })],
    }),
    OpsModule,
  ],
})
export class AppModule {}
```

### 14장. 패키지 선택과 영속성 전략

package chooser를 사용해 생태계 챕터를 패키지 알파벳순이 아니라 **사용자 목표 순서**로 배치한다 `[repo:docs/reference/package-chooser.md]`.

주요 하위 주제:

- persistence and caching
- auth and route protection
- realtime and background work
- observability and docs generation

## 연결 챕터

- `chapter-11-realworld-crud-pattern.md`
- `chapter-12-auth-and-principal-flow.md`
- `chapter-13-observability-and-operations.md`
- `chapter-14-package-choice-and-persistence-strategy.md`
