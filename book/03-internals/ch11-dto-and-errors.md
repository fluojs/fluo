# How DTOs and Responses Are Transformed

<!-- book:volume=03-internals;chapter=11 -->

[Previous: Dissecting the HTTP Request Pipeline](./ch10-http-pipeline.md) - [Volume 3 Contents](./toc.md) - [Next: When the Connection Closes Before the Request Ends](./ch12-cancellation-and-streaming.md)

## Similar Objects, Different Responsibilities

FluoBlog's post creation form accepted a title and content. Once the shop was added, similarly shaped JSON began to include SKU, quantity, price, and customer ID. Saving the price displayed by the browser directly on the server may seem convenient, but users can modify the browser's payload. Passing through an input DTO does not make prices and customer IDs authoritative values.

Failures happen in the opposite direction too. An internal processing note is added to an object returned by the orders service, and the controller returns that object unchanged, exposing the note in the response. Adding one field to a storage type has become a public API change. Treating input validation and output serialization as the same "automatic DTO transformation" makes it easy to miss both failures.

The previous chapter located binding and validation immediately before controller invocation. This chapter expands that boundary and compares it with serialization after the controller returns. Input handling decides what to accept, the service decides which facts to trust, and output handling decides what to expose. To classify 400 and 500 errors correctly, we also need to know where failures at each stage become HTTP errors.

## A TypeScript Declaration Is Not a Request Transformation Instruction

A declaration such as `quantity: number` does not convert request strings to numbers after compilation. The `2` in a JSON body and the `"2"` in a query are different runtime values. `@IsInt()` checks whether a value already received is an integer; it does not select a request source or implicitly convert strings. `DefaultValidator.materialize()` does not perform scalar coercion either.

HTTP binding reads metadata such as `@FromBody()`, `@FromPath('id')`, and `@FromQuery()`. `DefaultBinder` creates the DTO, reads raw values through each field's source reader, and assigns values transformed, when needed, by global converters followed by field converters. Because a global converter can participate in every field, a configuration that converts "all strings that look numeric into numbers" can corrupt order IDs or SKUs as well. Apply conversion narrowly according to each request field's contract.

The current binder also checks body safety. If a body is present, it must be a plain object; keys absent from body bindings are rejected as `UNKNOWN_FIELD`, and dangerous keys as `DANGEROUS_KEY`. If a client adds `customerId` to a DTO declaring only `@FromBody('quantity')`, the binder does not simply ignore it. This is a choice to expose an incorrect request contract instead of silently discarding input the server does not recognize.

A missing required binding field produces `MISSING_FIELD`. HTTP's `@Optional()` prevents binding failure when the source has no value, while validation's `@IsOptional()` skips other validation rules for a missing value. Do not treat the similar names as synonyms. For an optional query field, for example, define the intended optionality in both binding and validation.

Ordinary field validators also skip `null` and `undefined`. Add `@IsDefined()` when a required field must not accept `null`. An initializer of `''` or `0` does not establish requiredness across every input path. Even when binding rejects an absent field, explicitly supplied `null` and input to a standalone validator need separate consideration.

## An Order Creation Module for Observing Only the Input Contract

The following is a **complete experimental module file** for `src/orders/dto-lab.ts`. It is an in-memory fixture for reproducing the boundary between `/orders` input and the public response; do not register it alongside the production `OrdersModule`. It provides no stock reservation, payment, persistence, or idempotency, so it must not replace the checkout implementation from Volume 2. Its purpose is to observe transformations without external effects while retaining the same account subject and order field names.

