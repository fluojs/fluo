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
