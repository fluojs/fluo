import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';

export function readTestCatalog(root, changedFiles, identity) {
  const { testProjects } = JSON.parse(readFileSync(join(root, 'tooling/ci/local-verification-manifest.json'), 'utf8'));
  const matches = (file, project) => project.include.some((pattern) => matchesGlob(file, pattern))
    && !project.exclude.some((pattern) => matchesGlob(file, pattern));
  const catalog = Object.fromEntries(Object.entries(testProjects).map(([name, project]) =>
    [name, globSync(project.include, { cwd: root, exclude: project.exclude }).sort()]));
  for (const [name, project] of Object.entries(testProjects)) {
    for (const file of changedFiles.filter((path) => matches(path, project))) {
      const owner = file.split('/').slice(0, 2).join('/');
      if (!catalog[name].some((path) => path.startsWith(`${owner}/`))) {
        throw new TypeError(`coverage-loss: ${owner} has no matching ${name} tests after changing ${file}`);
      }
    }
  }
  if (!catalog.apps.length) {
    const previous = spawnSync('git', ['ls-tree', '-r', '--name-only', '-z', identity.baseSha, '--', 'apps/'],
      { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (previous.status === 0) {
      const original = spawnSync('git', ['show', `${identity.baseSha}:tooling/ci/local-verification-manifest.json`],
        { cwd: root, encoding: 'utf8' });
      const previousProject = original.status === 0
        ? JSON.parse(original.stdout).testProjects?.apps ?? testProjects.apps : testProjects.apps;
      if (previous.stdout.split('\0').filter(Boolean).some((path) => matches(path, previousProject))) {
        throw new TypeError('coverage-loss: apps suite existed at the base source but is empty in target checkout');
      }
    }
  }
  return catalog;
}
