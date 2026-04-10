# Error Handling & Responses

<p><strong><kbd>English</kbd></strong> <a href="./error-responses.ko.md"><kbd>한국어</kbd></a></p>

A backend's quality is often judged by how it handles failure. fluo enforces a **standardized error response format** across the entire framework, ensuring that your API remains predictable, actionable, and secure for clients even when things go wrong.

## Why Standardized Errors in fluo?

- **Predictable API Surface**: Clients can implement a single error-handling logic that works across all your endpoints, whether the error came from a database, a validation rule, or an auth guard.
- **Actionable Feedback**: Validation errors include detailed field-level information, allowing frontend developers to show precise error messages to users without guessing.
- **Security by Design**: Internal stack traces and sensitive database errors are automatically stripped in production, preventing information leakage.
- **Request Correlation**: Every error response includes the `requestId`, making it trivial for developers to find the corresponding logs in their observability stack.

## Responsibility Split

- **`@fluojs/http` (The Filter)**: Provides the global exception filter, the base `HttpException` class, and the set of standard exceptions (e.g., `NotFoundException`, `ForbiddenException`).
- **`@fluojs/validation` (The Reporter)**: Specialized in generating rich, nested error structures when DTO validation fails.
- **`@fluojs/core` (The Contract)**: Defines shared framework error primitives such as `fluoError` and the lower-level invariants other packages build on.

## Typical Workflow

### 1. Throwing an Exception
Use built-in exceptions to communicate intent clearly and stay consistent with HTTP status codes.

```typescript
if (!user) {
  throw new NotFoundException('User not found');
}
```

### 2. The Global Catch-All
Any exception thrown (or unhandled) during a request is caught by the fluo dispatcher. It identifies if the exception is a known `HttpException` or a raw JavaScript `Error`.

### 3. Envelope Formatting
The error is wrapped in the standard fluo envelope.

```json
{
  "error": {
    "code": "NOT_FOUND",
    "status": 404,
    "message": "User not found",
    "requestId": "req_abc123",
    "timestamp": "2024-04-08T..."
  }
}
```

### 4. Validation Specifics
When a DTO fails validation, the `details` array is populated with specific field violations.

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "status": 400,
    "message": "Bad Request",
    "details": [
      { "field": "email", "issue": "must be a valid email" }
    ]
  }
}
```

## Core Boundaries

- **The Production Shield**: In production mode, raw `Error` objects (like database connection failures) are mapped to a generic `INTERNAL_SERVER_ERROR` code to protect your infrastructure details.
- **Correlation is Key**: Always include the `requestId` in your client-side error reporting or support tickets. It is the "glue" between the client experience and the server logs.
- **Consistency over Customization**: While you can customize error filters, we strongly recommend sticking to the standard envelope to maintain ecosystem compatibility with our CLI and client generators.

## Next Steps

- **Hierarchy**: Review the built-in exception classes in the [HTTP Package README](../../packages/http/README.md).
- **Validation**: Learn about rich error reporting in the [Validation Package](../../packages/validation/README.md).
- **Advanced**: Learn how to create custom exception filters in the [HTTP Package README](../../packages/http/README.md).
