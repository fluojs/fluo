import { Module } from '@fluojs/core';
import { JwtModule } from '@fluojs/jwt';
import {
  BEARER_JWT_STRATEGY_NAME,
  BearerJwtStrategy,
  createBearerJwtStrategyRegistration,
  PassportModule,
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
      issuer: 'fluo-auth-example',
      secret: 'fluo-auth-example-secret',
    }),
    PassportModule.forRoot(
      { defaultStrategy: BEARER_JWT_STRATEGY_NAME },
      [createBearerJwtStrategyRegistration()],
    ),
  ],
  providers: [
    AuthService,
    BearerJwtStrategy,
  ],
})
export class AuthModule {}
