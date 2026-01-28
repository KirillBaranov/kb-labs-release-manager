/**
 * Release planner - detects changes and suggests version bumps
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import semver from 'semver';
import globby from 'globby';
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

  // Detect modified packages - with timeout to prevent hanging
  const git = simpleGit(cwd, { timeout: { block: 60000 } }); // 60 second timeout for large repos

  const modifiedPackages = await detectModifiedPackages(git, packages);

  // Compute version bumps
  let planPackages: PackageVersion[] = [];
  for (const pkg of modifiedPackages) {
    const bump = bumpOverride || config.bump || 'auto';

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
  const bumpStrategy = config.changelog?.bumpStrategy || 'independent';
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
  bumpStrategy: 'independent' | 'ripple' | 'lockstep'
): VersionStrategy {
  if (bumpStrategy === 'lockstep') {return 'lockstep';}
  if (bumpStrategy === 'ripple') {return 'adaptive';}
  return 'independent';
}

async function discoverPackages(cwd: string, scope?: string, config?: ReleaseConfig): Promise<PackageVersion[]> {
  const packages: PackageVersion[] = [];

  // Use provided config or empty object
  const releaseConfig = config || {};

  // Determine scope type:
  // 1. Exact package name: @kb-labs/core, my-package
  // 2. Wildcard pattern: @kb-labs/core-*, packages/*
  // 3. Path pattern: packages/*/src
  const isExactPackageName = scope && !scope.includes('*') && (scope.startsWith('@') || !scope.includes('/'));
  const isWildcardPattern = scope && scope.includes('*');

  // Find package.json files - support nested monorepos
  // For wildcard patterns with package names (like @kb-labs/core-*), we need to find all packages first
  // then filter by name regex, because glob patterns work on file paths, not package names
  const pattern = '**/package.json'; // Default pattern - config customization not yet implemented

  const packageJsonPaths = await globby(pattern, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/.*/**', // hidden folders
    ],
  });

  for (let i = 0; i < packageJsonPaths.length; i++) {
    // Освобождаем event loop каждые 10 файлов, чтобы спиннер мог обновиться
    if (i % 10 === 0) {
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }

    const packageJsonPath = packageJsonPaths[i]!;
    const packagePath = join(packageJsonPath, '..');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

    // Skip root package.json (always)
    if (packageJsonPath === join(cwd, 'package.json')) {
      continue;
    }

    // Skip private packages (always)
    if (packageJson.private) {
      continue;
    }

    // If scope is exact package name, filter by exact match
    if (isExactPackageName && packageJson.name !== scope) {
      continue;
    }

    // If scope is wildcard pattern, filter by glob match
    if (isWildcardPattern && scope) {
      // Convert package name to match pattern (e.g., @kb-labs/core-sys matches @kb-labs/core-*)
      // Escape regex special chars except *, then convert * to .*
      const scopePattern = scope
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars
        .replace(/\*/g, '.*');                    // Convert * to .*
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
      isPublished: false, // Will be set to true after actual publish
    });
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
    const result = semver.inc(currentVersion, detectedBump) || currentVersion;
    return result;
  }

  // Manual bump
  const result = semver.inc(currentVersion, bump) || currentVersion;
  return result;
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

