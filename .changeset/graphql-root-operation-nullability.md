---
'@fluojs/graphql': minor
---

Allow code-first query, mutation, and subscription decorators to mark their root return type non-null with `nullable: false`. Omitted and `nullable: true` retain nullable root returns, and list item and argument nullability remain unchanged.
