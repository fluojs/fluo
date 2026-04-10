# 에러 처리 및 응답 (Error Handling & Responses)

<p><a href="./error-responses.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

백엔드의 품질은 종종 실패를 어떻게 다루느냐에 따라 결정됩니다. fluo는 프레임워크 전반에서 **표준화된 에러 응답 형식**을 강제하여, 문제가 발생했을 때도 클라이언트에게 예측 가능하고 유용하며 보안상 안전한 API를 제공합니다.

## 왜 fluo의 에러 처리인가요?

- **예측 가능한 API Surface**: 클라이언트는 데이터베이스, 유효성 검사, 인증 가드 등 에러의 발생 지점에 상관없이 작동하는 단일 에러 처리 로직을 구현할 수 있습니다.
- **실용적인 피드백**: 유효성 검사 에러는 필드 레벨의 상세 정보를 포함하므로, 프론트엔드 개발자가 추측 없이 사용자에게 정확한 에러 메시지를 보여줄 수 있습니다.
- **보안을 고려한 설계**: 프로덕션 환경에서는 내부 스택 트레이스(Stack trace)와 민감한 데이터베이스 에러가 자동으로 제거되어 정보 유출을 방지합니다.
- **요청 상관관계 (Correlation)**: 모든 에러 응답에 `requestId`를 포함하여, 개발자가 관측 가능성 도구에서 해당 로그를 손쉽게 찾을 수 있도록 돕습니다.

## 책임 분담

- **`@fluojs/http` (필터)**: 처리되지 않은 에러를 캐치하는 글로벌 예외 필터, 기본 `HttpException` 클래스, 그리고 `NotFoundException`, `ForbiddenException` 같은 표준 HTTP 예외를 제공합니다.
- **`@fluojs/validation` (리포터)**: DTO 유효성 검사 실패 시 풍부하고 계층적인 에러 구조를 생성하는 데 특화되어 있습니다.
- **`@fluojs/core` (계약)**: `fluoError` 같은 공통 프레임워크 에러 프리미티브와 다른 패키지들이 기대하는 낮은 수준의 불변 조건을 정의합니다.

## 일반적인 워크플로우

### 1. 예외 던지기 (Throwing an Exception)
내장된 예외 클래스를 사용하여 의도를 명확히 전달하고 HTTP 상태 코드를 일관되게 유지하세요.

```typescript
if (!user) {
  throw new NotFoundException('사용자를 찾을 수 없습니다');
}
```

### 2. 글로벌 캐치올 (Global Catch-All)
요청 처리 중 발생하는 모든 예외는 fluo 디스패처에 의해 캡처됩니다. 디스패처는 해당 예외가 알려진 `HttpException`인지 일반 JavaScript `Error`인지 식별합니다.

### 3. 에러 봉투 포맷팅 (Envelope Formatting)
에러는 표준 fluo 봉투(Envelope) 형식으로 래핑됩니다.

```json
{
  "error": {
    "code": "NOT_FOUND",
    "status": 404,
    "message": "사용자를 찾을 수 없습니다",
    "requestId": "req_abc123",
    "timestamp": "2024-04-08T..."
  }
}
```

### 4. 유효성 검사 상세 정보
DTO 유효성 검사에 실패하면 `details` 배열에 구체적인 필드 위반 사항이 포함됩니다.

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "status": 400,
    "message": "잘못된 요청입니다",
    "details": [
      { "field": "email", "issue": "유효한 이메일 형식이어야 합니다" }
    ]
  }
}
```

## 주요 경계

- **프로덕션 보호막**: 프로덕션 모드에서는 데이터베이스 연결 실패와 같은 가공되지 않은 `Error` 객체가 인프라 보안을 위해 일반적인 `INTERNAL_SERVER_ERROR` 코드로 매핑됩니다.
- **상관관계가 핵심입니다**: 클라이언트 측 에러 보고나 지원 티켓에 항상 `requestId`를 포함하세요. 이는 클라이언트의 경험과 서버 로그를 연결하는 "접착제" 역할을 합니다.
- **커스텀보다 일관성**: 에러 필터를 커스텀할 수 있지만, CLI 및 클라이언트 생성기와의 생태계 호환성을 유지하기 위해 표준 봉투 형식을 따를 것을 강력히 권장합니다.

## 다음 단계

- **계층 구조**: [HTTP 패키지 README](../../packages/http/README.ko.md)에서 내장된 예외 클래스들을 확인하세요.
- **유효성 검사**: [Validation 패키지](../../packages/validation/README.ko.md)에서 풍부한 에러 보고 기능을 알아보세요.
- **고급**: [HTTP 패키지 README](../../packages/http/README.ko.md)에서 커스텀 예외 필터를 만드는 방법을 배워보세요.
