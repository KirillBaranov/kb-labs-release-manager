/**
 * Release plan command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from '@kb-labs/cli-commands/types';
import { box, keyValue, safeColors } from '@kb-labs/shared-cli-ui';
import { loadConfig, planRelease } from '@kb-labs/release-core';
import { findRepoRoot } from '../utils.js';

export const plan: Command = {
  name: 'release:plan',
  category: 'release',
  describe: 'Analyze changes and prepare release plan',
  async run(ctx, argv, flags) {
    const jsonMode = !!flags.json;
    const cwd = ctx?.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    try {
      // Load configuration
      const config = await loadConfig({
        cwd: repoRoot,
      });

      // Create release plan
      const plan = await planRelease({
        cwd: repoRoot,
        config,
        scope: flags.scope as string | undefined,
        bumpOverride: flags.bump as any,
      });

      // Save plan to .kb/release/plan.json
      if (!jsonMode) {
        const planDir = join(repoRoot, '.kb', 'release');
        await mkdir(planDir, { recursive: true });
        const planPath = join(planDir, 'plan.json');
        await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
      }

      if (jsonMode) {
        ctx.presenter.json(plan);
      } else {
        // Pretty print plan
        const lines: string[] = [];
        lines.push('Release Plan:');
        lines.push('');

        if (plan.packages.length === 0) {
          lines.push('No packages to release.');
        } else {
          const packageDisplay: Record<string, string> = {};
          for (const pkg of plan.packages) {
            packageDisplay[pkg.name] = `${pkg.currentVersion} → ${safeColors.info(pkg.nextVersion)} [${pkg.bump}]`;
          }
          lines.push(...keyValue(packageDisplay));
        }

        lines.push('');
        lines.push(`Strategy: ${plan.strategy}`);
        lines.push(`Registry: ${plan.registry}`);
        lines.push(`Rollback: ${plan.rollbackEnabled ? 'enabled' : 'disabled'}`);

        const output = box('Release Plan', lines);
        ctx.presenter.write(output);
      }

      return 0;
    } catch (error) {
      if (jsonMode) {
        ctx.presenter.json({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        ctx.presenter.error(`Failed to create plan: ${error instanceof Error ? error.message : String(error)}`);
      }
      return 1;
    }
  },
};

