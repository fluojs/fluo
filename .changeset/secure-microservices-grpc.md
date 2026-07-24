---
"@fluojs/microservices": major
---

Require `@grpc/grpc-js` 1.14.4 or newer for the optional gRPC transport. Upgrade the peer and refresh consumer lockfiles so the proto-loader chain resolves `protobufjs` 7.6.5 or newer; the fluo transport API is unchanged.
