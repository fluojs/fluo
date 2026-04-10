import { Inject } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';

import { HelloService } from './hello.service';

@Inject(HelloService)
@Controller('/hello')
export class HelloController {
  constructor(private readonly helloService: HelloService) {}

  @Get('/')
  greet(): { message: string } {
    return this.helloService.greet('World');
  }
}
