# lifecycle 및 shutdown (생명주기 및 종료)

<p><a href="./lifecycle-and-shutdown.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 bootstrap, readiness, shutdown에 걸친 현재 애플리케이션 lifecycle 모델을 설명합니다.

참고 항목:

- `./config-and-environments.md`
- `./transactions.md`
- `../../packages/runtime/README.md`

## lifecycle 단계

1. config 로드
2. 모듈 그래프 컴파일
3. provider/container 생성
4. provider 및 모듈 init 훅
5. 인프라스트럭처 연결
6. transport bind/listen
7. ready (준비 완료)

## bootstrap 보장 사항

- 유효하지 않은 config는 listen 전에 실패합니다.
- 모듈/provider 그래프 오류는 시작 시점에 실패합니다.
- 인프라스트럭처 연결 실패 시 절반만 시작된 상태를 남기지 않습니다.
- 앱이 ready 상태라는 것은 transport가 실제로 요청을 받을 준비가 되었음을 의미합니다.

## 훅 모델

runtime은 표준 lifecycle 훅 시퀀스를 소유합니다:

- `onModuleInit`
- `onApplicationBootstrap`
- `onModuleDestroy`
- `onApplicationShutdown`

## shutdown 시퀀스

1. 새로운 요청 수락 중단
2. shutdown 신호 기록
3. 처리 중인(in-flight) 요청 드레인(drain)
4. destroy/shutdown 훅 실행
5. 인프라스트럭처 클라이언트 연결 해제
6. 필요한 경우 로깅/트레이싱 플러시(flush)
7. 종료(exit)

## 처리 중인 요청 정책

- shutdown 중에는 새로운 요청을 받지 않습니다.
- 시작된 요청에 대해 제한된 드레인 시간을 가집니다.
- 드레인 타임아웃 이후에도 강제 종료가 가능합니다.
- request-scoped 정리 작업은 반드시 finally-safe를 유지해야 합니다.

## 통합 시 시사점

- ORM 클라이언트는 provider lifecycle을 따라야 합니다.
- 연결 해제 전에 열려 있는 트랜잭션을 정리해야 합니다.
- runtime 소유의 어댑터는 요청 중단/종료 상태를 프레임워크 요청 모델로 전파할 책임이 있습니다.
