import { Inject } from '@fluojs/core';
import { Controller, Get, Post, RequestDto, type RequestContext } from '@fluojs/http';
import { RequireScopes, UseAuth } from '@fluojs/passport';

import { LoginDto } from './login.dto';
import { AuthService } from './auth.service';

@Inject(AuthService)
@Controller('/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/token')
  @RequestDto(LoginDto)
  issueToken(dto: LoginDto) {
    return this.authService.issueToken(dto.username);
  }
}

@Controller('/profile')
export class ProfileController {
  @Get('/')
  @UseAuth('jwt')
  @RequireScopes('profile:read')
  getProfile(_input: undefined, ctx: RequestContext) {
    return { user: ctx.principal };
  }
}
