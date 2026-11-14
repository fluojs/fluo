---
"@fluojs/core": patch
"@fluojs/cqrs": patch
---

Copy Node `Buffer` values and other typed array subclasses in the shared fallback clone without calling the subclass constructor, so cloning a `Buffer` no longer emits the `DEP0005` deprecation warning. Instances whose class declares ECMAScript private members are now returned by reference instead of as a detached copy that threw a `TypeError` when private state was read. Detection is conservative so no private member is missed: a class whose source contains `#` followed by an identifier character anywhere, including text such as a `/#tag/` regular expression, is returned by reference, as is any instance whose class cannot be identified because its prototype `constructor` is missing or shadowed; prototype methods and accessors are inspected as well. Typed arrays created in another realm are copied without relying on prototype identity. The core and CQRS READMEs document the decided behavior.
