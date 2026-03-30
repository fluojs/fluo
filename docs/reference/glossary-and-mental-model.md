# glossary and mental model

<p><strong><kbd>English</kbd></strong> <a href="./glossary-and-mental-model.ko.md"><kbd>한국어</kbd></a></p>

This glossary defines the core terminology and concepts used throughout the Konekti framework.

## core concepts

- **Dispatcher**: The central component responsible for routing and request execution.
- **Middleware**: A broad filter layer that executes before handlers.
- **Guard**: An authorization gate that determines if a request can proceed.
- **Interceptor**: A wrapper around handler invocation for cross-cutting concerns.
- **Request DTO**: An explicit contract for route-level data binding and validation.
- **Exception Resolver**: The standard mechanism for mapping exceptions to HTTP responses.

## framework policy terms

- **Official**: Fully supported and actively validated features.
- **Preview**: Offered for use but not yet at full feature parity or documentation coverage.
- **Experimental**: Available for early exploration; not yet stable or officially supported.
- **Recommended Preset**: The primary path optimized for in documentation and examples.
- **Official Matrix**: The complete set of supported configurations, which may be broader than the recommended preset.

## generator terminology

- **`konekti new`**: The standard command for bootstrapping a new application.
- **`konekti g ...`**: Commands for generating individual application artifacts.
- **Repository (`repo`)**: A recommended architectural pattern for data access.
- **Request/Response DTOs**: Purposely separated schematics for API contracts.

## further reading

- `../concepts/http-runtime.md`
- `../concepts/decorators-and-metadata.md`
- `../operations/release-governance.md`
