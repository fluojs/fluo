import { releaseIntentDispositions, publicWorkspacePackageNames, workspacePackageManifests } from './release-intents.mjs';

export const publicPackageDependencyFields = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const releaseDisposition = releaseIntentDispositions.find((disposition) => disposition === 'release');
const downstreamEvaluateDisposition = releaseIntentDispositions.find(
  (disposition) => disposition === 'downstream-evaluate',
);

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function isPackagesWorkspaceManifest({ packageJsonPath }) {
  const pathParts = String(packageJsonPath).split(/[\\/]+/u);
  return pathParts.at(-1) === 'package.json' && pathParts.at(-3) === 'packages';
}

function publicPackageManifestRecords(packageManifests) {
  const packageSurfaceManifests = packageManifests.filter(isPackagesWorkspaceManifest);
  const publicPackageSet = new Set(publicWorkspacePackageNames(packageSurfaceManifests));

  return packageSurfaceManifests.filter(({ manifest }) => publicPackageSet.has(manifest.name));
}

function dependencyNamesForManifest(manifest, publicPackageSet) {
  const dependencyNames = new Set();

  for (const field of publicPackageDependencyFields) {
    const dependencies = manifest[field];

    if (!dependencies || typeof dependencies !== 'object') {
      continue;
    }

    for (const dependencyName of Object.keys(dependencies)) {
      if (dependencyName !== manifest.name && publicPackageSet.has(dependencyName)) {
        dependencyNames.add(dependencyName);
      }
    }
  }

  return sorted(dependencyNames);
}

function graphEntriesToObject(graphEntries) {
  return Object.fromEntries(
    sorted(graphEntries.keys()).map((packageName) => [packageName, sorted(graphEntries.get(packageName) ?? [])]),
  );
}

export function buildPublicPackageDependencyGraph(packageManifests = workspacePackageManifests()) {
  const publicPackageManifests = publicPackageManifestRecords(packageManifests);
  const publicPackageNames = publicPackageManifests.map(({ manifest }) => manifest.name).sort((left, right) => left.localeCompare(right));
  const publicPackageSet = new Set(publicPackageNames);
  const dependenciesByPackage = new Map(publicPackageNames.map((packageName) => [packageName, []]));
  const dependentsByPackage = new Map(publicPackageNames.map((packageName) => [packageName, []]));

  for (const { manifest } of publicPackageManifests) {
    const dependencyNames = dependencyNamesForManifest(manifest, publicPackageSet);
    dependenciesByPackage.set(manifest.name, dependencyNames);

    for (const dependencyName of dependencyNames) {
      dependentsByPackage.get(dependencyName)?.push(manifest.name);
    }
  }

  return {
    dependenciesByPackage: graphEntriesToObject(dependenciesByPackage),
    dependentsByPackage: graphEntriesToObject(dependentsByPackage),
    publicPackageNames,
  };
}

function normalizeReleasedPackages(releasedPackageNames) {
  if (!Array.isArray(releasedPackageNames)) {
    throw new Error('Dependency impact analysis failed: releasedPackageNames must be an array.');
  }

  return sorted(new Set(releasedPackageNames));
}

export function expandPublicPackageDependencyImpact(releasedPackageNames, options = {}) {
  const graph = options.graph ?? buildPublicPackageDependencyGraph(options.packageManifests);
  const publicPackageSet = new Set(graph.publicPackageNames);
  const releasePackageNames = normalizeReleasedPackages(releasedPackageNames);
  const releasePackageSet = new Set(releasePackageNames);
  const unknownPackages = releasePackageNames.filter((packageName) => !publicPackageSet.has(packageName));

  if (unknownPackages.length > 0) {
    throw new Error(
      `Dependency impact analysis failed: unknown public workspace package(s): ${unknownPackages.join(', ')}.`,
    );
  }

  const downstreamEvaluatePackageSet = new Set();
  const queue = [...releasePackageNames];

  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index];
    const dependents = graph.dependentsByPackage[packageName] ?? [];

    for (const dependentName of dependents) {
      if (releasePackageSet.has(dependentName) || downstreamEvaluatePackageSet.has(dependentName)) {
        continue;
      }

      downstreamEvaluatePackageSet.add(dependentName);
      queue.push(dependentName);
    }
  }

  return sorted([...releasePackageSet, ...downstreamEvaluatePackageSet]).map((packageName) => ({
    disposition: releasePackageSet.has(packageName) ? releaseDisposition : downstreamEvaluateDisposition,
    package: packageName,
  }));
}
