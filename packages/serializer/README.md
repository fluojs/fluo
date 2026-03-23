# @konekti/serializer

<p><strong><kbd>English</kbd></strong> <a href="./README.ko.md"><kbd>한국어</kbd></a></p>


Response serialization decorators and interceptor for Konekti.

This package provides class-based response shaping similar to NestJS class serialization:

- `@Exclude()` removes fields from serialized output.
- `@Expose()` marks fields to include, and supports class-level `excludeExtraneous` mode.
- `@Transform(fn)` transforms a field value before recursive serialization.
- `SerializerInterceptor` applies `serialize()` automatically to handler responses.

## Installation

```bash
pnpm add @konekti/serializer
```

## Quick Start

```typescript
import { Controller, Get, UseInterceptor } from '@konekti/http';
import { Exclude, Expose, SerializerInterceptor } from '@konekti/serializer';

@Expose({ excludeExtraneous: true })
class UserView {
  @Expose()
  id: string;

  @Exclude()
  password: string;

  constructor(id: string, password: string) {
    this.id = id;
    this.password = password;
  }
}

@Controller('/users')
class UsersController {
  @Get('/')
  @UseInterceptor(SerializerInterceptor)
  listUsers() {
    return [new UserView('u-1', 'secret')];
  }
}
```

## Global registration

Register serializer globally at bootstrap:

```typescript
import { bootstrapApplication } from '@konekti/runtime';
import { SerializerInterceptor } from '@konekti/serializer';

await bootstrapApplication({
  mode: 'prod',
  rootModule: AppModule,
  interceptors: [SerializerInterceptor],
});
```

## API

- `Exclude(): FieldDecorator`
- `Expose(options?: { excludeExtraneous?: boolean }): ClassDecorator | FieldDecorator`
- `Transform(fn: (value: unknown) => unknown): FieldDecorator`
- `serialize(value: unknown): unknown`
- `class SerializerInterceptor implements Interceptor`

## Serialization contract

- Cycles are cut to `undefined` at the cycle edge so output remains JSON-safe.
- Shared references are preserved: revisiting an already-serialized object returns the same serialized node instead of dropping it.
- Enumerable symbol-keyed properties on plain objects are serialized alongside string keys.
