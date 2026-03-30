# @konekti/dto

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


데코레이터 기반 TypeScript DTO 유틸리티 패키지입니다. `@konekti/dto`는 DTO 검증 규칙, validation/transform 엔진, `@ValidateClass(schema)`를 통한 Standard Schema 호환 클래스 검증, 메타데이터를 보존하는 mapped DTO helper를 담당합니다.

반대로 request binding이나 transport별 입력 추출은 이 패키지 책임이 아닙니다. `@konekti/http` 같은 패키지가 자신의 binding decorator와 함께 DTO 메타데이터를 사용하고, `@konekti/dto`는 규칙을 `ValidationIssue` / `DtoValidationError`와 타입이 지정된 DTO 인스턴스로 연결하는 역할에 집중합니다.

## 관련 문서

- `../../docs/concepts/decorators-and-metadata.md`
- `../../docs/concepts/http-runtime.md`

## 설치

```bash
pnpm add @konekti/dto
```

## 이 패키지가 하는 일

- `@IsString()`, `@MinLength()`, `@ValidateNested()` 같은 필드 레벨 검증 데코레이터 제공
- `@ValidateClass(...)`를 통한 클래스 레벨 검증 제공
- 이미 DTO 형태를 가진 값을 검증하는 `DefaultValidator.validate(...)`
- plain payload를 타입이 지정된 DTO 인스턴스로 변환한 뒤 검증하는 `DefaultValidator.transform(...)`
- Zod, Valibot, ArkType 등 Standard Schema v1 호환 validator의 이슈 정규화
- 메타데이터를 보존하는 mapped DTO helper: `PickType`, `OmitType`, `PartialType`, `IntersectionType`

## 이 패키지가 하지 않는 일

- HTTP body/query/path/header/cookie에서 값을 읽는 일
- transport 전용 binding decorator 정의
- 400 변환이나 route dispatch 같은 request pipeline 책임

## 빠른 시작

```typescript
import { IsEmail, IsString, MinLength, DefaultValidator, DtoValidationError } from '@konekti/dto';

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

### plain payload를 DTO 인스턴스로 변환하기

```typescript
import { DefaultValidator, IsEmail, MinLength } from '@konekti/dto';

class CreateUserDto {
  @IsEmail()
  email = '';

  @MinLength(2)
  name = '';
}

const validator = new DefaultValidator();
const dto = await validator.transform(
  { email: 'hello@example.com', name: 'Konekti' },
  CreateUserDto,
);

console.log(dto instanceof CreateUserDto); // true
```

### `transform(...)`는 문자열 ID를 숫자로 강제 변환하지 않습니다

```typescript
import { DefaultValidator, DtoValidationError, IsNumber } from '@konekti/dto';

class GetUserDto {
  @IsNumber()
  id = 0;
}

const validator = new DefaultValidator();

await validator.transform({ id: 42 }, GetUserDto); // ok

await validator.transform({ id: '42' }, GetUserDto); // throws DtoValidationError
```

`transform(...)`는 DTO 인스턴스 형태를 materialize하지만, 스칼라 값을 암묵적으로 coercion하지는 않습니다. transport layer에서 ID가 문자열로 들어오고 `id`를 숫자로 만들고 싶다면, DTO validation 전에 그 값을 명시적으로 변환해야 합니다.

## 핵심 API

### `DefaultValidator`

메인 검증 엔진. `Validator` 인터페이스를 구현합니다.

```typescript
class DefaultValidator implements Validator {
  async validate(value: unknown, target: Constructor): Promise<void>;
  async transform<T>(value: unknown, target: Constructor<T>): Promise<T>;
}
```

`validate(...)`는 이미 DTO 형태를 가진 값을 검증합니다.

`transform(...)`는 raw 값을 타입이 지정된 DTO 인스턴스로 materialize하고, nested DTO 필드를 재귀적으로 hydrate한 뒤 결과를 검증합니다. 검증 규칙이 실패하면 `DtoValidationError`를 throw합니다.

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
  transform<T>(value: unknown, target: Constructor<T>): MaybePromise<T>;
}
```

커스텀 검증 전략을 제공하려면 이 인터페이스를 구현하면 됩니다.

### `validate`와 `transform` 비교

| 메서드 | 입력 | 출력 | 중첩 DTO 변환 |
|---|---|---|---|
| `validate` | 기존 DTO 형태 값 | `void` | 아니오 |
| `transform` | raw 값 / plain object payload | 타입이 지정된 DTO 인스턴스 | 예 |

`transform`은 own-enumerable 속성만 안전하게 복사하며, `__proto__`, `constructor`, `prototype` 같은 위험한 키는 차단합니다.

## 데코레이터

### 타입 검사

| 데코레이터 | 설명 |
|-----------|------|
| `@IsString()` | 문자열이어야 함 |
| `@IsNumber({ allowNaN?: boolean })` | 숫자여야 함; 기본적으로 `NaN`은 거부되며 `allowNaN: true`일 때만 허용됨 |
| `@IsBoolean()` | 불리언이어야 함 |
| `@IsDate()` | `Date` 인스턴스여야 함 |
| `@IsArray()` | 배열이어야 함 |
| `@IsObject()` | plain object(`{}` 또는 `Object.create(null)`)여야 함; 클래스 인스턴스는 통과하지 않음 |
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

