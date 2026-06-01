---
"@fluojs/runtime": patch
"@fluojs/platform-bun": patch
"@fluojs/platform-deno": patch
"@fluojs/platform-fastify": patch
"@fluojs/platform-express": patch
---

Keep the runtime internal HTTP adapter seam free of Node-specific console logger globals, and route platform defaults through either the transport-neutral logger or the explicit Node runtime subpath.
