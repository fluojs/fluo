# 12장. 인증과 Principal 흐름

> **기준 소스**: [repo:docs/concepts/auth-and-jwt.md] [ex:auth-jwt-passport/README.md]
> **주요 구현 앵커**: [ex:auth-jwt-passport/src/auth/auth.service.ts] [ex:auth-jwt-passport/src/auth/bearer.strategy.ts]

이 장은 인증을 “JWT 라이브러리 사용법”이 아니라 **identity verification과 route protection의 결합**으로 설명한다 `[repo:docs/concepts/auth-and-jwt.md]`.

## 왜 auth 장이 별도로 필요한가

HTTP 장을 읽고 나면 독자는 request pipeline을 이해했다고 느낀다. 하지만 인증이 들어오는 순간 그 파이프라인은 훨씬 현실적인 모양을 갖춘다. 누가 요청을 보냈는지, 어떤 principal이 context에 실리는지, route protection은 어느 단계에서 끊기는지가 모두 중요해지기 때문이다 `[repo:docs/concepts/auth-and-jwt.md]`.

fluo의 auth 설명에서 중요한 것은 책임 분리다.

- `@fluojs/jwt`는 토큰 서명/검증을 담당한다.
- `@fluojs/passport`는 strategy bridge를 담당한다.
- `@fluojs/http`는 guard 실행 시점과 context 주입을 담당한다 `[repo:docs/concepts/auth-and-jwt.md]`.

즉, 인증은 하나의 패키지가 아니라 여러 층의 협업이다.

이 점은 fluo auth 설계의 강점이기도 하다. 토큰 발급, 검증 전략, request pipeline 통합이 한 패키지에 뒤엉키지 않고 분리되어 있기 때문에, 사용자는 각 층의 책임을 더 분명히 이해할 수 있다.

## principal이 중요한 이유

문서는 인증 방법이 달라도 애플리케이션은 일관된 principal을 다루도록 설계되어 있다고 설명한다 `[repo:docs/concepts/auth-and-jwt.md]`. 이 점은 프레임워크 사용성보다 더 중요한데, 비즈니스 로직이 인증 메커니즘 상세에 덜 묶이기 때문이다.

즉, 애플리케이션 코드는 “JWT를 어떻게 검증했는가”보다 “현재 principal이 누구인가”를 더 중요하게 다룰 수 있다. 이것이 유지보수성과 교체 가능성을 동시에 높인다.

## 예제에서 볼 지점

`auth.service.ts`는 토큰 발급의 중심이고 `[ex:auth-jwt-passport/src/auth/auth.service.ts]`, `bearer.strategy.ts`는 bearer token이 어떻게 검증 흐름에 연결되는지 보여주는 앵커다 `[ex:auth-jwt-passport/src/auth/bearer.strategy.ts]`.

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

이 코드는 인증 장에서 매우 중요한 의미를 가진다. 비즈니스 코드가 직접 JWT 구조를 손으로 조립하는 대신, signer contract에 기대어 principal payload를 토큰으로 바꾸는 것이다 `[ex:auth-jwt-passport/src/auth/auth.service.ts]`. 즉, auth는 문자열 토큰 처리 기술이 아니라 **principal contract를 발급하고 복원하는 설계**다.

책에서는 이 두 파일을 분리해서 읽는 게 좋다.

- `auth.service.ts`는 credential을 principal로 바꾸는 발급 측면
- `bearer.strategy.ts`는 bearer token을 다시 principal로 복원하는 검증 측면

이 둘을 함께 보면 “발급”과 “검증”이 대칭 구조로 보이고, 왜 route protection이 HTTP pipeline의 특정 단계에 걸쳐 있어야 하는지도 더 분명해진다.

## 보호된 라우트는 코드에서 어떤 모양인가

`auth.controller.ts` 안의 profile route는 auth 장 전체를 매우 작은 표면적으로 보여 준다 `[ex:auth-jwt-passport/src/auth/auth.controller.ts]`.

