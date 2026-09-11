import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
  createRefreshTokenStrategyRegistration,
  PassportModule,
  REFRESH_TOKEN_STRATEGY_NAME,
  RefreshTokenModule,
} from '@fluojs/passport';

import { AuthController, ProfileController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController, ProfileController],
  imports: [
    JwtModule.forRoot({
      accessTokenTtlSeconds: 3600,
      algorithms: ['HS256'],
      audience: 'fluo-auth-example-clients',
      global: true,
      issuer: 'fluo-auth-example',
      refreshToken: {
        expiresInSeconds: 604800,
        rotation: true,
        secret: 'fluo-auth-example-refresh-secret',
        store: 'memory',
      },
      secret: 'fluo-auth-example-secret',
    }),
    RefreshTokenModule.forRoot(),
    PassportModule.forRoot(
      { defaultStrategy: BEARER_JWT_STRATEGY_NAME },
      [createBearerJwtStrategyRegistration(), createRefreshTokenStrategyRegistration()],
    ),
  ],
  providers: [
    AuthService,
    BearerJwtStrategy,
  ],
})
export class AuthModule {}
