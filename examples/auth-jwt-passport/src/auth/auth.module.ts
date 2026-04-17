import { Module } from '@fluojs/core';
import { createJwtCoreProviders } from '@fluojs/jwt';
import { PassportModule } from '@fluojs/passport';

import { AuthController, ProfileController } from './auth.controller';
import { AuthService } from './auth.service';
import { BearerJwtStrategy } from './bearer.strategy';

@Module({
  controllers: [AuthController, ProfileController],
  imports: [
    PassportModule.forRoot(
      { defaultStrategy: 'jwt' },
      [{ name: 'jwt', token: BearerJwtStrategy }],
    ),
  ],
  providers: [
    AuthService,
    BearerJwtStrategy,
    ...createJwtCoreProviders({
      accessTokenTtlSeconds: 3600,
      algorithms: ['HS256'],
      audience: 'fluo-auth-example-clients',
      issuer: 'fluo-auth-example',
      secret: 'fluo-auth-example-secret',
    }),
  ],
})
export class AuthModule {}