```ts
// source: ex:auth-jwt-passport/src/auth/auth.controller.ts
@Controller('/profile')
export class ProfileController {
  @Get('/')
  @UseAuth('jwt')
  @RequireScopes('profile:read')
  getProfile(_input: undefined, ctx: RequestContext) {
    return { user: ctx.principal };
  }
}
```

이 코드는 세 층의 협업을 한 줄기처럼 보여 준다.

- `@UseAuth('jwt')`는 어떤 strategy를 쓸지 선언한다.
- `@RequireScopes('profile:read')`는 authorization contract를 선언한다.
- handler는 JWT 토큰 세부사항을 모르고 `ctx.principal`만 사용한다.

즉, 인증 메커니즘은 pipeline 바깥에서 해결되고, business handler는 principal contract만 소비한다.

## bearer strategy는 무엇을 검증하는가

`BearerJwtStrategy`는 auth 장의 또 다른 핵심이다 `[ex:auth-jwt-passport/src/auth/bearer.strategy.ts]`.

```ts
// source: ex:auth-jwt-passport/src/auth/bearer.strategy.ts
@Inject(DefaultJwtVerifier)
export class BearerJwtStrategy implements AuthStrategy {
  constructor(private readonly verifier: DefaultJwtVerifier) {}

  async authenticate(context: GuardContext) {
    const authorization = readAuthorizationHeader(context);
    if (!authorization) {
      throw new AuthenticationRequiredError('Authorization header is required.');
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AuthenticationFailedError('Authorization header must use Bearer token format.');
    }

    return await this.verifier.verifyAccessToken(token);
  }
}
```

이 발췌가 중요한 이유는, verification 로직이 놀랄 만큼 단순하고 직선적이라는 점이다. header를 읽고, bearer 형식을 확인하고, verifier에 위임한다. 다시 말해 auth 전략은 **복잡한 보안 엔진**이라기보다, request에서 principal을 복원하는 경계 어댑터에 가깝다.

## `AuthGuard`는 strategy를 HTTP 파이프라인에 연결한다

example 전략만 보면 “검증은 알겠는데, 그게 어떻게 route protection으로 이어지지?”라는 질문이 남는다. 그 접합부가 바로 `packages/passport/src/guard.ts`의 `canActivate(...)`다 `[pkg:passport/src/guard.ts]`.

```ts
// source: pkg:passport/src/guard.ts
async canActivate(context: GuardContext): Promise<true> {
  const requirement = getAuthRequirement(context.handler.controllerToken, context.handler.methodName);
  const strategyName = requirement?.strategy ?? this.options.defaultStrategy;

  if (!hasRegisteredStrategy(this.strategies, strategyName)) {
    throw new AuthStrategyResolutionError(`No auth strategy registered for ${strategyName}.`);
  }

  const strategyToken = this.strategies[strategyName];
  const strategy = await context.requestContext.container.resolve(strategyToken as Token<AuthStrategy>);
  const result = await strategy.authenticate(context);
  const principal = resolvePrincipal(result);

  if (requirement?.scopes?.length && !hasRequiredScopes(principal, requirement.scopes)) {
    throw new ForbiddenException('Access denied.');
  }

  context.requestContext.principal = principal;
  return true;
}
```

이 코드는 auth 장의 전체 논리를 한데 묶는다. decorator는 requirement를 기록하고, guard는 그 requirement를 읽고, container는 strategy를 resolve하고, strategy는 principal을 복원하고, 마지막으로 guard가 principal을 request context에 심는다 `[pkg:passport/src/guard.ts#L92-L149]`. 즉, auth는 패키지 하나의 능력이 아니라 **metadata → guard → strategy → principal**로 이어지는 파이프라인이다.

## auth module은 이 모든 조각을 어떻게 조립하는가

