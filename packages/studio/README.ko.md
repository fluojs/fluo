# @konekti/studio

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임 진단 내보내기를 파일 기반으로 확인하는 뷰어입니다.

## 제공 기능

- `konekti inspect --json`으로 내보낸 JSON 파일 로드
- 진단 스키마 버전 호환성(`version: 1`) 검증
- 모듈 노드/임포트 엣지 시각화 + 루트 모듈 강조
- 모듈 상세(imports/exports/controllers/providers) 표시
- 검색 + provider scope/type 필터 + global module 필터
- timing 페이로드가 있을 때 부트스트랩 타이밍 표시
- 로드한 JSON/ Mermaid 출력 복사·다운로드 헬퍼 제공

## 실행

```bash
pnpm --dir packages/studio dev
```

빌드:

```bash
pnpm --dir packages/studio build
```
