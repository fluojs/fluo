---
"@fluojs/i18n": patch
---

Generate valid catalog declarations when custom output names shadow helper type parameters or utility types, or when a namespace map is named `intrinsic`. Preserve contextual names such as `as` where valid for an interface, and reject names that are invalid in their declaration position with `I18N_INVALID_OPTIONS`.