`auth.module.ts`를 보면 발급, 검증, guard 연결이 한 providers 배열 안에 조립된다 `[ex:auth-jwt-passport/src/auth/auth.module.ts]`.

```ts
// source: ex:auth-jwt-passport/src/auth/auth.module.ts
@Module({
  controllers: [AuthController, ProfileController],
  providers: [
    AuthService,
    BearerJwtStrategy,
    ...createJwtCoreProviders({
      accessTokenTtlSeconds: 3600,
      algorithms: ['HS256'],
      audience: 'fluo-auth-example-clients',
      issuer: 'fluo-auth-example',
      secret: 'fluo-auth-example-secret',
    }),
    ...createPassportProviders(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: BearerJwtStrategy }],
    ),
  ],
})
export class AuthModule {}
```

이 코드는 auth 장의 중요한 메시지를 담고 있다. JWT core provider와 passport strategy provider는 별개지만, auth module 안에서 함께 조립된다. 즉, 인증은 한 클래스의 책임이 아니라 **여러 provider contract를 한 모듈 안에서 조합하는 문제**다.

## decorator는 auth requirement를 어떻게 기록하는가

`UseAuth`와 `RequireScopes`도 아주 짧지만, auth chapter에서는 중요하다 `[pkg:passport/src/decorators.ts#L99-L123]`.

```ts
// source: pkg:passport/src/decorators.ts
export function UseAuth(strategy: string): ClassOrMethodDecoratorLike {
  return createAuthRequirementDecorator({ strategy });
}

export function RequireScopes(...scopes: string[]): ClassOrMethodDecoratorLike {
  return createAuthRequirementDecorator({ scopes });
}
```

이 코드는 auth decorator도 결국 metadata를 기록하는 얇은 층이라는 사실을 보여 준다. 즉, auth chapter도 6장 core metadata 장과 직접 연결된다. 보호된 route의 마법은 decorator가 해 주는 것이 아니라, 그 기록을 guard가 나중에 읽으면서 생긴다.

## auth e2e 테스트가 왜 중요한가

`examples/auth-jwt-passport/src/app.test.ts`의 e2e 구간은 이 장의 아주 좋은 증거 자료다 `[ex:auth-jwt-passport/src/app.test.ts#L123-L151]`.

```ts
// source: ex:auth-jwt-passport/src/app.test.ts
await expect(app.dispatch({ method: 'GET', path: '/profile/' })).resolves.toMatchObject({
  status: 401,
});

const issueResult = await app.dispatch({
  method: 'POST',
  path: '/auth/token',
  body: { username: 'grace' },
});

const profileResult = await app.dispatch({
  headers: { authorization: `Bearer ${(issueResult.body as { accessToken: string }).accessToken}` },
  method: 'GET',
  path: '/profile/',
});
```

이 테스트는 세 가지 상태를 한 번에 증명한다. 토큰이 없으면 401, 토큰을 발급받으면 201, 올바른 bearer token을 붙이면 보호된 route가 200으로 열린다. 즉, auth 장은 이론보다 **상태 전이 증명**이 중요하다.

조금 더 자세히 보면 이 테스트는 auth 장의 세 계약을 동시에 확인한다.

- issuance contract: `/auth/token`이 principal payload를 access token으로 바꾼다.
- verification contract: bearer strategy가 token을 다시 principal로 복원한다.
- authorization contract: `profile:read` scope가 없는 요청은 route를 통과하지 못한다.

이런 식으로 장을 쓰면 auth는 JWT 사용법이 아니라 **principal lifecycle**로 읽히게 된다.

## 메인테이너 시각

인증은 항상 앱 코드보다 오래 살아남는 요구사항이다. 그래서 메인테이너는 auth를 “로그인 기능”이 아니라 **principal contract와 route protection contract를 유지하는 문제**로 본다. 이 관점을 책에 분명히 넣어야 auth 장이 단순 라이브러리 사용법을 넘어선다.
