# fluo 문서 허브

이 디렉터리는 fluo의 거버넌스 적용 저장소 문서를 담고 있습니다. 공식 웹사이트 소스는 이제 `apps/docs`에 있으며, Fumadocs를 사용해 영어/한국어 이중 언어 문서 표면을 제공합니다.

## 공식 웹사이트 소스

- 앱: `apps/docs`
- 콘텐츠: `apps/docs/content/docs`
- 영어/한국어 parity 검사: `pnpm docs:sync-check`
- 전체 문서 검증: `pnpm verify:docs`

## 정식 저장소 문서

- AI 컨텍스트: [`CONTEXT.ko.md`](./CONTEXT.ko.md)
- 패키지 표면: [`reference/package-surface.ko.md`](./reference/package-surface.ko.md)
- 패키지 선택기: [`reference/package-chooser.ko.md`](./reference/package-chooser.ko.md)
- Behavioral contract: [`contracts/behavioral-contract-policy.ko.md`](./contracts/behavioral-contract-policy.ko.md)
- 테스트 가이드: [`contracts/testing-guide.ko.md`](./contracts/testing-guide.ko.md)

웹사이트는 거버넌스가 적용되는 패키지나 런타임 사실을 요약할 때 source of truth를 중복하지 말고 이 정식 파일로 연결해야 합니다.

## 문서 기여하기

로컬 설정, 검증 명령, PR 프로세스는 root의 [`CONTRIBUTING.ko.md`](../CONTRIBUTING.ko.md)에서 시작하세요. 문서 변경은 다음 저장소별 체크도 함께 따라야 합니다.

- 변경한 문서 페이지의 영어/한국어 counterpart를 동기화하세요.
- localized documentation pair를 바꿀 때는 `pnpm docs:sync-check`를 실행하세요.
- `apps/docs`의 웹사이트 소스나 웹사이트가 소비하는 docs content를 바꿀 때는 `pnpm verify:docs`를 실행하세요.
- 문서가 패키지 동작을 설명한다면 affected package README와 [`contracts/behavioral-contract-policy.ko.md`](./contracts/behavioral-contract-policy.ko.md)가 여전히 일치하는지 확인하세요.
- 공개 패키지 동작 또는 API 변경에 release note가 필요하다면 생성된 changelog artifact를 손으로 수정하지 말고 `.changeset/*.md` 파일로 release intent를 기록하세요.
- 범위가 명확한 문서 PR에는 사전 이슈가 있으면 도움이 되지만 필수는 아닙니다. 이슈가 없다면 PR summary에 문제, 출처 컨텍스트, 의도한 결과를 설명하세요.
