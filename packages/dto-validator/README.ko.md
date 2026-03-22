# @konekti/dto-validator

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


데코레이터 기반 TypeScript DTO 검증. 클래스 필드에 검증 규칙을 선언적으로 적고 구조화된 타입 에러를 얻습니다 — 별도 스키마 파일도, 수동 검사도 없습니다.

이제 Zod, Valibot, 커스텀 스키마 엔진을 같은 `DtoValidationError` 이슈 형태로 연결하는 schema validation 확장 surface도 제공합니다.

## 관련 문서

- `../../docs/concepts/decorators-and-metadata.md`
- `../../docs/concepts/http-runtime.md`

## 설치

```bash
pnpm add @konekti/dto-validator
```

## 빠른 시작

```typescript
import { IsEmail, IsString, MinLength, DefaultValidator, DtoValidationError } from '@konekti/dto-validator';

class CreateUserDto {
  @IsEmail()
  email = '';

  @IsString()
  @MinLength(2)
  name = '';
}

const validator = new DefaultValidator();

try {
  await validator.validate(
    Object.assign(new CreateUserDto(), { email: 'not-an-email', name: 'A' }),
    CreateUserDto,
  );
} catch (err) {
  if (err instanceof DtoValidationError) {
    console.log(err.issues);
    // [
    //   { code: 'EMAIL', field: 'email', message: '...' },
    //   { code: 'MIN_LENGTH', field: 'name', message: '...' },
    // ]
  }
}
```

## 핵심 API

### `DefaultValidator`

메인 검증 엔진. `Validator` 인터페이스를 구현합니다.

```typescript
class DefaultValidator implements Validator {
  async validate(value: unknown, target: Constructor): Promise<void>;
}
```

검증 규칙이 실패하면 `DtoValidationError`를 throw합니다.

### `DtoValidationError`

```typescript
class DtoValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
}
```

### `ValidationIssue`

```typescript
interface ValidationIssue {
  code: string;       // 예: 'EMAIL', 'MIN_LENGTH'
  field?: string;     // 점/대괄호 경로: 'address.city', 'tags[0]'
  message: string;
  source?: MetadataSource;
}
```

### `Validator` 인터페이스

```typescript
interface Validator {
  validate(value: unknown, target: Constructor): MaybePromise<void>;
}
```

커스텀 검증 전략을 제공하려면 이 인터페이스를 구현하면 됩니다.

### 스키마 어댑터 (`@konekti/dto-validator/schema`)

`emitDecoratorMetadata` 없이 스키마 기반 검증을 사용하면서 동일한 `DtoValidationError` 계약을 유지할 수 있습니다.

```typescript
import { z } from 'zod';
import { type } from 'arktype';
import { object, pipe, safeParse, string, email } from 'valibot';
import {
  createArkTypeAdapter,
  createSchemaValidator,
  createValibotSchemaValidator,
  createZodSchemaValidator,
  type SchemaValidator,
} from '@konekti/dto-validator/schema';

const zodValidator = createZodSchemaValidator(
  z.object({
    email: z.string().email(),
  }),
);

const valibotValidator = createValibotSchemaValidator(
  object({
    email: pipe(string(), email()),
  }),
  safeParse,
);

const arkTypeValidator = createArkTypeAdapter(
  type({
    email: 'string.email',
  }),
);

const customValidator: SchemaValidator<{ name: string }> = createSchemaValidator({
  parse(value) {
    if (typeof (value as { name?: unknown }).name === 'string') {
      return { success: true, value: { name: (value as { name: string }).name } };
    }

    return {
      success: false,
      issues: [{ code: 'REQUIRED', field: 'name', message: 'name is required' }],
    };
  },
});
```

---

## 데코레이터

### 타입 검사

| 데코레이터 | 설명 |
|-----------|------|
| `@IsString()` | 문자열이어야 함 |
| `@IsNumber()` | 숫자여야 함 |
| `@IsBoolean()` | 불리언이어야 함 |
| `@IsDate()` | `Date` 인스턴스여야 함 |
| `@IsArray()` | 배열이어야 함 |
| `@IsObject()` | null이 아니고 배열이 아닌 객체여야 함 |
| `@IsInt()` | 정수여야 함 |
| `@IsEnum(entity)` | 주어진 enum의 값이어야 함 |

### 존재 여부

| 데코레이터 | 설명 |
|-----------|------|
| `@IsDefined()` | `undefined`나 `null`이 아니어야 함 |
| `@IsOptional()` | `undefined`나 `null`이면 검증 건너뜀 |
| `@IsEmpty()` | 비어 있어야 함 (`''`, `null`, `undefined`) |
| `@IsNotEmpty()` | 비어 있지 않아야 함 |

### 동등성 및 포함

| 데코레이터 | 설명 |
|-----------|------|
| `@Equals(value)` | `value`와 엄격하게 같아야 함 |
| `@NotEquals(value)` | `value`와 같지 않아야 함 |
| `@IsIn(array)` | 허용된 값 중 하나여야 함 |
| `@IsNotIn(array)` | 주어진 값에 없어야 함 |

