/**
 * Smart npm publish command with interactive 2FA support
 *
 * Features:
 * - Interactive OTP prompt when needed
 * - Better error messages
 * - Retry logic for expired OTP
 * - Support for multiple packages
 * - Dry-run mode
 */

import { defineCommand, type CommandResult, type PluginContext, useLoader } from '@kb-labs/sdk';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events.js';

interface PublishFlags {
  scope?: string;
  otp?: string;
  'dry-run'?: boolean;
  tag?: string;
  access?: 'public' | 'restricted';
  json?: boolean;
}

interface PublishResult extends CommandResult {
  ok: boolean;
  error?: string;
  published?: Array<{ name: string; version: string }>;
  failed?: Array<{ name: string; version: string; error: string }>;
  summary?: {
    total: number;
    successful: number;
    failed: number;
  };
  timingMs?: number;
}

export const publishCommand = defineCommand<any, PublishFlags, PublishResult>({
  name: 'publish',
  flags: {
    scope: { type: 'string', description: 'Package scope' },
    otp: { type: 'string', description: 'One-time password' },
    'dry-run': { type: 'boolean', description: 'Dry run' },
    tag: { type: 'string', description: 'NPM tag' },
    access: { type: 'string', description: 'Access level' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.PUBLISH_STARTED,
    finishEvent: ANALYTICS_EVENTS.PUBLISH_FINISHED,
    actor: ANALYTICS_ACTOR.id,
    includeFlags: true,
  },
  async handler(ctx: PluginContext, argv: any, flags: PublishFlags): Promise<PublishResult> {
    const { scope, otp: initialOtp, tag, access, json } = flags;
    const dryRun = flags['dry-run'];

    if (!ctx.ui) {
      throw new Error('UI not available');
    }

    ctx.logger?.info('Searching for packages to publish', { scope, cwd: ctx.cwd });

    // Find packages to publish
    const packages = await findPackagesToPublish(ctx.cwd, scope);

    if (packages.length === 0) {
      ctx.logger?.warn('No packages found to publish', { scope });
      if (json) {
        ctx.output?.json({ ok: false, error: 'No packages found to publish' });
        return { ok: false, error: 'No packages found to publish' };
      }
      return { ok: false };
    }

    ctx.logger?.info('Found packages to publish', {
      count: packages.length,
      packages: packages.map((p) => `${p.name}@${p.version}`),
    });

    // Publish each package
    let otp = initialOtp;
    const results: Array<{ name: string; version: string; success: boolean; error?: string }> = [];

    for (const pkg of packages) {
      ctx.logger?.info('Publishing package', { name: pkg.name, version: pkg.version });

      const loader = useLoader(`Publishing ${pkg.name}@${pkg.version}...`);
      loader.start();

      let attempts = 0;
      const maxAttempts = 3;
      let published = false;

      while (!published && attempts < maxAttempts) {
        attempts++;

        try {
          await publishPackage({
            packagePath: pkg.path,
            otp,
            dryRun,
            tag,
            access,
          });

          published = true;
          results.push({ name: pkg.name, version: pkg.version, success: true });

          const successMsg = dryRun
            ? `Dry-run succeeded for ${pkg.name}@${pkg.version}`
            : `Published ${pkg.name}@${pkg.version}`;

          loader.succeed(successMsg);
          ctx.logger?.info('Package published successfully', {
            name: pkg.name,
            version: pkg.version,
            dryRun,
          });
        } catch (error: any) {
          const errorMessage = error.message || String(error);

          // Check if OTP is required
          if (errorMessage.includes('EOTP') || errorMessage.includes('one-time password')) {
            if (attempts < maxAttempts) {
              loader.fail('2FA required - please enter your authenticator code');
              ctx.logger?.warn('OTP required for publishing', {
                name: pkg.name,
                attempt: attempts,
              });

              // Prompt for OTP
              const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
              });

              try {
                otp = await rl.question('Enter OTP code: ');
                rl.close();

                if (!otp || otp.trim().length !== 6) {
                  ctx.logger?.warn('Invalid OTP code provided', { length: otp?.trim().length });
                  otp = undefined;
                  continue;
                }

                ctx.logger?.debug('Retrying with OTP');
              } catch (e) {
                rl.close();
                throw e;
              }
            } else {
              loader.fail('Max OTP attempts reached');
              ctx.logger?.error('Max OTP attempts reached', {
                name: pkg.name,
                attempts: maxAttempts,
              });
              results.push({ name: pkg.name, version: pkg.version, success: false, error: 'Max OTP attempts reached' });
              break;
            }
          } else {
            // Other error - don't retry
            loader.fail(`Failed: ${errorMessage}`);
            ctx.logger?.error('Package publish failed', {
              name: pkg.name,
              version: pkg.version,
              error: errorMessage,
            });
            results.push({ name: pkg.name, version: pkg.version, success: false, error: errorMessage });
            break;
          }
        }
      }
    }

    // Summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const timingMs = 0; // Timing tracking not yet implemented

    ctx.logger?.info('Publish operation completed', {
      total: results.length,
      successful,
      failed,
    });

    const publishResult: PublishResult = {
      ok: failed === 0,
      published: results.filter((r) => r.success).map((r) => ({ name: r.name, version: r.version })),
      failed: results.filter((r) => !r.success).map((r) => ({
        name: r.name,
        version: r.version,
        error: r.error || 'Unknown error',
      })),
      summary: { total: results.length, successful, failed },
      timingMs,
    };

    if (json) {
      ctx.output?.json(publishResult);
      return publishResult;
    }

    // Build sections for sideBox
    const sections: Array<{ header?: string; items: string[] }> = [];

    if (successful > 0) {
      const successItems = results
        .filter((r) => r.success)
        .map((r) => `${ctx.ui.symbols.success} ${r.name}@${r.version}`);
      sections.push({
        header: 'Successfully published',
        items: successItems,
      });
    }

    if (failed > 0) {
      const failItems = results
        .filter((r) => !r.success)
        .map((r) => `${ctx.ui.symbols.error} ${r.name}@${r.version} - ${r.error}`);
      sections.push({
        header: 'Failed to publish',
        items: failItems,
      });
    }

    const status = failed === 0 ? 'success' : 'error';
    const outputText = ctx.ui.sideBox?.({
      title: dryRun ? 'Publish Dry-Run Summary' : 'Publish Summary',
      sections,
      status,
      timing: timingMs,
    });
    if (outputText) {
      ctx.ui.write?.(outputText);
    }

    return publishResult;
  },
});

