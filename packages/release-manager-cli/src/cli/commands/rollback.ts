/**
 * Release rollback command
 */

import { defineCommand, type CommandResult } from '@kb-labs/shared-command-kit';
import { restoreSnapshot } from '@kb-labs/release-manager-core';
import { findRepoRoot } from '../../shared/utils';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events';

type ReleaseRollbackFlags = {
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleaseRollbackResult = CommandResult & {
  message?: string;
};

export const rollbackCommand = defineCommand<ReleaseRollbackFlags, ReleaseRollbackResult>({
  name: 'release:rollback',
  flags: {
    json: {
      type: 'boolean',
      description: 'Output in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.ROLLBACK_STARTED,
    finishEvent: ANALYTICS_EVENTS.ROLLBACK_FINISHED,
    actor: ANALYTICS_ACTOR.id,
  },
  async handler(ctx, argv, flags) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    
    ctx.tracker.checkpoint('start');

    await restoreSnapshot(repoRoot);
    
    ctx.tracker.checkpoint('complete');

    ctx.logger?.info('Release rollback completed');

    if (flags.json) {
      ctx.output?.json({ ok: true, message: 'Rollback completed' });
    } else {
      if (!ctx.output) {
        throw new Error('Output not available');
      }

      const outputText = ctx.output.ui.sideBox({
        title: 'Rollback',
        sections: [
          {
            items: [
              `${ctx.output.ui.symbols.success} ${ctx.output.ui.colors.success('Release state restored from backup snapshot')}`,
            ],
          },
        ],
        status: 'success',
        timing: ctx.tracker.total(),
      });
      ctx.output.write(outputText);
    }

    // Return exit code 4 for rollback executed
    return 4;
  },
});
