# config and environments

<p><strong><kbd>English</kbd></strong> <a href="./config-and-environments.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current configuration contract across `@konekti/config`, runtime bootstrap, and package integrations.

See also:

- `../../packages/config/README.md`
- `./lifecycle-and-shutdown.md`
- `../getting-started/bootstrap-paths.md`

## ownership

- `@konekti/config` owns config loading, precedence, validation, and typed access
- bootstrap consumes already-loaded config rather than reinterpreting env sources ad hoc
- integrations should consume typed config, not read environment variables directly when avoidable

## current config shape

The public direction is:

- explicit mode selection (`dev`, `prod`, `test`)
- one deterministic precedence order
- validation at startup
- typed access through `ConfigService`

## mode and env-file policy

- official modes: `dev`, `prod`, `test`
- default env files:
  - `.env.dev`
  - `.env.prod`
  - `.env.test`

## source precedence

Current precedence is total and deterministic:

1. runtime overrides
2. process environment
3. mode-specific env file
4. explicit defaults

Application code reads the normalized merged result, not the winning source.

## validation boundary

- invalid config fails startup before listen
- validation and coercion happen once at bootstrap time
- secrets follow the same precedence model but should not be echoed in logs or error details

## practical rule

Use `ConfigService` for current application reads, and prefer typed integration-specific config providers where the package surface justifies them.
