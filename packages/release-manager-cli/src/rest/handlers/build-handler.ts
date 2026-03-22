/**
 * Build handler - Trigger package build before publish
 *
 * Uses safe build (temp dir → atomic swap) to prevent crashing running services.
 */

import { defineHandler, findRepoRoot, type RestInput } from '@kb-labs/sdk';
import type { ILogger } from '@kb-labs/sdk';
import type { BuildRequest, BuildResponse } from '@kb-labs/release-manager-contracts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { scopeToDir } from '../../shared/utils';
import { join } from 'node:path';
import { runSafeBuild } from '../../shared/safe-build';

/**
 * Copy changelog to package root and dist/ after successful build
 */
async function copyChangelogToPackage(
  packagePath: string,
  changelogContent: string,
  logger?: ILogger,
): Promise<void> {
  const rootTarget = join(packagePath, 'CHANGELOG.md');
  await writeFile(rootTarget, changelogContent, 'utf-8');
  logger?.info?.(`Copied CHANGELOG.md to ${rootTarget}`);

  const distDir = join(packagePath, 'dist');
  if (!existsSync(distDir)) {
    await mkdir(distDir, { recursive: true });
  }
  const distTarget = join(distDir, 'CHANGELOG.md');
  await writeFile(distTarget, changelogContent, 'utf-8');
  logger?.info?.(`Copied CHANGELOG.md to ${distTarget}`);
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

    // Read changelog once (non-fatal if missing)
    const changelogPath = join(repoRoot, '.kb/release/plans', scopeDir, 'current', 'changelog.md');
    let changelogContent: string | undefined;
    try {
      changelogContent = await readFile(changelogPath, 'utf-8');
    } catch {
      ctx.platform?.logger?.warn?.('No changelog.md found, skipping CHANGELOG.md copy');
    }

    const results: BuildResponse['packages'] = [];
    let allSuccess = true;

    for (const pkg of plan.packages) {
      const packagePath = pkg.path.startsWith('/') ? pkg.path : join(repoRoot, pkg.path);

      ctx.platform?.logger?.info?.(`Building ${pkg.name}...`, { packagePath });

      const result = await runSafeBuild(packagePath, pkg.name, ctx.platform?.logger);
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

      if (changelogContent) {
        try {
          await copyChangelogToPackage(packagePath, changelogContent, ctx.platform?.logger);
        } catch (err) {
          ctx.platform?.logger?.warn?.(
            `Failed to copy changelog for ${pkg.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
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
