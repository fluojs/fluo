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

## 현재 상태

현재 `konektijs/konekti`에는 열려 있는 planning issue가 없습니다.

새로운 future-work 질문이 생기면 GitHub Issue로 열고, grouped backlog index가 다시 필요해질 때만 이 파일을 업데이트하세요.

## 유지 규칙

어떤 issue가 해결되면:

- GitHub issue를 닫고
- 영향을 받는 `docs/` 주제와 package README를 업데이트하고
- backlog 구조 자체가 바뀐 경우에만 이 파일을 수정합니다.
