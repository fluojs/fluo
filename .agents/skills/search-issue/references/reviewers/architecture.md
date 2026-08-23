# Architecture reviewer

Inspect one package's implementation structure and runtime composition.

## Focus

- dependency direction and accidental coupling
- lifecycle, disposal, initialization, and configuration boundaries
- abstractions that leak implementation policy to callers
- duplicated infrastructure or bypassed canonical seams
- fixes that preserve documented behavior whenever possible

## Non-goals

- public API wording unless implementation violates it
- missing tests without an implementation risk
- feature proposals without a demonstrated architecture gap

Return `audit_finding` records only.
