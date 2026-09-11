import { Inject } from '@fluojs/core';
import { JwtService } from '@fluojs/jwt';

@Inject(JwtService)
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async issueToken(username: string): Promise<{ accessToken: string }> {
    const accessToken = await this.jwt.sign(
      { roles: ['user'], scopes: ['profile:read'] },
      { subject: username },
    );

    return { accessToken };
  }
}
