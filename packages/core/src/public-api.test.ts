import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as coreInternalApi from './internal.js';
import * as coreRequestPipelineApi from './request-pipeline.js';
import type {
  AsyncModuleOptions,
  Constructor,
  FluoErrorOptions,
  ForwardRefToken,
  InjectionToken,
  MaybePromise,
  MetadataPropertyKey,
  MetadataSource,
  OptionalInjectToken,
  Token,
} from './index.js';
import type {
  ClassDiMetadata,
  ClassValidationRule,
  ConditionalFieldValidator,
  ControllerMetadata,
  CustomClassValidator,
  CustomFieldValidationContext,
  CustomFieldValidator,
  DtoBindingSchemaEntry,
  DtoFieldBindingMetadata,
  DtoFieldValidationRule,
  DtoValidationSchemaEntry,
  InjectionMetadata,
  InjectionSchemaEntry,
  MetadataCollection,
  ModuleMetadata,
  RouteHeader,
  RouteMetadata,
  RouteRedirect,
  ValidationDecoratorOptions,
  ValidationIssueMetadata,
  ValidationRuleResult,
} from './internal.js';

type RootBarrelTypeExports = {
  asyncModuleOptions: AsyncModuleOptions<unknown>;
  constructor: Constructor;
  errorOptions: FluoErrorOptions;
  forwardRefToken: ForwardRefToken;
  injectionToken: InjectionToken;
  maybePromise: MaybePromise<unknown>;
  metadataPropertyKey: MetadataPropertyKey;
  metadataSource: MetadataSource;
  optionalInjectToken: OptionalInjectToken;
  token: Token;
};

type InternalSubpathTypeExports = {
  classDiMetadata: ClassDiMetadata;
  classValidationRule: ClassValidationRule;
  conditionalFieldValidator: ConditionalFieldValidator;
  controllerMetadata: ControllerMetadata;
  customClassValidator: CustomClassValidator;
  customFieldValidationContext: CustomFieldValidationContext;
  customFieldValidator: CustomFieldValidator;
  dtoBindingSchemaEntry: DtoBindingSchemaEntry;
  dtoFieldBindingMetadata: DtoFieldBindingMetadata;
  dtoFieldValidationRule: DtoFieldValidationRule;
  dtoValidationSchemaEntry: DtoValidationSchemaEntry;
  injectionMetadata: InjectionMetadata;
  injectionSchemaEntry: InjectionSchemaEntry;
  metadataCollection: MetadataCollection;
  moduleMetadata: ModuleMetadata;
  routeHeader: RouteHeader;
  routeMetadata: RouteMetadata;
  routeRedirect: RouteRedirect;
  validationDecoratorOptions: ValidationDecoratorOptions;
  validationIssueMetadata: ValidationIssueMetadata;
  validationRuleResult: ValidationRuleResult;
};

const documentedRootRuntimeExports = [
  'Module',
  'Global',
  'Inject',
  'Scope',
  'FluoError',
  'InvariantError',
  'FluoCodeError',
  'formatTokenName',
  'ensureMetadataSymbol',
  'getModuleMetadata',
] as const;

const documentedInternalRuntimeExports = [
  'appendClassValidationRule',
  'appendDtoFieldValidationRule',
  'cloneWithFallback',
  'defineClassDiMetadata',
  'defineControllerMetadata',
  'defineDtoFieldBindingMetadata',
  'defineInjectionMetadata',
  'defineModuleMetadata',
  'defineRouteMetadata',
  'ensureMetadataSymbol',
  'ensureSymbolMetadataPolyfill',
  'fallbackClone',
  'getClassDiMetadata',
  'getClassDiMetadataVersion',
  'getClassValidationRules',
  'getControllerMetadata',
  'getDtoBindingSchema',
  'getDtoFieldBindingMetadata',
  'getDtoFieldValidationRules',
  'getDtoValidationSchema',
  'getInheritedClassDiMetadata',
  'getInjectionSchema',
  'getModuleMetadata',
  'getModuleMetadataVersion',
  'getOwnClassDiMetadata',
  'getOwnStandardConstructorMetadataBag',
  'getRouteMetadata',
  'getStandardConstructorMetadataBag',
  'getStandardMetadataBag',
  'metadataKeys',
  'metadataSymbol',
] as const;

const packageRoot = new URL('..', import.meta.url);
const packageRootPath = fileURLToPath(packageRoot);

function buildCorePackage(): void {
  const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', 'build'], {
    cwd: packageRootPath,
    encoding: 'utf8',
  });

  expect(result.status, [result.stdout, result.stderr].filter(Boolean).join('\n')).toBe(0);
}

