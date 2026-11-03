---
'@fluojs/cli': major
---

Remove Deno runtime support from the CLI

- `fluo new` no longer offers the Deno runtime or platform choices: the interactive runtime prompt lists Node.js, Bun, and Cloudflare Workers only, and the `application-deno-deno-http` starter profile and scaffold recipe are gone.
- Explicit `--runtime deno` and `--platform deno` generation flags now fail with a support-ended reason and the canonical migration URL instead of scaffolding or silently selecting a different runtime.
- `fluo dev`, `fluo build`, and `fluo start` no longer route legacy projects whose manifest declares `@fluojs/platform-deno`; those requests fail with the same support-ended reason and migration URL instead of falling back to Node.
- The CLI-owned dev restart runner, Studio sidecar runtime union, generated starter metadata, and sandbox matrix no longer carry Deno execution paths.
- Node.js, Bun, and Cloudflare Workers starters and all non-Deno CLI behavior are unchanged.

Migration: move existing Deno projects to the Node.js, Bun, or Cloudflare Workers starter following the Deno migration guide at https://github.com/fluojs/fluo/blob/main/docs/getting-started/migrate-from-deno.md
