# Documentation Authority

<p><a href="./documentation-authority.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Docs는 AI가 Fluo 코드를 작성하고 검토할 때 사용하는 프레임워크의 규범적 계약 계층이다. Books는 같은 계약을 사람이 제품의 요구, 구현 과정, 실패 사례로 이해하도록 설명하는 중심 학습 경로다. 먼저 읽는 문서와 프레임워크 사실을 소유하는 문서는 구분한다.

## Scope and ownership

이 정책은 저장소 Docs, 위임된 패키지 README, Books, 웹사이트와 그 요약 문서의 권위 관계와 작성 형식을 정의한다. 런타임 동작을 새로 보장하거나 공개 API를 바꾸지는 않는다. 기존 [Behavioral Contract Rules](./behavioral-contract-policy.ko.md)를 함께 적용한다.

| 문서 표면 | 소유하는 책임 | 경계 |
| --- | --- | --- |
| `docs/contracts/`, `docs/architecture/`와 관련 Docs 작업 지침 | 공통 프레임워크 계약, 아키텍처 약속, 범위가 명시된 실행 recipe | 서로 다른 계약을 하나로 합치거나 실제 근거 없이 보장을 추가하지 않는다. |
| `packages/*/README.md`와 한국어 대응 문서 | Docs 계층에서 위임받은 패키지별 공개 API와 제약 | 설치, 정확한 공개 import, 필수 사용법, 기본값, 보장 요약을 유지하고 공통 계약으로 연결한다. 단순 링크만 남기거나 API 본문을 `docs/`에 복제하지 않는다. |
| `docs/CONTEXT.md`와 한국어 대응 문서, Docs 허브 | AI 작업별 담당 문서 탐색 | 안내와 요약은 별도의 계약 원본이 아니다. |
| Books와 `book/series.json` | 사람을 위한 제품 서사와 24/28/20장 학습 과정 | 프레임워크 사실은 담당 Docs 계약에서 가져온다. 제품 정책과 학습용 반례를 프레임워크 보장으로 승격하지 않는다. |
| 웹사이트, 루트 README, 다른 요약 | 계약의 설명과 발견 경로 | 독립 API 원본이나 중복 지원 매트릭스를 유지하지 않는다. |
| 구현, 테스트, 실행 예제 | 기존 계약을 대조하고 검증하는 근거 | 구현이 다르거나 테스트가 통과한다는 사실만으로 기존 약속을 덮어쓰지 않는다. |

명확히 구분되는 계약마다 EN/KO 담당 문서 쌍 하나를 지정한다. 한 문서가 여러 계약을 소유할 수 있지만, 나머지 표면은 그 원본을 설명하고 연결한다. 아직 이전하지 않은 문서의 계약, 안정 링크, heading/anchor, machine sentinel과 검사 의존성은 계속 유효하다. 이 정책의 도입은 43개 패키지와 72개 장의 전체 이전이나 의미 검증이 끝났다는 선언이 아니다.

## AI reading route

