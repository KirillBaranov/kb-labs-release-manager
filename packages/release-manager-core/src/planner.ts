/**
 * Release planner - detects changes and suggests version bumps
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import semver from 'semver';
import globby from 'globby';
import { discoverSubRepoPaths } from '@kb-labs/sdk';
import type { PackageVersion, VersionBump, ReleaseConfig, ReleasePlan } from './types';
import { applyVersionStrategy, type VersionStrategy } from './versioning-strategies';

export interface PlannerOptions {
  cwd: string;
  config: ReleaseConfig;
  scope?: string;
  bumpOverride?: VersionBump;
}

/**
 * Plan release by detecting changes and computing version bumps
 */
export async function planRelease(options: PlannerOptions): Promise<ReleasePlan> {
  const { cwd, config, scope, bumpOverride } = options;

  // Discover packages
  const packages = await discoverPackages(cwd, scope, config);

  // Workspace root with submodules: each sub-repo has its own git,
  // so we skip workspace-level detectModifiedPackages and use per-repo git.
  const isWorkspaceRoot = existsSync(join(cwd, '.gitmodules')) && !scope;

  let modifiedPackages: PackageVersion[];
  if (isWorkspaceRoot) {
    // All sub-repos are candidates — change detection happens per-repo
    modifiedPackages = packages;
  } else {
    const git = simpleGit(cwd, { timeout: { block: 60000 } });
    modifiedPackages = await detectModifiedPackages(git, packages);
  }

  // Compute version bumps
  let planPackages: PackageVersion[] = [];
  for (const pkg of modifiedPackages) {
    const bump = bumpOverride || config.bump || 'auto';

    // For workspace root, use per-sub-repo git instance
    const git = isWorkspaceRoot
      ? simpleGit(pkg.path, { timeout: { block: 60000 } })
      : simpleGit(cwd, { timeout: { block: 60000 } });

    const nextVersion = await computeNextVersion(
      pkg.path,
      pkg.currentVersion,
      bump,
      git
    );

    planPackages.push({
      ...pkg,
      nextVersion,
      bump: bump === 'auto' ? detectBumpType(pkg.currentVersion, nextVersion) : bump,
    });
  }

  // Apply versioning strategy (lockstep/independent/adaptive)
  // Top-level versioningStrategy takes priority over legacy changelog.bumpStrategy
  const bumpStrategy = config.versioningStrategy || config.changelog?.bumpStrategy || 'independent';
  const versionStrategy = mapBumpStrategyToVersionStrategy(bumpStrategy);

  planPackages = applyVersionStrategy(planPackages, {
    strategy: versionStrategy,
    umbrellaPath: scope,
  });

  return {
    packages: planPackages,
    strategy: config.strategy || 'semver',
    registry: config.registry || 'https://registry.npmjs.org',
    rollbackEnabled: config.rollback?.enabled ?? true,
  };
}

/**
 * Map changelog.bumpStrategy to VersionStrategy
 */
function mapBumpStrategyToVersionStrategy(
  bumpStrategy: 'independent' | 'ripple' | 'lockstep' | 'adaptive'
): VersionStrategy {
  if (bumpStrategy === 'lockstep') {return 'lockstep';}
  if (bumpStrategy === 'ripple' || bumpStrategy === 'adaptive') {return 'adaptive';}
  return 'independent';
}

