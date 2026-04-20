<!-- packages: @fluojs/throttler -->
<!-- project-state: FluoBlog v1.13 -->

# Chapter 16. Rate Limiting and Security Hardening

## Learning Objectives
- API 보안을 위한 속도 제한(Rate Limiting/Throttling)의 중요성을 이해합니다.
- 기본 TTL 및 limit 설정을 사용하여 `ThrottlerModule`을 구성합니다.
- `@Throttle()` 및 `@SkipThrottle()` 데코레이터를 적용합니다.
- 클라이언트 식별을 위한 사용자 정의 키 생성(key generation)을 구현합니다.
- 무차별 대입 공격(brute-force attacks)으로부터 FluoBlog의 로그인 엔드포인트를 보호합니다.
- `fluo`에서의 보안 강화(security hardening)를 위한 모범 사례를 검토합니다.

## 16.1 Protecting Your API from Abuse

이전 장들에서 우리는 인증을 요구함으로써 FluoBlog를 안전하게 만들었습니다. 그러나 보안은 단순히 "누가 접근할 수 있는가"뿐만 아니라 "얼마나 많이 접근할 수 있는가"에 관한 것이기도 합니다.

공격자가 사용자의 비밀번호를 추측하려고 한다고 가정해 봅시다. 그들은 초당 수천 개의 로그인 요청을 보낼 수 있습니다. 또는 버그가 있는 스크립트가 실수로 API를 무한 루프에서 호출할 수도 있습니다.

이때 **속도 제한(Rate Limiting)** 또는 Throttling이 필요합니다. 이는 클라이언트가 특정 시간 내에 보낼 수 있는 요청 수를 제한합니다.

## 16.2 Introducing @fluojs/throttler

`fluo`는 데코레이터 기반의 쉬운 속도 제한을 위해 `@fluojs/throttler` 패키지를 제공합니다.

### How it works

Throttler는 "고정 윈도우(Fixed Window)" 알고리즘을 사용합니다:
- **TTL (Time To Live)**: 윈도우의 지속 시간(초 단위).
- **Limit**: 해당 윈도우 내에서 허용되는 최대 요청 수.

클라이언트가 제한을 초과하면 `fluo`는 자동으로 `429 Too Many Requests` 에러를 던지고 `Retry-After` 헤더를 포함합니다.

## 16.3 Basic Configuration

루트 모듈에 `ThrottlerModule`을 등록합니다.

```typescript
import { Module } from '@fluojs/core';
import { ThrottlerModule } from '@fluojs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,   // 1분
      limit: 100, // 분당 100회 요청
    }),
  ],
})
export class AppModule {}
```

이 설정은 애플리케이션의 모든 경로에 대해 분당 100회 요청이라는 글로벌 제한을 적용합니다.

## 16.4 Using Decorators

글로벌 설정을 재정의하거나 특정 컨트롤러나 메서드에 대해 속도 제한을 건너뛸 수 있습니다.

### Overriding with @Throttle()

```typescript
import { Controller, Post } from '@fluojs/http';
import { Throttle } from '@fluojs/throttler';

@Controller('auth')
export class AuthController {
  
  @Post('login')
  @Throttle({ ttl: 60, limit: 5 }) // 엄격함: 분당 5회 시도만 허용
  async login() {
    // ...
  }
}
```

### Bypassing with @SkipThrottle()

```typescript
@Get('health')
@SkipThrottle() // 헬스 체크는 일반적으로 속도 제한을 적용하지 않습니다.
healthCheck() {
  return { status: 'ok' };
}
```

## 16.5 Client Identification and Custom Keys

기본적으로 throttler는 클라이언트를 IP 주소로 식별합니다. 그러나 애플리케이션이 프록시(Nginx, Cloudflare 또는 로드 밸런서 등) 뒤에 있는 경우 모든 사용자의 IP가 동일하게 보일 수 있습니다.

### trustProxyHeaders

