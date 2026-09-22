import { Inject, Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';

/**
 * Fixtures for the @fluojs/testing guide: one HTTP slice and one module with
 * an imported dependency, so overrides and module replacement are observable
 * through real resolution.
 */

export class GreetingRepository {
  findName(): string {
    return 'Fluo';
  }
}

@Inject(GreetingRepository)
@Controller('/greetings')
export class GreetingController {
  constructor(private readonly repository: GreetingRepository) {}

  @Get()
  greet(): string {
    return `Hello, ${this.repository.findName()}!`;
  }
}

@Module({
  controllers: [GreetingController],
  providers: [GreetingRepository],
})
export class TestingFixtureModule {}

export class StripeClient {
  charge(): string {
    return 'real';
  }
}

export class FakeStripeClient {
  charge(): string {
    return 'fake';
  }
}

@Module({
  providers: [StripeClient],
  exports: [StripeClient],
})
export class StripeModule {}

@Inject(StripeClient)
export class BillingService {
  constructor(private readonly client: StripeClient) {}

  charge(): string {
    return this.client.charge();
  }
}

@Module({
  providers: [{ provide: StripeClient, useClass: FakeStripeClient }],
  exports: [StripeClient],
})
export class FakeStripeModule {}

@Module({
  imports: [StripeModule],
  providers: [BillingService],
})
export class BillingModule {}
