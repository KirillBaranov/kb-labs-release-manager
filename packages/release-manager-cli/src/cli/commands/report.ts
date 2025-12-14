/**
 * Release report command
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand, type CommandResult } from '@kb-labs/sdk';
import type { ReleaseReport } from '@kb-labs/release-manager-core';
import { findRepoRoot } from '../../shared/utils';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events';

type ReleaseReportFlags = {
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleaseReportResult = CommandResult & {
  report?: ReleaseReport;
};

export const reportCommand = defineCommand<any, ReleaseReportFlags, ReleaseReportResult>({
  name: 'release:report',
  flags: {
    json: {
      type: 'boolean',
      description: 'Output in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.REPORT_STARTED,
    finishEvent: ANALYTICS_EVENTS.REPORT_FINISHED,
    actor: ANALYTICS_ACTOR.id,
  },
  async handler(ctx: any, argv: string[], flags: any) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    
    ctx.tracker.checkpoint('start');

    const reportPath = join(repoRoot, '.kb', 'release', 'report.json');

    try {
      const reportContent = await readFile(reportPath, 'utf-8');
      const report = JSON.parse(reportContent) as ReleaseReport;

      ctx.tracker.checkpoint('complete');

      ctx.logger?.info('Release report completed', { 
        stage: report.stage,
        ok: report.result.ok,
      });

      if (flags.json) {
        ctx.output?.json(report);
      } else {
        if (!ctx.output) {
          throw new Error('Output not available');
        }

        const sections: Array<{ header?: string; items: string[] }> = [
          {
            header: 'Summary',
            items: [
              `Timestamp: ${report.ts}`,
              `Stage: ${report.stage}`,
              `Result: ${report.result.ok ? 'SUCCESS' : 'FAILED'}`,
            ],
          },
        ];

        if (report.result.errors && report.result.errors.length > 0) {
          const errorItems: string[] = [];
          for (const error of report.result.errors) {
            errorItems.push(error);
          }
          sections.push({
            header: 'Errors',
            items: errorItems,
          });
        }

        const status = report.result.ok ? 'success' : 'error';
        const outputText = ctx.ui.sideBox({
          title: 'Release Report',
          sections,
          status,
          timing: ctx.tracker.total(),
        });
        ctx.ui.write(outputText);
      }

      return { ok: report.result.ok, report };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        ctx.logger?.warn('No release report found');
        
        if (flags.json) {
          ctx.output?.json({ ok: false, error: 'No release report found' });
        } else {
          ctx.output?.error(new Error('No release report found. Run "kb release run" first.'));
        }
        // Return exit code 3 for misconfiguration
        return 3;
      }
      throw error;
    }
  },
});
