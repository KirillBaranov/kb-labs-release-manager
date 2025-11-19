/**
 * Release preview command
 * Dry-run release planning
 */

import type { Command } from '@kb-labs/cli-commands';
import { box, safeColors, keyValue, TimingTracker } from '@kb-labs/shared-cli-ui';
import { loadReleaseConfig, planRelease } from '@kb-labs/release-core';
import { findRepoRoot } from '../../shared/utils.js';
import { runScope, type AnalyticsEventV1, type EmitResult } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events.js';

export const preview: Command = {
  name: 'release:preview',
  category: 'release',
  describe: 'Preview release plan without making changes',
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
            type: ANALYTICS_EVENTS.PREVIEW_STARTED,
            payload: {
              profile: flags.profile as string | undefined,
              scope: flags.scope as string | undefined,
              bump: flags.bump as string | undefined,
            },
          });

          // Load configuration and create plan
          const { config } = await loadReleaseConfig({
            cwd: repoRoot,
            profileKey: flags.profile as string | undefined,
            cli: {
              bump: flags.bump,
              strict: flags.strict,
            },
          });

          const plan = await planRelease({
            cwd: repoRoot,
            config,
            scope: flags.scope as string | undefined,
            bumpOverride: flags.bump as any,
          });

          // Format preview output
          if (jsonMode) {
            ctx.presenter.json(plan);
          } else {
            const lines: string[] = [];
            lines.push('Release Preview (dry-run):');
            lines.push('');

            if (plan.packages.length === 0) {
              lines.push('No packages to release.');
            } else {
              lines.push('Planned Bumps:');
              lines.push('');
              const packageDisplay: Record<string, string> = {};
              for (const pkg of plan.packages) {
                packageDisplay[pkg.name] = `${pkg.currentVersion} → ${safeColors.info(pkg.nextVersion)} [${pkg.bump}]`;
              }
              lines.push(...keyValue(packageDisplay));
            }

            lines.push('');
            const summary: Record<string, string> = {
              'Strategy': plan.strategy,
              'Registry': plan.registry,
              'Rollback': plan.rollbackEnabled ? 'enabled' : 'disabled',
              'Status': 'dry-run (no changes made)',
            };
            lines.push(...keyValue(summary));

            const output = box('Release Preview', lines);
            ctx.presenter.write(output);
          }

          // Track completion
          await emit({
            type: ANALYTICS_EVENTS.PREVIEW_FINISHED,
            payload: {
              packagesCount: plan.packages.length,
              durationMs: tracker.total(),
              result: 'success',
            },
          });

          return 0;
        } catch (error) {
          // Track failure
          await emit({
            type: ANALYTICS_EVENTS.PREVIEW_FINISHED,
            payload: {
              durationMs: tracker.total(),
              result: 'error',
              error: error instanceof Error ? error.message : String(error),
            },
          });

          ctx.presenter.error(`Preview failed: ${error instanceof Error ? error.message : String(error)}`);
          return 1;
        }
      }
    );
  },
};

export async function previewCommand(
  ctx: Parameters<Command['run']>[0],
  argv: Parameters<Command['run']>[1],
  flags: Parameters<Command['run']>[2]
) {
  return preview.run(ctx, argv, flags);
}


