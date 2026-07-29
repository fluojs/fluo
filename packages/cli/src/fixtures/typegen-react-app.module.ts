import { defineModule } from '@fluojs/runtime';
import { Path, ReactModule, Router } from '@fluojs/react';

@Router('/products')
class ProductRouter {
  @Path('/')
  index(): void {}

  @Path('/:productId')
  show(): void {}
}

/** Fixture root module used by CLI React page typegen tests. */
export class AppModule {}

defineModule(AppModule, {
  imports: [ReactModule.forRoot({ controllers: [ProductRouter] })],
});
