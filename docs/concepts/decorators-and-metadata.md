# decorators and metadata

<p><strong><kbd>English</kbd></strong> <a href="./decorators-and-metadata.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current decorator and metadata model across `@konekti/core`, `@konekti/http`, and `@konekti/dto-validator`.

See also:

- `./http-runtime.md`
- `./di-and-modules.md`
- `../../packages/core/README.md`

## current decorator stance

The public model is decorator-first and standard-decorator-only.

Core families include:

- module and DI decorators such as `@Module()`, `@Inject()`, `@Scope()`, `@Global()`
- HTTP decorators such as `@Controller()`, `@Get()`, `@Post()`, `@UseGuard()`, `@UseInterceptor()`
- DTO binding decorators such as `@FromBody()`, `@FromPath()`, `@FromQuery()`, `@FromHeader()`, `@FromCookie()`
- validation decorators from `@konekti/dto-validator`

## DTO strategy

- request DTO binding is explicit opt-in only
- method-level route metadata plus DTO field decorators are preferred over parameter-decorator magic
- validation runs from framework-owned decorator metadata
- nested DTO validation is part of the first-party model

## DTO security rules

- request DTO, response DTO, and persistence model stay separate
- one field maps to one request source
- body binding uses strict allowlist behavior
- dangerous keys such as `__proto__`, `constructor`, and `prototype` are blocked

## metadata ownership

- helper-owned metadata APIs remain the low-level write/read boundary
- runtime and other packages should read normalized metadata through helper APIs
- custom decorators should not depend on raw storage shape as a public contract

## practical mental model

```text
decorators write framework-owned metadata
runtime packages read normalized metadata
raw storage shape is not the public extension surface
```
