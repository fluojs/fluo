import { Module } from '@fluojs/core';
import { createJwtCoreProviders } from '@fluojs/jwt';
import { createPassportProviders } from '@fluojs/passport';

import { AuthController, ProfileController } from './auth.controller';
import { AuthService } from './auth.service';
import { BearerJwtStrategy } from './bearer.strategy';

@Module({
  controllers: [AuthController, ProfileController],
  providers: [
    AuthService,
    BearerJwtStrategy,
    ...createJwtCoreProviders({
      accessTokenTtlSeconds: 3600,
      algorithms: ['HS256'],
      audience: 'konekti-auth-example-clients',
      issuer: 'konekti-auth-example',
      secret: 'konekti-auth-example-secret',
    }),
    ...createPassportProviders(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: BearerJwtStrategy }],
    ),
  ],
})
export class AuthModule {}
