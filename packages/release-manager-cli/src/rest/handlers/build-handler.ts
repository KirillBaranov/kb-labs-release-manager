/**
 * Build handler - Trigger package build before publish
 *
 * Runs pnpm build for the specified scope
 */

import { defineHandler, findRepoRoot, type RestInput } from '@kb-labs/sdk';
import type { BuildRequest, BuildResponse } from '@kb-labs/release-manager-contracts';
import { readFile } from 'node:fs/promises';
import { scopeToDir } from '../../shared/utils';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Run build command for a package
 */
async function runBuild(packagePath: string, packageName: string): Promise<{
  success: boolean;
  error?: string;
  durationMs: number;
}> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn('pnpm', ['run', 'build'], {
      cwd: packagePath,
      stdio: 'pipe',
      shell: true,
    });

    let stderr = '';

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      if (code === 0) {
        resolve({ success: true, durationMs });
      } else {
        resolve({
          success: false,
          error: stderr || `Build failed with exit code ${code}`,
          durationMs,
        });
      }
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      resolve({
        success: false,
        error: err.message,
        durationMs,
      });
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      child.kill();
      const durationMs = Date.now() - startTime;
      resolve({
        success: false,
        error: 'Build timed out after 5 minutes',
        durationMs,
      });
    }, 5 * 60 * 1000);
  });
}

export default defineHandler({
  async execute(ctx, input: RestInput<unknown, BuildRequest>): Promise<BuildResponse> {
    const scope = input.body?.scope || 'root';
    const cwd = ctx.cwd ?? process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    const startTime = Date.now();

    // Read plan to get packages
    const scopeDir = scopeToDir(scope);
    const planPath = join(repoRoot, '.kb/release/plans', scopeDir, 'current', 'plan.json');

    let plan: { packages: Array<{ name: string; path: string }> };
    try {
      const planRaw = await readFile(planPath, 'utf-8');
      plan = JSON.parse(planRaw);
    } catch {
      return {
        scope,
        success: false,
        packages: [],
        builtCount: 0,
        totalCount: 0,
        totalDurationMs: Date.now() - startTime,
      };
    }

    const results: BuildResponse['packages'] = [];
    let allSuccess = true;

    for (const pkg of plan.packages) {
      const packagePath = pkg.path.startsWith('/') ? pkg.path : join(repoRoot, pkg.path);

      ctx.platform?.logger?.info?.(`Building ${pkg.name}...`, { packagePath });

      const result = await runBuild(packagePath, pkg.name);
      results.push({
        name: pkg.name,
        success: result.success,
        error: result.error,
        durationMs: result.durationMs,
      });

      if (!result.success) {
        allSuccess = false;
        ctx.platform?.logger?.error?.(`Build failed for ${pkg.name}`, undefined, { error: result.error });
        // Stop on first failure
        break;
      }

      ctx.platform?.logger?.info?.(`Built ${pkg.name} in ${result.durationMs}ms`);
    }

    const builtCount = results.filter((r) => r.success).length;
    const totalCount = plan.packages.length;

    return {
      scope,
      success: allSuccess,
      packages: results,
      builtCount,
      totalCount,
      totalDurationMs: Date.now() - startTime,
    };
  },
});
