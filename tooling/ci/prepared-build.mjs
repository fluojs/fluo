import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

function buildState(root, directories = null) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('prepared build requires clean source');
  const files = [];
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else {
      files.push({
        path: relative(root, path),
        mode: stat.mode & 0o777,
        digest: createHash('sha256').update(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path)).digest('hex'),
      });
    }
  };
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, 'packages', entry.name);
    if (directories !== null && !directories.includes(`packages/${entry.name}`)) continue;
    const manifestPath = join(directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!manifest.scripts?.build) continue;
    const output = join(directory, 'dist');
    if (!existsSync(output) || readdirSync(output).length === 0) throw new Error(`prepared build output missing: ${entry.name}`);
    visit(output);
  }
  if (!files.length) throw new Error('prepared build output inventory is empty');
  if (directories?.some((directory) => !files.some((file) => file.path.startsWith(`${directory}/dist/`)))) {
    throw new Error('prepared build scoped output missing');
  }
  return { root: realpathSync(root), head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), files };
}

export function recordPreparedBuild(root, imageKey, directories = null, planDigest = null) {
  const path = join(root, '.omo/verification/prepared-build.json');
  const state = buildState(root, directories);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, imageKey, directories, planDigest, state }));
  return path;
}

export function verifyPreparedBuild(root, path,
  expectedDirectories = process.env.FLUO_VERIFIED_BUILD_DIRECTORIES ? JSON.parse(process.env.FLUO_VERIFIED_BUILD_DIRECTORIES) : undefined,
  expectedPlanDigest = process.env.FLUO_VERIFIED_BUILD_PLAN) {
  if (!path) return false;
  const recorded = JSON.parse(readFileSync(path, 'utf8'));
  if (recorded.version !== 1 || typeof recorded.imageKey !== 'string'
    || (expectedDirectories !== undefined && JSON.stringify(recorded.directories) !== JSON.stringify(expectedDirectories))
    || (expectedPlanDigest !== undefined && recorded.planDigest !== expectedPlanDigest)
    || JSON.stringify(recorded.state) !== JSON.stringify(buildState(root, recorded.directories ?? null))) {
    throw new Error('prepared build source or output inventory changed');
  }
  return true;
}
