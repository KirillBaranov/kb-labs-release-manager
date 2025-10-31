/**
 * Release run command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from '@kb-labs/cli-commands/types';
import { box, formatTiming, TimingTracker, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';
import {
  loadConfig,
  planRelease,
  saveSnapshot,
  restoreSnapshot,
  publishPackages,
  generateChangelog,
  renderJson,
  renderMarkdown,
  renderText,
  type ReleaseReport,
} from '@kb-labs/release-core';
import { runChecks, createCheckRegistry } from '@kb-labs/release-checks';
import { findRepoRoot } from '../utils.js';

export const run: Command = {
  name: 'release:run',
  category: 'release',
  describe: 'Execute release process (plan, check, publish)',
  async run(ctx, argv, flags) {
    const tracker = new TimingTracker();
    const jsonMode = !!flags.json;
    const cwd = ctx?.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    tracker.checkpoint('config');

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

      tracker.checkpoint('plan');

      // Save snapshot for rollback
      await saveSnapshot({
        cwd: repoRoot,
        plan,
      });

      // Run pre-release checks
      const checks = config.verify && config.verify.length > 0 && !flags['skip-checks']
        ? await runChecks({
            checkIds: config.verify,
            cwd: repoRoot,
            registry: createCheckRegistry(),
          })
        : undefined;

      tracker.checkpoint('checks');

      // Check for failures in strict mode
      if (config.strict && checks) {
        const failedChecks = Object.entries(checks)
          .filter(([_, result]) => result && !result.ok)
          .map(([id]) => id);
        
        if (failedChecks.length > 0) {
          // Rollback
          await restoreSnapshot(repoRoot);
          
          const report: ReleaseReport = {
            schemaVersion: '1.0',
            ts: new Date().toISOString(),
            context: {
              repo: repoRoot,
              cwd: repoRoot,
              branch: 'unknown',
              profile: config as any,
              dryRun: !!flags['dry-run'],
            },
            stage: 'rollback',
            plan,
            result: {
              ok: false,
              timingMs: tracker.total(),
              errors: [`Pre-release checks failed: ${failedChecks.join(', ')}`],
              checks,
            },
          };

          await writeReport(repoRoot, report);
          
          if (jsonMode) {
            ctx.presenter.json(report);
          }
          
          return 2; // Quality gate failed
        }
      }

      // Publish packages
      const publishResult = await publishPackages({
        cwd: repoRoot,
        plan,
        dryRun: !!flags['dry-run'],
      });

      tracker.checkpoint('publish');

      // Generate changelog
      const changelog = await generateChangelog({
        cwd: repoRoot,
        plan,
      });

      // Build final report
      const report: ReleaseReport = {
        schemaVersion: '1.0',
        ts: new Date().toISOString(),
        context: {
          repo: repoRoot,
          cwd: repoRoot,
          branch: 'unknown',
          profile: config as any,
          dryRun: !!flags['dry-run'],
        },
        stage: 'verifying',
        plan,
        result: {
          ok: publishResult.errors.length === 0,
          published: publishResult.published,
          changelog,
          checks,
          timingMs: tracker.total(),
          errors: publishResult.errors.length > 0 ? publishResult.errors : undefined,
        },
      };

      await writeReport(repoRoot, report);

      if (jsonMode) {
        ctx.presenter.json(report);
      } else {
        // Pretty print summary
        const lines: string[] = [];
        
        if (report.result.ok) {
          lines.push('Release completed successfully');
        } else {
          lines.push('Release failed');
        }
        lines.push('');

        if (report.result.published && report.result.published.length > 0) {
          lines.push('Published packages:');
          for (const pkg of report.result.published) {
            lines.push(`  ${safeColors.success(safeSymbols.tick)} ${pkg}`);
          }
          lines.push('');
        }

        if (report.result.errors && report.result.errors.length > 0) {
          lines.push('Errors:');
          for (const error of report.result.errors) {
            lines.push(`  ${safeColors.error('✗')} ${error}`);
          }
          lines.push('');
        }

        lines.push(`Duration: ${formatTiming(report.result.timingMs)}`);

        const output = box('Release Summary', lines);
        ctx.presenter.write(output);
      }

      return report.result.ok ? 0 : 1;
    } catch (error) {
      // Attempt rollback
      try {
        await restoreSnapshot(repoRoot);
      } catch {
        // Rollback failed - continue
      }

      if (jsonMode) {
        ctx.presenter.json({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        ctx.presenter.error(`Release failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return 1;
    }
  },
};

async function writeReport(repoRoot: string, report: ReleaseReport): Promise<void> {
  const reportDir = join(repoRoot, '.kb', 'release');
  await mkdir(reportDir, { recursive: true });
  
  // Write JSON report
  const jsonPath = join(reportDir, 'report.json');
  await writeFile(jsonPath, renderJson(report), 'utf-8');
  
  // Write markdown summary
  const mdPath = join(reportDir, 'summary.md');
  await writeFile(mdPath, renderMarkdown(report), 'utf-8');
  
  // Write text summary
  const txtPath = join(reportDir, 'summary.txt');
  await writeFile(txtPath, renderText(report), 'utf-8');
}

