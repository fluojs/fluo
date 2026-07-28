import { Path, ReactModule, Router } from '@fluojs/react';
import { defineModule } from '@fluojs/runtime';

@Router('/products')
class ProductRouter {
  @Path('/:productId')
  show(): void {}
}

export class AppModule {}

defineModule(AppModule, {
  imports: [ReactModule.forRoot({ controllers: [ProductRouter] })],
});
