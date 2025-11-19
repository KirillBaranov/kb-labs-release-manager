/**
 * Publisher - handles package publishing and changelog updates
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PackageVersion, ReleasePlan } from './types.js';
import type { ShellApi } from '@kb-labs/plugin-contracts';
import { createExecaShellAdapter } from './shell-adapter.js';

export interface PublisherOptions {
  cwd: string;
  plan: ReleasePlan;
  dryRun?: boolean;
  shell?: ShellApi;
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
  const { cwd, plan, dryRun, shell } = options;
  const shellApi = shell || createExecaShellAdapter();
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
    const buildResult = await shellApi.exec('pnpm', ['build'], {
      cwd,
      timeoutMs: 300000,
    });

    if (!buildResult.ok) {
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
        const publishResult = await shellApi.exec(
          'pnpm',
          ['publish', '--access', 'public', '--registry', registry],
          {
            cwd: pkg.path,
            timeoutMs: 60000,
          }
        );

        if (publishResult.ok) {
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
 * Note: This is a simplified wrapper. Full changelog generation is handled by @kb-labs/changelog
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
 * Generate enhanced changelog using @kb-labs/changelog
 * This is the recommended approach for full-featured changelog generation
 * 
 * Note: Full integration available via @kb-labs/changelog package and CLI command
 */
export async function generateEnhancedChangelog(options: {
  cwd: string;
  plan: ReleasePlan;
  from?: string;
  to?: string;
  config?: any;
}): Promise<{ changelog: string; manifest: any }> {
  // Full changelog generation is available via @kb-labs/changelog
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

