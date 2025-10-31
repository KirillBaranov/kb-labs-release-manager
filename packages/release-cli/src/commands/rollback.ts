/**
 * Release rollback command
 */

import type { Command } from '@kb-labs/cli-commands/types';
import { box } from '@kb-labs/shared-cli-ui';
import { restoreSnapshot } from '@kb-labs/release-core';
import { findRepoRoot } from '../utils.js';

export const rollback: Command = {
  name: 'release:rollback',
  category: 'release',
  describe: 'Rollback last release',
  async run(ctx, argv, flags) {
    const jsonMode = !!flags.json;
    const cwd = ctx?.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    try {
      await restoreSnapshot(repoRoot);

      if (jsonMode) {
        ctx.presenter.json({ ok: true, message: 'Rollback completed' });
      } else {
        const output = box('Rollback', ['Release state restored from backup snapshot']);
        ctx.presenter.write(output);
      }

      return 4; // Rollback executed
    } catch (error) {
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
  },
};