function probeRootImportSymbolMetadata(): void {
  const script = `
    const describeDescriptor = (descriptor) => descriptor
      ? JSON.stringify({
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          hasGetter: typeof descriptor.get === 'function',
          hasSetter: typeof descriptor.set === 'function',
          writable: Object.hasOwn(descriptor, 'writable') ? descriptor.writable : null,
        })
      : 'missing';
    const beforeDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const beforeMetadata = Symbol.metadata;
    const corePublicApi = await import('@fluojs/core');
    const afterDescriptor = Object.getOwnPropertyDescriptor(Symbol, 'metadata');
    const afterMetadata = Symbol.metadata;
    const failures = [];

    if (typeof corePublicApi.ensureMetadataSymbol !== 'function') {
      failures.push('root package did not expose ensureMetadataSymbol');
    }
    if (describeDescriptor(afterDescriptor) !== describeDescriptor(beforeDescriptor)) {
      failures.push('root package import changed the Symbol.metadata descriptor');
    }
    if (beforeMetadata !== afterMetadata) {
      failures.push('root package import changed the Symbol.metadata value');
    }

    if (failures.length > 0) {
      console.error(failures.join('\\n'));
      process.exit(1);
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: packageRootPath,
    encoding: 'utf8',
  });

  expect(result.status, [result.stdout, result.stderr].filter(Boolean).join('\n')).toBe(0);
}

describe('@fluojs/core public API surface', () => {
  it('keeps cold root-package import side-effect free for Symbol.metadata', () => {
    buildCorePackage();

    probeRootImportSymbolMetadata();
  }, 300_000);

  it('keeps documented root-barrel exports for application code', async () => {
    const corePublicApi = await import('./index.js');

    for (const exportName of documentedRootRuntimeExports) {
      expect(corePublicApi).toHaveProperty(exportName);
    }
  });

  it('keeps documented root-barrel type exports for application code', () => {
    const rootTypeExport: keyof RootBarrelTypeExports = 'asyncModuleOptions';

    expect(rootTypeExport).toBe('asyncModuleOptions');
  });

  it('does not expose internal metadata writers or non-module readers on the root barrel', async () => {
    const corePublicApi = await import('./index.js');

    expect(corePublicApi).not.toHaveProperty('defineModuleMetadata');
    expect(corePublicApi).not.toHaveProperty('getModuleMetadataVersion');
    expect(corePublicApi).not.toHaveProperty('defineControllerMetadata');
    expect(corePublicApi).not.toHaveProperty('getControllerMetadata');
    expect(corePublicApi).not.toHaveProperty('getClassDiMetadata');
    expect(corePublicApi).not.toHaveProperty('getClassDiMetadataVersion');
    expect(corePublicApi).not.toHaveProperty('metadataSymbol');
    expect(corePublicApi).not.toHaveProperty('ensureSymbolMetadataPolyfill');
    expect(corePublicApi).not.toHaveProperty('cloneWithFallback');
    expect(corePublicApi).not.toHaveProperty('fallbackClone');
    expect(corePublicApi).not.toHaveProperty('forwardRef');
    expect(corePublicApi).not.toHaveProperty('optional');
  });

  it('keeps internal metadata helpers available from the internal subpath', () => {
    for (const exportName of documentedInternalRuntimeExports) {
      expect(coreInternalApi).toHaveProperty(exportName);
    }
  });

  it('keeps internal subpath type exports available for sibling packages', () => {
    const internalTypeExport: keyof InternalSubpathTypeExports = 'moduleMetadata';

    expect(internalTypeExport).toBe('moduleMetadata');
  });

  it('keeps request-pipeline metadata helpers available from the documented integration seam', () => {
    expect(coreRequestPipelineApi).toHaveProperty('ensureRequestPipelineMetadataSymbol');
    expect(coreRequestPipelineApi).toHaveProperty('getRequestPipelineMetadataBag');
    expect(coreRequestPipelineApi).toHaveProperty('getOwnConstructorRequestPipelineMetadataBag');
    expect(coreRequestPipelineApi).toHaveProperty('defineDtoFieldBindingMetadata');
    expect(coreRequestPipelineApi).toHaveProperty('getDtoFieldBindingMetadata');
    expect(coreRequestPipelineApi).toHaveProperty('getDtoBindingSchema');
    expect(coreRequestPipelineApi).toHaveProperty('getDtoValidationSchema');
    expect(coreRequestPipelineApi).not.toHaveProperty('defineModuleMetadata');
    expect(coreRequestPipelineApi).not.toHaveProperty('defineControllerMetadata');
    expect(coreRequestPipelineApi).not.toHaveProperty('getClassDiMetadata');
    expect(coreRequestPipelineApi).not.toHaveProperty('cloneWithFallback');
  });

  it('documents that forwardRef and optional wrappers come from @fluojs/di', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    expect(readme).toContain("import { forwardRef, optional } from '@fluojs/di';");
    expect(readme).toContain('@fluojs/core` only exports the shared wrapper types');
  });
});