```ts
import { Inject, Module } from '@fluojs/core';
import {
  Controller, FromBody, NotFoundException, Post, RequestDto,
  UnauthorizedException, UseGuards, UseInterceptors,
  type Guard, type GuardContext, type RequestContext,
} from '@fluojs/http';
import {
  IsDefined, IsInt, IsString, Max, Min, MinLength,
} from '@fluojs/validation';
import {
  Expose, SerializerInterceptor, Transform,
} from '@fluojs/serialization';

export class CreateOrderInput {
  @FromBody()
  @IsDefined()
  @IsString()
  @MinLength(1)
  sku = '';

  @FromBody()
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(10)
  quantity = 0;
}

type OrderStatus =
  | 'pending_payment' | 'paid' | 'fulfilling' | 'shipped'
  | 'cancelled' | 'refund_pending' | 'refunded';

export interface OrderRecord {
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: 'KRW';
  totalMinor: bigint;
  version: number;
  internalNote: string;
}

interface CatalogPricePort {
  priceOf(sku: string): bigint;
}

const CATALOG_PRICE = Symbol('CATALOG_PRICE');

@Expose({ excludeExtraneous: true })
export class OrderView {
  @Expose() id = '';
  @Expose() customerId = '';
  @Expose() status: OrderStatus = 'pending_payment';
  @Expose() currency: 'KRW' = 'KRW';
  @Expose() version = 0;

  @Expose()
  @Transform((value) => {
    if (typeof value !== 'bigint') {
      throw new TypeError('Order total must be bigint.');
    }
    return value.toString(10);
  })
  totalMinor = 0n;

  internalNote = '';
}

@Inject(CATALOG_PRICE)
class OrdersService {
  private nextId = 1;

  constructor(private readonly catalog: CatalogPricePort) {}

  create(input: CreateOrderInput, customerId: string): OrderView {
    const record: OrderRecord = {
      id: `order-${this.nextId++}`,
      customerId,
      status: 'pending_payment',
      currency: 'KRW',
      totalMinor: this.catalog.priceOf(input.sku) * BigInt(input.quantity),
      version: 0,
      internalNote: 'Created by the local DTO experiment.',
    };
    return Object.assign(new OrderView(), record);
  }
}

class AuthenticatedGuard implements Guard {
  canActivate({ requestContext }: GuardContext): boolean {
    if (!requestContext.principal) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Inject(OrdersService)
@Controller('/orders')
@UseGuards(AuthenticatedGuard)
@UseInterceptors(SerializerInterceptor)
class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @RequestDto(CreateOrderInput)
  create(input: CreateOrderInput, context: RequestContext): OrderView {
    const principal = context.principal;
    if (!principal) {
      throw new UnauthorizedException();
    }
    return this.orders.create(input, principal.subject);
  }
}

@Module({
  controllers: [OrdersController],
  providers: [
    {
      provide: CATALOG_PRICE,
      useValue: {
        priceOf(sku: string): bigint {
          if (sku !== 'logo-shirt') {
            throw new NotFoundException('Product not found.');
          }
          return 25_000n;
        },
      } satisfies CatalogPricePort,
    },
    OrdersService,
    AuthenticatedGuard,
    SerializerInterceptor,
  ],
})
export class OrdersModule {}
```

The price port defines both an interface and a `CATALOG_PRICE` token. The module has an actual `useValue` implementation for that token, and the service class has class-level `@Inject(CATALOG_PRICE)`. The code makes the boundary explicit: the server, not the client, is the source of product prices. In the real product, `CatalogModule` exports its public price lookup token and `OrdersModule` imports it; here, we reproduce the calculation with a closed fixture containing only one known SKU.

Quantity is restricted to integers from 1 through 10 before conversion with `BigInt()`, so no floating-point money calculation occurs. That does not prove this example secures inventory. Reading a price and calculating a total, storing an item snapshot at order time, and reserving stock are separate steps. The in-memory ID does not survive process restarts either. This chapter does not execute that business work, so that we can separate the responsibilities of the transformation layer.

The principal checks in the guard and controller sit at different boundaries. The guard rejects unauthenticated requests before binding. The controller's check narrows the optional `principal` type to an actual value and passes only a confirmed subject to the service. This chapter contains no authentication implementation; the existing `AccountsModule` must supply a verified principal. If a test inserts a principal directly, make clear that it is only a test fixture.

