# @fluojs/validation

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo를 위한 입력값 검증 데코레이터, Mapped DTO 헬퍼 및 검증 엔진입니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API](#공개-api)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/validation
```

## 사용 시점

- raw request payload를 비즈니스 로직에 도달하기 전에 검증된 DTO 인스턴스로 바꿔야 할 때
- 컨트롤러나 서비스에서 ad hoc parsing 대신 class 기반 검증 규칙을 쓰고 싶을 때
- `PickType`, `PartialType`, `IntersectionType` 같은 metadata-preserving mapped DTO helper가 필요할 때
- `@ValidateClass(...)`로 Zod나 Valibot 같은 Standard Schema validator를 붙이고 싶을 때
- `@fluojs/i18n/validation`으로 명시적으로 localize할 수 있는 안정적인 validation issue code와 path가 필요할 때

## 빠른 시작

```ts
import { DefaultValidator, DtoValidationError, IsEmail, IsString, MinLength } from '@fluojs/validation';

class CreateUserDto {
  @IsEmail()
  email = '';

  @IsString()
  @MinLength(2)
  name = '';
}

const validator = new DefaultValidator();

try {
  const dto = await validator.materialize(
    { email: 'hello@example.com', name: 'fluo' },
    CreateUserDto,
  );

  console.log(dto instanceof CreateUserDto);
} catch (error) {
  if (error instanceof DtoValidationError) {
    console.log(error.issues);
  }
}
```

## 주요 패턴

### `materialize()` vs `validate()`

- **`materialize<T>(value, target)`**: **입력 처리**에 가장 적합합니다. plain 객체를 받아 대상 클래스의 인스턴스를 생성하고, 값을 복사하며, 중첩된 DTO를 재귀적으로 처리한 후 모든 검증 규칙을 실행합니다.
- **`validate(instance, target)`**: **기존 루트 객체 확인**에 적합합니다. 이미 생성된 루트 값에 대해 검증 규칙을 실행하며, plain 객체인 `@ValidateNested(...)` 값은 중첩 DTO 규칙을 실행하기 위해 임시로 실체화할 수 있습니다. 이 임시 실체화는 호출자가 넘긴 속성 값을 대체하지 않습니다.

`validate()`는 문자열, 배열, `null`, `undefined` 같은 잘못된 루트 값을 field 또는
class rule이 실행되기 전에 deterministic `DtoValidationError`로 거부합니다. 이미
생성된 대상 DTO 인스턴스와 plain 루트 객체는 허용하므로 request-pipeline binder가
준비한 DTO payload를 scalar coercion 없이 검증할 수 있습니다.

`materialize()`는 plain 입력 객체의 안전한 own enumerable 속성을 복사하고,
DTO 바인딩 메타데이터를 적용한 뒤 `@ValidateNested(...)` 필드를 재귀적으로
실체화합니다. 어떤 요청 소스를 선택하고 스칼라 값을 변환할지는 transport 또는
binder가 검증 전에 담당한다는 request-pipeline 계약을 유지합니다.
선언된 중첩 DTO의 인스턴스인 기존 중첩 값은 그대로 보존하고, plain 중첩 값만
해당 필드 또는 collection entry 단위로 실체화합니다.
`materialize()`에 넘기는 루트 값은 plain 객체이거나 대상 DTO 인스턴스여야 합니다.
문자열, 배열, `null` 같은 잘못된 루트 값은 대상 DTO 생성자나 필드 initializer가
실행되기 전에 거부됩니다.

### 검증 이슈 형태

`DtoValidationError.issues`는 request-pipeline 오류 상세에 사용하는 안정적인 DTO입니다.

```ts
type ValidationIssue = {
  code: string;
  field?: string;
  message: string;
  source?: 'path' | 'query' | 'header' | 'cookie' | 'body';
};
```

중첩 DTO는 `address.city`, `items[0].name` 같은 dot path와 collection index를
사용합니다. HTTP 바인딩에서 온 규칙은 `source`를 붙이며, standalone validation이나
Standard Schema 이슈에서는 값이 없을 수 있습니다.

`@fluojs/validation`은 항상 기존 human-readable `message` 값을 방출합니다. Localized message가 필요한 애플리케이션은 validation 실패 후 `@fluojs/i18n/validation`에 opt-in할 수 있습니다. 이 통합은 validator 실행을 바꾸거나 이 패키지를 HTTP locale resolution에 결합하지 않고 `source`, `field`, `code`를 translation key로 매핑합니다.

### Mapped DTO 헬퍼

```ts
import { IsString, IsEmail, PickType, PartialType } from '@fluojs/validation';

class UserDto {
  @IsString() name = '';
  @IsEmail() email = '';
}

class EmailOnlyDto extends PickType(UserDto, ['email']) {}
class UpdateUserDto extends PartialType(UserDto) {}
```

Mapped DTO helper는 위와 같은 문서화된 subclassing 패턴에서도 field-level
validation 및 binding metadata를 보존합니다. `PickType`, `OmitType`,
`PartialType`은 생략되었거나 optional이 된 필드에 의존할 수 있는 base
class-level validator를 derived DTO로 전달하지 않습니다.

### Standard Schema 지원

Standard Schema adapter는 유효하지 않은 입력을 명시적인 issue로 보고해야 합니다. issue가 없는 검증 결과는 성공으로 처리합니다.

```ts
import { ValidateClass } from '@fluojs/validation';
import { z } from 'zod';

const UserSchema = z.object({ age: z.number().min(18) });

@ValidateClass(UserSchema)
class RestrictedUserDto {
  age = 0;
}
```

`ValidateClass(...)`는 custom class-level validator도 받을 수 있습니다. `Validate(...)`는 built-in decorator만으로 부족할 때 custom field-level validator를 붙이고, `ValidateIf(...)`는 predicate가 false를 반환하면 dependent validator를 short-circuit합니다.

### 네트워크 검증기

`@IsIP()`는 기본적으로 IPv4와 IPv6 문자열을 모두 검증합니다. 한 IP 버전으로
제한하려면 `@IsIP('4')` 또는 `@IsIP('6')`을 전달하세요.
`@IsIP('4_or_6')`은 `@IsIP()`와 같은 런타임 동작을 유지하면서 "IPv4 또는
IPv6 모두 허용" 계약을 명시하고 싶을 때 사용할 수 있습니다.

### 중첩 검증

`@ValidateNested(...)`는 객체 필드, 배열, `Set`, `Map`을 지원합니다. 중첩 DTO path는 validation issue에서 dot/index 표기법을 사용하며, cycle은 안전하게 감지되고 shared reference는 허용됩니다.
중첩 타입을 지연 해석해야 할 때는 DTO 클래스 자체나 `() => ChildDto`, `function resolveChildDto() { return ChildDto; }` 같은 lazy constructor factory를 전달할 수 있습니다.

### 암묵적 scalar coercion 없음

`materialize()`는 의도적으로 엄격합니다. Transport가 `'42'`를 넘기고 DTO가 `number`를 기대한다면, transport나 binding layer가 먼저 변환해야 합니다.
`@IsLatitude()`, `@IsLongitude()`를 포함한 numeric validator는 numeric string을 이미 변환된 number처럼 취급하지 않고 DTO의 numeric 값을 검증합니다.

## 공개 API

- **검증 엔진**: `DefaultValidator`, `DtoValidationError`, `ValidationIssue`, `Validator`
- **핵심 데코레이터**: `IsString`, `IsNumber`, `IsBoolean`, `IsDate`, `IsArray`, `IsObject`, `IsEnum`, `IsInt`, `IsDefined`, `IsOptional`, `ValidateNested`, `ValidateIf`, `Validate`, `ValidateClass`
- **존재 및 비교 데코레이터**: `IsEmpty`, `IsNotEmpty`, `Equals`, `NotEquals`, `IsIn`, `IsNotIn`
- **문자열 및 네트워크 데코레이터**: `IsEmail`, `IsUrl`, `IsUUID`, `IsIP`, `IsAlpha`, `IsAlphanumeric`, `IsAscii`, `IsBase64`, `IsBooleanString`, `IsDataURI`, `IsDateString`, `IsDecimal`, `IsFQDN`, `IsHexColor`, `IsHexadecimal`, `IsJSON`, `IsJWT`, `IsLocale`, `IsLowercase`, `IsMagnetURI`, `IsMimeType`, `IsMongoId`, `IsNumberString`, `IsPort`, `IsRFC3339`, `IsSemVer`, `IsUppercase`, `IsISO8601`, `Matches`, `Length`, `MinLength`, `MaxLength`, `Contains`, `NotContains`
- **숫자, 날짜, 지리, locale 데코레이터**: `Min`, `Max`, `IsPositive`, `IsNegative`, `IsDivisibleBy`, `MinDate`, `MaxDate`, `IsLatitude`, `IsLongitude`, `IsLatLong`, `IsISBN`, `IsISSN`, `IsMobilePhone`, `IsPostalCode`, `IsRgbColor`, `IsCurrency`
- **배열 데코레이터**: `ArrayContains`, `ArrayNotContains`, `ArrayNotEmpty`, `ArrayMinSize`, `ArrayMaxSize`, `ArrayUnique`
- **Mapped DTO 헬퍼**: `PickType`, `OmitType`, `PartialType`, `IntersectionType`
- **Mapped DTO 서브패스**: `@fluojs/validation/mapped-types`
- **Standard Schema 계약**: `ValidateClass(...)` 스키마를 타입 지정하기 위한 `StandardSchemaV1Like`
- **검증 흐름**: 실체화 및 검증을 위한 `materialize()`, 단순 검증을 위한 `validate()`

## 관련 패키지

- `@fluojs/http`: request data를 bind한 뒤 이 패키지로 검증합니다.
- `@fluojs/i18n`: opt-in localized validation issue message를 위한 `@fluojs/i18n/validation`을 제공합니다.
- `@fluojs/serialization`: response side에서 output DTO를 가공합니다.
- `@fluojs/core`: validation decorator가 사용하는 metadata primitive를 제공합니다.

## 예제 소스

- `packages/validation/src/validation.test.ts`
- `packages/validation/src/mapped-types.test.ts`
- `examples/realworld-api/src/users/create-user.dto.ts`
- `examples/auth-jwt-passport/src/auth/login.dto.ts`
