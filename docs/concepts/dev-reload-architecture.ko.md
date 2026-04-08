# 개발 리로드 아키텍처

<p><a href="./dev-reload-architecture.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 개발 중 변경 사항을 소스 코드에 대한 **전체 프로세스 재시작**과 설정에 대한 **인프로세스 리로드**라는 두 개의 별도 경로로 엄격하게 분리합니다. 이 구분은 개발 속도를 희생하지 않으면서도 최대한의 신뢰성을 확보하기 위한 의도적인 아키텍처 선택입니다.

## 이 개념이 중요한 이유

현대적인 백엔드 개발은 변경 사항이 즉시 반영되는 “라이브”한 느낌을 요구합니다. 하지만 전통적인 “hot module replacement”(HMR)나 단순한 “file-watching restart”는 종종 **상태 없는 로직**과 **상태를 가진 인프라**의 경계를 흐립니다.

부분 리로드 중에 database connection이나 network socket이 제대로 정리되지 않으면 애플리케이션은 정의되지 않은 상태에 들어가며, 수동 재시작 후 사라지는 “phantom bug”가 발생합니다. Konekti는 코드와 로직, 그리고 로직에는 깨끗한 시작점이 필요하다는 명확한 경계를 강제함으로써 이러한 오류를 제거합니다.

## 핵심 아이디어

### “깨끗한 시작점” 원칙 (code changes)
기본 개발 runner(`@konekti/cli`)는 전체 source tree를 감시합니다. `.ts` 파일이 변경되면:
1. runner가 현재 process에 `SIGTERM`을 보냅니다.
2. 애플리케이션이 [graceful shutdown sequence](./lifecycle-and-shutdown.ko.md)를 실행하여 database pool을 닫고 진행 중인 요청을 마무리합니다.
3. runner가 완전히 새로운 process를 시작합니다.

이렇게 하면 최신 TC39 standard decorator를 사용해 dependency graph를 처음부터 다시 구성할 수 있고, 오래된 memory나 “zombie” connection이 남지 않습니다. 우리는 위험한 HMR이 주는 미세한 속도 향상보다 **절대적 정확성**을 우선합니다.

### “live tune” 경로 (config changes)
`.env` 파일 편집이나 JSON config 수정과 같은 configuration 업데이트는 다른 경로를 따릅니다. configuration은 **static logic**이 아니라 **dynamic data**로 설계되었기 때문에, Konekti는 process를 종료하지 않고도 이러한 변경을 적용할 수 있습니다.

이를 통해 개발자는 다음을 할 수 있습니다:
- feature flag를 즉시 전환합니다.
- 현재 debug context를 잃지 않고 log level을 조정합니다.
- API key나 secret을 갱신하고 즉시 통합 상태를 확인합니다.

## 책임 경계

### runner orchestration
**CLI**(`@konekti/cli`)는 “supervisor” 역할을 합니다. 파일 watcher와 process lifecycle을 소유하며, 코드가 무엇을 하는지는 알지 못하고 그저 변경되었고 새 환경이 필요하다는 사실만 압니다.

### config snapshot production
**Config Package**(`@konekti/config`)는 환경을 “관찰”하는 책임을 집니다. 파일 기반 configuration과 environment variable을 병합하여 immutable한 **Config Snapshot**을 생성합니다. 파일이 변경되면 새 snapshot을 만들고 정의된 schema에 대해 검증합니다.

### runtime application
**Runtime**(`@konekti/runtime`)은 “consumer” 역할을 합니다. 안정적인 참조 역할을 하는 `ConfigService`를 호스팅합니다. Config Package에서 새로 검증된 snapshot이 도착하면 `ConfigService`가 내부 state를 갱신하고, 새 데이터에 반응해야 하는 service들을 위한 “reload hook”을 트리거합니다(예: cache TTL 업데이트).

## 경계

- **Statelessness Required**: 인프로세스 리로드가 안정적으로 동작하려면 `ConfigService`를 사용하는 service가 constructor에서 config 값을 로컬 private variable에 “굽지” 않아야 합니다. 항상 service를 조회하거나 update를 구독해야 합니다.
- **Validation Barrier**: 새 config snapshot은 검증에 실패하면 **절대** 적용되지 않습니다. 애플리케이션은 “last known good” configuration으로 계속 실행되며, CLI는 console에 validation error를 보고합니다.
- **Development-Only**: 이 아키텍처는 지원하지만, 일반적으로 production에서는 새 config가 새 deployment를 의미하는 “immutable infrastructure” 패턴을 유지하기 위해 인프로세스 리로딩을 비활성화합니다.

## 관련 문서

- [Architecture Overview](./architecture-overview.ko.md)
- [Config and Environments](./config-and-environments.ko.md)
- [Lifecycle and Shutdown](./lifecycle-and-shutdown.ko.md)
- [CLI README](../../packages/cli/README.ko.md)
