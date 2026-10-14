---
"@fluojs/platform-fastify": patch
"@fluojs/microservices": major
---

Require patched Fastify 5.12.7 and raise the optional gRPC peer security floor to @grpc/grpc-js 1.14.5. Existing transport APIs and resource ownership remain unchanged.

Migration: Applications using @grpc/grpc-js 1.14.4 must install @grpc/grpc-js ^1.14.5 and refresh their lockfile before upgrading @fluojs/microservices. The gRPC peers remain optional when the application does not use gRPC.
