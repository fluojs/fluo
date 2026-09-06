---
"@fluojs/platform-fastify": patch
---

Require Fastify `^5.12.3`, including the upstream proxy-identity and root-primitive schema validation fixes, instead of allowing `5.8.5`. Existing Fluo routing, query parsing, proxy trust, and validation contracts remain unchanged.

Fastify now rejects malformed RFC 10008 `QUERY` requests without content or a matching `Content-Type`; send a JSON body with `Content-Type: application/json` rather than using an empty `QUERY` as a `GET` substitute.

After upgrading to the release carrying this change, refresh application lockfiles and verify every transitive `fast-uri` copy is at least `3.1.6` (`qs` must be at least `6.16.0` in Express applications). Repository pnpm overrides do not propagate to published consumers. See the [consumer dependency update guide](https://github.com/fluojs/fluo/blob/main/docs/reference/dependency-security-update.md).
