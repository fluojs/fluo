# fluo 문서 허브

이 디렉터리는 fluo의 거버넌스 적용 저장소 문서를 담고 있습니다. 공식 웹사이트 소스는 이제 `apps/docs`에 있으며, Fumadocs를 사용해 영어/한국어 이중 언어 문서 표면을 제공합니다.

Docs는 AI가 사용하는 프레임워크의 규범적 계약 계층이며, Book은 같은 계약에서 파생된 사람 중심의 제품 서사입니다. [문서 권위 정책](./contracts/documentation-authority.ko.md)은 원본 책임, 간결한 Markdown 계약 필드, 충돌 처리와 변경 순서를 정의합니다. 패키지 README는 이 계층에서 패키지 API를 위임받은 원본입니다. 설치·공개 import·필수 사용법·기본값·보장 요약을 유지하고 공통 계약으로 연결하며, API 본문을 `docs/`에 복제하지 않습니다.

## 읽기 경로 선택

| 목적 | 시작할 문서 | 제공하는 내용 |
| --- | --- | --- |
| AI로 코드 작성·검토하기 | [AI 컨텍스트](./CONTEXT.ko.md) | 제약 확인 → [계약 참조 색인](./knowledge-index.json)과 아래 원본 책임 표·패키지 선택기 → 담당 계약 → 구현·테스트·실행 근거. |
| 제품을 만들며 백엔드 설계 배우기 | [3권 시리즈](../book/README.ko.md) | FluoBlog → 머천다이즈 숍 → Fluo 내부 구조로 이어지는 72장. |
| 첫 HTTP 기능을 짧게 확인하기 | [FluoBlog 실습](../apps/docs/content/docs/tutorial/index.ko.mdx) | 초기 라우트·DI·검증 경로의 실행 가능한 보조 과정. |
| 기존 앱에 기능 추가하기 | [작업별 가이드](../apps/docs/content/docs/guides/index.ko.mdx) | 특정 작업의 방법과 기능 선택 기준이며 별도의 입문 과정은 아닙니다. |
| 프레임워크 구현 이해하기 | [3권 Inside Fluo](../book/03-internals/toc.ko.md) | 두 제품의 실행 경로를 소스와 계약으로 추적하는 심화 과정. |
| API나 지원 동작 확인하기 | [패키지 선택기](./reference/package-chooser.ko.md) | 담당 패키지 README와 공통 동작 계약. |
| 실행하거나 내 코드와 비교하기 | [예제](../examples/README.ko.md) | 튜토리얼 단계별 코드를 포함한 실행 가능한 애플리케이션. |

색인은 문서 권위·부트스트랩·라이프사이클의 담당 EN/KO 문서와 소스·테스트 경로를 연결하는 작은 pilot 참조 색인입니다. 계약 본문을 대체하지 않으며 43개 패키지 전체 coverage나 문서 의미·동작 정확성의 증명이 아닙니다. 아직 색인에 없는 계약은 아래 원본 책임 표와 패키지 선택기로 찾으세요.

## 원본 책임

| 주제 | 관리하는 원본 | 다른 문서의 역할 |
| --- | --- | --- |
| 제품·패턴 중심의 전체 학습 경로 | `book/series.json`과 새 3권 본문 | Book은 사람의 중심 학습 경로이며, 프레임워크 사실은 Docs 계약에서 가져옵니다. 사이트와 루트 README는 해당 권과 장으로 안내합니다. |
| 초기 HTTP 실습 지침 | `apps/docs/content/docs/tutorial/` | 첫 라우트·DI·검증을 직접 확인하는 보조 과정이며 책 전체를 대체하지 않습니다. |
| 튜토리얼 단계별 동작 | `examples/fluo-blog/` 소스와 테스트 | 같은 파일과 관찰 가능한 결과를 EN/KO 실습에서 설명합니다. |
| 패키지 API와 패키지별 제약 | 담당 `packages/*/README.md`와 한국어 문서 | 가이드는 한 사용 사례를 설명하고 전체 계약으로 연결합니다. |
| 패키지를 아우르는 런타임·아키텍처 약속 | 해당 `docs/contracts/` 또는 `docs/architecture/` 문서 쌍 | 패키지 README와 Book은 적용 방법을 설명하며 계약을 다시 정의하지 않습니다. |
| 런타임 범위와 도구 지원 | `docs/reference/package-surface.ko.md`와 `toolchain-contract-matrix.ko.md` | 별도 목록을 관리하지 않고 기준 표로 연결합니다. |
| AI 문서 탐색 | `docs/CONTEXT.md`와 한국어 문서 | 담당 문서로 가는 안내이며 두 번째 튜토리얼이 아닙니다. |

설명이 충돌하면 담당 구현, 테스트, 관리 중인 계약을 함께 확인하세요. 원본 문서에서 불일치를 해소한 다음 요약을 갱신하며, 문장 재구성을 이유로 동작 약속을 조용히 바꾸지 않습니다.