1. [CONTEXT](../CONTEXT.ko.md)에서 프로젝트 제약과 작업 범위를 확인한다.
2. [계약 참조 색인](../knowledge-index.json)에서 계약 ID의 `owner.en`/`owner.ko`와 `sourcePaths`/`testPaths`를 따라간다. 아직 색인에 없는 계약은 [문서 허브의 원본 책임](../README.ko.md#원본-책임)과 [패키지 선택기](../reference/package-chooser.ko.md)에서 담당 Docs 또는 위임된 패키지 README를 찾는다. AI가 프레임워크 사실을 확인하기 위해 Book을 먼저 읽을 필요는 없다.
3. 담당 문서에서 적용 범위, 기본값, 실패와 소유권까지 읽고 필요한 관련 계약을 따라간다.
4. 연결된 구현, 테스트, 실행 예제로 주장을 대조하고 실제 검증 범위를 기록한다. 현재 checkout에서의 검증을 배포된 최신 패키지 검증으로 표현하지 않는다.

이 색인은 문서 권위·부트스트랩·라이프사이클의 문서와 근거 경로를 연결하는 작은 pilot 참조 색인이다. 계약 본문을 복제하거나 43개 패키지 전체 coverage를 선언하지 않는다. 색인 항목의 존재나 `pnpm docs:knowledge-check` 통과는 문서 의미·동작 정확성의 증명이 아니며, 담당 계약과 실행 근거를 계속 대조해야 한다.

사람은 Book에서 시작할 수 있지만, 최종적으로 같은 담당 계약과 실행 근거에 도달해야 한다.

## Markdown contract fields

별도의 AI 전용 복제 문서 대신 간결한 Markdown을 사용한다. 아래 필드를 표나 짧은 절로 드러내고, 기존 문서는 안정 heading/anchor를 보존하며 내용을 보완한다. 관련 없는 필드는 이유와 함께 적용 대상이 아님을 명시한다. 모르는 값을 기본값이나 보장으로 추정하지 않는다.

| 필드 | 기록할 내용 |
| --- | --- |
| Scope | 답하는 작업, 계약의 담당 문서, 적용 runtime/platform/version, 제외 범위. |
| Prerequisites | 필수 패키지, 사전 등록, 설정, 파일, 외부 서비스와 실행 환경. `generated-app`과 `repository-example`, registry와 workspace 전제를 구분한다. |
| Public imports | 실제 공개 package/subpath와 export 이름. 내부 소스 경로를 소비자 import로 제시하지 않는다. |
| Inputs | 필수·선택 입력, 허용 값, 검증 책임과 잘못된 입력을 거절하는 경계. |
| Defaults | 입력을 생략했을 때의 정확한 값과 동작, opt-in/opt-out 조건. |
| Outputs | 반환값과 응답, 완료 시점, 관찰 가능한 상태와 부수 효과. |
| Order | 시작, 요청, 오류 처리, 종료 순서와 비동기 완료 경계. 생성·준비·요청 수용을 같은 시점으로 취급하지 않는다. |
| Failures | 발생 조건, throw/reject/응답 방식, 부분 실패, 정리, 재시도 가능 여부와 실패 뒤 상태. |
| Resource ownership | 생성, 등록, 활성화, drain, close/disposal과 signal을 담당하는 framework/adapter/host/application 주체. |
| Limitations | 의도적으로 제공하지 않는 보장, 지원하지 않는 조합, 애플리케이션이 별도로 구현해야 하는 정책. |
| Examples and alternatives | 완전한 실행 예제 또는 범위가 명시된 부분 코드, 기대 결과, 대안의 선택 조건, 관련 계약과 Book 적용 장. |
| Evidence | 실제 구현·공개 export·테스트·실행 예제의 경로와 관련 동작. 검증 명령과 필요한 환경을 제시하고, 미실행·외부 의존 범위를 구분한다. |

실행 날짜, 정확한 checkout/head, 변경 파일, 명령, exit code, 실제 stdout/관찰 결과, 실행하지 못한 범위는 검증 receipt에 기록한다. 구조·링크·코드 일치 검사는 번역 의미나 런타임 동작을 자동 증명하지 않는다. 이 권위 정책 자체는 런타임 API가 아니라 문서 정책이므로, 적용 근거는 [Docs 허브](../README.ko.md), [Book 집필 기준](../../book/EDITORIAL.ko.md), 프로젝트 로컬 [문서 skill](../../.agents/skills/fluo-docs-governance/SKILL.md)과 [계약 skill](../../.agents/skills/fluo-contract-governance/SKILL.md)이다.

## Conflicting sources

기존 계약, 담당 구현, 테스트를 함께 대조해 문서 오류인지 구현 회귀인지 판단한다. 테스트가 없거나 주장과 무관하면 근거의 빈틈으로 기록한다. 구현에 맞추기 위해 기존 보장, 순서, 오류, 정리 책임을 조용히 낮추지 않는다.

충돌은 담당 문서에서 먼저 해결한 뒤 Book과 요약에 반영한다. 공개 동작 변경이 필요하면 문서 정리와 분리해 승인받고, 구현·테스트·계약·마이그레이션 안내와 필요한 Changeset을 함께 변경한다. 해결되지 않은 충돌은 검토 인계에 명시하며 이미 정렬된 계약처럼 설명하지 않는다.

## Change sequence and bilingual increments

1. **Docs 기준 확정:** 담당 문서 쌍과 영향받는 계약·Book 장을 식별하고 기존 약속과 충돌을 해결한다.
2. **근거 검증:** 구현과 테스트를 대조하고 영향받는 실행 경로를 검증한다. 명령·결과·한계는 receipt로 남긴다.
3. **Book 한국어 적용:** 검증한 Docs를 제품 서사에 반영한다. 최초 집필은 한국어 72장 전체를 먼저 검토한다. 기존 Book의 정정은 서로 의존하는 장을 포함한 영향받는 한국어 묶음 전체를 검토·확정한 뒤 동결한다.
4. **영어 대응:** 동결한 한국어 묶음을 기준으로 장·절 순서, 코드·명령, 결과, 기본값, 제약, 실패 조건을 빠짐없이 맞춘다. 한국어 초안과 영어 집필을 병행하지 않는다.
5. **양언어 인계:** 병합 가능한 각 증분에는 확정한 한국어 묶음과 영어 대응을 함께 넣고, 미번역 초안을 섞지 않는다. 기존 양언어 검사를 통과하고 의미를 검토한다. 한국어 작성 중 임시 locale 불완전성은 허용하지만 병합 시 parity 면제는 아니다.

Docs 변경마다 Book 영향을 검토한다. 의미가 바뀌면 해당 장을 수정하고, 편집만 바뀌어 Book 수정이 불필요하면 그 근거를 기록한다. Book의 필수 설명을 링크로 대체하지 않는다. KRW 선택, 게시글·주문 상태, 앱 주소, 영속성·재시도 정책은 앱 소유 정책으로 구분한다. 의도적으로 실패하는 중간 코드나 비교 실험은 최종 권장 구현과 명확히 구별한다.

기존 machine sentinel, 안정 링크와 검사 소비자를 이전할 때는 담당 문서·trigger·assertion·negative regression을 같은 검증된 변경에서 맞추고 검출력을 낮추지 않는다. 한국어 집필 중에는 `pnpm book:check:ko`, 양언어 증분에는 `pnpm book:check`를 사용한다. `pnpm docs:sync-check`는 웹사이트 counterpart 존재 검사이며 EN/KO 의미 검토를 대신하지 않는다. 자연어 문장이나 prompt를 고정하는 테스트는 추가하지 않는다.
