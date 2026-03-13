# http policy examples

The current starter app keeps HTTP policy knobs explicit without opening unnecessary prompt choices.

## CORS default

The scaffolded app reads `CORS_ORIGIN` and wires `createCorsMiddleware(...)` in `src/app.ts`.

Default scaffold env:

```dotenv
CORS_ORIGIN=*
```

## tightening CORS

To restrict origins, set a comma-separated list:

```dotenv
CORS_ORIGIN=https://app.example.com,https://admin.example.com
```

The generated middleware keeps:

- `Authorization` and `Content-Type` in `allowHeaders`
- `X-Request-Id` in `exposeHeaders`

## request lifecycle expectations

- request IDs remain available in canonical error output
- abort-aware adapters should propagate `FrameworkRequest.signal`
- long-lived or streaming routes should be treated outside the strict request-tx path unless a stack-specific guide states otherwise
