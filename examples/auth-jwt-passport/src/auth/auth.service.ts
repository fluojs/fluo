import { Inject } from '@fluojs/core';
import { JwtService, RefreshTokenService } from '@fluojs/jwt';

@Inject(JwtService, RefreshTokenService)
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async issueToken(username: string): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwt.sign(
      { roles: ['user'], scopes: ['profile:read'] },
      { subject: username },
    );
    const refreshToken = await this.refreshTokens.issueRefreshToken(username);

    return { accessToken, refreshToken };
  }
}
