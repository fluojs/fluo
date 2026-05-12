---
"@fluojs/i18n": minor
---

Keep optional i18n subpath integrations out of the default root dependency graph while documenting their peer prerequisites and hardening fallback, interpolation, and remote-loader cancellation contract coverage.

Upgrade note: consumers that import `@fluojs/i18n/icu`, `@fluojs/i18n/http`, or `@fluojs/i18n/validation` must list the matching peer dependency in their application or package manifest: `intl-messageformat` for ICU formatting, `@fluojs/http` for HTTP locale helpers, and `@fluojs/validation` for validation localization. The root `@fluojs/i18n` entry point does not require these integration peers.
