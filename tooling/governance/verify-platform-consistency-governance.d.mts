export interface DirectProcessEnvViolation {
  excerpt: string;
  line: number;
  path: string;
}

export interface NodeGlobalBufferViolation {
  excerpt: string;
  line: number;
  path: string;
}

export function isGovernedPackageSourcePath(relativePath: string): boolean;
export function collectDirectProcessEnvViolations(
  relativePaths: readonly string[],
  readSource: (relativePath: string) => string,
): DirectProcessEnvViolation[];
export function collectNodeGlobalBufferViolations(
  relativePaths: readonly string[],
  readSource: (relativePath: string) => string,
): NodeGlobalBufferViolation[];
export function parsePackageNamesFromFamilyTable(markdown: string, sectionTitle: string): string[];
export function enforceNoDirectProcessEnvInOrdinaryPackageSource(
  relativePaths?: readonly string[],
  readSource?: (relativePath: string) => string,
): void;
export function enforceNoNodeGlobalBufferInDenoAndCloudflareWorkerServices(
  relativePaths?: readonly string[],
  readSource?: (relativePath: string) => string,
): void;
export function enforceReactClientSubpathContract(): void;
export function enforceReactPageCatalogContract(readText?: (relativePath: string) => string): void;
export function enforceReactPageMetadataIdentityContract(): void;
export function enforceReactRscGraduationEvidenceUpdates(
  changedFiles: readonly string[],
  readText?: (relativePath: string) => string,
): void;
export function enforceReactRscGraduationGovernance(
  changedFiles: readonly string[],
  readText?: (relativePath: string) => string,
): void;
export function enforceReactRscGraduationPolicy(readText?: (relativePath: string) => string): void;
export function enforceReactServerFunctionContract(): void;
export function enforceHttpRuntimeCancellationAndContextIsolation(): void;
export function enforceHttpCatchAllRouteGrammarDecision(): void;
export function enforceHttpCustomMethodContract(): void;
export function isSupportedNodeListenerVersion(version: string): boolean;
export function enforcePlatformFastifyEngineDocumentation(
  readText?: (relativePath: string) => string,
): void;
export function enforceCloudflareWorkersLifecycleDocsSync(
  readText?: (relativePath: string) => string,
): void;
export function enforceSerializerResponseOwnershipDocsSync(
  readText?: (relativePath: string) => string,
): void;
export function enforceExpressRuntimeMigrationDocsSync(
  readText?: (relativePath: string) => string,
): void;
export function enforcePlatformShellLifecycleContract(
  readText?: (relativePath: string) => string,
): void;
export function enforcePassportJsBridgeNestjsMigration(
  readText?: (relativePath: string) => string,
): void;
export function enforceEmailLifecycleDocsContract(
  readText?: (relativePath: string) => string,
): void;
export function enforceJwtAsyncRegistrationContract(
  readText?: (relativePath: string) => string,
): void;
export function enforceGraphqlRuntimeBoundaryDiscoverability(): void;
export function enforceMicroservicesSafetyGuidanceParity(): void;
export function enforceMicroservicesSafetyRuntimeEvidence(): void;
export function enforceQueueWorkerOwnershipContract(
  readText?: (relativePath: string) => string,
): void;
export function main(): void;
