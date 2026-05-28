---
"@fluojs/cli": patch
"@fluojs/runtime": patch
"@fluojs/platform-bun": patch
"@fluojs/platform-deno": patch
"@fluojs/platform-express": patch
"@fluojs/platform-fastify": patch
"@fluojs/platform-nodejs": patch
---

Restore generated Node starter runtime log colors by using platform startup helpers and internalizing runtime logger selection instead of accepting logger overrides in app options.