`SerializerInterceptor` is also explicitly registered in providers. Reading the decorator name and omitting DI registration would leave the example short of explaining the complete module graph. For this experiment, place `@Module({ imports: [OrdersModule] })` in the actual `src/app.ts`. This specifies the root composition of an isolated experimental application; it does not mean overwriting the production application's existing module list with this one line.

## An Output DTO Is Not Another Name for a Stored Object

`OrderView` resembles `OrderRecord` in shape, but serves a different purpose. The stored object has an internal note; the public object retains only fields allowed by field-level `@Expose()`. Class-level `@Expose({ excludeExtraneous: true })` ensures that internal fields added later are not exposed by default. Removing known secret fields one by one with `@Exclude()` requires reassessing possible omissions whenever a new field is added.

The experiment deliberately copies even the internal note through `Object.assign(new OrderView(), record)`. This checks whether serialization removes it based on the instance's metadata. In a real service, copying only the necessary fields through a constructor or mapping function may be clearer. The important point is that adding TypeScript's `as OrderView` to a plain object does not create its runtime prototype or decorator metadata. A type assertion does not install a data exposure policy.

`serialize()` is not a JSON encoder either. It recursively traverses decorated classes, ordinary objects, and arrays to apply metadata, but does not automatically turn `bigint` into a decimal string. Opaque values such as `Date`, `Map`, `Set`, and `Promise` may also be preserved rather than expanded like ordinary DTOs. Check separately that a returned object passed through `serialize()` and that `JSON.stringify()` succeeds.

That is why the transform on `totalMinor` explicitly converts the internal `bigint` to a base-10 string. Creating the string through `Number(value)` may already have corrupted values beyond the safe integer range. The `Transform` callback is synchronous and receives only the current field value. It is not an API for querying the database, inferring currency from another DTO field, or awaiting an asynchronous exchange-rate conversion. Establish currency and amount consistency before constructing the response DTO.

The engine also handles circular references, but that capability is not a substitute for data model design. Active back edges are cut to `undefined`, and shared references that have already completed may be reused. Defining the public response's depth and fields first is more predictable for API consumers than returning an entire ORM graph in which orders and customers point to one another.

## When Metadata Must Be Available

The serialization package does not install global `Symbol.metadata` merely by being imported. If the runtime lacks it, call `ensureMetadataSymbol()` before evaluating decorated modules. The following is a **partial entry point implementation** for this experimental application. It assumes that `src/app.ts` imports the preceding `OrdersModule`, exports the root module, and starts the application with the existing host configuration.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
await import('./app.js');
```

The dynamic import here is not decorative. If you statically import `OrdersModule` and then prepare the metadata symbol in main's body, ESM may already have finished evaluating dependent modules. Using standard decorators and Node running every TypeScript construct without transformation are also different claims. The book uses Node24 with the existing standard decorator build configuration; enabling legacy `experimentalDecorators` and `emitDecoratorMetadata` is not the solution.

## Different Defaults for the HTTP Binder and Standalone Validator

Calling `new DefaultValidator().materialize(payload, Dto)` directly does not pass through the HTTP binder. This is useful, for example, for checking queue messages or administrative script input. By default, this API preserves safe own enumerable properties of a plain object. That is not the same as the HTTP binder's `UNKNOWN_FIELD` policy.

For a strict standalone input boundary, pass `{ undeclaredProperties: 'reject' }` as the third argument. Safe but undeclared properties are then rejected with an `UNDECLARED_PROPERTY` issue. This applies recursively to plain nested DTO input too, but an already constructed DTO instance is not subject to the same undeclared-property check. Wrapping an arbitrary external object in a DTO instance first and then using this option as a security filter is therefore incorrect.

Distinguish `validate()` from `materialize()` as well. The former checks rules on an already prepared root object; the latter creates a DTO instance from plain input, copies values, and materializes nested DTOs. Do not force invalid root arrays, strings, or null through field rules. The validation adapter on the HTTP path uses the binder's prepared value and binding plan, so do not try to unify the semantics by adding another arbitrary standalone materialize call in front of an HTTP handler.

The following is the **complete test file** `src/orders/dto-lab.test.ts`. It dynamically imports the experiment module after preparing metadata. The first two tests check standalone validator contracts; the last checks both metadata-driven output processing and actual JSON encoding.

```ts
import { expect, it } from 'vitest';
import { ensureMetadataSymbol } from '@fluojs/core';
import { DefaultValidator, DtoValidationError } from '@fluojs/validation';
import { serialize } from '@fluojs/serialization';