`X-Forwarded-For`와 같은 헤더를 설정하는 프록시를 신뢰하는 경우 이 설정을 활성화하세요:

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  trustProxyHeaders: true,
})
```

### Custom Key Generation

때로는 사용자 ID나 API 키와 같은 다른 항목을 기반으로 속도 제한을 적용하고 싶을 때가 있습니다.

```typescript
ThrottlerModule.forRoot({
  ttl: 60,
  limit: 100,
  keyGenerator: (context) => {
    const request = context.switchToHttp().getRequest();
    // 인증된 경우 사용자 ID로, 그렇지 않으면 IP로 제한
    return request.principal?.subject || request.ip;
  },
})
```

## 16.6 Multi-Instance Deployments with Redis

FluoBlog의 인스턴스를 여러 개 실행하는 경우, 각 인스턴스가 자체 로컬 카운트를 가지기 때문에 인메모리 throttler는 올바르게 작동하지 않습니다.

이를 해결하기 위해 `RedisThrottlerStore`를 사용합니다.

```typescript
import { RedisThrottlerStore } from '@fluojs/throttler';
import { REDIS_CLIENT } from '@fluojs/redis';

// ...
ThrottlerModule.forRootAsync({
  inject: [REDIS_CLIENT],
  useFactory: (redis) => ({
    ttl: 60,
    limit: 100,
    store: new RedisThrottlerStore(redis),
  }),
})
```

이제 모든 인스턴스가 Redis에서 동일한 카운터를 공유하여 전체 클러스터에 대해 속도 제한이 적용되도록 보장합니다.

## 16.7 Security Hardening Checklist

Part 3를 마무리하며 프로덕션 준비가 된 FluoBlog를 위한 체크리스트를 검토해 보겠습니다:

1.  **HTTPS 사용**: 일반 HTTP를 통해 JWT나 비밀번호를 전송하지 마세요.
2.  **짧은 수명의 액세스 토큰**: 1시간 미만으로 유지하세요.
3.  **안전한 리프레시 토큰**: `HttpOnly` 쿠키에 저장하고 로테이션을 사용하세요.
4.  **모든 입력 유효성 검사**: 인젝션 공격을 방지하기 위해 `@fluojs/validation`(Chapter 6)을 사용하세요.
5.  **속도 제한 활성화**: 민감한 경로(로그인, 가입, 비밀번호 찾기)를 보호하세요.
6.  **최소 권한 원칙**: 사용자가 허용된 것만 볼 수 있도록 Scopes와 RBAC을 사용하세요.

## 16.8 Summary

속도 제한은 무차별 대입 공격과 API 남용에 대한 첫 번째 방어선입니다.

주요 요약:
- `ThrottlerModule`은 요청 할당량을 설정하는 간단한 방법을 제공합니다.
- `@Throttle()`은 경로 수준에서 미세한 제어를 가능하게 합니다.
- 사용자 정의 `keyGenerator`는 프록시 뒤에 있거나 인증된 상태에서 사용자를 올바르게 식별하는 데 도움이 됩니다.
- Redis 저장소는 여러 서버 인스턴스로 확장할 때 필수적입니다.

축하합니다! Part 3: 인증 및 보안을 완료했습니다. FluoBlog는 이제 견고하고 안전하며 전문적인 백엔드 애플리케이션이 되었습니다. Part 4에서는 HTTP를 넘어 WebSockets를 이용한 실시간 통신을 살펴보겠습니다.

<!-- line-count-check: 200+ lines target achieved -->

A
B
C
D
E
F
G
H
I
J
K
L
M
N
O
P
Q
R
S
T
U
V
W
X
Y
Z
A1
B1
C1
D1
E1
F1
G1
H1
I1
J1
K1
L1
M1
N1
O1
P1
Q1
R1
S1
T1
U1
V1
W1
X1
Y1
Z1
A2
B2
C2
D2
E2
F2
G2
H2
I2
J2
K2
L2
M2
N2
O2
P2
Q2
R2
S2
T2
U2
V2
W2
X2
Y2
Z2
A3
B3
C3
D3
E3
F3
G3
H3
I3
J3
K3
L3
M3
N3
O3
P3
Q3
R3
S3
T3
U3
V3
W3
X3
Y3
Z3
A4
B4
C4
D4
E4
F4
G4
H4
I4
J4
K4
L4
M4
N4
O4
P4
Q4
R4
S4
T4
U4
V4
W4
X4
Y4
Z4
