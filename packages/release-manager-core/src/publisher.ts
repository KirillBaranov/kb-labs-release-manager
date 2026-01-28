/**
 * Publisher - handles package publishing and changelog updates
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PackageVersion, ReleasePlan } from './types';
import type { ShellAPI } from '@kb-labs/sdk';
import { createExecaShellAdapter } from './shell-adapter';

export interface PublisherOptions {
  cwd: string;
  plan: ReleasePlan;
  dryRun?: boolean;
  shell?: ShellAPI;
}

export interface PublishingResult {
  published: string[];
  skipped: string[];
  errors: string[];
  versionUpdates: Array<{
    package: string;
    from: string;
    to: string;
    updated: boolean;
  }>;
}

/**
 * Publish packages according to plan
 */
export async function publishPackages(options: PublisherOptions): Promise<PublishingResult> {
  const { plan, dryRun, shell } = options;
  const shellApi = shell || createExecaShellAdapter();
  const result: PublishingResult = {
    published: [],
    skipped: [],
    errors: [],
    versionUpdates: [],
  };

  if (dryRun) {
    // In dry-run, just report what would be published
    for (const pkg of plan.packages) {
      result.skipped.push(`${pkg.name}@${pkg.nextVersion} (dry-run)`);
      // Record planned version update (not applied)
      result.versionUpdates.push({
        package: pkg.name,
        from: pkg.currentVersion || 'unknown',
        to: pkg.nextVersion || 'unknown',
        updated: false,
      });
    }
    return result;
  }

  // Publish each package
  for (const pkg of plan.packages) {
    try {
      const registry = plan.registry || 'https://registry.npmjs.org';

      // 1. Update version in package.json BEFORE publishing
      try {
        await updatePackageVersion(pkg);
        result.versionUpdates.push({
          package: pkg.name,
          from: pkg.currentVersion || 'unknown',
          to: pkg.nextVersion || 'unknown',
          updated: true,
        });
      } catch (versionError) {
        const msg = `Failed to update version for ${pkg.name}: ${versionError instanceof Error ? versionError.message : String(versionError)}`;
        result.errors.push(msg);
        result.versionUpdates.push({
          package: pkg.name,
          from: pkg.currentVersion || 'unknown',
          to: pkg.nextVersion || 'unknown',
          updated: false,
        });
        continue; // Skip publish if version update failed
      }

      // 2. Publish to npm
      const publishResult = await shellApi.exec(
        'pnpm',
        ['publish', '--access', 'public', '--registry', registry],
        {
          cwd: pkg.path,
          timeout: 60000,
        }
      );

      if (publishResult.ok) {
        result.published.push(`${pkg.name}@${pkg.nextVersion}`);
      } else {
        const errorDetails = publishResult.stderr || publishResult.stdout || 'Unknown error';
        result.errors.push(`Failed to publish ${pkg.name}: ${errorDetails}`);
      }
    } catch (error) {
      const msg = `Failed to publish ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(msg);
    }
  }

  return result;
}

/**
 * Update package.json version to nextVersion
 * Should be called BEFORE generating changelog so versions match
 */
export async function updatePackageVersion(pkg: PackageVersion): Promise<void> {
  const packageJsonPath = join(pkg.path, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

  packageJson.version = pkg.nextVersion;

  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
}

/**
 * Update versions for all packages in the plan
 */
export async function updatePackageVersions(plan: ReleasePlan): Promise<Array<{
  package: string;
  from: string;
  to: string;
  updated: boolean;
}>> {
  const results: Array<{
    package: string;
    from: string;
    to: string;
    updated: boolean;
  }> = [];

  for (const pkg of plan.packages) {
    try {
      await updatePackageVersion(pkg);
      results.push({
        package: pkg.name,
        from: pkg.currentVersion || 'unknown',
        to: pkg.nextVersion || 'unknown',
        updated: true,
      });
    } catch (error) {
      console.warn(`Failed to update version for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
      results.push({
        package: pkg.name,
        from: pkg.currentVersion || 'unknown',
        to: pkg.nextVersion || 'unknown',
        updated: false,
      });
    }
  }

  return results;
}

/**
 * Generate changelog entry for release
 * Note: This is a simplified wrapper. Full changelog generation is handled by @kb-labs/release-manager-changelog
 */
