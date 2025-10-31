/**
 * Publisher - handles package publishing and changelog updates
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import type { PackageVersion, ReleasePlan } from './types';

export interface PublisherOptions {
  cwd: string;
  plan: ReleasePlan;
  dryRun?: boolean;
}

export interface PublishingResult {
  published: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Publish packages according to plan
 */
export async function publishPackages(options: PublisherOptions): Promise<PublishingResult> {
  const { cwd, plan, dryRun } = options;
  const result: PublishingResult = {
    published: [],
    skipped: [],
    errors: [],
  };

  if (dryRun) {
    // In dry-run, just report what would be published
    for (const pkg of plan.packages) {
      result.skipped.push(`${pkg.name}@${pkg.nextVersion} (dry-run)`);
    }
    return result;
  }

  // Update versions in package.json first
  for (const pkg of plan.packages) {
    try {
      await updatePackageVersion(pkg);
    } catch (error) {
      const msg = `Failed to update version for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(msg);
      continue;
    }
  }

  // Run build
  try {
    const { exitCode } = await execa('pnpm', ['build'], {
      cwd,
      timeout: 300000,
    });

    if (exitCode !== 0) {
      result.errors.push('Build failed');
      return result;
    }
  } catch (error) {
    const msg = `Build failed: ${error instanceof Error ? error.message : String(error)}`;
    result.errors.push(msg);
    return result;
  }

  // Publish each package
  for (const pkg of plan.packages) {
    try {
      const registry = plan.registry || 'https://registry.npmjs.org';
      
      // Publish to npm if configured
      if (plan.packages.length > 0) {
        const { exitCode } = await execa(
          'pnpm',
          ['publish', '--access', 'public', '--registry', registry],
          {
            cwd: pkg.path,
            timeout: 60000,
          }
        );

        if (exitCode === 0) {
          result.published.push(`${pkg.name}@${pkg.nextVersion}`);
        } else {
          result.errors.push(`Failed to publish ${pkg.name}`);
        }
      }
    } catch (error) {
      const msg = `Failed to publish ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(msg);
    }
  }

  return result;
}

async function updatePackageVersion(pkg: PackageVersion): Promise<void> {
  const packageJsonPath = join(pkg.path, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
  
  packageJson.version = pkg.nextVersion;
  
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8');
}

/**
 * Generate changelog entry for release
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

