import { describe, expect, it } from 'vitest';

import { JwtService } from './service.js';
import { DefaultJwtSigner } from './signer.js';
import type { JwtVerifierOptions } from './types.js';
import { DefaultJwtVerifier } from './verifier.js';

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
        audience: 'konekti-users',
        expiresIn: '60s',
        issuer: 'jwt-service-tests',
        subject: 'service-overrides-user',
      },
    );

    await expect(
      service.verify<{ aud?: string; role?: string; sub?: string }>(token, {
        audience: 'konekti-users',
        issuer: 'jwt-service-tests',
      }),
    ).resolves.toMatchObject({
      aud: 'konekti-users',
      role: 'reader',
      sub: 'service-overrides-user',
    });
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
