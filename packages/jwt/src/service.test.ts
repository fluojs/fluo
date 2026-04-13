import { describe, expect, it } from 'vitest';

import { JwtService } from './service.js';
import { DefaultJwtSigner } from './signing/signer.js';
import type { JwtVerifierOptions } from './types.js';
import { DefaultJwtVerifier } from './signing/verifier.js';

function createJwtService(options: JwtVerifierOptions): JwtService {
  return new JwtService(options, new DefaultJwtSigner(options), new DefaultJwtVerifier(options));
}

describe('JwtService', () => {
  it('signs and verifies payload claims with NestJS-style facade methods', async () => {
    const service = createJwtService({
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    });
    const token = await service.sign({ role: 'admin', sub: 'service-user' });

    await expect(service.verify<{ role?: string; sub?: string }>(token)).resolves.toMatchObject({
      role: 'admin',
      sub: 'service-user',
    });
  });

  it('applies sign and verify options overrides', async () => {
    const service = createJwtService({
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    });
    const token = await service.sign(
      {
        role: 'reader',
      },
      {
        audience: 'fluo-users',
        expiresIn: '60s',
        issuer: 'jwt-service-tests',
        subject: 'service-overrides-user',
      },
    );

    await expect(
      service.verify<{ aud?: string; role?: string; sub?: string }>(token, {
        audience: 'fluo-users',
        issuer: 'jwt-service-tests',
      }),
    ).resolves.toMatchObject({
      aud: 'fluo-users',
      role: 'reader',
      sub: 'service-overrides-user',
    });
  });

  it('prefers per-call expiresIn over a pre-existing payload exp claim', async () => {
    const service = createJwtService({
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await service.sign(
      {
        exp: now + 3600,
        role: 'reader',
        sub: 'service-overrides-user',
      },
      {
        expiresIn: 60,
      },
    );

    const decoded = service.decode(token);

    expect(decoded).toMatchObject({
      exp: expect.any(Number),
      role: 'reader',
      sub: 'service-overrides-user',
    });

    expect((decoded as { exp: number }).exp).toBeLessThanOrEqual(now + 60);
    expect((decoded as { exp: number }).exp).toBeGreaterThanOrEqual(now + 59);
  });

  it('decodes payload without signature verification', async () => {
    const service = createJwtService({
      algorithms: ['HS256'],
      issuer: 'jwt-service-tests',
      secret: 'service-secret',
    });
    const token = await service.sign({ sub: 'decoded-user' });

    expect(service.decode(token)).toMatchObject({ sub: 'decoded-user' });
    expect(service.decode('invalid-token')).toBeNull();
  });
});
