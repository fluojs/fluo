# 에러 응답 (error responses)

<p><a href="./error-responses.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 가이드는 HTTP 런타임 전반에 걸친 표준 에러 엔벨로프(envelope) 및 노출 정책을 설명합니다.

함께 보기:

- `./http-runtime.md`
- `./auth-and-jwt.md`
- `../../packages/http/README.md`

## 표준 에러 엔벨로프

성공적인 응답은 일반 객체 우선 방식을 유지합니다. 에러는 표준 엔벨로프를 사용합니다:

```ts
type ErrorResponse = {
  error: {
    code: string;
    status: number;
    message: string;
    requestId?: string;
    details?: Array<{
      field?: string;
      source?: 'path' | 'query' | 'header' | 'cookie' | 'body';
      code: string;
      message: string;
    }>;
    meta?: Record<string, unknown>;
  };
};
```

## 기본 상태 코드 매핑 (default status mapping)

- 바인딩 및 검증 -> `400`
- 인증 (Authentication) -> `401`
- 인가 (Authorization) -> `403`
- 찾을 수 없음 (Not Found) -> `404`
- 충돌 (Conflict) -> `409`
- 처리되지 않은 내부 에러 -> `500`

## 패키지 경계

- 트랜스포트 중립적인 에러 규약은 코어 레이어에 속합니다.
- HTTP 상태 코드를 인식하는 예외는 `@konekti/http`에 속합니다.
- 가드, 리졸버, 런타임 연결 지점들은 패키지 로컬 또는 트랜스포트 중립적인 실패를 HTTP 예외 제품군으로 변환합니다.

## 노출 정책

기본적으로 안전하게 노출되는 항목:

- 검증 필드 경로
- 클라이언트가 안전하게 볼 수 있는 검증 메시지
- 요청 ID
- 대략적인 인증 실패 카테고리

기본적으로 노출되지 않는 항목 (안전하지 않음):

- 스택 트레이스 (stack traces)
- 내부 원인 체인 (internal cause chains)
- 가공되지 않은 DB/ORM 에러 페이로드
- JWT 검증 내부 세부 정보
- 시크릿/설정 값

## 요청 상관관계 (request correlation)

표준 에러 응답은 런타임 컨텍스트에 ID가 있는 경우 `requestId`를 표시합니다. 이 ID는 로그, 트레이스, 메트릭 전반에서 공용 상관관계 키로 사용되어야 합니다.
