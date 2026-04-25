import { describe, expect, it } from 'vitest';
import { buildPublicPackageDependencyGraph, expandPublicPackageDependencyImpact } from './dependency-impact.mjs';

function packageManifest(
  name: string,
  options: {
    dependencies?: Record<string, string>;
    directory?: string;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    private?: boolean;
    publishAccess?: string;
  } = {},
) {
  const packageDirectory = options.directory ?? `packages/${name.slice('@fluojs/'.length)}`;

  return {
    manifest: {
      name,
      private: options.private ?? false,
      publishConfig: { access: options.publishAccess ?? 'public' },
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
      ...(options.peerDependencies ? { peerDependencies: options.peerDependencies } : {}),
      ...(options.optionalDependencies ? { optionalDependencies: options.optionalDependencies } : {}),
    },
    packageJsonPath: `/repo/${packageDirectory}/package.json`,
  };
}

const runtimeCliStudioManifests = [
  packageManifest('@fluojs/cli', {
    dependencies: {
      '@fluojs/runtime': 'workspace:^',
    },
  }),
  packageManifest('@fluojs/runtime'),
  packageManifest('@fluojs/studio', {
    dependencies: {
      '@fluojs/runtime': 'workspace:^',
    },
  }),
];

describe('buildPublicPackageDependencyGraph', () => {
  it('excludes non-public, tooling, and example manifests from the public package graph', () => {
    const graph = buildPublicPackageDependencyGraph([
      ...runtimeCliStudioManifests,
      packageManifest('@fluojs/private-runtime-consumer', {
        dependencies: { '@fluojs/runtime': 'workspace:^' },
        private: true,
      }),
      packageManifest('@fluojs/tooling-runtime-consumer', {
        dependencies: { '@fluojs/runtime': 'workspace:^' },
        directory: 'tooling/runtime-consumer',
      }),
      packageManifest('@fluojs/example-runtime-consumer', {
        dependencies: { '@fluojs/runtime': 'workspace:^' },
        directory: 'examples/runtime-consumer',
      }),
      packageManifest('@fluojs/restricted-runtime-consumer', {
        dependencies: { '@fluojs/runtime': 'workspace:^' },
        publishAccess: 'restricted',
      }),
    ]);

    expect(graph.publicPackageNames).toEqual(['@fluojs/cli', '@fluojs/runtime', '@fluojs/studio']);
    expect(graph.dependentsByPackage['@fluojs/runtime']).toEqual(['@fluojs/cli', '@fluojs/studio']);
    expect(graph.dependentsByPackage).not.toHaveProperty('@fluojs/tooling-runtime-consumer');
    expect(graph.dependentsByPackage).not.toHaveProperty('@fluojs/example-runtime-consumer');
  });
});

describe('expandPublicPackageDependencyImpact', () => {
  it('marks CLI and Studio for downstream evaluation when Runtime is explicitly released', () => {
    expect(expandPublicPackageDependencyImpact(['@fluojs/runtime'], { packageManifests: runtimeCliStudioManifests })).toEqual([
      { disposition: 'downstream-evaluate', package: '@fluojs/cli' },
      { disposition: 'release', package: '@fluojs/runtime' },
      { disposition: 'downstream-evaluate', package: '@fluojs/studio' },
    ]);
  });

  it('does not expand a CLI leaf release to unrelated downstream packages', () => {
    expect(expandPublicPackageDependencyImpact(['@fluojs/cli'], { packageManifests: runtimeCliStudioManifests })).toEqual([
      { disposition: 'release', package: '@fluojs/cli' },
    ]);
  });

  it('keeps explicit releases as release and does not auto-release downstream dependents', () => {
    const impact = expandPublicPackageDependencyImpact(['@fluojs/runtime', '@fluojs/cli'], {
      packageManifests: runtimeCliStudioManifests,
    });

    expect(impact).toEqual([
      { disposition: 'release', package: '@fluojs/cli' },
      { disposition: 'release', package: '@fluojs/runtime' },
      { disposition: 'downstream-evaluate', package: '@fluojs/studio' },
    ]);
    expect(impact.filter((entry) => entry.disposition === 'release').map((entry) => entry.package)).toEqual([
      '@fluojs/cli',
      '@fluojs/runtime',
    ]);
  });

  it('follows transitive downstream dependencies through runtime linkage fields', () => {
    const impact = expandPublicPackageDependencyImpact(['@fluojs/core'], {
      packageManifests: [
        packageManifest('@fluojs/adapter', {
          optionalDependencies: { '@fluojs/runtime': 'workspace:^' },
        }),
        packageManifest('@fluojs/core'),
        packageManifest('@fluojs/runtime', {
          peerDependencies: { '@fluojs/core': 'workspace:^' },
        }),
      ],
    });

    expect(impact).toEqual([
      { disposition: 'downstream-evaluate', package: '@fluojs/adapter' },
      { disposition: 'release', package: '@fluojs/core' },
      { disposition: 'downstream-evaluate', package: '@fluojs/runtime' },
    ]);
  });
});
