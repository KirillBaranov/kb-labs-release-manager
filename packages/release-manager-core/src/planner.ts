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
  const packages = await discoverPackages(cwd, scope);

  // Detect modified packages
  const git = simpleGit(cwd);
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
  if (bumpStrategy === 'lockstep') return 'lockstep';
  if (bumpStrategy === 'ripple') return 'adaptive';
  return 'independent';
}

async function discoverPackages(cwd: string, scope?: string): Promise<PackageVersion[]> {
  const packages: PackageVersion[] = [];

  // Read config for customization (optional)
  const config = await readReleaseConfig(cwd);

  // Determine if scope is a package name (e.g., @kb-labs/pkg) or a glob pattern (e.g., packages/*)
  const isPackageName = scope && (scope.startsWith('@') || !scope.includes('/') || !scope.includes('*'));

  // Find package.json files - support nested monorepos
  const pattern = scope && !isPackageName
    ? `${scope}/**/package.json`
    : (config.release?.packagesPattern || '**/package.json');

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
      ...(config.release?.ignorePatterns || []),
    ],
  });

  for (const packageJsonPath of packageJsonPaths) {
    const packagePath = join(packageJsonPath, '..');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

    // Skip root package.json unless configured
    if (packageJsonPath === join(cwd, 'package.json') && !config.release?.includeRoot) {
      continue;
    }

    // Skip private packages unless configured
    if (packageJson.private && !config.release?.includePrivate) {
      continue;
    }

    // If scope is a package name, filter by exact match
    if (isPackageName && packageJson.name !== scope) {
      continue;
    }

    packages.push({
      name: packageJson.name,
      path: packagePath,
      currentVersion: packageJson.version,
      nextVersion: packageJson.version,
      bump: 'auto',
      isPublished: !packageJson.private,
    });
  }

  return packages;
}

/**
 * Read release configuration from kb.config.json (optional)
 */
async function readReleaseConfig(cwd: string): Promise<any> {
  try {
    const configPath = join(cwd, 'kb.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    return JSON.parse(configContent);
  } catch {
    return {}; // fallback to empty config if file doesn't exist
  }
}

async function detectModifiedPackages(
  git: ReturnType<typeof simpleGit>,
  packages: PackageVersion[]
): Promise<PackageVersion[]> {
  // Get list of modified files
  const status = await git.status();
  const diffSummary = await git.diffSummary(['HEAD']);

  const modifiedPaths = [
    ...status.files.map(f => f.path),
    ...diffSummary.files.map(f => f.file),
  ];

  // Find packages that have changes
  const modified: PackageVersion[] = [];
  for (const pkg of packages) {
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
  } catch {
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

