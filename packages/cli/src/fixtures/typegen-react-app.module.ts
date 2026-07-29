import { defineModule } from '@fluojs/runtime';
import { Path, ReactModule, Router } from '@fluojs/react';

@Router('/products')
class ProductRouter {
  @Path('/')
  index(): void {}

  @Path('/:productId')
  show(): void {}
}

export class AppModule {}

defineModule(AppModule, {
  imports: [ReactModule.forRoot({ controllers: [ProductRouter] })],
});
