/**
 * Release run command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand, type CommandResult } from '@kb-labs/shared-command-kit';
import {
  loadReleaseConfig,
  planRelease,
  saveSnapshot,
  restoreSnapshot,
  publishPackages,
  generateChangelog,
  renderJson,
  renderMarkdown,
  renderText,
  type ReleaseReport,
  type VersionBump,
} from '@kb-labs/release-core';
import { runChecks, createCheckRegistry } from '@kb-labs/release-checks';
import { findRepoRoot } from '../../shared/utils';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events';

type ReleaseRunFlags = {
  scope: { type: 'string'; description?: string };
  profile: { type: 'string'; description?: string };
  bump: { type: 'string'; description?: string; choices?: readonly string[] };
  strict: { type: 'boolean'; description?: string; default?: boolean };
  'dry-run': { type: 'boolean'; description?: string; default?: boolean; alias?: string };
  'skip-checks': { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleaseRunResult = CommandResult & {
  report?: ReleaseReport;
};

export const runCommand = defineCommand<ReleaseRunFlags, ReleaseRunResult>({
  name: 'release:run',
  flags: {
    scope: {
      type: 'string',
      description: 'Package scope (glob pattern)',
    },
    profile: {
      type: 'string',
      description: 'Release profile to use',
    },
    bump: {
      type: 'string',
      description: 'Version bump strategy',
      choices: ['patch', 'minor', 'major', 'auto'] as const,
    },
    strict: {
      type: 'boolean',
      description: 'Fail on any check failure',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Simulate release without publishing',
      default: false,
      alias: 'n',
    },
    'skip-checks': {
      type: 'boolean',
      description: 'Skip pre-release checks',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Print result as JSON',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.RUN_STARTED,
    finishEvent: ANALYTICS_EVENTS.RUN_FINISHED,
    actor: ANALYTICS_ACTOR.id,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    
    ctx.tracker.checkpoint('config');

    // Load configuration
    const { config } = await loadReleaseConfig({
      cwd: repoRoot,
      profileKey: flags.profile,
      cli: {
        bump: flags.bump,
        strict: flags.strict,
        'dry-run': flags['dry-run'],
      },
    });

    // Create release plan
    const plan = await planRelease({
      cwd: repoRoot,
      config,
      scope: flags.scope,
      bumpOverride: flags.bump as VersionBump | undefined,
    });

    ctx.tracker.checkpoint('plan');

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

    ctx.tracker.checkpoint('checks');

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
            dryRun: flags['dry-run'],
          },
          stage: 'rollback',
          plan,
          result: {
            ok: false,
            timingMs: ctx.tracker.total(),
            errors: [`Pre-release checks failed: ${failedChecks.join(', ')}`],
            checks,
          },
        };

        await writeReport(repoRoot, report);
        
        ctx.logger?.warn('Release run failed checks', { failedChecks });
        
        // Return object with ok: false for quality gate failure
        // defineCommand will convert to exit code 1, but we need special handling
        // For now, return 2 directly to indicate quality gate failure
        if (flags.json) {
          ctx.output?.json(report);
        } else {
          ctx.output?.error(`Pre-release checks failed: ${failedChecks.join(', ')}`);
        }
        
        // Return exit code 2 for quality gate failure
        return 2;
      }
    }

    // Publish packages
    const publishResult = await publishPackages({
      cwd: repoRoot,
      plan,
      dryRun: flags['dry-run'],
    });

    ctx.tracker.checkpoint('publish');

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
        dryRun: flags['dry-run'],
      },
      stage: 'verifying',
      plan,
      result: {
        ok: publishResult.errors.length === 0,
        published: publishResult.published,
        changelog,
        checks,
        timingMs: ctx.tracker.total(),
        errors: publishResult.errors.length > 0 ? publishResult.errors : undefined,
      },
    };

    await writeReport(repoRoot, report);

    ctx.logger?.info('Release run completed', { 
      ok: report.result.ok,
      publishedCount: report.result.published?.length || 0,
      errorsCount: report.result.errors?.length || 0,
      timingMs: report.result.timingMs,
    });

    if (flags.json) {
      ctx.output?.json(report);
    } else {
      if (!ctx.output) {
        throw new Error('Output not available');
      }

      const sections: Array<{ header?: string; items: string[] }> = [];

      if (report.result.published && report.result.published.length > 0) {
        const publishedItems: string[] = [];
        for (const pkg of report.result.published) {
          publishedItems.push(`${ctx.output.ui.symbols.success} ${pkg}`);
        }
        sections.push({
          header: 'Published packages',
          items: publishedItems,
        });
      }

      if (report.result.errors && report.result.errors.length > 0) {
        const errorItems: string[] = [];
        for (const error of report.result.errors) {
          errorItems.push(`${ctx.output.ui.symbols.error} ${error}`);
        }
        sections.push({
          header: 'Errors',
          items: errorItems,
        });
      }

      const status = report.result.ok ? 'success' : 'error';
      const outputText = ctx.output.ui.sideBox({
        title: 'Release Summary',
        sections,
        status,
        timing: report.result.timingMs,
      });
      ctx.output.write(outputText);
    }

    // Return exit code based on result
    return report.result.ok ? 0 : 1;
  },
});

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
