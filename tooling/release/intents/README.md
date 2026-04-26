# Committed release intent records

**DEPRECATED**: This directory is retained for historical reference. fluo has migrated to [Changesets](https://github.com/changesets/changesets) (`.changeset/*.md`) for release intent tracking. New releases should use Changesets instead of JSON intent records.

Release intent records were the repo-local machine input for release preparation before Changesets adoption.

## Record shape

Legacy records used one committed JSON record per fixture/candidate release under this directory. The shape is intentionally close to Changesets-style committed change files: a small version header plus package-scoped intent entries that historical tests can still validate.

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

Each legacy package entry included:

- `package`: a public workspace package name from `packages/*/package.json` with the `@fluojs/*` scope and `publishConfig.access: "public"`.
- `disposition`: exactly one of `release`, `no-release`, or `downstream-evaluate`.
- `semver`: exactly one of `patch`, `minor`, `major`, or `none`.
- `summary`: maintainer-facing release review summary, aligned with the changelog's concise package/release-note language.
- `rationale`: why the package is included, excluded, or marked for downstream evaluation.
- `migrationNote`: required when `semver` is `major` or the entry sets `breaking: true`; optional for non-breaking intents.

## Dependency impact tracking

The legacy readiness flow started from public packages selected as candidate impact roots. Maintainers passed those
package names to `tooling/release/verify-release-readiness.mjs` with repeated `--changed-package <name>` flags when
auditing a candidate release set. The readiness check called `expandPublicPackageDependencyImpact(...)`, which walks
public workspace `dependencies`, `peerDependencies`, and `optionalDependencies` from the released package set to every
public dependent package.

When reading old records, use the `--changed-package` roots deliberately: a docs-only package that is recorded as `no-release` can remain in the
intent record for audit context, but adding it as a readiness impact root also requires explicit decisions for every
public dependent that the dependency graph reaches.

Every directly changed package and every downstream public dependent in the legacy flow had to include a committed intent entry for
the candidate version. Directly released packages use `disposition: "release"` with `semver` set to `patch`,
`minor`, or `major`. A downstream-only package must use `disposition: "downstream-evaluate"` or
`disposition: "no-release"` with `semver: "none"`; `downstream-evaluate` records a required human review gate and
does not trigger automatic dependent-package publishing.

## Historical cutoff policy

Release intent records are not backfilled for releases at or before `1.0.0-beta.1`. The `1.0.0-beta.2` release candidate has a retained JSON record only as migration history and a `.changeset/*.md` backfill. New releases use `.changeset/*.md` instead of adding JSON records here.

## Validation helper

`tooling/release/release-intents.mjs` exports lightweight Node ESM helpers for historical tests and migration audits:

- `validateReleaseIntentRecord(record, dependencies)` validates a single record.
- `validateReleaseIntentRecords(records, { candidateVersion, ...dependencies })` enforces the cutoff behavior.
- `workspacePackageManifests()` and `publicWorkspacePackageNames(...)` derive the public package surface from local package manifests.

The validator remains local and side-effect free so historical records can be checked without changing package versions, tags, publishing workflows, or external tooling. It is not the source of truth for new release intent after the Changesets migration.
