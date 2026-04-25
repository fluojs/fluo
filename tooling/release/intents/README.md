# Committed release intent records

Release intent records are the repo-local machine input for future release preparation. They complement the human-facing root `CHANGELOG.md`; GitHub Releases remain generated CI artifacts, and this schema does not adopt Changesets, Beachball, or any other release automation dependency.

## Record shape

Use one committed JSON record per fixture/candidate release under this directory. The shape is intentionally close to Changesets-style committed change files: a small version header plus package-scoped intent entries that can be converted later without changing the governed release policy.

```json
{
  "version": "1.0.0-beta.2",
  "packages": [
    {
      "package": "@fluojs/cli",
      "disposition": "release",
      "semver": "patch",
      "summary": "Clarify CLI startup behavior for the beta.2 candidate.",
      "rationale": "The CLI package owns the affected generated starter contract."
    }
  ]
}
```

Each package entry must include:

- `package`: a public workspace package name from `packages/*/package.json` with the `@fluojs/*` scope and `publishConfig.access: "public"`.
- `disposition`: exactly one of `release`, `no-release`, or `downstream-evaluate`.
- `semver`: exactly one of `patch`, `minor`, `major`, or `none`.
- `summary`: maintainer-facing release review summary, aligned with the changelog's concise package/release-note language.
- `rationale`: why the package is included, excluded, or marked for downstream evaluation.
- `migrationNote`: required when `semver` is `major` or the entry sets `breaking: true`; optional for non-breaking intents.

## Cutoff policy

Release intent records are not backfilled for legacy releases. Releases at or before `1.0.0-beta.1` remain compatible without committed intent records, while fixture/candidate releases from `1.0.0-beta.2` onward must provide them.

## Validation helper

`tooling/release/release-intents.mjs` exports lightweight Node ESM helpers for tests and later readiness integration:

- `validateReleaseIntentRecord(record, dependencies)` validates a single record.
- `validateReleaseIntentRecords(records, { candidateVersion, ...dependencies })` enforces the cutoff behavior.
- `workspacePackageManifests()` and `publicWorkspacePackageNames(...)` derive the public package surface from local package manifests.

The validator is intentionally local and side-effect free so Task 9 can wire it into release readiness without changing package versions, tags, publishing workflows, or external tooling.
