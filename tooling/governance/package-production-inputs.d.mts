export interface ProductionInput {
  readonly path: string;
  readonly excludeTests: boolean;
  readonly excludeTestFixtures?: boolean;
  readonly excludeDirectories?: readonly string[];
}
export interface NonProductionInput {
  readonly path: string;
  readonly testsOnly: boolean;
}
export interface DeclaredPackageInputs {
  readonly name: string;
  readonly owner: string;
  readonly inputs: readonly ProductionInput[];
  readonly nonProduction: readonly NonProductionInput[];
}
export interface DeclaredProducer {
  readonly id: string;
  readonly owner: string;
  readonly consumers: readonly string[];
  readonly inputs: readonly ProductionInput[];
  readonly definitions: Readonly<Record<string, string>>;
  readonly definitionScopes?: readonly string[];
}
export interface ProductionInputDeclaration {
  readonly version: 1;
  readonly owner: string;
  readonly packages: readonly DeclaredPackageInputs[];
  readonly producers: readonly DeclaredProducer[];
  readonly manifests: Readonly<Record<string, string>>;
  readonly nonProduction: readonly NonProductionInput[];
}
export interface ProductionInputSnapshot {
  readonly declaration: ProductionInputDeclaration;
  readonly manifests: readonly {
    readonly packageJsonPath: string;
    readonly manifest: Readonly<Record<string, unknown>>;
  }[];
  readonly files: readonly string[];
}
export const productionInputsPath: string;
export function productionManifestDigest(manifest: Readonly<Record<string, unknown>>): string;
export function validatePackageProductionInputs(source: {
  readonly files: readonly string[];
  readonly readText: (path: string) => string;
  readonly readBytes?: (path: string) => Uint8Array;
}): ProductionInputSnapshot;
export function assertProductionInputsPreserved(previous: ProductionInputSnapshot, current: ProductionInputSnapshot): void;
export function consumerVisibleFromInputs(file: string, snapshot: ProductionInputSnapshot): boolean;
export function readPackageProductionInputs(root?: string, ref?: string): ProductionInputSnapshot;
export function productionInputClassifier(root?: string, head?: string, base?: string): (file: string) => boolean;
export function enforcePackageProductionInputs(root?: string, ref?: string): ProductionInputSnapshot;