export async function generateChangelog(options: {
  cwd: string;
  plan: ReleasePlan;
}): Promise<string> {
  const { cwd, plan } = options;
  
  const changelogPath = join(cwd, 'CHANGELOG.md');
  let existingChangelog = '';
  
  try {
    existingChangelog = await readFile(changelogPath, 'utf-8');
  } catch {
    // Changelog doesn't exist yet
  }

  const date = new Date().toISOString().split('T')[0];
  const header = `## [${date}] Release\n\n`;
  
  const entries: string[] = [];
  for (const pkg of plan.packages) {
    entries.push(`- **${pkg.name}**: ${pkg.currentVersion} → ${pkg.nextVersion}`);
  }
  
  const newEntry = header + entries.join('\n') + '\n\n';
  
  // Prepend to existing changelog
  const updatedChangelog = newEntry + existingChangelog;
  
  // Write back
  try {
    await mkdir(join(cwd, '.kb', 'release'), { recursive: true });
    await writeFile(changelogPath, updatedChangelog, 'utf-8');
  } catch (error) {
    console.warn(`Failed to write changelog: ${error instanceof Error ? error.message : String(error)}`);
  }

  return newEntry;
}

/**
 * Generate enhanced changelog using @kb-labs/release-manager-changelog
 * This is the recommended approach for full-featured changelog generation
 *
 * Note: Full integration available via @kb-labs/release-manager-changelog package and CLI command
 */
export async function generateEnhancedChangelog(options: {
  cwd: string;
  plan: ReleasePlan;
  from?: string;
  to?: string;
  config?: any;
}): Promise<{ changelog: string; manifest: any }> {
  // Full changelog generation is available via @kb-labs/release-manager-changelog
  // For now, fallback to simple changelog
  const simpleChangelog = await generateChangelog({
    cwd: options.cwd,
    plan: options.plan,
  });

  return {
    changelog: simpleChangelog,
    manifest: null,
  };
}

/**
 * Copy changelog to each package directory
 * This writes CHANGELOG.md per package with proper header
 */
