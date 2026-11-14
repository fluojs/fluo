---
"@fluojs/core": patch
"@fluojs/cqrs": patch
---

Copy Node `Buffer` values and other typed array subclasses in the shared fallback clone without calling the subclass constructor, so cloning a `Buffer` no longer emits the `DEP0005` deprecation warning. Instances whose class declares ECMAScript private members are now returned by reference instead of as a detached copy that threw a `TypeError` when private state was read. The core and CQRS READMEs document the decided behavior.
