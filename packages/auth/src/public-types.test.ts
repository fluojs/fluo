import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

describe('built authentication public contracts', () => {
  it('typechecks canonical and legacy strategies against emitted export maps without source aliases', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fluo-auth-consumer-'));
    mkdirSync(join(directory, 'node_modules/@fluojs'), { recursive: true });
    for (const name of ['auth', 'auth-http', 'http', 'jwt', 'passport']) {
      symlinkSync(join(repository, 'packages', name), join(directory, 'node_modules/@fluojs', name));
    }
    writeFileSync(join(directory, 'consumer.mts'), `
import type { Principal, AuthStrategy as NeutralStrategy } from '@fluojs/auth';
import { AuthModule, type AuthStrategy } from '@fluojs/auth-http';
import type { GuardContext, Principal as HttpPrincipal } from '@fluojs/http';
import type { JwtPrincipal } from '@fluojs/jwt';
import { PassportModule, type AuthStrategy as LegacyStrategy } from '@fluojs/passport';
const principal: Principal = { subject: 'consumer', claims: {} };
principal.subject = 'mutable';
principal.claims['custom'] = true;
const http: HttpPrincipal = principal;
const jwt: JwtPrincipal = http;
const shared: Principal = jwt;
class Neutral implements NeutralStrategy<{ subject: string }> {
  authenticate(context: { subject: string }): Principal {
    return { subject: context.subject, claims: {} };
  }
}
class Http implements LegacyStrategy {
  authenticate(context: GuardContext): Principal {
    return { subject: context.requestContext.request.path, claims: {} };
  }
}
const canonical: AuthStrategy = new Http();
const legacy: LegacyStrategy = canonical;
const neutral = new Neutral();
const oldModule: typeof PassportModule = AuthModule;
const newModule: typeof AuthModule = PassportModule;
void [shared, legacy, neutral, oldModule, newModule];
`);

    try {
      const result = spawnSync(process.execPath, [
        join(repository, 'node_modules/typescript/bin/tsc'),
        '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext',
        '--moduleResolution', 'NodeNext', '--target', 'ES2022',
        join(directory, 'consumer.mts'),
      ], { cwd: directory, encoding: 'utf8', timeout: 30_000 });

      expect(result.status, result.stdout + result.stderr).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
