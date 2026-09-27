import { Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { HealthModule } from '@fluojs/runtime';

@Controller('/floor')
class FloorController {
  @Get('/greeting')
  getGreeting(): { readonly framework: 'fluo'; readonly message: string } {
    return { framework: 'fluo', message: 'Hello from the Node 24.0.0 runtime floor' };
  }
}

@Module({
  imports: [HealthModule.forRoot()],
  controllers: [FloorController],
})
export class AppModule {}
