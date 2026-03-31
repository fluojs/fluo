# @konekti/serialization

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>

Output-side response shaping and serialization for Konekti.

`@konekti/serialization` focuses on the **output** boundary. It handles turning internal class instances or complex object graphs back into clean, JSON-safe plain objects. While `@konekti/validation` ensures incoming data is safe, this package ensures outgoing data is correctly shaped and sensitive information is hidden.

## The Mental Model

Konekti splits data handling into two distinct phases:

1. **Validation (Input)**: Materializing raw payloads into class instances and enforcing rules.
2. **Serialization (Output)**: Shaping class instances back into plain data for the response.

`@konekti/serialization` provides decorators like `@Exclude()`, `@Expose()`, and `@Transform()` to control the final response shape without modifying your domain models or business logic.

## Relationship with @konekti/http

This package provides an interceptor that automatically shapes your handler's return values.

In a Konekti application:
1. Your controller returns a class instance (or an array of them).
2. The `SerializerInterceptor` (if registered) catches the result.
3. It runs the `serialize()` engine, which applies your decorators.
4. The resulting plain object is what actually gets sent as the HTTP JSON body.

## Installation

```bash
pnpm add @konekti/serialization
```

## Quick Start

### Basic Usage

```typescript
import { Controller, Get, UseInterceptors } from '@konekti/http';
import { Exclude, Expose, SerializerInterceptor } from '@konekti/serialization';

// Use @Expose({ excludeExtraneous: true }) to only include marked fields.
@Expose({ excludeExtraneous: true })
class UserView {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Exclude() // Explicitly hidden, even if excludeExtraneous is false.
  passwordHash: string;

  constructor(id: string, email: string, passwordHash: string) {
    this.id = id;
    this.email = email;
    this.passwordHash = passwordHash;
  }
}

@Controller('/users')
class UsersController {
  @Get('/')
  @UseInterceptors(SerializerInterceptor)
  async getUser() {
    return new UserView('u-1', 'hello@example.com', 'shhhh');
  }
}
```

### Before vs After Serialization

When the controller above returns the `UserView` instance, the serialized output looks like this:

**Before (Class Instance):**
```typescript
UserView {
  id: 'u-1',
  email: 'hello@example.com',
  passwordHash: 'shhhh'
}
```

**After (JSON Output):**
```json
{
  "id": "u-1",
  "email": "hello@example.com"
}
```

## Core API

### Decorators

- `@Exclude()`: Removes the field from the serialized output.
- `@Expose(options?)`: Marks a field to be included. If used on a class with `{ excludeExtraneous: true }`, only fields with `@Expose()` are kept.
- `@Transform(({ value, obj }) => newValue)`: Dynamically transforms a value during serialization. Must return synchronously.

### SerializerInterceptor

The recommended way to use this package in a Konekti app. You can register it per-controller, per-route, or globally.

**Global Registration:**
```typescript
import { bootstrapApplication } from '@konekti/runtime';
import { SerializerInterceptor } from '@konekti/serialization';

await bootstrapApplication({
  rootModule: AppModule,
  interceptors: [SerializerInterceptor],
});
```

### serialize()

The manual serialization helper used by the interceptor.

```typescript
import { serialize } from '@konekti/serialization';

const plainObject = serialize(myClassInstance);
```

## Serialization Rules

1. **JSON Safety**: Cycles are automatically cut to `undefined` to prevent infinite loops.
2. **Reference Preservation**: If the same object appears multiple times in a graph, it is serialized consistently.
3. **Symbols**: Enumerable symbol-keyed properties on plain objects are included.
4. **Classes**: Only string-keyed properties on class instances are serialized.

## Intentional Limitations

- **No Deep Instantiation**: Serialization converts classes to plain objects. It does **not** do the reverse. For that, use `@konekti/validation`.
- **No Schema Validation**: This package shapes data; it does not validate that the data is "correct" or "valid".
- **Sync Only**: Transformations must be synchronous. Async operations are not supported during the serialization walk.
