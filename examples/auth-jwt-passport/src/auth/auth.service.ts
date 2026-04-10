import { Inject } from '@konekti/core';
import { DefaultJwtSigner } from '@konekti/jwt';

@Inject(DefaultJwtSigner)
export class AuthService {
  constructor(private readonly signer: DefaultJwtSigner) {}

  async issueToken(username: string): Promise<{ accessToken: string }> {
    const accessToken = await this.signer.signAccessToken({
      sub: username,
      roles: ['user'],
      scopes: ['profile:read'],
    });

    return { accessToken };
  }
}
