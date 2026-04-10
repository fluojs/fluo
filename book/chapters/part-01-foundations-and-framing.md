# 파트 I 개요 — 철학과 멘탈 모델

> **기준 소스**: [repo:README.md] [repo:docs/README.md] [repo:docs/reference/glossary-and-mental-model.md]

이 파트는 fluo가 무엇인지, 왜 존재하는지, 그리고 구현 세부사항에 들어가기 전에 어떤 멘탈 모델을 가져야 하는지를 설명한다.

## 파트 목표

1. 프레임워크의 정체성을 평이한 한국어로 설명한다.
2. 뒤 챕터에서 계속 사용할 핵심 용어를 고정한다.
3. `standard-first`, `explicit DI`, `behavioral contract`를 구호가 아니라 실제 설계 원칙으로 이해시킨다.

## 포함될 챕터

### 1장. 왜 fluo인가

fluo는 TC39 표준 데코레이터, 명시적 의존성 주입, 멀티 런타임 이식성을 기반으로 한 TypeScript 백엔드 프레임워크로 자신을 정의한다 `[repo:README.md]`.

### 2장. fluo 멘탈 모델

문서 허브와 용어집을 바탕으로 fluo를 “데코레이터가 메타데이터를 적고, runtime/di/http가 그것을 읽어 실행한다”는 관점으로 설명한다 `[repo:docs/README.md]` `[repo:docs/reference/glossary-and-mental-model.md]`.

### 3장. 용어와 학습 지도

예제 인덱스와 용어집을 이용해 `minimal → realworld-api → auth-jwt-passport → ops-metrics-terminus` 순서를 책의 실습 지도와 연결한다 `[ex:README.md]` `[repo:docs/reference/glossary-and-mental-model.md]`.

## 뒤 챕터를 위한 근거 메모

- 루트 README는 fluo를 “performance without magic”, “explicit over implicit”, “run anywhere”의 조합으로 설명한다 `[repo:README.md]`.
- 용어집은 lifecycle을 resolution → instantiation → bootstrap → ready → shutdown으로 정리한다 `[repo:docs/reference/glossary-and-mental-model.md]`.
- 예제 인덱스는 예제 앱을 문서 허브와 함께 읽는 것을 전제로 한다 `[ex:README.md]`.

## 연결 챕터

- `chapter-01-why-fluo.md`
- `chapter-02-explicit-mental-model.md`
- `chapter-03-glossary-and-learning-map.md`
