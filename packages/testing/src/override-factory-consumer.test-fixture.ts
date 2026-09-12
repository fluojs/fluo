import { Test } from '@fluojs/testing';

class Config {
  readonly environment = 'test';
}

class Service {
  constructor(readonly config: Config) {}
}

class AppModule {}

void Test.createTestingModule({ rootModule: AppModule })
  .overrideProvider(Service)
  .useFactory((config: Config) => new Service(config), [Config]);
