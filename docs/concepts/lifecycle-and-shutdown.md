# lifecycle and shutdown

<p><strong><kbd>English</kbd></strong> <a href="./lifecycle-and-shutdown.ko.md"><kbd>한국어</kbd></a></p>


This guide describes the current application lifecycle model across bootstrap, readiness, and shutdown.

See also:

- `./config-and-environments.md`
- `./transactions.md`
- `../../packages/runtime/README.md`

## lifecycle phases

1. config load
2. module graph compile
3. provider/container creation
4. provider and module init hooks
5. infrastructure connect
6. transport bind/listen
7. ready

## bootstrap guarantees

- invalid config fails before listen
- module/provider graph errors fail at startup
- infrastructure connection failures do not leave half-started state
- app ready means the transport is actually ready to receive requests

## hook model

The runtime owns the standard lifecycle hook sequence:

- `onModuleInit`
- `onApplicationBootstrap`
- `onModuleDestroy`
- `onApplicationShutdown`

## shutdown sequence

1. stop accepting new requests
2. record shutdown signal
3. drain in-flight requests
4. run destroy/shutdown hooks
5. disconnect infrastructure clients
6. flush logging/tracing if needed
7. exit

## in-flight request policy

- no new requests during shutdown
- bounded drain for started requests
- forced termination remains available after drain timeout
- request-scoped cleanup must remain finally-safe

## integration implications

- ORM clients should follow provider lifecycle
- open transactions must be cleaned up before disconnect
- runtime-owned adapters are responsible for propagating request abort/close state into the framework request model