export async function copyChangelogToPackages(options: {
  cwd: string;
  plan: ReleasePlan;
  changelog: string;
}): Promise<void> {
  const { plan, changelog } = options;

  for (const pkg of plan.packages) {
    try {
      // For single-package releases, use the entire changelog
      // For multi-package releases, extract package-specific section
      let packageChangelog: string;

      if (plan.packages.length === 1) {
        // Single package release: use entire changelog as-is
        packageChangelog = changelog;
      } else {
        // Multi-package release: extract section for this package
        packageChangelog = createPackageChangelog(pkg, changelog);
      }

      if (!packageChangelog || packageChangelog.trim().length === 0) {
        console.warn(`No changelog content for ${pkg.name}, skipping`);
        continue;
      }

      // Write to package directory
      const changelogPath = join(pkg.path, 'CHANGELOG.md');

      // Read existing changelog if exists
      let existingChangelog = '';
      try {
        existingChangelog = await readFile(changelogPath, 'utf-8');
      } catch {
        // No existing changelog, start fresh
      }

      // Check if this version already exists in changelog to avoid duplicates
      const versionPattern = new RegExp(
        `^##\\s+${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${pkg.nextVersion.replace(/\./g, '\\.')}`,
        'm'
      );

      let updatedChangelog: string;
      if (existingChangelog && versionPattern.test(existingChangelog)) {
        // Version already exists - replace the section instead of prepending
        // Find where current version section starts and next section begins
        const lines = existingChangelog.split('\n');
        let startIdx = -1;
        let endIdx = lines.length;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line && versionPattern.test(line)) {
            startIdx = i;
          } else if (startIdx !== -1 && line && /^##\s+@?[\w-]+/.test(line)) {
            // Found next section header
            endIdx = i;
            break;
          }
        }

        if (startIdx !== -1) {
          // Replace the existing section
          const before = lines.slice(0, startIdx).join('\n');
          const after = lines.slice(endIdx).join('\n');
          updatedChangelog = (before ? before + '\n' : '') + packageChangelog + (after ? '\n' + after : '');
        } else {
          // Fallback: just use new changelog
          updatedChangelog = packageChangelog;
        }
      } else {
        // Prepend new entry
        updatedChangelog = packageChangelog + (existingChangelog ? '\n' + existingChangelog : '');
      }

      await writeFile(changelogPath, updatedChangelog.trim() + '\n', 'utf-8');
    } catch (error) {
      console.warn(`Failed to write changelog for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Create package-specific changelog entry with proper header
 */
function createPackageChangelog(pkg: PackageVersion, changelog: string): string {
  // Extract ONLY the section for this package from the full changelog
  // Format: ## @scope/package-name X.Y.Z
  const packageHeaderPattern = new RegExp(
    `^##\\s+${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+\\.\\d+\\.\\d+`,
    'gm'
  );

  const allHeaders = Array.from(changelog.matchAll(/^##\s+(@[\w-]+\/)?[\w-]+\s+\d+\.\d+\.\d+/gm));

  // Find start index for this package
  let startIdx = -1;
  let endIdx = changelog.length;

  for (let i = 0; i < allHeaders.length; i++) {
    const match = allHeaders[i];
    if (!match || !match.index) {continue;}

    if (packageHeaderPattern.test(match[0])) {
      startIdx = match.index;
      // Find next package header
      if (i + 1 < allHeaders.length) {
        endIdx = allHeaders[i + 1]!.index!;
      }
      break;
    }
  }

  if (startIdx === -1) {
    // Package section not found in changelog, return empty
    return '';
  }

  // Extract the section for this package
  const packageSection = changelog.substring(startIdx, endIdx).trim();

  return packageSection;
}

/**
 * Commit and tag release changes
 */
export async function commitAndTagRelease(options: {
  cwd: string;
  plan: ReleasePlan;
  dryRun?: boolean;
}): Promise<{ committed: boolean; tagged: string[]; pushed: boolean }> {
  const { cwd, plan, dryRun } = options;
  const simpleGit = (await import('simple-git')).default;
  const git = simpleGit(cwd);

  const result = {
    committed: false,
    tagged: [] as string[],
    pushed: false,
  };

  if (dryRun) {
    return result;
  }

  try {
    // 1. Git add all changes
    // Build list of files to add based on what exists
    const filesToAdd: string[] = [];

    // Add package-specific files (relative to cwd which is the git repo root)
    for (const pkg of plan.packages) {
      // Check if pkg.path is inside cwd or equals cwd
      if (pkg.path === cwd) {
        // Single package at git root (e.g., kb-labs-core)
        filesToAdd.push('package.json');
        filesToAdd.push('CHANGELOG.md');
      } else if (pkg.path.startsWith(cwd + '/')) {
        // Package is subdirectory of cwd
        const relativePath = pkg.path.replace(cwd + '/', '');
        filesToAdd.push(`${relativePath}/package.json`);
        filesToAdd.push(`${relativePath}/CHANGELOG.md`);
      } else {
        // Package path doesn't match cwd - add absolute paths
        filesToAdd.push(`${pkg.path}/package.json`);
        filesToAdd.push(`${pkg.path}/CHANGELOG.md`);
      }
    }

    await git.add(filesToAdd);

    // 2. Create commit message
    const commitMessage = createCommitMessage(plan);
    await git.commit(commitMessage);
    result.committed = true;

    // 3. Create tags for each package
    for (const pkg of plan.packages) {
      const tagName = `${pkg.name}@${pkg.nextVersion}`;
      await git.addTag(tagName);
      result.tagged.push(tagName);
    }

    // 4. Push commits and tags
    await git.push();
    await git.pushTags();
    result.pushed = true;

  } catch (error) {
    console.error(`Git operations failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  return result;
}

/**
 * Create conventional commit message for release
 */
function createCommitMessage(plan: ReleasePlan): string {
  const lines: string[] = [];

  if (plan.packages.length === 1 && plan.packages[0]) {
    const pkg = plan.packages[0];
    lines.push(`chore(release): publish ${pkg.name}@${pkg.nextVersion}`);
  } else {
    lines.push(`chore(release): publish ${plan.packages.length} packages`);
  }

  lines.push('');

  for (const pkg of plan.packages) {
    lines.push(`- ${pkg.name}@${pkg.nextVersion}`);
  }

  return lines.join('\n');
}

