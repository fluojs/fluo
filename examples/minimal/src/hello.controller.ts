import { Inject } from '@konekti/core';
import { Controller, Get } from '@konekti/http';

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
