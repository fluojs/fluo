# @konekti/dto-validator

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Decorator-based DTO validation for TypeScript. Declare validation rules directly on class fields and get structured, typed errors — no schema files, no manual checks.

The current public contract is decorator-first. Schema-object validation and richer validation-adapter contracts are not part of the supported public surface today.

## See also

- `../../docs/concepts/decorators-and-metadata.md`
- `../../docs/concepts/http-runtime.md`

## Installation

```bash
pnpm add @konekti/dto-validator
```

## Quick Start

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

## Core API

### `DefaultValidator`

The main validation engine. Implements the `Validator` interface.

```typescript
class DefaultValidator implements Validator {
  async validate(value: unknown, target: Constructor): Promise<void>;
}
```

Throws `DtoValidationError` when any validation rule fails.

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
}
```

Implement this interface to supply a custom validation strategy.

---

## Decorators

### Type Checks

| Decorator | Description |
|-----------|-------------|
| `@IsString()` | Must be a string |
| `@IsNumber()` | Must be a number |
| `@IsBoolean()` | Must be a boolean |
| `@IsDate()` | Must be a `Date` instance |
| `@IsArray()` | Must be an array |
| `@IsObject()` | Must be a non-null object that is not an array |
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

### Arrays

| Decorator | Description |
|-----------|-------------|
| `@ArrayContains(values)` | Array must contain all `values` |
| `@ArrayNotContains(values)` | Array must not contain any of `values` |
| `@ArrayNotEmpty()` | Array must have at least one element |
| `@ArrayMinSize(n)` | Array length ≥ `n` |
| `@ArrayMaxSize(n)` | Array length ≤ `n` |
| `@ArrayUnique()` | All array elements must be unique |

`{ each: true }` is most useful with scalar validators such as `@MinLength(...)` when you want to validate each array element individually.

### Nested & Conditional

| Decorator | Description |
|-----------|-------------|
| `@ValidateNested(() => TargetClass)` | Recursively validate a nested object |
| `@ValidateNested(() => TargetClass, { each: true })` | Recursively validate each item in an array |
| `@ValidateIf(condition)` | Apply decorators only when `condition(dto, value) === true` (sync or async) |

### Custom Validators

```typescript
// Field-level custom validator
@Validate(MyCustomValidator, options?)
field = value;

// Class-level custom validator
@ValidateClass(MyClassValidator, options?)
class MyDto { ... }
```

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

### Custom Error Messages

Every decorator accepts an options object with an optional `message` string:

```typescript
@IsEmail({ message: 'Please provide a valid email address.' })
email = '';
```

---

## Dependencies

| Package | Role |
|---------|------|
| `@konekti/core` | Shared core utilities and metadata types |
| `validator` | String format validation (email, URL, UUID, …) |
