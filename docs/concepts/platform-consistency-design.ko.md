# 플랫폼 일관성 설계

<p><a href="./platform-consistency-design.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

**Platform Consistency Design**는 Konekti 프레임워크의 “spine”입니다. database driver부터 message broker까지 모든 공식 package가 따라야 하는 보편적 contract를 정의하여, 일관된 운영 경험을 보장합니다.

## 이 개념이 중요한 이유

현대 백엔드 생태계는 종종 일관성 없는 library들로 가득한 “Wild West”와 같습니다. 어떤 library는 config를 위해 environment variable을 사용하고, 다른 library는 JSON file을 요구합니다. 어떤 것은 Prometheus metric을 내보내지만, 어떤 것은 stdout에만 기록합니다.

이러한 불일치는 **운영 마찰**을 만듭니다:
- 개발자는 새 package마다 새로운 “사용 방식”을 배워야 합니다.
- SRE와 DevOps 팀은 각 service가 health를 다르게 보고하기 때문에 통합 monitoring과 alerting을 구축하기 어렵습니다.
- stack 전반에서 error format과 diagnostic code가 크게 다르면 troubleshooting은 악몽이 됩니다.

Konekti는 **공유된 개념적 contract**를 강제하여 이 마찰을 제거합니다. `@konekti/redis`, `@konekti/prisma`, 또는 커스텀 내부 module을 사용하더라도, configuration, monitoring, scaling의 “shape”는 동일하게 유지됩니다.

## 핵심 아이디어

### 플랫폼 쉘 (`@konekti/runtime`)
Runtime은 orchestrator 역할을 합니다. 어떤 package가 하는 일(예: Redis에 데이터 저장)을 알 필요는 없지만, 어떻게 대화해야 하는지는 압니다. 모든 package는 다음에 대한 표준 interface를 구현함으로써 이 shell에 “plug in”해야 합니다:
- **Lifecycle**: 어떻게 안전하게 시작하고 멈출 것인가
- **Health**: “나는 살아 있습니다”를 보고하는 방법
- **Readiness**: “작업할 준비가 되었습니다”를 보고하는 방법
- **Telemetry**: metric과 trace를 표준화된 형식으로 내보내는 방법

### 리소스 소유권과 책임
설계의 핵심 원칙은 **명확한 소유권**입니다.
- package가 TCP socket이나 file handle 같은 resource를 생성했다면, 정리 책임은 전적으로 그 package에 있습니다.
- 사용자가 resource를 package에 제공한 경우(예: 기존 database client 전달), package는 그것을 닫으려 해서는 안 됩니다.
이것은 shutdown 중 “double-free” 오류와 연결 hanging을 방지합니다.

### 일관된 진단 정보
Konekti의 error는 단순한 string이 아니라 **실행 가능한 데이터**입니다. 일관성 설계는 모든 공식 package가 다음을 제공하도록 요구합니다:
- **안정적인 Error Code**: 기계 판독 가능한 ID(예: `ERR_KV_CONNECTION_FAILED`)
- **수정 힌트**: 문제를 해결하는 방법에 대한 사람이 읽을 수 있는 지침(예: “.env의 REDIS_URL을 확인하세요”)
- **상황별 Metadata**: 실패를 일으킨 구체적인 parameter로, 자동화된 troubleshooting을 가능하게 합니다.

## 공유 contract spine

모든 platform-facing package는 다음 네 가지 기둥에 맞춰집니다:

1. **Config Envelope**: `enabled`, `id`, `timeout`, `telemetry`에 대한 표준 필드
2. **State Model**: `CREATED` -> `INITIALIZING` -> `READY` -> `STOPPING` -> `STOPPED`의 예측 가능한 state machine
3. **Common Observability**: metric(예: `service_id`, `environment`)과 tracing span을 위한 공유 label
4. **Behavioral Contracts**: retry, circuit breaking, backpressure를 처리하는 엄격한 규칙

## 경계

- **No Leaky Abstractions**: 기반 library의 힘을 숨기지 않습니다. Prisma package를 사용하면 여전히 전체 Prisma API를 사용할 수 있지만, Konekti의 운영 안전성으로 감싸집니다.
- **Explicitness over Magic**: 모듈의 숨겨진 “auto-discovery”는 없습니다. 모든 것은 `AppModule`에서 명시적으로 import되고 설정됩니다.
- **Operational Truth**: health와 readiness는 **편향 없는 사실**로 취급됩니다. database가 다운되면 package는 전체 애플리케이션이 “Unready”가 되더라도 이를 솔직하게 보고해야 합니다.

## 관련 문서

- [Architecture Overview](./architecture-overview.ko.md)
- [Lifecycle and Shutdown](./lifecycle-and-shutdown.ko.md)
- [Config and Environments](./config-and-environments.ko.md)
- [Package Surface](../reference/package-surface.ko.md)
