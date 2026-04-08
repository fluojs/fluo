# 라이프사이클 및 종료

<p><a href="./lifecycle-and-shutdown.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 서비스가 시작되고, health를 알리고, 우아하게 종료되는 방식을 규정하는 엄격하고 결정론적인 **Application Lifecycle**을 제공합니다. 이 lifecycle은 애플리케이션이 결코 “half-alive” 상태에 머물지 않도록 보장합니다.

## 이 개념이 중요한 이유

현대의 cloud-native 환경(Kubernetes, AWS 등)에서는 애플리케이션이 시작되고 멈추는 방식이 요청 처리만큼 중요합니다.
- **Startup Race**: database connection이 준비되기 전에 앱이 트래픽을 받기 시작하면 500 error가 급증합니다.
- **“Dirty” Shutdown**: database에 아직 쓰는 중인 process를 종료하면 data corruption 위험이 생깁니다.
- **Zombie Resource**: Redis client나 message broker connection을 닫지 않으면 시간이 지남에 따라 resource exhaustion이 발생할 수 있습니다.

Konekti는 **구조화된 lifecycle contract**를 제공함으로써 이러한 위험을 제거합니다. 애플리케이션의 모든 module과 provider가 이 contract에 참여할 수 있으며, 의존성이 올바른 순서로 초기화되고 파괴되도록 보장합니다.

## 핵심 아이디어

### atomic bootstrap
Bootstrap은 “all-or-nothing” 작업입니다.
1. **Config Validation**: `.env`가 잘못되었으면 중지합니다.
2. **Module Compilation**: DI graph가 깨졌으면 중지합니다.
3. **Provider Initialization**: `onModuleInit` 중 database connection이 실패하면 중지합니다.

Konekti는 process가 **완전히 기능할 때만** 살아 있도록 보장합니다.

### readiness vs. liveness
Konekti는 “살아 있음”(process가 실행 중임)과 “준비됨”(process가 트래픽을 처리할 수 있음)을 구분합니다.
- **Liveness**: runtime engine이 관리합니다.
- **Readiness**: 모든 module에서 `onApplicationBootstrap`이 성공적으로 완료된 후에만 신호가 켜집니다. 이는 load balancer가 인스턴스로 트래픽 라우팅을 시작할 수 있다는 신호입니다.

### graceful shutdown sequence
`SIGTERM` 또는 `SIGINT`를 받으면 Konekti는 coordinated retreat을 시작합니다:
1. **Stop Ingestion**: HTTP server가 즉시 새 connection 수락을 중단합니다.
2. **Request Draining**: 진행 중인 요청에 configurable한 유예 시간을 주어 완료하게 합니다.
3. **Reverse-Order Teardown**: shutdown hook(`onModuleDestroy`, `beforeApplicationShutdown`)은 초기화의 **정확한 역순**으로 실행됩니다. Module A가 Module B에 의존한다면 A의 정리 중 B의 리소스가 여전히 사용 가능하도록 Module A를 *먼저* 파괴합니다.

## lifecycle hooks

- **`onModuleInit`**: module의 provider가 인스턴스화되자마자 실행되어야 하는 logic입니다(예: socket connection 수립).
- **`onApplicationBootstrap`**: *전체* application graph가 준비된 후 실행되는 logic입니다(예: background cron job 시작).
- **`onModuleDestroy`**: 특정 module을 정리하는 logic입니다.
- **`beforeApplicationShutdown`**: process가 종료되기 전에 정리를 수행할 수 있는 마지막 기회입니다.

## 경계

- **Dependency-Aware**: 정리 순서에 대해 걱정할 필요가 없습니다. Konekti는 `@Inject()` metadata를 기반으로 올바른 순서를 계산합니다.
- **Timeout Protection**: shutdown hook이 너무 오래 걸리면(예: 멈춘 database query), Konekti는 결국 강제 종료하여 “zombie” process가 배포를 막지 않도록 합니다.
- **Idempotency**: lifecycle hook은 애플리케이션 인스턴스당 정확히 한 번 실행되도록 보장됩니다.

## 관련 문서

- [Architecture Overview](./architecture-overview.ko.md)
- [Dev Reload Architecture](./dev-reload-architecture.ko.md)
- [Config and Environments](./config-and-environments.ko.md)
- [Runtime Package README](../../packages/runtime/README.ko.md)
