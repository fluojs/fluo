import { defineModule } from '@fluojs/runtime';
import { Path, ReactModule, Router } from '@fluojs/react';

@Router('/products')
class ProductRouter {
  @Path('/:productId')
  show(): void {}
}

/** Fixture application module used by build-less React route inspection tests. */
export class AppModule {}

defineModule(AppModule, {
  imports: [ReactModule.forRoot({ controllers: [ProductRouter] })],
});
