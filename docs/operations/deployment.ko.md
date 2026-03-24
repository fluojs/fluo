# deployment

<p><strong><kbd>한국어</kbd></strong> <a href="./deployment.md"><kbd>English</kbd></a></p>

이 가이드는 Konekti 애플리케이션의 프로덕션 배포 요구 사항과 패턴을 설명합니다.

## Docker multi-stage build

권장되는 프로덕션 Dockerfile은 실행 이미지를 작고 안전하게 유지하기 위해 멀티스테이지 빌드를 사용합니다. 이 구성은 `pnpm` 워크스페이스나 표준 `pnpm` 프로젝트 구조를 전제로 합니다.

```dockerfile
# Stage 1: Builder
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

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
ENV PORT=3000

# root가 아닌 사용자로 실행
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 konekti
USER konekti

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1))"

CMD ["node", "dist/main.js"]
```

## Kubernetes probes

Konekti 런타임은 내장된 헬스 체크와 레디니스 엔드포인트를 제공합니다. `globalPrefix` 설정과 관계없이 기본적으로 접두사 없이 노출됩니다.

- `/health`: Liveness probe. 프로세스가 실행 중일 때 `200 { status: 'ok' }`를 반환합니다.
- `/ready`: Readiness probe. 애플리케이션 부트스트랩이 완료되고 등록된 모든 레디니스 체크를 통과하면 `200`을 반환합니다. 시작 중이거나 의존성 체크에 실패하면 `503`을 반환합니다.

`@konekti/terminus`를 등록하면 `/health`가 인디케이터 상세 정보를 포함한 응답을 반환할 수 있으며, 등록된 인디케이터 중 하나라도 실패하면 HTTP `503`을 반환합니다.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: konekti-app
spec:
  template:
    spec:
      containers:
      - name: app
        image: konekti-app:latest
        ports:
        - containerPort: 3000
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 2
          periodSeconds: 5
          failureThreshold: 3
```

## Graceful shutdown

`runNodeApplication()`은 `SIGTERM`과 `SIGINT` 신호를 감지하여 애플리케이션의 종료 시퀀스를 자동으로 실행합니다.

종료 신호를 받으면 다음 과정이 진행됩니다:
1. HTTP 어댑터가 새로운 연결을 수락하지 않습니다.
2. 런타임이 진행 중인 요청들이 완료될 때까지 기다립니다.
3. 유휴 상태인 keep-alive 연결들을 닫습니다.
4. 라이프사이클 훅(`onModuleDestroy` 및 `onApplicationShutdown`)이 역순으로 호출됩니다.
5. 모든 훅과 연결이 정리되면 프로세스가 종료됩니다.

### Configuration

`shutdownTimeoutMs`를 사용하여 기본 10초인 대기 시간을 변경할 수 있습니다. Kubernetes의 `terminationGracePeriodSeconds`는 이 설정값보다 약간 길게 설정해야 합니다 (`shutdownTimeoutMs`보다 약간 높게).

```typescript
import { runNodeApplication } from '@konekti/runtime';
import { AppModule } from './app.module';

await runNodeApplication(AppModule, {
  mode: 'prod',
  shutdownTimeoutMs: 15000, // 15 seconds
});
```

## Environment variables

Konekti는 애플리케이션 수준 설정을 위해 `@konekti/config`를 사용합니다. 런타임은 다음 핵심 변수들을 관리합니다:

- `NODE_ENV`: 실행 이미지에서 `production`으로 설정합니다. 이 값은 여러 패키지의 로그 형식과 기본 동작에 영향을 줍니다.
- `PORT`: HTTP 어댑터가 바인딩할 포트입니다. 설정이나 부트스트랩 옵션에 지정되지 않으면 기본값은 `3000`입니다.

애플리케이션 수준의 비밀 정보와 설정은 환경 변수로 전달하고 `runNodeApplication()`의 `config` 객체를 통해 매핑합니다.

## Docker Compose for local development

로컬 개발 시 Docker Compose를 사용하여 애플리케이션과 의존성 서비스를 함께 실행합니다.

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=dev
      - DATABASE_URL=postgresql://user:pass@db:5432/konekti
    depends_on:
      - db
      - redis

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: konekti
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```
