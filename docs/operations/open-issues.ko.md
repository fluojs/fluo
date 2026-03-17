# open issues

<p><a href="./open-issues.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 현재 GitHub issue backlog를 보기 쉽게 묶어 놓은 색인입니다.

planning의 source of truth는 여전히 GitHub Issues입니다. 이 문서는 현재 열려 있는 issue들을 묶어서 보여주고, 각 issue가 무엇을 다루는지 설명하며, 실무적인 진행 순서를 제안하기 위해서만 존재합니다.

## 현재 source of truth

- canonical planning source -> `konektijs/konekti`의 GitHub Issues
- 현재 ship된 동작 -> `README.md`, `docs/`, `packages/*/README*.md`

## 추천 실행 순서

1. bootstrap 및 scaffold UX
2. core runtime 및 validation 계약
3. transport 확장
4. auth 기본값 및 ecosystem 확장

## issue 그룹

### core runtime 및 validation 계약

#### `#3` Plan validation and DTO evolution beyond the current decorator model

- 다루는 내용
  - schema-object validation의 first-class 경로화
  - richer validation adapter interface
- 중요한 이유
  - request binding과 validation은 핵심 DX 계약이므로, 확장 시 docs/generator/test 전부에 영향
- 진행 방법
  - `#4` 이후 진행해서, 선택된 runtime/request 모델 위에서 DTO 방향을 결정

### transport 확장

#### `#9` Explore future non-HTTP transport and gateway model

- 다루는 내용
  - non-HTTP transport boundary model
  - gateway/websocket 실행 모델과 package surface
- 중요한 이유
  - future transport는 HTTP semantics를 흐리기보다 현재 framework contract를 재사용해야 함
- 진행 방법
  - `#4` 이후에 진행
  - 구현 전에 package boundary, lifecycle, ownership부터 정의

### auth 기본값 및 ecosystem 확장

#### `#7` Define the official auth product policy defaults

- 다루는 내용
  - bearer vs HttpOnly cookie 기본 권장안
  - refresh token lifecycle 및 rotation
  - logout/revoke 동작
  - identity source 간 account-linking 정책
- 중요한 이유
  - examples, starter guidance, public policy가 하나의 coherent auth story에 의존함
- 진행 방법
  - strategy-generic foundation은 유지
  - 문서/예제를 확장하기 전에 하나의 official default story를 선택

#### `#5` Track future support-matrix and data-layer expansion

- 다루는 내용
  - future ORM x DB 조합
  - integration이 template-level로 남을지 public package가 될지
  - MongoDB 같은 matrix 밖 후보
- 중요한 이유
  - support claim은 docs, CI, examples, package shape 전부에 영향
- 진행 방법
  - 새 stack을 승격할 때는 docs + tests + examples + support-tier 기준을 함께 요구

#### `#8` Plan the next expansion of `@konekti/testing`

- 다루는 내용
  - testing API를 어디까지 확장할지
  - generated test template를 얼마나 풍부하게 만들지
- 중요한 이유
  - testing은 지원되는 runtime/package workflow를 따라가야지, 먼저 앞서 나가면 안 됨
- 진행 방법
  - public bootstrap/auth/support 기본값이 더 명확해진 뒤 진행
  - 실제 사용자 workflow가 있는 경우에만 helper 확장

## 실무적인 다음 순서

지금 바로 진행한다면 가장 효율적인 순서는 다음과 같습니다.

1. `#3`
2. `#9`
3. `#7`
4. `#5`
5. `#8`

## 유지 규칙

어떤 issue가 해결되면:

- GitHub issue를 닫고
- 영향을 받는 `docs/` 주제와 package README를 업데이트하고
- backlog 구조 자체가 바뀐 경우에만 이 파일을 수정합니다.
