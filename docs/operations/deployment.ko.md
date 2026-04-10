# 배포 (Deployment)

<p>
  <strong>한국어</strong> | <a href="./deployment.md">English</a>
</p>

이 문서는 fluo 프레임워크의 프로덕션 배포 표준, 컨테이너화 패턴 및 런타임 상태 지표를 정의합니다. 이를 통해 애플리케이션이 다양한 클라우드 환경에서 회복 탄력성, 관측 가능성 및 관리 용이성을 유지할 수 있도록 보장합니다.

## 이 문서가 필요한 경우

- **프로덕션 준비**: fluo 애플리케이션을 라이브 환경에 배포하기 위해 준비할 때.
- **인프라 구성**: Kubernetes 프로브(Probe), 리소스 제한 또는 클라우드 네이티브 스케일링을 설정할 때.
- **트러블슈팅**: 시작 실패, 예기치 않은 재시작 또는 정상 종료(Graceful Shutdown) 문제를 진단할 때.

---

## 컨테이너화 (Containerization)

fluo는 이미지 크기를 최소화하고 공격 표면을 줄이기 위해 멀티 스테이지(Multi-stage) Docker 빌드를 권장합니다.

### 권장 Dockerfile 패턴
```dockerfile
# Stage 1: Builder
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY pnpm-lock.yaml package.json ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm build

# Stage 2: Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 fluo
USER fluo

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 선택 사항: 지원되는 컨테이너 런타임을 위한 헬스체크 추가
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

EXPOSE 3000
CMD ["node", "dist/main.js"]
```

---

## 헬스 및 준비성 프로브 (Health and Readiness Probes)

fluo는 자동화된 상태 모니터링을 위한 내장 엔드포인트를 제공합니다. 이는 Kubernetes의 `livenessProbe` 및 `readinessProbe`와 직접 통합됩니다.

- **Liveness (`/health`)**: 프로세스가 실행 중인 동안 `200 OK`를 반환합니다. 컨테이너 재시작을 트리거하는 데 사용됩니다.
- **Readiness (`/ready`)**: 애플리케이션 부트스트랩이 완료되고 모든 등록된 의존성 체크(예: Database, Redis)가 통과된 경우에만 `200 OK`를 반환합니다. 시작 중이거나 의존성 실패 시 `503 Service Unavailable`을 반환합니다.

### 전역 접두사(Global Prefix) 처리
`globalPrefix`(예: `/api`)가 구성된 경우, 프로브는 `globalPrefixExclude` 설정을 통해 명시적으로 제외되지 않는 한 접두사가 붙은 경로(예: `/api/health`)를 사용해야 합니다.

### Kubernetes 구성 예시
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /ready
    port: 3000
  initialDelaySeconds: 2
  periodSeconds: 5
```

---

## 정상 종료 (Graceful Shutdown)

fluo 런타임(특히 `@fluojs/runtime/node`의 `runNodeApplication`)은 `SIGTERM` 및 `SIGINT` 신호를 자동으로 수신하여 깨끗한 종료 절차를 시작합니다.

1. **인입 중단**: HTTP 어댑터가 새로운 연결 수락을 중단합니다.
2. **요청 드레인**: 런타임은 `shutdownTimeoutMs` 창(기본값: 10초) 내에서 활성 요청이 완료되기를 기다립니다.
3. **생명주기 훅**: `onModuleDestroy` 및 `onApplicationShutdown` 훅이 역순으로 실행됩니다.
4. **종료**: 모든 연결과 훅이 정리되면 프로세스가 종료됩니다.

> **팁**: Kubernetes의 `terminationGracePeriodSeconds`를 `shutdownTimeoutMs`보다 약간 높게 설정하여 프로세스가 갑자기 강제 종료되지 않도록 하세요.

---

## 환경 변수 (Environment Variables)

| 변수명 | 설명 | 기본값 |
| :--- | :--- | :--- |
| `NODE_ENV` | 실행 모드를 설정합니다 (예: `production`, `development`). | `development` |
| `PORT` | HTTP 어댑터가 바인딩할 포트입니다. | `3000` |
| `LOG_LEVEL` | 프레임워크 로거의 상세 수준을 제어합니다. | `info` |

---

## 관련 문서
- [동작 계약 정책 (Behavioral Contract Policy)](./behavioral-contract-policy.ko.md)
- [테스트 가이드 (Testing Guide)](./testing-guide.ko.md)
- [릴리스 거버넌스 (Release Governance)](./release-governance.ko.md)
