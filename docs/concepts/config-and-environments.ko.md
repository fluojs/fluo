# config and environments

<p><a href="./config-and-environments.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 `@konekti/config`, runtime 부트스트랩, 패키지 통합 전반에 걸친 현재 설정 규약을 설명합니다.

함께 보기:

- `../../packages/config/README.md`
- `./lifecycle-and-shutdown.md`
- `../getting-started/bootstrap-paths.md`

## ownership

- `@konekti/config`: 설정 로딩, 우선순위, 유효성 검사 및 타입이 지정된 접근을 소유합니다.
- 부트스트랩: 환경 변수 소스를 임의로 재해석하는 대신 이미 로드된 설정을 소비합니다.
- 통합 패키지: 가능한 경우 환경 변수를 직접 읽지 않고 타입이 지정된 설정을 소비해야 합니다.

## current config shape

공개되는 방향은 다음과 같습니다:

- 명시적인 모드 선택 (`dev`, `prod`, `test`)
- 하나의 결정론적인 우선순위 순서
- 시작 시 유효성 검사 수행
- `ConfigService`를 통한 타입이 지정된 접근

## mode and env-file policy

- 공식 모드: `dev`, `prod`, `test`
- 기본 환경 변수 파일:
  - `.env.dev`
  - `.env.prod`
  - `.env.test`

## source precedence

현재 우선순위는 절대적이며 결정론적입니다:

1. runtime 재정의(overrides)
2. 프로세스 환경 변수(process environment)
3. 모드별 환경 변수 파일
4. 명시적 기본값

애플리케이션 코드는 개별 소스가 아닌 정규화되어 병합된 결과를 읽습니다.

## validation boundary

- 유효하지 않은 설정은 listen 단계 이전에 시작을 중단시킵니다.
- 유효성 검사 및 강제 변환(coercion)은 부트스트랩 시점에 한 번 발생합니다.
- 비밀 정보(secrets)는 동일한 우선순위 모델을 따르되, 로그나 에러 상세 내용에 노출되어서는 안 됩니다.

## practical rule

현재 애플리케이션 읽기에는 `ConfigService`를 사용하고, 패키지 인터페이스가 정당화되는 경우 타입이 지정된 통합 패키지 전용 설정 provider를 선호하십시오.