구현과 다르다는 이유만으로 문서의 보장을 낮추지 말고 문서 오류인지 구현 회귀인지 판정하세요. 공개 동작 변경은 문서 정리와 분리해 승인받습니다. Book의 통화·게시글·주문 상태 같은 앱 정책은 프레임워크 보장이 아닙니다. 이 권위 규칙은 기존 계약·링크·검사 의존성을 보존하며 전체 패키지나 장의 이전 완료를 뜻하지 않습니다.

## 공식 웹사이트 소스

- 앱: `apps/docs`
- 콘텐츠: `apps/docs/content/docs`
- 영어/한국어 parity 검사: `pnpm docs:sync-check`
- 전체 문서 검증: `pnpm verify:docs`

## 정식 저장소 문서

- AI 컨텍스트: [`CONTEXT.ko.md`](./CONTEXT.ko.md)
- Pilot 계약 참조 색인: [`knowledge-index.json`](./knowledge-index.json)
- 문서 권위와 작성 형식: [`contracts/documentation-authority.ko.md`](./contracts/documentation-authority.ko.md)
- 패키지 표면: [`reference/package-surface.ko.md`](./reference/package-surface.ko.md)
- 패키지 선택기: [`reference/package-chooser.ko.md`](./reference/package-chooser.ko.md)
- Behavioral contract: [`contracts/behavioral-contract-policy.ko.md`](./contracts/behavioral-contract-policy.ko.md)
- HTTP error representation decision: [`architecture/http-error-representations.ko.md`](./architecture/http-error-representations.ko.md)
- React render policy decision: [`architecture/react-render-policy-decorators.ko.md`](./architecture/react-render-policy-decorators.ko.md)
- React page metadata/error/not-found policy decision: [`architecture/react-page-render-policies.ko.md`](./architecture/react-page-render-policies.ko.md)
- React RSC graduation policy: [`contracts/react-rsc-graduation.ko.md`](./contracts/react-rsc-graduation.ko.md)
- 테스트 가이드: [`contracts/testing-guide.ko.md`](./contracts/testing-guide.ko.md)
- Testing package 계약: [`../packages/testing/README.ko.md`](../packages/testing/README.ko.md)
- Testing 학습 경로: [FluoBlog 요청 테스트](../apps/docs/content/docs/tutorial/testing.ko.mdx)
- Testing 배경 설명: [`../book/beginner/ch20-testing.ko.md`](../book/beginner/ch20-testing.ko.md)

웹사이트는 거버넌스가 적용되는 패키지나 런타임 사실을 요약할 때 source of truth를 중복하지 말고 이 정식 파일로 연결해야 합니다.

## 문서 기여하기

로컬 설정, 검증 명령, PR 프로세스는 root의 [`CONTRIBUTING.ko.md`](../CONTRIBUTING.ko.md)에서 시작하세요. 문서 변경은 다음 저장소별 체크도 함께 따라야 합니다.

- 변경한 문서 페이지의 영어/한국어 counterpart를 동기화하세요.
- 웹사이트 페이지와 내비게이션 파일 쌍은 `pnpm docs:sync-check`로 확인하세요. 대응 파일의 존재를 검사하며 번역의 의미를 검사하지는 않습니다.
- `apps/docs`의 웹사이트 소스나 웹사이트가 소비하는 docs content를 바꿀 때는 `pnpm verify:docs`를 실행하세요.
- 튜토리얼 변경 시 단계별 테스트를 실행하고, 변경한 장을 그 장의 출발 상태에서 따라가세요. 최종 예제만 통과한다고 중간 실습 지침까지 검증되지는 않습니다.
- Docs 기준 확정 → 근거 검증 → Book 한국어 적용 → 영어 대응 → 인계 순서를 따릅니다. 최초 집필은 한국어 전체를 검토한 뒤 번역하고, 기존 Book 정정은 의존 장을 포함한 영향받는 한국어 묶음 전체를 확정·동결한 뒤 영어로 옮깁니다.
- 병합 가능한 각 증분에는 확정한 한국어 묶음과 영어 대응을 함께 포함합니다. 미번역 초안을 섞거나 parity를 면제하지 않습니다. 중간 한국어 검증은 `pnpm book:check:ko`, 양언어 증분 검증은 `pnpm book:check`를 사용합니다.
- EN/KO의 명령, 파일 경로, 기본값, 제약, 기대 응답을 함께 검토하세요. 별도 platform governance 검사는 지정된 계약의 구조를 확인하며, 두 구조 검사 모두 이 검토를 대체하지 않습니다.
- 문서가 패키지 동작을 설명한다면 affected package README와 [`contracts/behavioral-contract-policy.ko.md`](./contracts/behavioral-contract-policy.ko.md)가 여전히 일치하는지 확인하세요.
- 공개 패키지 동작 또는 API 변경에 release note가 필요하다면 생성된 changelog artifact를 손으로 수정하지 말고 `.changeset/*.md` 파일로 release intent를 기록하세요.
- 범위가 명확한 문서 PR에는 사전 이슈가 있으면 도움이 되지만 필수는 아닙니다. 이슈가 없다면 PR summary에 문제, 출처 컨텍스트, 의도한 결과를 설명하세요.
