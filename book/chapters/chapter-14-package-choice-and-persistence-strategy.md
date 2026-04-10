# 14장. 패키지 선택과 영속성 전략

> **기준 소스**: [repo:docs/reference/package-chooser.md] [repo:docs/operations/release-governance.md]
> **주요 구현 앵커**: [repo:docs/reference/package-chooser.md]

이 장의 목적은 독자가 fluo의 패키지 수를 보고 압도되지 않게 하는 것이다. package chooser 문서는 이미 “무엇을 만들고 싶은가?” 기준으로 패키지를 고르게 돕는다 `[repo:docs/reference/package-chooser.md]`.

## 왜 이 장이 필요한가

fluo는 모듈식 생태계를 지향하기 때문에, 처음 보는 사람에게는 “패키지가 너무 많다”는 인상을 줄 수 있다. 하지만 package chooser 문서가 보여주듯 중요한 것은 패키지 수가 아니라 **문제를 어떤 조합으로 푸는가**다 `[repo:docs/reference/package-chooser.md]`.

따라서 이 장은 패키지를 나열하는 대신 다음 질문으로 구성하는 것이 좋다.

- 웹 API를 만들려면 어떤 조합이 필요한가?
- 인증을 붙이려면 무엇이 추가되는가?
- 캐시/Redis/Queue는 어떤 문제를 해결하는가?
- Prisma, Drizzle, Mongoose 중 어떤 선택지가 있는가?

이 질문 중심 접근이 중요한 이유는, fluo를 “패키지 카탈로그”로 읽는 습관을 끊어 주기 때문이다. 독자는 “무슨 패키지가 있지?”보다 “내가 풀려는 문제가 무엇이지?”를 먼저 물어야 한다.

중요한 점은 persistence 장도 결국 DI boundary와 module boundary 위에서 설명되어야 한다는 것이다. ORM을 택하는 순간에도 fluo의 기본 원리는 변하지 않는다.

## persistence를 책에서 어떻게 다뤄야 하나

영속성 장에서 흔히 빠지는 함정은 ORM 비교 자체가 목적이 되어 버리는 것이다. 하지만 fluo 책에서 persistence는 다음 질문에 종속되어야 한다.

- 이 저장소 구현은 어떤 module 안에 들어가는가?
- 어떤 service가 이 persistence layer에 의존하는가?
- 무엇을 export하고 무엇을 숨길 것인가?
- 설정과 인증, 테스트와 어떤 경계로 연결되는가?

즉, persistence는 기술 선택이지만 동시에 **구조 선택**이다.

## 패키지 선택을 release 관점으로도 봐야 한다

기술 선택은 흔히 기능 비교로 끝난다. 하지만 fluo에서는 release governance도 함께 봐야 한다 `[repo:docs/operations/release-governance.md]`. 어떤 패키지가 더 성숙한지, 어떤 패키지가 더 강한 behavioral contract를 갖는지, 어떤 패키지가 운영 도구와 더 잘 맞는지도 선택의 일부다.

이 점은 persistence에서도 그대로 적용된다. 예를 들어 DB adapter나 health indicator를 고를 때는 “코드가 되느냐”만이 아니라, **운영과 검증까지 포함한 전체 contract가 맞느냐**를 봐야 한다.

## 이 장에서 독자가 가져가야 하는 기준

패키지를 고를 때는 다음 질문이 항상 먼저 와야 한다.

1. 이 패키지는 어떤 문제를 해결하는가?
2. 이 패키지는 내 module boundary 어디에 들어가는가?
3. 이 패키지를 선택하면 testing/observability/governance에 어떤 영향이 생기는가?

이 질문을 몸에 익히면, 독자는 더 이상 package chooser를 “목록”으로 읽지 않고 **아키텍처 의사결정 지도**로 읽게 된다.

## 메인테이너 시각

메인테이너는 package 선택을 “호환 가능한 패키지 목록”으로만 보지 않는다. release governance와 package maturity도 함께 고려해야 하기 때문이다 `[repo:docs/operations/release-governance.md]`. 따라서 이 장은 기능 선택뿐 아니라, **어떤 패키지가 어떤 안정성 기대치를 가지는가**를 함께 다루는 편이 좋다.
