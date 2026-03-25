# config and environments

<p><a href="./config-and-environments.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 `@konekti/config`, 런타임 부트스트랩 프로세스, 그리고 패키지 통합에서 구현된 설정 관리를 설명합니다.

### 관련 문서

- `../../packages/config/README.md`
- `./lifecycle-and-shutdown.ko.md`
- `../getting-started/bootstrap-paths.ko.md`

## 책임 범위

- **`@konekti/config`**: 설정 로딩, 우선순위, 유효성 검사, 타입이 지정된 접근을 처리합니다.
- **부트스트랩 (Bootstrap)**: 환경 변수를 다시 읽는 대신 미리 로드된 설정을 소비합니다.
- **통합 (Integrations)**: 직접적인 환경 변수 접근 대신 타입이 지정된 설정 프로바이더를 사용해야 합니다.

## 핵심 설정 원칙

- **명시적 파일 선택**: `envFile`로 env 파일 경로를 직접 지정하거나, 기본값 `.env`를 사용합니다.
- **결정론적 우선순위**: 설정 해결을 위한 하나의 명확한 순서를 따릅니다.
- **조기 유효성 검사**: 설정은 애플리케이션 시작 시점에 검증됩니다.
- **타입이 지정된 접근**: 설정은 `ConfigService`를 통해 접근합니다.

## 환경 및 파일

env 파일 경로는 `ConfigModule.forRoot()` 또는 `loadConfig()`에 전달하는 `envFile` 옵션으로 제어합니다. 생략하면 `.env`가 기본값입니다. 모드 이름에 따른 자동 파일 선택은 없으며, 부트스트랩 시점에 호출자가 로드할 파일을 결정합니다.

## 우선순위 및 병합

설정 해결 순서는 결정론적입니다:

1.  **런타임 재정의 (Runtime Overrides)**: 부트스트랩 도중 직접 전달됩니다.
2.  **프로세스 환경 (Process Environment)**: 표준 시스템 환경 변수입니다.
3.  **Env 파일**: `envFile`로 지정한 경로에서 로드됩니다 (기본값 `.env`).
4.  **기본값 (Default Values)**: 하드코딩된 폴백(fallback) 값입니다.

### 병합 동작

- **객체**: 일반 객체(Plain objects)는 모든 소스에 대해 딥 머지(deep-merge)됩니다.
- **프리미티브 및 배열**: 우선순위 순서를 따르며 기존 값을 대체합니다.
- **안전성**: 중첩된 재정의가 인접한 키를 실수로 제거해서는 안 됩니다.

## 유효성 검사 및 보안

- **Fail-fast**: 유효하지 않은 설정은 애플리케이션 시작을 차단합니다.
- **강제 변환 (Coercion)**: 타입은 부트스트랩 단계에서 한 번 강제 변환됩니다.
- **비밀 정보 (Secrets)**: 표준 우선순위 모델을 따르되, 로그나 에러 메시지에는 절대 포함되지 않습니다.

## 사용 권장 사항

일반적인 애플리케이션 설정에는 `ConfigService`를 사용하세요. 복잡한 통합의 경우, 해당 패키지에서 제공하는 타입이 지정된 설정 프로바이더를 선호하는 것이 좋습니다.

## 리로드 동작

`@konekti/config`는 리로드를 명시적으로 처리합니다.

- `loadConfig()`는 부트스트랩 시점에 하나의 검증된 스냅샷을 해결합니다.
- `createConfigReloader()`는 env 파일을 감시하고 리로드하기 위한 opt-in 경로입니다.
- 리로드 지원은 설정(config)에 한정됩니다. 일반적인 코드 핫 리로드를 의미하지 않습니다.

`@konekti/runtime`에서 `watch: true`를 사용하면 `createConfigReloader()`를 구독하고, 전체 애플리케이션 셸을 재구축하지 않고도 기존 `ConfigService` 인스턴스에 검증된 스냅샷을 적용할 수 있습니다.

런타임은 설정 검증을 통과한 스냅샷만 적용합니다. 런타임 측 리로드 처리가 실패하면 이전 스냅샷이 유지됩니다.
