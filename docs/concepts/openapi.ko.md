# OpenAPI 문서화

<p><a href="./openapi.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

문서화는 나중에 덧붙이는 작업이 되어서는 안 됩니다. Konekti는 HTTP 라우트, 유효성 검사 규칙 및 보안 설정에서 메타데이터를 집계하여 자동으로 **OpenAPI 3.1.0** 문서를 생성하는 기능을 제공합니다. 이를 통해 API 명세와 실제 구현을 항상 완벽하게 동기화할 수 있습니다.

## 왜 Konekti의 OpenAPI인가요?

- **수동 동기화 제로**: 코드가 곧 문서입니다. 라우트나 DTO의 변경 사항이 생성된 명세에 자동으로 반영됩니다.
- **대화형 UI**: 내장된 **Swagger UI** 지원을 통해 개발자가 브라우저에서 직접 엔드포인트를 테스트할 수 있습니다.
- **기계 읽기 가능**: 생성된 `openapi.json`을 사용하여 클라이언트 라이브러리를 생성하거나, 계약 테스트를 수행하고, API 게이트웨이와 통합할 수 있습니다.
- **DTO 통합**: `@konekti/validation` 데코레이터를 풍부한 JSON Schema 컴포넌트로 자동 변환합니다.

## 책임 분담

- **`@konekti/openapi` (생성기)**: 메타데이터 수집을 오케스트레이션하고 최종 명세를 생성하는 핵심 엔진입니다. 선택적인 Swagger UI 미들웨어도 제공합니다.
- **`@konekti/http` (소스)**: 경로, 메서드, HTTP 상태 코드 및 URI 버전 정보와 같은 라우트 레벨의 메타데이터를 공급합니다.
- **`@konekti/validation` (스키마)**: 클래스 기반 DTO와 유효성 검사 규칙(예: `@IsEmail()`, `@Min(1)`)을 OpenAPI 스키마 컴포넌트로 변환합니다.

## 일반적인 워크플로우

### 1. 설정 없는 자동 탐색
`OpenApiModule.forRoot()`를 가져오는 것만으로도 Konekti는 컨트롤러 스캔을 시작합니다. 경로, 메서드와 같은 대부분의 기본 정보는 자동으로 캡처됩니다.

### 2. 데코레이터를 통한 보완
비즈니스 로직을 오염시키지 않으면서 전용 문서화 데코레이터를 사용하여 사람이 읽기 쉬운 문맥을 추가할 수 있습니다.

```typescript
@ApiTag('Users')
@Controller('/users')
class UsersController {
  @ApiOperation({ summary: '새 사용자 프로필 생성' })
  @ApiResponse(201, { description: '사용자가 성공적으로 생성됨' })
  @Post('/')
  create(@FromBody() dto: CreateUserDto) {
    // ...
  }
}
```

### 3. 자동 스키마 생성
DTO 클래스는 자동으로 OpenAPI "Components"가 됩니다.

```typescript
export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  name: string;
}
```

### 4. 문서 제공
생성된 문서는 런타임에 노출됩니다:
- **JSON 명세**: `GET /openapi.json`
- **Swagger UI**: `GET /docs` (선택 사항)

## 주요 경계

- **시작 시점의 오버헤드**: 문서 생성은 애플리케이션 부트스트랩 시점에 한 번만 발생합니다. 요청 처리 시점의 성능에는 전혀 영향을 주지 않습니다.
- **표준 데코레이터**: Konekti의 다른 부분과 마찬가지로, OpenAPI 시스템은 레거시 컴파일러 플래그를 피하고 TC39 표준 데코레이터를 사용합니다.
- **보안 우선**: JWT나 API 키와 같은 인증 요구 사항은 `@ApiBearerAuth()` 데코레이터를 통해 명시적으로 문서화되어 보안 상태가 명확하게 전달되도록 합니다.

## 다음 단계

- **설정**: [OpenAPI 패키지 README](../../packages/openapi/README.ko.md)에서 사용 가능한 옵션을 확인하세요.
- **유효성 검사**: [Validation 패키지](../../packages/validation/README.ko.md)에서 DTO 작동 방식을 알아보세요.
- **라이브 예제**: [예제 디렉토리](../../examples/README.ko.md)를 확인해 보세요.
