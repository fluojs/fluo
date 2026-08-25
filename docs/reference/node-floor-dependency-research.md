# Node.js Floor Dependency Research

Date: 2026-08-23

| Package/version in the committed graph | Runtime or dev-only | Published requirement | Consumer impact | Primary source |
|---|---|---|---|---|
| `fastify@5.8.5` | Runtime dependency of `@fluojs/platform-fastify` | Fastify v5 supports Node 20+. | Yes for Fastify adapter consumers; no 22.14/24 floor. | https://github.com/fastify/fastify/blob/v5.8.5/docs/Guides/Migration-Guide-V5.md |
| `mongoose@9.7.2` (root override) | Optional consumer peer used by repository verification | `node >=20.19.0`. | Yes when that Mongoose release is selected; raises the Node 20 floor, not the Node 22 floor. | https://github.com/Automattic/mongoose/blob/9.7.2/package.json |
| `@prisma/client@7.5.0` (resolved verification peer) | Optional consumer peer | `node ^20.19 || ^22.12 || >=24.0`. | Consumer-selected, but confirms 22.12 rather than 22.14 as the relevant 22.x boundary. | https://www.prisma.io/docs/orm/reference/system-requirements |
| `drizzle-orm@0.45.2` (minimum peer and resolved verification version) | Optional consumer peer | The resolved package snapshot declares no Node engine. | No 22.14/24 floor from the peer itself; the Fluo wrapper remains Node-bound. | https://github.com/drizzle-team/drizzle-orm |
| `bullmq@5.81.1` | Runtime dependency of `@fluojs/queue` | `node >=12.22.0`. | No constraint on the candidate choice. | https://registry.npmjs.org/bullmq/5.81.1 |
| `ioredis@5.10.0` / `5.11.1` | Runtime peer integration | `node >=12.22.0`. | No constraint on the candidate choice. | https://github.com/redis/ioredis/blob/v5.11.1/package.json |
| `vite@6.4.3` | Dev and generated-project tooling | `node ^18.0.0 || ^20.0.0 || >=22.0.0`. | No published library runtime impact and no 22.14/24 floor. | https://github.com/vitejs/vite/blob/v6.4.3/packages/vite/package.json |
| `vitest@3.2.7` | Dev-only | `node ^18.0.0 || ^20.0.0 || >=22.0.0`. | No published-consumer impact and no 22.14/24 floor. | https://github.com/vitest-dev/vitest/blob/v3.2.7/packages/vitest/package.json |
| `typescript@6.0.2` | Maintainer toolchain | `node >=14.17`. | No published library runtime impact. | https://github.com/microsoft/TypeScript/blob/v6.0.2/package.json |
| `@babel/core@7.29.7`, `@babel/cli@^7.26.4` | Dev-only | The package line declares `node >=6.9.0`. | No published-consumer impact. | https://github.com/babel/babel/tree/main/packages |
| `@changesets/cli@2.31.0` | Dev/release-only | Its package manifest does not create a Node 22.14/24 floor. | No runtime impact; release automation only. | https://github.com/changesets/changesets/tree/main/packages/cli |
| `pnpm@10.4.1` | Dev/package-manager | Repository pin; no published-consumer floor. | No. | https://github.com/fluojs/fluo/blob/main/package.json · https://github.com/pnpm/pnpm/releases/tag/v10.4.1 |
| Root Fluo policy: `>=20.19.3 <21 || >=22.2.0 <27` | Published-package policy | Existing direct declaration. | Yes; this is the consumer-facing floor. | https://github.com/fluojs/fluo/blob/main/package.json |

## Conclusion

- No current dependency creates a meaningful floor specifically at **Node 22.14**.
- No current dependency requires a later **Node 22 patch** than 22.14. Prisma's current requirement accepts 22.12, while Fluo's Vite 6 and Vitest 3 toolchain accepts Node 22 from 22.0.0.
- **Node 24 is not dependency-required** by the committed graph.
- The strongest runtime evidence is Mongoose 9's **Node 20.19.0+** requirement. Therefore, if retaining Node 20, Fluo's existing **20.19.3** minimum is a sound floor. A Node 22.14-only policy is defensible operationally, but is not forced by this dependency graph; Node 24 would be a deliberate policy choice.

Caveat: Prisma, Drizzle, and Mongoose wrappers leave the external ORM selection to consumers, so an application's own lockfile may introduce a stricter floor. Repository version claims above use committed declarations and `pnpm-lock.yaml`; the local `node_modules` directory was stale for several packages during this investigation and is not treated as authoritative.