interface PublishOptions {
  packagePath: string;
  otp?: string;
  dryRun?: boolean;
  tag?: string;
  access?: string;
}

/**
 * Publish a single package using npm CLI
 */
function publishPackage(options: PublishOptions): Promise<void> {
  const { packagePath, otp, dryRun, tag, access } = options;

  return new Promise((resolve, reject) => {
    const args = ['publish'];

    if (dryRun) {
      args.push('--dry-run');
    }

    if (otp) {
      args.push(`--otp=${otp}`);
    }

    if (tag) {
      args.push(`--tag=${tag}`);
    }

    if (access) {
      args.push(`--access=${access}`);
    }

    const child = spawn('npm', args, {
      cwd: packagePath,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const errorOutput = stderr || stdout;
        reject(new Error(errorOutput));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

interface PackageInfo {
  name: string;
  version: string;
  path: string;
}

/**
 * Find packages to publish based on scope filter
 */
async function findPackagesToPublish(cwd: string, scope?: string): Promise<PackageInfo[]> {
  const packages: PackageInfo[] = [];

  // If scope is provided, assume it's a specific package path or name
  if (scope) {
    // Try as direct path first
    const pkgPath = resolve(cwd, scope);
    const pkgJsonPath = resolve(pkgPath, 'package.json');

    if (existsSync(pkgJsonPath)) {
      const pkgJson = await import(pkgJsonPath, { with: { type: 'json' } });
      packages.push({
        name: pkgJson.default.name,
        version: pkgJson.default.version,
        path: pkgPath,
      });
    } else {
      // Try to find by package name in workspace
      // For now, just check current directory
      const currentPkgJson = resolve(cwd, 'package.json');
      if (existsSync(currentPkgJson)) {
        const pkgJson = await import(currentPkgJson, { with: { type: 'json' } });
        if (pkgJson.default.name === scope || pkgJson.default.name.includes(scope)) {
          packages.push({
            name: pkgJson.default.name,
            version: pkgJson.default.version,
            path: cwd,
          });
        }
      }
    }
  } else {
    // No scope - publish current directory
    const pkgJsonPath = resolve(cwd, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkgJson = await import(pkgJsonPath, { with: { type: 'json' } });
      packages.push({
        name: pkgJson.default.name,
        version: pkgJson.default.version,
        path: cwd,
      });
    }
  }

  return packages;
}
