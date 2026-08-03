# Error Response Taxonomy

<p><a href="./error-responses.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/http`가 사용하는 HTTP 에러 envelope, 내장 예외가 노출하는 안정적인 응답 코드, 그리고 알 수 없는 실패를 정규화하는 dispatcher 규칙을 정의합니다.

## Error Shape

`packages/http/src/exceptions.ts`는 직렬화된 표준 envelope를 `ErrorResponse`로 정의합니다.

| Field | Type | Required | Source | Notes |
| --- | --- | --- | --- | --- |
| `error.code` | `string` | Yes | `HttpException.code` | 안정적인 프로그램 식별용 에러 코드입니다. |
| `error.status` | `number` | Yes | `HttpException.status` | 응답에 기록되는 HTTP 상태 코드입니다. |
| `error.message` | `string` | Yes | `HttpException.message` | 사람이 읽는 실패 메시지입니다. |
| `error.details` | `HttpExceptionDetail[]` | No | `HttpException.details` | 바인딩 및 유효성 검사 실패의 필드 또는 source 단위 진단 정보입니다. |
| `error.meta` | `Record<string, unknown>` | No | `HttpException.meta` | observability 또는 클라이언트 진단용 구조화 메타데이터입니다. |
| `error.requestId` | `string` | No | Dispatcher argument | 요청 컨텍스트에 correlation ID가 있을 때 포함됩니다. |

구조화된 계약:

```ts
interface ErrorResponse {
  error: {
    code: string;
    status: number;
    message: string;
    details?: Array<{
      code: string;
      field?: string;
      message: string;
      source?: 'body' | 'path' | 'query' | 'header' | 'cookie';
    }>;
    meta?: Record<string, unknown>;
    requestId?: string;
  };
}
```

현재 HTTP 파이프라인에서 확인되는 detail 생성 지점:

| Producer | Top-level code | Detail codes currently emitted |
| --- | --- | --- |
| `DefaultBinder` 요청 바인딩 실패 | `BAD_REQUEST` | `MISSING_FIELD`, `INVALID_BODY`, `DANGEROUS_KEY`, `UNKNOWN_FIELD` |
| `HttpDtoValidationAdapter` DTO 유효성 검사 실패 | `BAD_REQUEST` | `toInputErrorDetail(...)`를 통해 매핑된 validation issue code |
| 필드 진단이 없는 내장 HTTP 예외 | 예외별 상이 | 없음 |

## Error Codes

`packages/http/src/exceptions.ts`의 내장 예외 클래스는 현재 다음 top-level code를 직렬화합니다.

| HTTP status | Code | Class |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | `BadRequestException` |
| `401` | `UNAUTHORIZED` | `UnauthorizedException` |
| `403` | `FORBIDDEN` | `ForbiddenException` |
| `404` | `NOT_FOUND` | `NotFoundException` |
| `406` | `NOT_ACCEPTABLE` | `NotAcceptableException` |
| `409` | `CONFLICT` | `ConflictException` |
| `413` | `PAYLOAD_TOO_LARGE` | `PayloadTooLargeException` |
| `429` | `TOO_MANY_REQUESTS` | `TooManyRequestsException` |
| `500` | `INTERNAL_SERVER_ERROR` | `InternalServerErrorException` |

`packages/http/src/dispatch/dispatch-error-representation.ts`의 dispatcher 정규화 규칙은 다음 매핑을 추가합니다.

| Input failure | Output code | Output status | Rule |
| --- | --- | --- | --- |
| 기존 `HttpException` | 기존 code | 기존 status | 재매핑 없이 직렬화됩니다. |
| `HandlerNotFoundError` | `NOT_FOUND` | `404` | `NotFoundException`으로 변환됩니다. |
| 그 외 모든 throw 값 | `INTERNAL_SERVER_ERROR` | `500` | `InternalServerErrorException`으로 변환됩니다. |

## Representation Selection

