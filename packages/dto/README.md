# @konekti/dto

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based DTO utilities for TypeScript. `@konekti/dto` owns DTO validation rules, the validation/transform engine, Standard Schema-compatible class validation via `@ValidateClass(schema)`, and metadata-preserving mapped DTO helpers.

It does **not** own request binding or transport-specific input extraction. Packages such as `@konekti/http` use DTO metadata together with their own binding decorators, while `@konekti/dto` focuses on turning rules into `ValidationIssue` / `DtoValidationError` output and typed DTO instances.

## See also

- `../../docs/concepts/decorators-and-metadata.md`
- `../../docs/concepts/http-runtime.md`

## Installation

```bash
pnpm add @konekti/dto
```

## What this package does

- field-level validation decorators such as `@IsString()`, `@MinLength()`, and `@ValidateNested()`
- class-level validation via `@ValidateClass(...)`
- `DefaultValidator.validate(...)` for validating an existing DTO-like value
- `DefaultValidator.transform(...)` for turning plain payloads into typed DTO instances before validation
- Standard Schema normalization for Zod, Valibot, ArkType, and other Standard Schema v1 compatible validators
- metadata-preserving mapped DTO helpers: `PickType`, `OmitType`, `PartialType`, `IntersectionType`

## What this package does not do

- read values from HTTP body/query/path/header/cookie sources
- define transport-specific binding decorators
- own request-pipeline concerns such as 400 conversion or route dispatch

## Quick Start

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

### Transform a plain payload into a DTO instance

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

### `transform(...)` does not coerce string IDs into numbers

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

`transform(...)` materializes the DTO instance shape, but it does not perform implicit scalar coercion. If your transport layer receives IDs as strings and you want `id` to become a number, convert that value explicitly before DTO validation runs.

## Core API

### `DefaultValidator`

The main validation engine. Implements the `Validator` interface.

```typescript
class DefaultValidator implements Validator {
  async validate(value: unknown, target: Constructor): Promise<void>;
  async transform<T>(value: unknown, target: Constructor<T>): Promise<T>;
}
```

`validate(...)` checks an existing DTO-like value.

`transform(...)` materializes a typed DTO instance from a raw value, recursively hydrates nested DTO fields, then validates the result. It throws `DtoValidationError` when any validation rule fails.

### `DtoValidationError`

```typescript
class DtoValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
}
```

### `ValidationIssue`

```typescript
interface ValidationIssue {
  code: string;       // e.g. 'EMAIL', 'MIN_LENGTH'
  field?: string;     // dot/bracket path: 'address.city', 'tags[0]'
  message: string;
  source?: MetadataSource;
}
```

### `Validator` interface

```typescript
interface Validator {
  validate(value: unknown, target: Constructor): MaybePromise<void>;
  transform<T>(value: unknown, target: Constructor<T>): MaybePromise<T>;
}
```

Implement this interface to supply a custom validation strategy.

### `validate` vs `transform`

| Method | Input | Output | Nested DTO hydration |
|---|---|---|---|
| `validate` | Existing DTO-like value | `void` | No |
| `transform` | Raw value / plain object payload | Typed DTO instance | Yes |

`transform` only copies safe own-enumerable properties and blocks dangerous keys such as `__proto__`, `constructor`, and `prototype`.

## Decorators

### Type Checks

| Decorator | Description |
|-----------|-------------|
| `@IsString()` | Must be a string |
| `@IsNumber({ allowNaN?: boolean })` | Must be a number; `NaN` is rejected unless `allowNaN: true` is passed |
| `@IsBoolean()` | Must be a boolean |
| `@IsDate()` | Must be a `Date` instance |
| `@IsArray()` | Must be an array |
| `@IsObject()` | Must be a plain object (`{}` or `Object.create(null)`); class instances do not pass |
| `@IsInt()` | Must be an integer |
| `@IsEnum(entity)` | Must be a member of the given enum |

### Presence

| Decorator | Description |
|-----------|-------------|
| `@IsDefined()` | Must not be `undefined` or `null` |
| `@IsOptional()` | Skip validation if `undefined` or `null` |
| `@IsEmpty()` | Must be empty (`''`, `null`, `undefined`) |
| `@IsNotEmpty()` | Must not be empty |

### Equality & Membership

| Decorator | Description |
|-----------|-------------|
| `@Equals(value)` | Must strictly equal `value` |
| `@NotEquals(value)` | Must not equal `value` |
| `@IsIn(array)` | Must be one of the allowed values |
| `@IsNotIn(array)` | Must not be one of the given values |

### Numbers

| Decorator | Description |
|-----------|-------------|
| `@IsPositive()` | Must be > 0 |
| `@IsNegative()` | Must be < 0 |
| `@IsDivisibleBy(n)` | Must be divisible by `n` |
| `@Min(n)` | Must be ≥ `n` |
| `@Max(n)` | Must be ≤ `n` |

### Dates

| Decorator | Description |
|-----------|-------------|
| `@MinDate(date)` | Must be on or after `date` |
| `@MaxDate(date)` | Must be on or before `date` |

### String Length

| Decorator | Description |
|-----------|-------------|
| `@Length(min, max?)` | Length between `min` and optional `max` |
| `@MinLength(n)` | Length ≥ `n` |
| `@MaxLength(n)` | Length ≤ `n` |