ensureMetadataSymbol();
const { CreateOrderInput, OrderView } = await import('./dto-lab.js');

it('does not coerce a numeric string', async () => {
  const validator = new DefaultValidator();
  await expect(
    validator.materialize({ sku: 'logo-shirt', quantity: '2' }, CreateOrderInput),
  ).rejects.toBeInstanceOf(DtoValidationError);
});

it('rejects undeclared standalone input when explicitly configured', async () => {
  const validator = new DefaultValidator();
  try {
    await validator.materialize(
      { sku: 'logo-shirt', quantity: 2, customerId: 'account-2' },
      CreateOrderInput,
      { undeclaredProperties: 'reject' },
    );
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(DtoValidationError);
    if (!(error instanceof DtoValidationError)) throw error;
    expect(error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNDECLARED_PROPERTY' }),
    ]));
  }
});

it('keeps exact money and removes non-public fields before JSON encoding', () => {
  const view = Object.assign(new OrderView(), {
    id: 'order-1', customerId: 'account-1',
    status: 'pending_payment', currency: 'KRW', version: 0,
    totalMinor: 9_007_199_254_740_993n,
    internalNote: 'Never return this field.',
  });
  const wire = JSON.parse(JSON.stringify(serialize(view)));
  expect(wire).toEqual({
    id: 'order-1', customerId: 'account-1',
    status: 'pending_payment', currency: 'KRW', version: 0,
    totalMinor: '9007199254740993',
  });
});
```

```bash
pnpm exec vitest run src/orders/dto-lab.test.ts
```

The final amount deliberately exceeds JavaScript's safe integer range. It is not a product price received by the actual order fixture; it checks that the serialization boundary preserves the precision of an already validated internal integer. It makes no claim that this value can be stored in the database. Actual column ranges, quantity limits, and currency matching must be checked separately at the relevant storage boundary.

## How Input Errors Become 400 Responses

The validation package's `DtoValidationError` is not an HTTP exception. `HttpDtoValidationAdapter` catches it, converts each issue into an HTTP input detail, and throws `BadRequestException`. Missing values, unknown body fields, and conversion failures discovered by the binder itself are also propagated as input errors owned by that boundary. Because errors pass through this boundary, services do not need to interpret the validation package's internal error types as HTTP status codes.

The default error envelope contains `code`, `status`, and `message` under `error`, with optional `details`, `meta`, and `requestId`. For example, the key observations for a request that adds `customerId` to the body are as follows. This is **an example of fields to check, not a complete error response**; it does not pin wording or the presence of optional fields.

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "status": 400,
    "details": [
      {
        "code": "UNKNOWN_FIELD",
        "field": "customerId",
        "source": "body"
      }
    ]
  }
}
```

A validation issue's `field` can be a nested path such as `items[0].quantity`. `source` can differ between HTTP binding and standalone validation, so do not assume it is always present. Treat error codes processed by the client as machine identifiers, and messages displayed to users as a separate representation. Comparing entire message strings to decide UI behavior turns translation or explanatory improvements into behavior changes.

Passing quantity validation in a DTO does not authorize an order state transition. Service business rules decide optimistic version conflicts or attempts to modify an already cancelled order and map them to 409 when appropriate. A nonexistent product is 404, an unauthenticated request is 401, and failed authorization is 403. A global catch that converts unexpected `TypeError` exceptions, invalid internal values in serializer transforms, and programmer errors all into 400 hides server defects as user mistakes.