`@IsDateString()`는 ISO-8601 문자열만 검증합니다.

### 배열

| 데코레이터 | 설명 |
|-----------|------|
| `@ArrayContains(values)` | 배열이 모든 `values`를 포함해야 함 |
| `@ArrayNotContains(values)` | 배열이 `values` 중 어느 것도 포함하지 않아야 함 |
| `@ArrayNotEmpty()` | 배열에 최소 한 개의 요소가 있어야 함 |
| `@ArrayMinSize(n)` | 배열 길이 ≥ `n` |
| `@ArrayMaxSize(n)` | 배열 길이 ≤ `n` |
| `@ArrayUnique(selector?)` | 모든 배열 요소가 고유해야 함; `selector`로 비교 키를 지정할 수 있음 |

`{ each: true }`는 `@MinLength(...)` 같은 스칼라 validator를 배열 요소별로 적용할 때 가장 유용합니다.

`{ each: true }`는 `Set`과 `Map` 값에서도 동작합니다. `Map`의 경우 key가 아니라 각 value를 검증합니다.

### 중첩 및 조건부

| 데코레이터 | 설명 |
|-----------|------|
| `@ValidateNested(() => TargetClass)` | 중첩 객체를 재귀적으로 검증 |
| `@ValidateNested(() => TargetClass, { each: true })` | 배열의 각 항목을 재귀적으로 검증 |
| `@ValidateIf(condition)` | `condition(dto, value)`가 falsy이면 해당 필드 validator를 건너뜀 (동기/비동기 가능) |

### 커스텀 검증기

```typescript
import { z } from 'zod';

// 필드 레벨 커스텀 검증기
@Validate(MyCustomValidator, options?)
field = value;

// 클래스 레벨 커스텀 검증기
@ValidateClass(MyClassValidator, options?)
class MyDto { ... }

// 클래스 레벨 Standard Schema 검증기
@ValidateClass(z.object({
  email: z.string().email(),
}))
class CreateUserDto {
  email = '';
}
```

`@Validate(...)`는 필드 레벨에만 사용합니다. `@ValidateClass(...)`는 DTO 전체 invariant와 schema 연결 지점입니다.

Zod, Valibot, ArkType처럼 Standard Schema를 구현한 검증기는 `@ValidateClass(schema)`를 통해 DTO 레벨에 직접 붙일 수 있습니다.

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

중첩 DTO를 변환할 때는 plain object payload만 nested 인스턴스에 복사합니다. non-plain 입력은 invalid data로 취급되며 DTO 필드에 암묵적으로 merge되지 않습니다.

순환(cyclic) 중첩 payload도 invalid data로 취급하므로, 재귀 검증은 무한 재귀 대신 validation error로 실패합니다.

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

### selector 기반 배열 고유성 검사

```typescript
class UniqueItemsDto {
  @ArrayUnique((item: { id: string }) => item.id)
  items: Array<{ id: string }> = [];
}
```

### `Set`과 `Map`에서의 `each: true`

```typescript
class CollectionDto {
  @MinLength(2, { each: true })
  tagsSet = new Set<string>();

  @MinLength(2, { each: true })
  tagsMap = new Map<string, string>();
}
```

두 컬렉션 모두 에러 경로는 대괄호 표기법을 사용합니다: `{ field: 'tagsSet[1]', ... }`, `{ field: 'tagsMap[1]', ... }`.

### 커스텀 에러 메시지

모든 데코레이터는 선택적 `message` 문자열을 가진 옵션 객체를 받습니다:

```typescript
@IsEmail({ message: '유효한 이메일 주소를 입력해 주세요.' })
email = '';
```

---

## Mapped DTO Helpers

Mapped DTO helper는 기존 DTO 하나 이상에서 새 DTO 클래스를 파생하면서 검증 메타데이터와, companion package가 이미 붙여 둔 필드 binding 메타데이터를 함께 보존합니다.

`@konekti/dto`에서 바로 import할 수도 있고, subpath export인 `@konekti/dto/mapped-types`를 사용할 수도 있습니다.

```typescript
import { IntersectionType, OmitType, PartialType, PickType } from '@konekti/dto';

class CreateUserDto {
  @IsEmail()
  email = '';

  @MinLength(2)
  name = '';
}

class AddressDto {
  @MinLength(1)
  city = '';
}

const UserEmailDto = PickType(CreateUserDto, ['email']);
const UserWithoutNameDto = OmitType(CreateUserDto, ['name']);
const PartialUserDto = PartialType(CreateUserDto);
const UserWithAddressDto = IntersectionType(CreateUserDto, AddressDto);
```

- `PickType()`은 선택한 필드만 유지합니다.
- `OmitType()`은 선택한 필드를 제거합니다.
- `PartialType()`은 상속된 필드를 validation과 companion-package binding 의미에서 optional로 만듭니다.
- `IntersectionType()`은 여러 DTO의 필드와 메타데이터를 합칩니다.

## 의존성

| 패키지 | 역할 |
|--------|------|
| `@konekti/core` | 공유 core 유틸리티 및 메타데이터 타입 |
| `validator` | 문자열 형식 검증 (이메일, URL, UUID 등) |
