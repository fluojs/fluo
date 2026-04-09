# @konekti/validation

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti를 위한 입력값 검증 데코레이터, Mapped DTO 헬퍼 및 검증 엔진입니다.

`@konekti/validation`은 애플리케이션의 **입력 경계(Input Boundary)**를 담당합니다. 가공되지 않은(untyped) raw 데이터를 검증이 완료된 타입 기반 클래스 인스턴스(DTO)로 변환하는 강력한 데코레이터 세트와 실체화(Materialization) 엔진을 제공합니다. 이를 통해 비즈니스 로직에 도달하기 전 데이터의 무결성을 보장합니다.

## 목차

- [설치](#설치)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
  - [실체화 vs 검증 (Materialization vs Validation)](#실체화-vs-검증-materialization-vs-validation)
  - [Mapped Types (Pick, Omit, Partial)](#mapped-types-pick-omit-partial)
  - [Standard Schema 지원 (Zod, Valibot)](#standard-schema-지원-zod-valibot)
  - [중첩 검증 (Nested Validation)](#중첩-검증-nested-validation)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @konekti/validation
```

## 사용 시점

- 들어오는 데이터(요청 바디, 쿼리 파라미터 등)를 클래스 기반 스키마에 맞춰 검증해야 할 때.
- 일반 JavaScript 객체를 재귀적 검증이 포함된 타입 기반 클래스 인스턴스로 변환하고 싶을 때.
- 기존 DTO로부터 새로운 DTO를 파생시키고 싶을 때 (예: `UserDto`에서 `UpdateUserDto` 생성).
- Zod나 Valibot 같은 기존 검증 라이브러리를 클래스 기반 DTO 구조 내에서 사용하고 싶을 때.

## 빠른 시작

표준 데코레이터를 사용하여 DTO를 정의하고, `DefaultValidator`를 사용하여 raw 데이터를 실체화 및 검증합니다.

```typescript
import { IsEmail, IsString, MinLength, DefaultValidator } from '@konekti/validation';

class CreateUserDto {
  @IsEmail()
  email: string = '';

  @IsString()
  @MinLength(2)
  name: string = '';
}

const validator = new DefaultValidator();
const rawData = { email: 'test@example.com', name: 'Ko' };

// materialize()는 CreateUserDto의 인스턴스를 생성하고 검증을 수행합니다.
const user = await validator.materialize(rawData, CreateUserDto);

console.log(user instanceof CreateUserDto); // true
console.log(user.name); // "Ko"
```

## 주요 패턴

### 실체화 vs 검증 (Materialization vs Validation)

- **`materialize<T>(value, target)`**: **입력 처리**에 가장 적합합니다. plain 객체를 받아 대상 클래스의 인스턴스를 생성하고, 값을 복사하며, 중첩된 DTO를 재귀적으로 처리한 후 모든 검증 규칙을 실행합니다.
- **`validate(instance, target)`**: **기존 객체 확인**에 적합합니다. 이미 생성된 인스턴스에 대해 검증 규칙만 실행합니다. 타입 변환이나 중첩된 객체의 실체화는 수행하지 않습니다.

### Mapped Types (Pick, Omit, Partial)

모든 검증 데코레이터와 바인딩 메타데이터를 보존하면서 새로운 DTO 클래스를 파생합니다.

```typescript
import { IsString, IsEmail, PickType, PartialType } from '@konekti/validation';

class UserDto {
  @IsString() name: string = '';
  @IsEmail() email: string = '';
}

// 'email' 필드만 포함
class EmailOnlyDto extends PickType(UserDto, ['email']) {}

// 모든 필드를 선택 사항(optional)으로 변경
class UpdateUserDto extends PartialType(UserDto) {}
```

### Standard Schema 지원 (Zod, Valibot)

`@ValidateClass`를 통해 클래스 레벨에서 선호하는 스키마 라이브러리를 사용할 수 있습니다. Konekti는 [Standard Schema](https://github.com/standard-schema/spec) 규격을 구현하는 모든 라이브러리를 지원합니다.
유효하지 않은 입력은 명시적인 `issues`로 보고되어야 하며, 이슈가 없는 검증 결과는 성공으로 처리합니다.

```typescript
import { ValidateClass } from '@konekti/validation';
import { z } from 'zod';

const UserSchema = z.object({
  age: z.number().min(18),
});

@ValidateClass(UserSchema)
class RestrictedUserDto {
  age: number = 0;
}
```

### 중첩 검증 (Nested Validation)

`@ValidateNested`를 사용하여 복잡한 계층적 데이터 구조를 검증합니다.

```typescript
import { IsString, ValidateNested } from '@konekti/validation';

class ProfileDto {
  @IsString() bio: string = '';
}

class UserDto {
  @IsString() name: string = '';
  
  @ValidateNested(() => ProfileDto)
  profile?: ProfileDto;
}
```

## 공개 API 개요

### 데코레이터
- **타입 검사**: `@IsString()`, `@IsNumber()`, `@IsBoolean()`, `@IsDate()`, `@IsArray()`, `@IsObject()`, `@IsEnum(entity)`, `@IsInt()`.
- **문자열 형식**: `@IsEmail()`, `@IsUrl()`, `@IsUUID()`, `@IsIP()`, `@IsJSON()`, `@Matches(regex)` 및 [기타 다수](https://github.com/validatorjs/validator.js).
- **제약 조건**: `@Min(n)`, `@Max(n)`, `@MinLength(n)`, `@MaxLength(n)`, `@Length(min, max)`, `@Contains(str)`.
- **로직**: `@IsOptional()`, `@IsDefined()`, `@ValidateIf(condition)`, `@ValidateNested(dto)`.
- **커스텀**: `@Validate(fn)`, `@ValidateClass(schema_or_fn)`.

### 클래스 및 타입
- `DefaultValidator`: `Validator` 인터페이스의 표준 구현체입니다.
- `DtoValidationError`: 검증 실패 시 발생하며, `ValidationIssue[]`를 포함합니다.
- `PickType`, `OmitType`, `PartialType`, `IntersectionType`: DTO 합성을 위한 헬퍼.

## 관련 패키지

- `@konekti/core`: 데코레이터가 사용하는 메타데이터 시스템을 제공합니다.
- `@konekti/http`: 이 패키지를 사용하여 들어오는 요청 데이터를 자동으로 검증합니다.
- `@konekti/serialization`: **출력** 측면(응답용 DTO 가공)을 담당합니다.

## 예제 소스

- `packages/validation/src/validation.test.ts`: 모든 데코레이터와 엔진에 대한 종합 테스트.
- `examples/realworld-api`: 실제 프로덕션과 유사한 환경에서의 DTO 사용 예시.
