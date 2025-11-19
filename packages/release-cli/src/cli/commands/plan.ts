/**
 * Release plan command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from '@kb-labs/cli-commands/types';
import { box, keyValue, safeColors, TimingTracker } from '@kb-labs/shared-cli-ui';
import { loadReleaseConfig, planRelease } from '@kb-labs/release-core';
import { findRepoRoot } from '../../shared/utils.js';
import { runScope, type AnalyticsEventV1, type EmitResult } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events.js';

export const plan: Command = {
  name: 'release:plan',
  category: 'release',
  describe: 'Analyze changes and prepare release plan',
  async run(ctx, argv, flags) {
    const tracker = new TimingTracker();
    const jsonMode = !!flags.json;
    const cwd = ctx?.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    return await runScope(
      {
        actor: ANALYTICS_ACTOR,
        ctx: { workspace: cwd },
      },
      async (emit: (event: Partial<AnalyticsEventV1>) => Promise<EmitResult>) => {
        try {
          // Track command start
          await emit({
            type: ANALYTICS_EVENTS.PLAN_STARTED,
            payload: {
              profile: flags.profile as string | undefined,
              scope: flags.scope as string | undefined,
              bump: flags.bump as string | undefined,
              strict: !!flags.strict,
            },
          });
          // Load configuration
          const { config } = await loadReleaseConfig({
            cwd: repoRoot,
            profileKey: flags.profile as string | undefined,
            cli: {
              bump: flags.bump,
              strict: flags.strict,
            },
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

          // Track command completion
          await emit({
            type: ANALYTICS_EVENTS.PLAN_FINISHED,
            payload: {
              profile: flags.profile as string | undefined,
              scope: flags.scope as string | undefined,
              packagesCount: plan.packages.length,
              strategy: plan.strategy,
              durationMs: tracker.total(),
              result: 'success',
            },
          });

          return 0;
        } catch (error) {
          // Track command failure
          await emit({
            type: ANALYTICS_EVENTS.PLAN_FINISHED,
            payload: {
              profile: flags.profile as string | undefined,
              scope: flags.scope as string | undefined,
              durationMs: tracker.total(),
              result: 'error',
              error: error instanceof Error ? error.message : String(error),
            },
          });

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
      }
    );
  },
};

export async function planCommand(
  ctx: Parameters<Command['run']>[0],
  argv: Parameters<Command['run']>[1],
  flags: Parameters<Command['run']>[2]
) {
  return plan.run(ctx, argv, flags);
}

