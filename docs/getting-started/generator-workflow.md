# generator workflow

<p><strong><kbd>English</kbd></strong> <a href="./generator-workflow.ko.md"><kbd>한국어</kbd></a></p>

Eliminate manual boilerplate and maintain a consistent project structure using the fluo CLI. The generators create real fluo building blocks that follow the framework's module-first conventions.

### who this is for
Developers who want to stay productive by automating the creation of modules, controllers, and services while ensuring architectural consistency.

### 1. generating a complete feature module
A **module** is the primary unit of organization in fluo. One command gives you a clean module entry point, and you can add the remaining pieces with focused generators.

```sh
fluo g module catalog
```

This creates the following structure:

```
src/
└── catalog/
    └── catalog.module.ts
```

The generated module file looks like this:

```ts
import { Module } from '@fluojs/core';

@Module({
  controllers: [],
  providers: [],
})
export class CatalogModule {}
```

From here, you add controllers, services, and other building blocks as the feature grows.

### 2. precise component generation
Need to add a single building block to an existing feature? Use granular generators.

```sh
fluo g controller catalog
fluo g service catalog
```

After running both, your feature directory looks like this:

```
src/
└── catalog/
    ├── catalog.module.ts
    ├── catalog.controller.ts
    └── catalog.service.ts
```

The generated controller follows the standard `@Inject` + `@Controller` pattern:

```ts
import { Inject } from '@fluojs/core';
import { Controller } from '@fluojs/http';

import { CatalogService } from './catalog.service';

@Inject(CatalogService)
@Controller('/catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}
}
```

All available generators:

| command | what it creates |
| :--- | :--- |
| `fluo g module name` | Module definition with `@Module` decorator |
| `fluo g controller name` | HTTP controller with `@Controller` and `@Inject` |
| `fluo g service name` | Business logic service class |
| `fluo g repo name` | Data repository pattern class |

### 3. flexible output paths
By default, the CLI targets `src/`. Use the `--target-directory` (or `-o`) flag to align with your project's directory structure.

```sh
fluo g module auth --target-directory src/shared
```

This creates `src/shared/auth/auth.module.ts` instead of `src/auth/auth.module.ts`.

### 4. safe execution with dry runs
Preview exactly which files will be modified or created before committing to the change.

```sh
fluo g module shop --dry-run
```

Output shows the planned operations without touching the filesystem, so you can verify paths and names before generating.

### 5. composing a full feature slice
In practice, you'll chain generators to build a complete feature. Here's the typical workflow for a new `orders` feature:

```sh
# 1. Create the module
fluo g module orders

# 2. Add a controller and service
fluo g controller orders
fluo g service orders

# 3. Add a repository for data access
fluo g repo orders
```

Result:

```
src/
└── orders/
    ├── orders.module.ts
    ├── orders.controller.ts
    ├── orders.service.ts
    └── orders.repo.ts
```

Then wire everything together in `orders.module.ts`:

```ts
import { Module } from '@fluojs/core';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepo } from './orders.repo';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepo],
  exports: [OrdersService],
})
export class OrdersModule {}
```

And import the module from your root `AppModule`:

```ts
import { Module } from '@fluojs/core';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [OrdersModule],
})
export class AppModule {}
```

### why use the CLI?
- **Zero Boilerplate**: Skip manual directory creation, repetitive file naming, and import setup.
- **Consistent Shape**: Generated files follow the naming and placement rules documented in fluo's reference docs.
- **Composable Workflow**: Start with a module, then add controllers, services, DTOs, events, or repositories as the feature grows.

### next steps
- **Implement Logic**: Now that your files are ready, follow the [First Feature Path](./first-feature-path.md) to add logic.
- **Verification**: Learn how to test your generated components in the [Testing Guide](../operations/testing-guide.md).
