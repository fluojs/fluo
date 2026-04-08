# generator workflow

<p><strong><kbd>English</kbd></strong> <a href="./generator-workflow.ko.md"><kbd>한국어</kbd></a></p>

Eliminate manual boilerplate and maintain a consistent project structure using the Konekti CLI. The generators create real Konekti building blocks that follow the framework's module-first conventions.

### who this is for
Developers who want to stay productive by automating the creation of modules, controllers, and services while ensuring architectural consistency.

### 1. generating a complete feature module
A **module** is the primary unit of organization in Konekti. One command gives you a clean module entry point, and you can add the remaining pieces with focused generators.

```sh
konekti g module catalog
```

**What happens?**
The CLI creates a `src/catalog/` directory with a `catalog.module.ts` entry point that you can extend with additional generated parts.

### 2. precise component generation
Need to add a single building block to an existing feature? Use granular generators.

- **`konekti g controller name`**: Scaffolds an HTTP controller.
- **`konekti g service name`**: Scaffolds a business logic service.
- **`konekti g repo name`**: Scaffolds a data repository pattern.
- **`konekti g module name`**: Scaffolds a clean module definition.

### 3. flexible output paths
By default, the CLI targets `src/`. Use the `--target-directory` (or `-o`) flag to align with your project's directory structure.

```sh
konekti g module auth --target-directory src/shared
```

### 4. safe execution with dry runs
Preview exactly which files will be modified or created before committing to the change.

```sh
konekti g module shop --dry-run
```

### why use the CLI?
- **Zero Boilerplate**: Skip manual directory creation, repetitive file naming, and import setup.
- **Consistent Shape**: Generated files follow the naming and placement rules documented in Konekti's reference docs.
- **Composable Workflow**: Start with a module, then add controllers, services, DTOs, events, or repositories as the feature grows.

### next steps
- **Implement Logic**: Now that your files are ready, follow the [First Feature Path](./first-feature-path.md) to add logic.
- **Verification**: Learn how to test your generated components in the [Testing Guide](../operations/testing-guide.md).