async function discoverPackages(cwd: string, scope?: string, config?: ReleaseConfig): Promise<PackageVersion[]> {
  // If cwd is the workspace root (has .gitmodules), discover sub-repos as release units
  const isWorkspaceRoot = existsSync(join(cwd, '.gitmodules'));
  if (isWorkspaceRoot && !scope) {
    return discoverSubRepoPackages(cwd);
  }

  const packages: PackageVersion[] = [];

  // Determine scope type:
  // 1. Exact package name: @kb-labs/core, my-package
  // 2. Wildcard pattern: @kb-labs/core-*, packages/*
  // 3. Path pattern: packages/*/src
  const isExactPackageName = scope && !scope.includes('*') && (scope.startsWith('@') || !scope.includes('/'));
  const isWildcardPattern = scope && scope.includes('*');

  // Find package.json files - support nested monorepos
  const pattern = '**/package.json';

  const packageJsonPaths = await globby(pattern, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/.*/**',
    ],
  });

  for (let i = 0; i < packageJsonPaths.length; i++) {
    if (i % 10 === 0) {
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }

    const packageJsonPath = packageJsonPaths[i]!;
    const packagePath = join(packageJsonPath, '..');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

    const isRootPackageJson = packageJsonPath === join(cwd, 'package.json');

    // Skip private packages (always)
    if (packageJson.private) {
      continue;
    }

    // Skip monorepo root package.json — it's a workspace manifest, not a buildable package.
    // The actual buildable packages are inside packages/ or apps/.
    if (isRootPackageJson && existsSync(join(packagePath, 'pnpm-workspace.yaml'))) {
      continue;
    }

    // Skip root package.json without name (workspace-only manifest)
    if (isRootPackageJson && !packageJson.name) {
      continue;
    }

    // If scope is exact package name, filter by exact match
    if (isExactPackageName && packageJson.name !== scope) {
      continue;
    }

    // If scope is wildcard pattern, filter by glob match
    if (isWildcardPattern && scope) {
      const scopePattern = scope
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      const regex = new RegExp(`^${scopePattern}$`);
      if (!regex.test(packageJson.name)) {
        continue;
      }
    }

    packages.push({
      name: packageJson.name,
      path: packagePath,
      currentVersion: packageJson.version,
      nextVersion: packageJson.version,
      bump: 'auto',
      isPublished: false,
    });
  }

  return packages;
}

/**
 * Discover sub-repos as release units via .gitmodules.
 * Each sub-repo root package.json is a release unit (even if private).
 */
async function discoverSubRepoPackages(workspaceRoot: string): Promise<PackageVersion[]> {
  const subRepoPaths = discoverSubRepoPaths(workspaceRoot);
  const packages: PackageVersion[] = [];

  for (const subRepoPath of subRepoPaths) {
    try {
      const pkgJson = JSON.parse(
        await readFile(join(subRepoPath, 'package.json'), 'utf-8')
      );
      if (!pkgJson.name) {continue;}

      packages.push({
        name: pkgJson.name,
        path: subRepoPath,
        currentVersion: pkgJson.version || '0.0.0',
        nextVersion: pkgJson.version || '0.0.0',
        bump: 'auto',
        isPublished: false,
      });
    } catch {
      // Sub-repo without valid package.json — skip
    }
  }

  return packages;
}

/**
 * Check if file should be ignored (node_modules, dist, etc.)
 */
function shouldIgnoreFile(file: string): boolean {
  const ignoredPaths = [
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    '.next/',
    '.nuxt/',
    'coverage/',
    '.cache/',
    'tmp/',
  ];

  return ignoredPaths.some(path => file.includes(path));
}

async function detectModifiedPackages(
  git: ReturnType<typeof simpleGit>,
  packages: PackageVersion[]
): Promise<PackageVersion[]> {

  // Get list of modified files
  const status = await git.status();
  const diffSummary = await git.diffSummary(['HEAD']);

  // Filter out node_modules and other build artifacts
  const modifiedPaths = [
    ...status.files.map(f => f.path),
    ...diffSummary.files.map(f => f.file),
  ].filter(path => !shouldIgnoreFile(path));


  // Find packages that have changes
  const modified: PackageVersion[] = [];
  for (let i = 0; i < packages.length; i++) {
    // Освобождаем event loop каждые 10 пакетов
    if (i % 10 === 0) {
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }

    const pkg = packages[i]!;

    // Check if any file in this package is modified
    const packageModified = modifiedPaths.some(path =>
      path.startsWith(pkg.path) || path.includes(pkg.name)
    );

    if (packageModified) {
      modified.push(pkg);
    }
  }


  // If no modified packages detected, include all packages (for initial release)
  return modified.length > 0 ? modified : packages;
}

async function computeNextVersion(
  packagePath: string,
  currentVersion: string,
  bump: VersionBump,
  git: ReturnType<typeof simpleGit>
): Promise<string> {

  // If auto, detect from conventional commits
  if (bump === 'auto') {
    const detectedBump = await detectVersionFromCommits(git, packagePath);
    return semver.inc(currentVersion, detectedBump) || currentVersion;
  }

  // Manual bump
  return semver.inc(currentVersion, bump) || currentVersion;
}

async function detectVersionFromCommits(
  git: ReturnType<typeof simpleGit>,
  packagePath: string
): Promise<'major' | 'minor' | 'patch'> {

  try {
    // Get recent commits for this package

    const log = await git.log({
      maxCount: 50,
      file: packagePath,
    });


    let hasMinor = false;
    let hasBreaking = false;

    for (const commit of log.all) {
      const message = commit.message.toLowerCase();

      // Detect conventional commits
      if (message.includes('!:')) {
        hasBreaking = true;
      } else if (message.startsWith('feat') || message.startsWith('feature')) {
        hasMinor = true;
      }
      // else if fix/bugfix -> patch level (default)
    }

    // If breaking change detected
    if (hasBreaking) {
      return 'major';
    }

    // If feature added
    if (hasMinor) {
      return 'minor';
    }

    // Default to patch
    return 'patch';
  } catch (error) {
    // On error, default to patch
    return 'patch';
  }
}

function detectBumpType(currentVersion: string, nextVersion: string): VersionBump {
  if (semver.major(currentVersion) < semver.major(nextVersion)) {
    return 'major';
  }
  if (semver.minor(currentVersion) < semver.minor(nextVersion)) {
    return 'minor';
  }
  return 'patch';
}

