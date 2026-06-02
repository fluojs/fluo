export type BenchmarkEnvironment = Readonly<Record<string, string | undefined>>;

export interface BenchmarkTargetConfig<TName extends string = string> {
  readonly args: readonly string[];
  readonly command: string;
  readonly label: string;
  readonly name: TName;
  readonly port: number;
}

export type FluoSource = 'published' | 'local-tarball';

export interface BenchmarkOptions<
  TName extends string = string,
  TTarget extends BenchmarkTargetConfig<TName> = BenchmarkTargetConfig<TName>,
> {
  readonly artifactLabel: string;
  readonly fluoSource: FluoSource;
  readonly targets: readonly TTarget[];
}

export interface BenchmarkMetadata<TName extends string = string> {
  readonly artifactLabel: string;
  readonly fluoSource: FluoSource;
  readonly selectedTargets: readonly TName[];
}

export function selectTargetConfigs<
  TName extends string,
  TTarget extends BenchmarkTargetConfig<TName> = BenchmarkTargetConfig<TName>,
>(
  env: BenchmarkEnvironment,
  targets: readonly TTarget[],
): readonly TTarget[] {
  const filter = readCommaList(env.BENCH_TARGETS);
  if (filter.length === 0) {
    return targets;
  }

  const selectedNames = new Set<string>(filter);
  const knownNames = new Set<string>(targets.map((target) => target.name));
  const unknownNames = filter.filter((name) => !knownNames.has(name));
  if (unknownNames.length > 0) {
    throw new Error(`Unknown BENCH_TARGETS entries: ${unknownNames.join(', ')}`);
  }

  const selected = targets.filter((target) => selectedNames.has(target.name));
  if (selected.length === 0) {
    throw new Error('BENCH_TARGETS did not select any targets.');
  }

  return selected;
}

export function readFluoSource(env: BenchmarkEnvironment): FluoSource {
  const raw = env.BENCH_FLUO_SOURCE;
  if (raw === undefined || raw.trim() === '') {
    return 'published';
  }

  if (raw === 'published' || raw === 'local-tarball') {
    return raw;
  }

  throw new Error(`BENCH_FLUO_SOURCE must be one of published, local-tarball, got ${raw}`);
}

export function readArtifactLabel(env: BenchmarkEnvironment): string {
  const raw = env.BENCH_ARTIFACT_LABEL;
  if (raw === undefined || raw.trim() === '') {
    return 'measurement';
  }

  return raw;
}

export function resolveBenchmarkOptions<
  TName extends string,
  TTarget extends BenchmarkTargetConfig<TName>,
>(
  env: BenchmarkEnvironment,
  targets: readonly TTarget[],
): BenchmarkOptions<TName, TTarget> {
  return {
    artifactLabel: readArtifactLabel(env),
    fluoSource: readFluoSource(env),
    targets: selectTargetConfigs(env, targets),
  };
}

export function createBenchmarkMetadata<TName extends string>(
  options: BenchmarkOptions<TName>,
): BenchmarkMetadata<TName> {
  return {
    artifactLabel: options.artifactLabel,
    fluoSource: options.fluoSource,
    selectedTargets: options.targets.map((target) => target.name),
  };
}

function readCommaList(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }

  return raw.split(',').map((name) => name.trim()).filter((name) => name.length > 0);
}
