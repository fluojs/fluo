---
"@fluojs/cli": patch
"@fluojs/react": patch
---

Start generated React SSR projects directly with `fluo dev` after dependency installation. The generated `dev` script now uses the same CLI-owned restart lifecycle, which transforms the server entry and serves client modules/styles through Vite's development server without a production build or manifest.

Grant generated Deno dev, test, and compiled applications read access to their `.env` file so the native watcher and production binary can start without unrestricted filesystem permissions.

Update the published `@fluojs/react` English and Korean README workflow to document the generated React starter's shared CLI-owned development lifecycle without a production build or manifest.
