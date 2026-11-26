---
"@fluojs/i18n": patch
---

Generate valid catalog declarations when custom output names shadow helper type parameters or utility types, or when names such as `keyof` and `readonly` are ambiguous in type references. Preserve valid contextual names, including `as` for interfaces and `intrinsic` for namespace maps, and reject names that are invalid in their declaration position with `I18N_INVALID_OPTIONS`.
