# decorators and metadata

<p><strong><kbd>English</kbd></strong> <a href="./decorators-and-metadata.ko.md"><kbd>한국어</kbd></a></p>

This guide outlines the decorator and metadata model used in `@konekti/core`, `@konekti/http`, and the `@konekti/dto` package.

### related documentation

- `./http-runtime.md`
- `./di-and-modules.md`
- `../../packages/core/README.md`

## decorator implementation

Konekti uses a decorator-first approach based exclusively on TC39 standard decorators.

### core decorator families

- **Module and DI**: `@Module()`, `@Inject()`, `@Scope()`, `@Global()`
- **HTTP Routing**: `@Controller()`, `@Get()`, `@Post()`, `@UseGuards()`, `@UseInterceptors()`
- **DTO Binding**: `@FromBody()`, `@FromPath()`, `@FromQuery()`, `@FromHeader()`, `@FromCookie()`
- **Validation**: Decorators provided by the `@konekti/dto` package

## dto strategy

- Request DTO binding is an explicit opt-in.
- Method-level route metadata and DTO field decorators are used instead of parameter-based injection magic.
- Validation is driven by framework-owned decorator metadata.
- Nested DTO validation is a first-class feature.

### current constraints

- The decorator-first DTO model is the primary supported contract.
- Direct schema-object validation is not a priority at this time.
- Validation-adapter contracts will not be expanded into a general extension API for now.

## dto security

- Request DTOs, response DTOs, and persistence models remain separate.
- Each field maps to a single request source.
- Body binding uses a strict allowlist.
- Sensitive or dangerous keys (e.g., `__proto__`, `constructor`, `prototype`) are blocked.

## metadata management

- Low-level metadata read/write operations are handled by internal helper APIs.
- The runtime and other packages must access normalized metadata through these helpers.
- Custom decorators should not rely on the internal storage format.
- Third-party extensions to the metadata system are not currently part of the public API.
- Use `ensureMetadataSymbol()` and other exported helpers to ensure compatibility when `Symbol.metadata` is required.

## conceptual model

```text
decorators write framework-owned metadata
runtime packages read normalized metadata
internal storage remains private
```