## Writing the Response Directly Means Owning Its Protective Boundary

After `await next.handle()`, `SerializerInterceptor` checks the response's `committed` state. It passes only ordinary return values whose response has not yet committed to `serialize()`. If the controller first called `context.response.send(record)`, the internal note may already be in the final payload. The interceptor cannot remove it later, and the dispatcher does not write a second success response either.

There is nothing inherently wrong with a handler owning the response when manual downloads or streaming are needed. However, the protection provided by the returned DTO path does not automatically follow that choice. Prepare public data first, settle bigint and date representations, encode the result, and then send it. Await the transmission promise too, so that pre-commit errors can propagate through the request failure path.

Output transform failures also need verification. If `OrderView.totalMinor` contains the wrong internal type, this example's transform throws. An ordinary response that has not yet committed must enter the error handling path; the original object containing `internalNote` must not be sent as a fallback success response. Conversely, an error occurring after a stream has started cannot be replaced with a JSON 500. That is the boundary between commit and connection lifetime explored in the next chapter.

## Breaking the Transformation One Stage at a Time

For the HTTP experiment, send the valid body `{ "sku": "logo-shirt", "quantity": 2 }` with an authenticated principal. The service should be called once, and the public amount should be `"50000"`. Changing quantity to `"2"` must produce a 400 with no service invocation because this DTO has no numeric conversion configured. A quantity of null, 0, a fraction, or 11 must also be rejected by the applicable requiredness, integer, or range rules.

Adding `customerId` or `totalMinor` to the body must be rejected by the binder first. An unknown SKU, however, has a valid DTO structure, so it reaches the service and produces a 404 in the fixture's product lookup. Observing handler call counts and error details distinguishes binder failures from business lookup failures.

Apply default and strict modes side by side in standalone validation. The current contract preserves the same safe extra field under default materialize and turns it into an issue with the reject option. Rather than erasing the difference between HTTP and standalone behavior on the assumption that "one of them is a bug," write tests for the intended acceptance policy at each boundary.

For serialization verification, supply a DTO instance and a plain object separately and compare the results. Also test decorated nested DTOs, bigint, internal fields that must be hidden, and a small graph with circular references individually. Combining all cases into one large snapshot makes it hard to see which contract broke. Narrowing the failure reason by boundary also makes the tests less fragile under type changes.

The tests and expected HTTP results presented in this chapter are reproduction procedures derived from the current implementation. They are not results from actually running the new experimental application or storing orders. Nor do we claim that the initial HTTP and DI evidence in the existing `examples/fluo-blog` supplies a complete repository implementation for this orders module. The next chapter moves to a case where request and response values are both correct, but the customer disconnects before receiving the response.

## Sources and Verification Evidence

- [Validation README](../../packages/validation/README.md), [public exports](../../packages/validation/src/index.ts), [validator tests](../../packages/validation/src/validation.test.ts)
- [Serialization README](../../packages/serialization/README.md), [public exports](../../packages/serialization/src/index.ts), [serialize tests](../../packages/serialization/src/serialize.test.ts)
- [HTTP binder](../../packages/http/src/adapters/binding.ts), [binding plan](../../packages/http/src/adapters/dto-binding-plan.ts), [binding tests](../../packages/http/src/adapters/binding.test.ts)
- [HTTP validation adapter](../../packages/http/src/adapters/dto-validation-adapter.ts), [controller invocation boundary](../../packages/http/src/dispatch/dispatch-handler-policy.ts)
- [SerializerInterceptor implementation](../../packages/serialization/src/serializer-interceptor.ts), [interceptor tests](../../packages/serialization/src/serializer-interceptor.test.ts)
- [HTTP exceptions and error envelope](../../packages/http/src/exceptions.ts), [error response writing](../../packages/http/src/dispatch/dispatch-error-representation.ts)

The verification scope is a static comparison of the public APIs, implementations, and related tests. Executing the chapter's commands, integrating authentication, transmitting actual JSON, and checking database storage ranges must be verified separately in the reader's environment.
