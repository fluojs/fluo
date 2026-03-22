# 용어집과 멘탈 모델

<p><a href="./glossary-and-mental-model.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 공유 용어를 짧고 안정적으로 유지하기 위한 참조입니다.

## 핵심 멘탈 모델

- `Dispatcher` ~= Spring `DispatcherServlet`
- `Middleware` ~= 넓은 범위의 pre-handler filter layer
- `Guard` = authorization gate
- `Interceptor` = invocation wrapper
- `RequestDto` = 명시적인 route-level DTO binding 계약
- `ExceptionResolver` = canonical exception-to-response shaping 경로

## 정책 용어

- `official` = 지원되며 적극적으로 검증됨
- `preview` = 의도적으로 제공되지만 완전한 동등성/커버리지를 약속하지 않음
- `experimental` = 탐색용으로 제공되며 안정적인 지원 약속은 아님
- `recommended preset` = docs/examples가 최적화하는 단일 기본 경로
- `official matrix` = 단일 recommended preset보다 넓을 수 있는, 공식 지원 조합 전체

## 생성기 용어

- `konekti new` = 정식 공개 bootstrap entry
- `konekti g ...` = 개별 artifact generation
- `repo` = 추천 기본 패턴이지, 강제 아키텍처 법칙은 아님
- `request-dto` / `response-dto` = 의도적으로 분리된 generator schematics

## 관련 문서

- `../concepts/http-runtime.md`
- `../concepts/decorators-and-metadata.md`
- `./support-matrix.ko.md`
