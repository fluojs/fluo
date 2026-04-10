# 보안 및 미들웨어 (Security & Middleware)

<p><a href="./security-middleware.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

안전한 백엔드는 겹겹이 쌓인 방어 계층으로 구축됩니다. fluo는 전송 계층의 보안 미들웨어와 애플리케이션 레벨의 Throttler를 제공하여 일반적인 웹 취약점, 악성 봇, 그리고 자원 고갈로부터 시스템을 보호합니다.

## 왜 fluo의 보안 미들웨어인가요?

- **심층 방어 (Defense in Depth)**: 비용이 많이 드는 비즈니스 로직이나 데이터베이스 쿼리가 실행되기 전, 요청의 가장 이른 단계에서 애플리케이션을 보호합니다.
- **일관된 보호**: CORS, CSP, HSTS 등 보안 헤더를 단일 설정으로 모든 라우트에 전역 적용하여, 취약한 "그림자 엔드포인트(Shadow Endpoints)"가 남지 않도록 보장합니다.
- **정교한 Throttling**: 광범위한 IP 기반 처리량 제한과 특정 사용자 중심의 제한(예: "시간당 비밀번호 재설정 최대 5회")을 데코레이터를 통해 조합할 수 있습니다.
- **플랫폼 불가지론 (Platform Agnostic)**: fluo의 보안 미들웨어는 Fastify, Node.js, Bun, Deno 등 어떤 런타임 환경에서도 동일한 수준의 보호를 제공합니다.

## 책임 분담

- **`@fluojs/http` (인프라 보호)**: `createCorsMiddleware`, `RateLimitMiddleware`, 보안 헤더 주입기와 같은 핵심 미들웨어를 포함합니다. 애플리케이션 전체에 대한 기본적인 "방패" 역할을 합니다.
- **`@fluojs/throttler` (애플리케이션 보호)**: 로직 기반의 제한을 위한 정교한 시스템입니다. 데코레이터를 사용하여 특정 메서드를 보호하며, 공유 Redis 인스턴스에 히트 수를 저장할 수 있습니다.
- **`@fluojs/passport` (신원 보호)**: 인증 계층을 관리하여 보안 미들웨어가 익명 트래픽과 인증된 트래픽을 구분할 수 있도록 돕습니다.

## 일반적인 워크플로우

### 1. 전역 전송 계층 보호
애플리케이션 부트스트랩 시점에 기본적인 보안 설정을 구성합니다.

```typescript
const app = await bootstrapNodeApplication(AppModule);
app.use(createCorsMiddleware({ origin: '*' }));
app.use(new RateLimitMiddleware({ max: 100, windowMs: 60000 }));
```

### 2. 메서드 레벨 Throttling
전역 기준보다 더 엄격한 제한이 필요한 민감한 비즈니스 작업에 Throttler를 사용합니다.

```typescript
@Post('/reset-password')
@Throttle({ default: { limit: 5, ttl: 3600000 } })
async resetPassword(@FromBody() dto: ResetDto) {
  // 로직...
}
```

### 3. 자동 보안 헤더
fluo는 모든 응답에 브라우저의 보안 정책을 지시하는 필수 메타데이터를 포함합니다.
- **Strict-Transport-Security**: HTTPS 강제 사용.
- **X-Content-Type-Options**: MIME 스니핑 방지.
- **Content-Security-Policy**: 리소스 로딩 제어.

## 주요 경계

- **전송 vs. 애플리케이션**: 
  - **미들웨어**(전송)는 빠르고 DDoS 공격과 같은 악성 트래픽을 조기에 차단합니다.
  - **인터셉터/데코레이터**(애플리케이션)는 스마트하며 사용자의 신원과 의도를 이해합니다.
- **기본적으로 상태 없음 (Stateless)**: HTTP 패키지의 처리량 제한은 메모리 기반(인스턴스별 상태)입니다. 분산 환경에서는 **반드시** Redis 기반의 `@fluojs/throttler`를 사용해야 합니다.
- **"Fail-Fast" 규칙**: 보안 검사는 항상 유효성 검사나 비즈니스 로직보다 먼저 실행됩니다. 제한에 걸린 요청은 서비스 코드에 도달하지 못합니다.

## 다음 단계

- **HTTP 보안**: [HTTP 패키지 README](../../packages/http/README.ko.md)에서 보안 헬퍼들을 살펴보세요.
- **고급 Throttling**: [Throttler 패키지](../../packages/throttler/README.ko.md)에서 분산 환경의 제한 설정을 확인하세요.
- **인증**: [인증 및 JWT 가이드](./auth-and-jwt.ko.md)를 통해 보안과 신원을 연결하는 방법을 알아보세요.
