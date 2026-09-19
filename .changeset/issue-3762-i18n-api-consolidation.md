---
"@fluojs/i18n": major
---

Consolidate standalone i18n service, ICU service, and catalog loader creation under static `.create(...)` methods on their owning classes, and unify `Accept-Language` resolution under canonical policy resolvers.

**Breaking migration:**
- Standalone service creation: replace `createI18n(options)` with `I18nService.create(options)`. The free function `createI18n` is removed from package exports.
- ICU service creation: replace `createIcuI18n(options)` with `IcuI18nService.create(options)`. The free function `createIcuI18n` is removed from `@fluojs/i18n/icu`.
- Filesystem loader creation: replace `createFileSystemI18nLoader(options)` with `FileSystemI18nLoader.create(options)`. The free function `createFileSystemI18nLoader` is removed from `@fluojs/i18n/loaders/fs`.
- Remote loader creation: replace `createRemoteI18nLoader(options)` and `createCachedRemoteI18nLoader(options)` with `RemoteI18nLoader.create(options)` and `CachedRemoteI18nLoader.create(options)`. The free functions `createRemoteI18nLoader` and `createCachedRemoteI18nLoader` are removed from `@fluojs/i18n/loaders/remote`.
- Header locale resolution: `createAcceptLanguageLocaleResolver` in `@fluojs/i18n/http` and `createHeaderLocaleResolver` in `@fluojs/i18n/adapters` are removed. Use `createAcceptLanguageLocalePolicyResolver` and `createHeaderLocalePolicyResolver`. For exact match semantics without regional normalization, pass `{ normalizeToSupportedLocale: false }`.
- Public constructors: `I18nService`, `IcuI18nService`, `FileSystemI18nLoader`, `RemoteI18nLoader`, and `CachedRemoteI18nLoader` constructors remain public for DI and subclassing.
