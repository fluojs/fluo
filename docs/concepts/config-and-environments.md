# config and environments

<p><strong><kbd>English</kbd></strong> <a href="./config-and-environments.ko.md"><kbd>한국어</kbd></a></p>

fluo treats configuration as **validated runtime data** rather than a collection of ambient environment variables. By enforcing explicit loading, strict validation, and typed access, we ensure your application's behavior is predictable across every environment.

## why this matters

"Ambient" configuration—scattering `process.env.DB_URL` throughout your codebase—is a major source of production instability.
- **Hidden Dependencies**: You don't know which environment variables your app actually needs until it crashes in production.
- **Type Uncertainty**: `process.env` values are always strings. Forgetting to parse a `PORT` as a number or a `DEBUG` flag as a boolean leads to subtle, hard-to-trace bugs.
- **Testing Friction**: Mocking global `process.env` in unit tests is messy and can lead to side effects between test suites.

fluo solves these issues by creating a **Config Boundary**. All configuration must pass through a validation gate before it ever reaches your application logic.

## core ideas

### explicit loading (no magic env)
fluo does not automatically scan your system for environment variables. You must explicitly define your configuration sources during the bootstrap process. This might include:
- A specific `.env` file path.
- A static JSON or YAML configuration.
- A filtered subset of `process.env`.

This explicitness makes your application "hermetic"—it only knows what you've told it to know, making it highly portable and easy to test.

### early validation gate
The application will **refuse to start** if its configuration is invalid.
- **Schema-Driven**: You define the "shape" of your config (e.g., using a validation library).
- **Fail-Fast**: Missing keys, incorrect types, or out-of-range values are caught at the very first line of code execution. This prevents "half-booted" applications that fail only when a specific service is called.

### the `ConfigService` boundary
Within your application, you never access external environment variables. Instead, you inject the `ConfigService`.
- **Typed Access**: `config.get<number>('port')` ensures you're working with the correct data type.
- **Safe Defaults**: You can define fallback values in code that are only used if the environment doesn't provide them.
- **Secret Masking**: The `ConfigService` can be configured to mask sensitive values (like API keys) when logging the application state.

## loading precedence

When multiple sources are provided, fluo merges them in a deterministic order:
1. **Bootstrap Overrides**: Values passed directly in the `fluo.create()` call (highest priority).
2. **Environment Variables**: Values mapped from the system environment.
3. **Configuration Files**: Values read from `.env`, `config.json`, etc.
4. **Code Defaults**: Hardcoded fallback values (lowest priority).

## boundaries

- **Zero Global Dependency**: No package in the fluo ecosystem is allowed to access `process.env` directly. Everything must go through the DI container.
- **Validation Barrier**: A configuration snapshot is considered "corrupt" if even a single required field fails validation. No partial configuration is ever applied.
- **Runtime Reloading**: In development, the `ConfigService` can apply new snapshots without restarting the process (see [Dev Reload Architecture](./dev-reload-architecture.md)).

## related docs

- [Architecture Overview](./architecture-overview.md)
- [Dev Reload Architecture](./dev-reload-architecture.md)
- [Lifecycle and Shutdown](./lifecycle-and-shutdown.md)
- [Config Package README](../../packages/config/README.md)