### String Content

| Decorator | Description |
|-----------|-------------|
| `@Contains(seed)` | Must contain `seed` |
| `@NotContains(seed)` | Must not contain `seed` |
| `@Matches(pattern)` | Must match the regex |

### String Format (via `validator.js`)

`@IsAlpha`, `@IsAlphanumeric`, `@IsAscii`, `@IsBase64`, `@IsBooleanString`, `@IsDataURI`, `@IsDateString`, `@IsDecimal`, `@IsEmail`, `@IsFQDN`, `@IsHexColor`, `@IsHexadecimal`, `@IsJSON`, `@IsJWT`, `@IsLocale`, `@IsLowercase`, `@IsMagnetURI`, `@IsMimeType`, `@IsMongoId`, `@IsNumberString`, `@IsPort`, `@IsRFC3339`, `@IsSemVer`, `@IsUppercase`, `@IsISO8601`, `@IsLatitude`, `@IsLongitude`, `@IsLatLong`, `@IsIP`, `@IsISBN`, `@IsISSN`, `@IsMobilePhone`, `@IsPostalCode`, `@IsRgbColor`, `@IsUrl`, `@IsUUID`, `@IsCurrency`

`@IsDateString()` validates ISO-8601 strings.

### Arrays

| Decorator | Description |
|-----------|-------------|
| `@ArrayContains(values)` | Array must contain all `values` |
| `@ArrayNotContains(values)` | Array must not contain any of `values` |
| `@ArrayNotEmpty()` | Array must have at least one element |
| `@ArrayMinSize(n)` | Array length ≥ `n` |
| `@ArrayMaxSize(n)` | Array length ≤ `n` |
| `@ArrayUnique(selector?)` | All array elements must be unique; `selector` can provide the comparison key |

`{ each: true }` is most useful with scalar validators such as `@MinLength(...)` when you want to validate each array element individually.

`{ each: true }` also works with `Set` and `Map` values. For `Map`, validation runs against each map value, not the key.

### Nested & Conditional

| Decorator | Description |
|-----------|-------------|
| `@ValidateNested(() => TargetClass)` | Recursively validate a nested object |
| `@ValidateNested(() => TargetClass, { each: true })` | Recursively validate each item in an array |
| `@ValidateIf(condition)` | Skip the field's validators when `condition(dto, value)` is falsy (sync or async) |

### Custom Validators

```typescript
import { z } from 'zod';

// Field-level custom validator
@Validate(MyCustomValidator, options?)
field = value;

// Class-level custom validator
@ValidateClass(MyClassValidator, options?)
class MyDto { ... }

// Class-level Standard Schema validator
@ValidateClass(z.object({
  email: z.string().email(),
}))
class CreateUserDto {
  email = '';
}
```

`@Validate(...)` stays field-level. `@ValidateClass(...)` is the DTO-level invariant and schema hook.

Standard Schema-compatible validators such as Zod, Valibot, and ArkType can be attached directly at the DTO level through `@ValidateClass(schema)`.

---

## Advanced Usage

### Nested Objects

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

Errors use dot-notation paths: `{ field: 'address.city', ... }`.

When transforming nested DTOs, only plain-object payloads are copied into the nested instance; non-plain inputs are treated as invalid data and are not implicitly merged into DTO fields.

Cyclic nested payloads are treated as invalid data as well, so recursive validation fails with a validation error instead of recursing indefinitely.

### Arrays of Nested Objects

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

Errors use bracket notation: `{ field: 'items[0].name', ... }`.

### Per-Element String Validation

```typescript
class CreateOrderDto {
  @MinLength(2, { each: true })
  tags: string[] = [];
}
```

Errors: `{ field: 'tags[1]', ... }`.

### Selector-Based Array Uniqueness

```typescript
class UniqueItemsDto {
  @ArrayUnique((item: { id: string }) => item.id)
  items: Array<{ id: string }> = [];
}
```

### `each: true` on `Set` and `Map`

```typescript
class CollectionDto {
  @MinLength(2, { each: true })
  tagsSet = new Set<string>();

  @MinLength(2, { each: true })
  tagsMap = new Map<string, string>();
}
```

Error paths use bracket notation for both collections: `{ field: 'tagsSet[1]', ... }`, `{ field: 'tagsMap[1]', ... }`.

### Custom Error Messages

Every decorator accepts an options object with an optional `message` string:

```typescript
@IsEmail({ message: 'Please provide a valid email address.' })
email = '';
```

---

## Mapped DTO Helpers

Mapped DTO helpers derive a new DTO class from one or more existing DTOs while preserving validation metadata and any field-level binding metadata already attached by companion packages.

They can be imported from `@konekti/dto` or from the subpath export `@konekti/dto/mapped-types`.

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

- `PickType()` keeps only the selected fields.
- `OmitType()` removes the selected fields.
- `PartialType()` marks inherited fields as optional for validation and companion-package binding semantics.
- `IntersectionType()` merges fields and metadata from multiple DTO bases.

## Dependencies

| Package | Role |
|---------|------|
| `@konekti/core` | Shared core utilities and metadata types |
| `validator` | String format validation (email, URL, UUID, …) |
