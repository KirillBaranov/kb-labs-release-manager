/**
 * Release rollback command
 */

import type { Command } from '@kb-labs/cli-commands/types';
import { box, TimingTracker } from '@kb-labs/shared-cli-ui';
import { restoreSnapshot } from '@kb-labs/release-core';
import { findRepoRoot } from '../utils.js';
import { runScope, type AnalyticsEventV1, type EmitResult } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../analytics/events';

export const rollback: Command = {
  name: 'release:rollback',
  category: 'release',
  describe: 'Rollback last release',
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
            type: ANALYTICS_EVENTS.ROLLBACK_STARTED,
            payload: {},
          });
          await restoreSnapshot(repoRoot);

          if (jsonMode) {
            ctx.presenter.json({ ok: true, message: 'Rollback completed' });
          } else {
            const output = box('Rollback', ['Release state restored from backup snapshot']);
            ctx.presenter.write(output);
          }

          // Track command completion
          await emit({
            type: ANALYTICS_EVENTS.ROLLBACK_FINISHED,
            payload: {
              durationMs: tracker.total(),
              result: 'success',
            },
          });

          return 4; // Rollback executed
        } catch (error) {
          // Track command failure
          await emit({
            type: ANALYTICS_EVENTS.ROLLBACK_FINISHED,
            payload: {
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
            ctx.presenter.error(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          return 1;
        }
      }
    );
  },
};

