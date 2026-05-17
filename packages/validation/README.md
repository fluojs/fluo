# @fluojs/validation

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Input-side validation decorators, mapped DTO helpers, and the validation engine for fluo.

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
- when you want stable validation issue codes and paths that can be localized explicitly through `@fluojs/i18n/validation`

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
- `validate(instance, Target)` validates an already-created root value and may
  temporarily materialize plain nested `@ValidateNested(...)` values to run their
  nested DTO rules without replacing the caller's properties

`validate()` rejects malformed roots such as strings, arrays, `null`, and
`undefined` with a deterministic `DtoValidationError` before field or class rules
run. It accepts already-created target DTO instances and plain root objects so
request-pipeline binders can validate their prepared DTO payloads without scalar
coercion.

`materialize()` copies safe own enumerable properties from plain input objects,
applies DTO binding metadata, and recursively hydrates `@ValidateNested(...)`
fields. It preserves the request-pipeline contract that transports or binders own
source selection and scalar conversion before validation runs.
Existing nested values that are already instances of the declared nested DTO are
preserved; plain nested values are hydrated only for the affected nested field or
collection entry.
The root value passed to `materialize()` must already be a plain object or an
instance of the target DTO; malformed roots such as strings, arrays, and `null`
are rejected before the target DTO constructor or field initializers run.

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

`@fluojs/validation` always emits its normal human-readable `message` values. Applications that need localized messages can opt into `@fluojs/i18n/validation` after validation fails. That integration maps `source`, `field`, and `code` to translation keys without changing validator execution or coupling this package to HTTP locale resolution.

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

Mapped DTO helpers preserve field-level validation and binding metadata through
the documented subclassing pattern shown above. `PickType`, `OmitType`, and
`PartialType` do not carry base class-level validators onto derived DTOs because
those validators can depend on fields that were omitted or made optional.

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

`ValidateClass(...)` also accepts custom class-level validators. `Validate(...)` attaches custom field-level validators when built-in decorators are not enough, and `ValidateIf(...)` short-circuits dependent validators when its predicate returns false.

### Network validators

`@IsIP()` validates IPv4 and IPv6 strings by default. Pass `@IsIP('4')` or
`@IsIP('6')` to restrict a field to one IP version, or pass
`@IsIP('4_or_6')` when you want to state the default "either IPv4 or IPv6"
contract explicitly while still using the same runtime behavior as `@IsIP()`.

### Nested validation

`@ValidateNested(...)` supports object fields, arrays, `Set`, and `Map`. Nested DTO paths use dot/index notation in validation issues, cycles are detected safely, and shared references are allowed.
Pass either a DTO class or a lazy constructor factory such as `() => ChildDto` or `function resolveChildDto() { return ChildDto; }` when nested types need deferred resolution.

### No implicit scalar coercion

`materialize()` is intentionally strict. If a transport gives you `'42'` and your DTO expects `number`, the transport or binding layer must convert it first.
Numeric validators, including `@IsLatitude()` and `@IsLongitude()`, validate numeric DTO values without treating numeric strings as already-converted numbers.

## Public API

- **Validator engine**: `DefaultValidator`, `DtoValidationError`, `ValidationIssue`, `Validator`
- **Core decorators**: `IsString`, `IsNumber`, `IsBoolean`, `IsDate`, `IsArray`, `IsObject`, `IsEnum`, `IsInt`, `IsDefined`, `IsOptional`, `ValidateNested`, `ValidateIf`, `Validate`, `ValidateClass`
- **Presence and comparison decorators**: `IsEmpty`, `IsNotEmpty`, `Equals`, `NotEquals`, `IsIn`, `IsNotIn`
- **String and network decorators**: `IsEmail`, `IsUrl`, `IsUUID`, `IsIP`, `IsAlpha`, `IsAlphanumeric`, `IsAscii`, `IsBase64`, `IsBooleanString`, `IsDataURI`, `IsDateString`, `IsDecimal`, `IsFQDN`, `IsHexColor`, `IsHexadecimal`, `IsJSON`, `IsJWT`, `IsLocale`, `IsLowercase`, `IsMagnetURI`, `IsMimeType`, `IsMongoId`, `IsNumberString`, `IsPort`, `IsRFC3339`, `IsSemVer`, `IsUppercase`, `IsISO8601`, `Matches`, `Length`, `MinLength`, `MaxLength`, `Contains`, `NotContains`
- **Number, date, geo, and locale decorators**: `Min`, `Max`, `IsPositive`, `IsNegative`, `IsDivisibleBy`, `MinDate`, `MaxDate`, `IsLatitude`, `IsLongitude`, `IsLatLong`, `IsISBN`, `IsISSN`, `IsMobilePhone`, `IsPostalCode`, `IsRgbColor`, `IsCurrency`
- **Array decorators**: `ArrayContains`, `ArrayNotContains`, `ArrayNotEmpty`, `ArrayMinSize`, `ArrayMaxSize`, `ArrayUnique`
- **Mapped DTO helpers**: `PickType`, `OmitType`, `PartialType`, `IntersectionType`
- **Mapped DTO subpath**: `@fluojs/validation/mapped-types`
- **Standard Schema contract**: `StandardSchemaV1Like` for typing `ValidateClass(...)` schemas
- **Validation flow**: `materialize()` for hydration + validation, `validate()` for validation-only checks

## Related Packages

- `@fluojs/http`: binds request data, then uses this package to validate it
- `@fluojs/i18n`: exposes `@fluojs/i18n/validation` for opt-in localized validation issue messages
- `@fluojs/serialization`: shapes output DTOs on the response side
- `@fluojs/core`: provides the metadata primitives used by validation decorators

## Example Sources

- `packages/validation/src/validation.test.ts`
- `packages/validation/src/mapped-types.test.ts`
- `examples/realworld-api/src/users/create-user.dto.ts`
- `examples/auth-jwt-passport/src/auth/login.dto.ts`
