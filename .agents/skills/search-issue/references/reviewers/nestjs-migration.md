# NestJS migration reviewer

Inspect one package for concrete migration gaps encountered by users moving from
NestJS.

## Focus

- unsupported assumptions around decorators, metadata, lifecycle, and adapters
- migration steps that current docs or APIs make ambiguous
- behavior differences that require an explicit migration note or adapter
- evidence from shipped Fluo and NestJS-facing surfaces

## Non-goals

- claims of one-to-one NestJS compatibility or parity
- copying NestJS architecture without a Fluo contract reason
- speculative convenience features

Return `audit_finding` records only.
