# first feature path

<p><strong><kbd>English</kbd></strong> <a href="./first-feature-path.ko.md"><kbd>한국어</kbd></a></p>

Move from a basic starter to building real-world logic. Konekti encourages a **slice-based architecture**, where related logic is grouped by feature rather than technical layer.

### who this is for
Developers who have completed the [Quick Start](./quick-start.md) and are ready to implement their first API endpoint.

### 1. define the feature boundary
Create a dedicated directory for your feature slice. Let's build a "catalog" service.

```sh
mkdir -p src/catalog
```

### 2. create a provider
Providers handle business logic or data access. In Konekti, dependencies are declared explicitly using the `@Inject` decorator on the class.

```ts
// src/catalog/product.service.ts
import { Scope } from '@konekti/core';

@Scope('singleton')
export class ProductService {
  getProducts() {
    return [{ id: 1, name: 'Standard Decorator', price: 99 }];
  }
}
```

### 3. create a controller
Controllers define the HTTP interface. Note how we explicitly `@Inject` the `ProductService`.

```ts
// src/catalog/product.controller.ts
import { Controller, Get } from '@konekti/http';
import { Inject } from '@konekti/core';
import { ProductService } from './product.service';

@Controller('/products')
@Inject([ProductService])
export class ProductController {
  constructor(private readonly service: ProductService) {}

  @Get('/')
  list() {
    return this.service.getProducts();
  }
}
```

### 4. bundle into a module
Modules are the building blocks of the Konekti application graph.

```ts
// src/catalog/catalog.module.ts
import { Module } from '@konekti/core';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';

@Module({
  providers: [ProductService],
  controllers: [ProductController],
  exports: [ProductService], // Optional: Export if other modules need this service
})
export class CatalogModule {}
```

### 5. mount to the application
Import your new module into the root `AppModule` to activate it.

```ts
// src/app.module.ts
import { Module } from '@konekti/core';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [CatalogModule],
})
export class AppModule {}
```

### verify the flow
Check your new endpoint while the dev server is running:
```sh
curl http://localhost:3000/products
```
*Expect: `[{"id":1,"name":"Standard Decorator","price":99}]`*

### why this workflow?
- **Explicit Wiring**: `@Inject([ProductService])` makes it immediately clear what a class depends on without hidden metadata magic.
- **Slice Ownership**: All logic related to "Catalog" lives in one place, making it easier to maintain and scale.
- **Standard-Ready**: This entire flow uses native TypeScript decorators that align with future ECMAScript standards.

### next steps
- **Automate the Boilerplate**: Use `konekti g module catalog` to generate this entire structure in seconds. See [Generator Workflow](./generator-workflow.md).
- **Add Validation**: Learn how to use DTOs and `@konekti/validation` for secure, type-safe inputs.
