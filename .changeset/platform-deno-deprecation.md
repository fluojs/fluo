---
"@fluojs/platform-deno": patch
"@fluojs/websockets": patch
"@fluojs/cli": patch
---

Deprecate the Deno HTTP adapter, WebSocket Deno subpath, and CLI Deno target without changing their existing behavior or exports. No new Deno features, performance work, or runtime compatibility work is planned. Critical security/regression fixes are considered case by case without a patch or LTS guarantee.

The final Deno adapter and WebSocket support line is 2.x. Deno-specific surfaces are planned for removal at the next major of their respective packages, tracked in https://github.com/fluojs/fluo/issues/3938. The remaining WebSocket and CLI targets are not deprecated.

Migrate to Node.js + Fastify, or a supported Bun/Cloudflare Workers adapter as appropriate: https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-from-deno.md
