/**
 * Release rollback command
 */

import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { restoreSnapshot } from '@kb-labs/release-core';
import { findRepoRoot } from '../../shared/utils.js';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events.js';

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
      
      const outputText = ctx.output.ui.box('Rollback', ['Release state restored from backup snapshot']);
      ctx.output.write(outputText);
    }

    // Return exit code 4 for rollback executed
    return 4;
  },
});
