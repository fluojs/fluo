# 3장. 용어와 학습 지도

> **기준 소스**: [repo:docs/reference/glossary-and-mental-model.md] [ex:README.md] [repo:docs/README.md]
> **주요 구현 앵커**: [ex:minimal/README.md] [ex:realworld-api/README.md] [ex:auth-jwt-passport/README.md] [ex:ops-metrics-terminus/README.md]

이 장의 목표는 독자가 앞으로 길을 잃지 않도록 fluo의 핵심 용어를 고정하고, 어떤 예제를 어떤 순서로 읽어야 하는지 지도를 제시하는 것이다.

## 왜 용어 장이 따로 필요한가

기술서는 종종 이 장을 가볍게 넘긴다. 하지만 fluo처럼 메타데이터, 모듈 그래프, request context, platform adapter 같은 단어가 구조 그 자체를 설명하는 프로젝트에서는 용어 장이 매우 중요하다. 용어를 대충 이해한 채로 DI나 HTTP chapter에 들어가면, 나중에 읽는 모든 문장이 조금씩 어긋난다.

예를 들어 `module`이라는 단어만 해도 일반적인 JavaScript import/export 단위를 떠올릴 수 있지만, fluo에서 module은 **가시성과 provider boundary를 담은 프레임워크 단위**다 `[repo:docs/concepts/di-and-modules.md]`. 이 차이를 초반에 못 잡으면 후속 설명 전체가 흐려진다.

## 먼저 익혀야 할 용어

용어집 기준으로 가장 먼저 고정해야 할 단어는 다음과 같다 `[repo:docs/reference/glossary-and-mental-model.md]`.

- **Bootstrap**: 애플리케이션이 시작되며 모듈 그래프가 준비되는 과정
- **Module Graph**: 모듈 간 import/export와 provider 가시성의 구조
- **Platform Adapter**: 런타임 차이를 감추는 어댑터
- **Dispatcher**: 요청을 실제 핸들러로 보내는 실행 엔진
- **Guard / Interceptor**: 요청 파이프라인의 교차 관심사 처리 도구
- **Request DTO**: 외부 입력을 내부 타입 경계로 들여오는 객체

이 단어들을 먼저 익히면 문법보다 구조를 먼저 이해하게 된다.

## 특히 중요하게 번역해야 하는 용어들

한국어 책에서는 몇몇 용어를 어떻게 부를지가 중요하다. 무턱대고 번역하면 오히려 의미가 흐려지고, 그대로 두면 독자가 문맥을 놓칠 수 있다. 이 책에서는 다음처럼 다루는 것이 좋다.

- **Behavioral Contract**: 단순 계약이 아니라 “동작 계약” 또는 “행동 계약”으로 설명하고, 항상 테스트/거버넌스와 연결한다 `[repo:docs/operations/release-governance.md]`
- **Module Graph**: “모듈 그래프”로 두되, 항상 가시성/의존성 구조라는 설명을 붙인다 `[repo:docs/reference/glossary-and-mental-model.md]`
- **Platform Adapter**: “플랫폼 어댑터”로 두고, 런타임 포팅 경계라는 뜻을 반복한다 `[repo:README.md]`
- **Request DTO**: “요청 DTO”라고 부르되, 단순 타입 정의가 아니라 입력 경계라는 설명을 붙인다 `[repo:docs/concepts/http-runtime.md]`

## 예제는 어떻게 읽어야 하는가

예제 인덱스는 fluo 학습 순서를 이미 제안하고 있다 `[ex:README.md]`.

1. `minimal` — 가장 작은 실행 단위
2. `realworld-api` — 실제 기능 슬라이스와 CRUD 패턴
3. `auth-jwt-passport` — 인증과 권한 흐름
4. `ops-metrics-terminus` — 운영, 지표, readiness 개념

이 순서는 단순 난이도 순이 아니다. **fluo의 층이 하나씩 추가되는 순서**다.

### `minimal`

가장 작은 진입점이다. 어댑터, AppModule, 컨트롤러, 서비스가 최소 단위로 묶여 있어 부트스트랩과 구조를 읽기 좋다 `[ex:minimal/README.md]`.

### `realworld-api`

기능 슬라이스, DTO, CRUD, config, 테스트가 함께 보인다. core/di/http 설명이 실제 앱 구조로 확장되는 첫 번째 실전 예제다 `[ex:realworld-api/README.md]`.

### `auth-jwt-passport`

request pipeline에 인증이라는 교차 관심사가 붙는 순간을 보여준다. guard, principal, strategy 같은 말이 여기서 구체성을 얻는다 `[ex:auth-jwt-passport/README.md]`.

### `ops-metrics-terminus`

운영과 관측성도 결국 모듈 조합과 런타임 계약 위에 있다는 점을 보여준다. 책 후반부 운영 장의 중요한 앵커다 `[ex:ops-metrics-terminus/README.md]`.

## 문서 허브와 예제를 같이 읽어야 하는 이유

fluo 문서 허브는 개념과 공식 학습 경로를 주고 `[repo:docs/README.md]`, 예제는 그 개념이 코드에서 어떤 모양인지 보여준다 `[ex:README.md]`. 둘 중 하나만 보면 항상 빈칸이 남는다.

- 문서만 읽으면 흐름은 알지만 손에 잡히지 않는다.
- 예제만 읽으면 동작은 보지만 설계 이유를 놓친다.

그래서 이 책은 **문서 → 예제 → 패키지 README → 소스 코드**를 계속 왕복하는 방식으로 전개된다.

## 추천 학습 리듬

이 책을 읽는 가장 좋은 리듬은 “한 번 읽고 넘어가기”가 아니다. 오히려 다음 순환을 반복하는 편이 좋다.

1. 챕터의 개념 설명을 읽는다.
2. 챕터에 연결된 example 파일을 연다.
3. package README에서 public responsibility를 확인한다.
4. 필요하면 source file까지 내려간다.

## 이 책의 실전 읽기 전략

이 책을 따라갈 때는 각 장마다 다음 질문을 유지하면 좋다.

1. 이 장은 어느 층을 설명하는가?
2. 이 장의 주장은 어떤 문서가 근거인가?
3. 이 장의 코드는 어떤 예제 파일이 근거인가?
4. 이 장에서 배운 개념이 다음 장에서 어떤 실행 단계로 이어지는가?

이 질문이 반복되면, fluo는 갑자기 커 보이는 프레임워크가 아니라 **예측 가능한 작은 조각의 조합**으로 보이기 시작한다.

## 이 장의 핵심 문장

> fluo를 빠르게 배우는 가장 좋은 방법은, 한 자료를 끝까지 붙드는 것이 아니라 **문서·예제·패키지 책임·소스 코드 사이를 왕복하는 읽기 습관**을 만드는 것이다.
