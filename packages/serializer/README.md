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
import { Controller, Get, UseInterceptors } from '@konekti/http';
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
  @UseInterceptors(SerializerInterceptor)
  listUsers() {
    return [new UserView('u-1', 'secret')];
  }
}
```

## Global registration

Register the serializer globally at bootstrap:

```typescript
import { bootstrapApplication } from '@konekti/runtime';
import { SerializerInterceptor } from '@konekti/serializer';

await bootstrapApplication({
  rootModule: AppModule,
  interceptors: [SerializerInterceptor],
});
```

## API

- `Exclude(): FieldDecorator` — removes fields from serialized output.
- `Expose(options?): ClassDecorator | FieldDecorator` — marks fields to include and supports class-level `excludeExtraneous` mode.
- `Transform(fn): FieldDecorator` — transforms a field value before recursive serialization.
- `serialize(value: unknown): unknown` — manual serialization helper.
- `class SerializerInterceptor implements Interceptor` — interceptor for automatic response serialization.

## Serialization contract

- Cycles are cut to `undefined` at the cycle edge to ensure output remains JSON-safe.
- Shared references are preserved. Revisiting an already-serialized object returns the same serialized node.
- Enumerable symbol-keyed properties on plain objects are serialized alongside string keys.

## non-goals and intentional limitations

- No deep class instantiation — serialization walks the object graph but does not construct new class instances from plain objects; output is always JSON-safe plain data
- No schema validation — `@Exclude` / `@Expose` / `@Transform` shape the output but do not validate input; use the `@konekti/dto` package for input validation
- No async transform support — `@Transform(fn)` must return synchronously; async transforms are not supported
- Symbol-keyed properties on class instances are not serialized — only plain-object symbol keys are included (class instances serialize only string-keyed properties)