Application이 `errorRepresentation.html`을 등록해도 위 envelope가 canonical contract로 유지된다. 기존
`HttpException`과 route miss에 대해 HTTP는 먼저 canonical outcome을 만든 다음 `application/json`과 사용
가능한 `text/html` provider를 negotiate한다. Provider는 `HttpErrorRepresentationContext`에서 같은
`ErrorResponse`를 받으므로 HTML document가 status, code, details, metadata, request id를 다시 정의하지
않고 outcome을 표현할 수 있다.

`Accept`가 없거나 wildcard tie이면 JSON을 선택한다. Quality와 media-range specificity는 deterministic하며,
specific `q=0` rejection이 해당 representation에 대해 broader wildcard보다 우선한다. 등록된 acceptable
offer가 없으면 HTML을 재귀 호출하지 않고 canonical JSON `406 NOT_ACCEPTABLE`을 보낸다. `HEAD`는 선택된
status/header를 보존하지만 render하거나 body를 보내지 않는다. Provider failure는 원래 canonical JSON
outcome으로 한 번만 fallback한다.

알 수 없는 throw 값은 canonical JSON 500으로 유지되고 HTML representation phase에 들어가지 않는다.
Configured filter와 `onError`가 계속 우선하며 already-committed 또는 aborted request는 다시 쓰지 않는다.
전체 ownership 및 React integration 계약은
[HTTP error representation decision](./http-error-representations.ko.md)을 참고한다.

## Handling Rules

| Rule | Statement | Source anchor |
| --- | --- | --- |
| Serialization boundary | HTTP 클라이언트는 `createErrorResponse(...)`가 만든 `{ error: ... }` envelope를 받습니다. | `packages/http/src/exceptions.ts` |
| Unknown failure masking | `HttpException`이 아닌 값은 `Internal server error.` 메시지와 `INTERNAL_SERVER_ERROR`로 정규화됩니다. | `packages/http/src/dispatch/dispatch-error-representation.ts` |
| Route miss mapping | 누락된 handler는 가공되지 않은 런타임 에러가 아니라 `NOT_FOUND`로 노출됩니다. | `packages/http/src/dispatch/dispatch-error-representation.ts` |
| Response commit guard | 응답이 이미 committed 상태이면 `writeErrorResponse(...)`는 아무 것도 쓰지 않고 반환합니다. | `packages/http/src/dispatch/dispatch-error-representation.ts` |
| Representation negotiation | HTML provider가 등록된 경우에만 eligible HTTP outcome이 deterministic JSON/HTML selection을 사용합니다. | `packages/http/src/dispatch/dispatch-error-negotiation.ts` |
| Provider fallback | Pre-commit provider failure는 configured dispatcher logger로 기록되고 원래 JSON outcome으로 한 번만 fallback합니다. | `packages/http/src/dispatch/dispatch-error-representation.ts` |
| Request correlation | dispatcher는 `requestContext.requestId`를 에러 직렬화에 전달하고, correlation middleware는 가능할 때 inbound header에서 그 값을 채웁니다. | `packages/http/src/dispatch/dispatcher.ts`, `packages/http/src/middleware/correlation.ts` |
| Binding diagnostics | 누락된 요청 필드, 잘못된 body shape, 위험한 key, 미지원 body field는 구조화된 `details`와 함께 `BAD_REQUEST`를 생성합니다. | `packages/http/src/adapters/binding.ts` |
| Validation diagnostics | DTO 유효성 검사 실패는 매핑된 issue detail을 포함한 `BadRequestException`으로 변환됩니다. | `packages/http/src/adapters/dto-validation-adapter.ts` |

제약:

- 안정적인 클라이언트 대상 status와 code가 필요하면 애플리케이션 및 패키지 코드는 `HttpException` 하위 클래스를 던져야 합니다.
- 클라이언트는 `error.message`보다 `error.code`를 기계 식별 키로 취급해야 합니다.
- `error.details`는 선택 항목입니다. 소비자는 `code`, `status`, `message`만 있는 envelope도 처리해야 합니다.
- `requestId`도 선택 항목입니다. 클라이언트 correlation 로직은 모든 응답에 이 값이 있다고 가정하면 안 됩니다.