### 숫자

| 데코레이터 | 설명 |
|-----------|------|
| `@IsPositive()` | 0보다 커야 함 |
| `@IsNegative()` | 0보다 작아야 함 |
| `@IsDivisibleBy(n)` | `n`으로 나눌 수 있어야 함 |
| `@Min(n)` | `n` 이상이어야 함 |
| `@Max(n)` | `n` 이하이어야 함 |

### 날짜

| 데코레이터 | 설명 |
|-----------|------|
| `@MinDate(date)` | `date`와 같거나 이후여야 함 |
| `@MaxDate(date)` | `date`와 같거나 이전이어야 함 |

### 문자열 길이

| 데코레이터 | 설명 |
|-----------|------|
| `@Length(min, max?)` | `min` 이상, 선택적 `max` 이하 길이 |
| `@MinLength(n)` | 길이 ≥ `n` |
| `@MaxLength(n)` | 길이 ≤ `n` |

### 문자열 내용

| 데코레이터 | 설명 |
|-----------|------|
| `@Contains(seed)` | `seed`를 포함해야 함 |
| `@NotContains(seed)` | `seed`를 포함하지 않아야 함 |
| `@Matches(pattern)` | 정규식에 매칭되어야 함 |

### 문자열 형식 (`validator.js` 사용)

`@IsAlpha`, `@IsAlphanumeric`, `@IsAscii`, `@IsBase64`, `@IsBooleanString`, `@IsDataURI`, `@IsDateString`, `@IsDecimal`, `@IsEmail`, `@IsFQDN`, `@IsHexColor`, `@IsHexadecimal`, `@IsJSON`, `@IsJWT`, `@IsLocale`, `@IsLowercase`, `@IsMagnetURI`, `@IsMimeType`, `@IsMongoId`, `@IsNumberString`, `@IsPort`, `@IsRFC3339`, `@IsSemVer`, `@IsUppercase`, `@IsISO8601`, `@IsLatitude`, `@IsLongitude`, `@IsLatLong`, `@IsIP`, `@IsISBN`, `@IsISSN`, `@IsMobilePhone`, `@IsPostalCode`, `@IsRgbColor`, `@IsUrl`, `@IsUUID`, `@IsCurrency`

### 배열

| 데코레이터 | 설명 |
|-----------|------|
| `@ArrayContains(values)` | 배열이 모든 `values`를 포함해야 함 |
| `@ArrayNotContains(values)` | 배열이 `values` 중 어느 것도 포함하지 않아야 함 |
| `@ArrayNotEmpty()` | 배열에 최소 한 개의 요소가 있어야 함 |
| `@ArrayMinSize(n)` | 배열 길이 ≥ `n` |
| `@ArrayMaxSize(n)` | 배열 길이 ≤ `n` |
| `@ArrayUnique()` | 모든 배열 요소가 고유해야 함 |

`{ each: true }`는 `@MinLength(...)` 같은 스칼라 validator를 배열 요소별로 적용할 때 가장 유용합니다.

### 중첩 및 조건부

| 데코레이터 | 설명 |
|-----------|------|
| `@ValidateNested(() => TargetClass)` | 중첩 객체를 재귀적으로 검증 |
| `@ValidateNested(() => TargetClass, { each: true })` | 배열의 각 항목을 재귀적으로 검증 |
| `@ValidateIf(condition)` | `condition(dto, value) === true`일 때만 데코레이터 적용 (동기/비동기 가능) |

### 커스텀 검증기

```typescript
// 필드 레벨 커스텀 검증기
@Validate(MyCustomValidator, options?)
field = value;

// 클래스 레벨 커스텀 검증기
@ValidateClass(MyClassValidator, options?)
class MyDto { ... }
```

---

## 고급 사용법

### 중첩 객체

```typescript
class AddressDto {
  @IsString()
  @IsNotEmpty()
  city = '';
}

class CreateOrderDto {
  @ValidateNested(() => AddressDto)
  address = new AddressDto();
}
```

에러는 점 표기법 경로를 사용합니다: `{ field: 'address.city', ... }`.

### 중첩 객체 배열

```typescript
class ItemDto {
  @IsString()
  name = '';
}

class CreateOrderDto {
  @ValidateNested(() => ItemDto, { each: true })
  items: ItemDto[] = [];
}
```

에러는 대괄호 표기법을 사용합니다: `{ field: 'items[0].name', ... }`.

### 요소별 문자열 검증

```typescript
class CreateOrderDto {
  @MinLength(2, { each: true })
  tags: string[] = [];
}
```

에러: `{ field: 'tags[1]', ... }`.

### 커스텀 에러 메시지

모든 데코레이터는 선택적 `message` 문자열을 가진 옵션 객체를 받습니다:

```typescript
@IsEmail({ message: '유효한 이메일 주소를 입력해 주세요.' })
email = '';
```

---

## 의존성

| 패키지 | 역할 |
|--------|------|
| `@konekti/core` | 공유 core 유틸리티 및 메타데이터 타입 |
| `validator` | 문자열 형식 검증 (이메일, URL, UUID 등) |
