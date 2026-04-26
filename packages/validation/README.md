# @fluojs/validation

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Input-side validation decorators, mapped DTO helpers, and the materialization engine for fluo.

## Table of Contents

- [Installation](#installation)
- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Common Patterns](#common-patterns)
- [Public API](#public-api)
- [Related Packages](#related-packages)
- [Example Sources](#example-sources)

## Installation

```bash
pnpm add @fluojs/validation
```

## When to Use

- when raw request payloads need to become validated DTO instances before reaching business logic
- when you want class-based validation rules instead of ad hoc parsing in controllers and services
- when you need metadata-preserving mapped DTO helpers such as `PickType`, `PartialType`, and `IntersectionType`
- when you want to attach Standard Schema validators such as Zod or Valibot through `@ValidateClass(...)`

## Quick Start

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

## Common Patterns

### `materialize()` vs `validate()`

- `materialize(value, Target)` builds a typed instance and validates it recursively
- `validate(instance, Target)` only validates an already-created value

`materialize()` copies safe own enumerable properties from plain input objects,
applies DTO binding metadata, and recursively hydrates `@ValidateNested(...)`
fields. It preserves the request-pipeline contract that transports or binders own
source selection and scalar conversion before validation runs.

### Validation issue shape

`DtoValidationError.issues` is a stable DTO for request-pipeline error details:

```ts
type ValidationIssue = {
  code: string;
  field?: string;
  message: string;
  source?: 'path' | 'query' | 'header' | 'cookie' | 'body';
};
```

Nested DTOs use dot paths and collection indexes, such as `address.city` or
`items[0].name`. HTTP bindings attach `source` when the rule came from request
metadata; standalone validation and Standard Schema issues may leave it unset.

### Mapped DTO helpers

```ts
import { IsEmail, IsString, PartialType, PickType } from '@fluojs/validation';

class UserDto {
  @IsString() name = '';
  @IsEmail() email = '';
}

class EmailOnlyDto extends PickType(UserDto, ['email']) {}
class UpdateUserDto extends PartialType(UserDto) {}
```

### Standard Schema support

Standard Schema adapters are expected to report invalid input through explicit issues. Validation results without issues are treated as successful.

```ts
import { ValidateClass } from '@fluojs/validation';
import { z } from 'zod';

const UserSchema = z.object({ age: z.number().min(18) });

@ValidateClass(UserSchema)
class RestrictedUserDto {
  age = 0;
}
```

### No implicit scalar coercion

`materialize()` is intentionally strict. If a transport gives you `'42'` and your DTO expects `number`, the transport or binding layer must convert it first.

## Public API

- **Validator engine**: `DefaultValidator`, `DtoValidationError`, `ValidationIssue`, `Validator`
- **Core decorators**: `IsString`, `IsNumber`, `IsBoolean`, `IsDate`, `IsArray`, `IsObject`, `IsEnum`, `IsInt`, `IsDefined`, `IsOptional`, `ValidateNested`, `ValidateIf`, `Validate`, `ValidateClass`
- **String and network decorators**: `IsEmail`, `IsUrl`, `IsUUID`, `IsIP`, `IsAlpha`, `IsAlphanumeric`, `IsAscii`, `IsBase64`, `IsDateString`, `IsJSON`, `IsJWT`, `IsNumberString`, `IsISO8601`, `Matches`, `Length`, `MinLength`, `MaxLength`, `Contains`, `NotContains`
- **Number and date decorators**: `Min`, `Max`, `IsPositive`, `IsNegative`, `IsDivisibleBy`, `MinDate`, `MaxDate`
- **Array decorators**: `ArrayContains`, `ArrayNotContains`, `ArrayNotEmpty`, `ArrayMinSize`, `ArrayMaxSize`, `ArrayUnique`
- **Mapped DTO helpers**: `PickType`, `OmitType`, `PartialType`, `IntersectionType`
- **Standard Schema contract**: `StandardSchemaV1Like` for typing `ValidateClass(...)` schemas
- **Validation flow**: `materialize()` for hydration + validation, `validate()` for validation-only checks

## Related Packages

- `@fluojs/http`: binds request data, then uses this package to validate it
- `@fluojs/serialization`: shapes output DTOs on the response side
- `@fluojs/core`: provides the metadata primitives used by validation decorators

## Example Sources

- `packages/validation/src/validation.test.ts`
- `examples/realworld-api/src/users/create-user.dto.ts`
- `examples/auth-jwt-passport/src/auth/login.dto.ts`
