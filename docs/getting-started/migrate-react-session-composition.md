# Migrate React session composition

Keep `FluoFactory.create(AppModule, { adapter })` and `app.listen()` as the startup
path. Keep ordinary HTTP handlers, validation, origin/CSRF checks and native
POST/303/GET. This change does not install a login provider or detect cookies.

## Existing provider and router

Configure the existing `ReactClientRouterProvider`, not another session provider:

```tsx
<ReactClientRouterProvider
  initialSnapshot={snapshot}
  navigationModules={navigationModules}
  navigationBuildId={navigationBuildId}
  session={{ epoch: 'initial-nonsecret-label' }}
>
  {children}
</ReactClientRouterProvider>
```

After an application-confirmed login/logout/permission change, call
`router.sessionChanged({ epoch: nextLabel, reason: 'login' })`. Repeated labels
still invalidate old ownership. Do not use a controlled epoch prop, separate
notifier, prefetch-scope-only switch or cookie guessing. Read
`useRouterState().session` for the existing provider's approval state.

Revocation removes old page approval/head/retained form data before policy,
including initial SSR fallback. Fresh credentialed 401 defaults to signed-out,
403 to forbidden without erasing identity. Optional session policy runs after
that barrier; same-origin document exits are validated. Transient network/5xx
continue using existing failure policy. External cookie changes alone are not a
cross-tab signal. These in-document defaults require configured or explicitly activated
session-aware composition. Legacy providers without it exit to the ordinary HTTP document
after fresh 401/403 revocation, so plain protected children cannot remain visible.
Do not use `failurePolicy: () => 'preserve'` to retain auth-rejected content.
Session policy `'refresh'` performs fresh GET approval for GET and POST auth rejection
without replaying POST. Cancelling a saved form while its session policy is held settles
the binding immediately and prevents a late document exit.

## HTTP forms and saved data

The canonical handler can return:

```ts
return ReactModule.formResult({
  destination: '/account', followUp: 'navigate',
  data: { revision: 2 },
  session: { epoch: 'new-nonsecret-label', reason: 'login' },
});
```

The explicit outcome enters the same barrier before asynchronous destination
policy, then transfers only the confirmed saved continuation to fresh approval.
Saved follow-up failure is not failed persistence; retry GET never replays POST.
Ordinary mutations keep unrelated form state. Native success remains 303 and the
enhanced saved acknowledgement remains v1.

Generated contracts provide `ReactFormContract<Input, Data>` with `fields` and
`decodeSaved(value: unknown): Data` to the existing `useForm({ contract, ... })`.
Manual `fields` remains unprojected; it cannot assert a generated saved-data type.
Malformed decoded data is protocol uncertainty. The root boundary rejects
nonfinite values, classes, Date, functions, hooks/accessors, undefined members,
sparse arrays and cycles rather than silently normalizing them.

## App-owned resources

Background GET/POST uses the same internal provider session lease. Navigation alone
retains live owners; logout/rebind removes old results and inputs before policy.
Generated contracts may validate ordinary reads through optional `decodeRead`.
Manual/opaque background redirects fail locally; configured validated document
decisions and the legacy 401/403 document exit are explicit auth-policy exceptions.
Never infer a new epoch from cookies or retry an uncertain POST.

Place protected players/channels/listeners under the application's existing
session-aware React subtree and effect cleanup. The runtime has no public teardown
registry. Store settlement is not a paint or SDK disposal receipt: verify the
actual owned connection operation and cleanup. The example/starter session fixture
uses real MessageChannel acknowledgements, two port closes and new-session recovery.
Auth revocation takes priority over future dirty-confirm composition; this is not
the future dirty-navigation guard.
