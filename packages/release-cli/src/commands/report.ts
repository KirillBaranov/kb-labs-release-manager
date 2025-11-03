/**
 * Release report command
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from '@kb-labs/cli-commands/types';
import { box, TimingTracker } from '@kb-labs/shared-cli-ui';
import type { ReleaseReport } from '@kb-labs/release-core';
import { findRepoRoot } from '../utils.js';
import { runScope, type AnalyticsEventV1, type EmitResult } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../analytics/events';

export const report: Command = {
  name: 'release:report',
  category: 'release',
  describe: 'Show last release report',
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
            type: ANALYTICS_EVENTS.REPORT_STARTED,
            payload: {},
          });

          const reportPath = join(repoRoot, '.kb', 'release', 'report.json');

          const reportContent = await readFile(reportPath, 'utf-8');
          const report = JSON.parse(reportContent) as ReleaseReport;

          if (jsonMode) {
            ctx.presenter.json(report);
          } else {
            // Pretty print summary
            const lines: string[] = [];
            lines.push(`Timestamp: ${report.ts}`);
            lines.push(`Stage: ${report.stage}`);
            lines.push(`Result: ${report.result.ok ? 'SUCCESS' : 'FAILED'}`);
            
            if (report.result.errors && report.result.errors.length > 0) {
              lines.push('');
              lines.push('Errors:');
              for (const error of report.result.errors) {
                lines.push(`  - ${error}`);
              }
            }

            const output = box('Release Report', lines);
            ctx.presenter.write(output);
          }

          // Track command completion
          await emit({
            type: ANALYTICS_EVENTS.REPORT_FINISHED,
            payload: {
              stage: report.stage,
              resultOk: report.result.ok,
              durationMs: tracker.total(),
              result: 'success',
            },
          });

          return 0;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            await emit({
              type: ANALYTICS_EVENTS.REPORT_FINISHED,
              payload: {
                durationMs: tracker.total(),
                result: 'failed',
                error: 'No release report found',
              },
            });

            if (jsonMode) {
              ctx.presenter.json({ ok: false, error: 'No release report found' });
            } else {
              ctx.presenter.error('No release report found. Run "kb release run" first.');
            }
            return 3; // Misconfiguration
          }

          // Track command failure
          await emit({
            type: ANALYTICS_EVENTS.REPORT_FINISHED,
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
            ctx.presenter.error(`Failed to read report: ${error instanceof Error ? error.message : String(error)}`);
          }
          return 1;
        }
      }
    );
  },
};

