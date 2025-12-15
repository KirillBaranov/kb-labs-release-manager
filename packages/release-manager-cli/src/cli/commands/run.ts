/**
 * Release run command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand, type CommandResult, useLLM, useLoader } from '@kb-labs/sdk';
import {
  loadReleaseConfig,
  planRelease,
  saveSnapshot,
  restoreSnapshot,
  copyChangelogToPackages,
  commitAndTagRelease,
  updatePackageVersions,
  renderJson,
  renderMarkdown,
  renderText,
  type ReleaseReport,
  type VersionBump,
} from '@kb-labs/release-manager-core';
import {
  generateChangelog,
  generateSimpleChangelog,
  type ChangelogPackageInfo,
} from '@kb-labs/release-manager-changelog';
import { runChecks, createCheckRegistry } from '@kb-labs/release-manager-checks';
import { findRepoRoot } from '../../shared/utils';
import { publishPackagesWithOTP } from '../../shared/publish-with-otp';
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

export const runCommand = defineCommand({
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
  async handler(ctx: any, _argv: string[], flags: any) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    const dryRun = flags['dry-run'] === true;

    ctx.tracker.checkpoint('config');

    // Load configuration with loader
    const configLoader = useLoader('Loading release configuration...');
    configLoader.start();

    const { config } = await loadReleaseConfig({
      cwd: repoRoot,
      profileId: flags.profile,
      cli: {
        bump: flags.bump,
        strict: flags.strict,
        'dry-run': flags['dry-run'],
      },
    });

    configLoader.succeed('Configuration loaded');

    // Create release plan with loader
    const planLoader = useLoader('Discovering packages and planning release...');
    planLoader.start();

    const plan = await planRelease({
      cwd: repoRoot,
      config,
      scope: flags.scope,
      bumpOverride: flags.bump as VersionBump | undefined,
    });

    if (plan.packages.length === 0) {
      planLoader.fail(`No packages found matching scope: ${flags.scope || 'all'}`);
      return { ok: false };
    }

    planLoader.succeed(`Found ${plan.packages.length} package(s) to release`);

    ctx.tracker.checkpoint('plan');

    // Save snapshot for rollback
    await saveSnapshot({
      cwd: repoRoot,
      plan,
    });

    // Run pre-release checks
    let checks: Partial<Record<string, any>> | undefined;
    if (config.verify && config.verify.length > 0 && !flags['skip-checks']) {
      const checksLoader = useLoader(`Running ${config.verify.length} pre-release check(s)...`);
      checksLoader.start();

      checks = await runChecks({
        checkIds: config.verify,
        cwd: repoRoot,
        registry: createCheckRegistry(),
      });

      checksLoader.succeed('Pre-release checks completed');
    }

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
            dryRun,
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

    // Update package.json versions BEFORE generating changelog
    // This ensures changelog shows correct version that will be published
    const versionLoader = useLoader('Updating package versions...');
    versionLoader.start();

    const versionUpdates = await updatePackageVersions(plan);
    const failedVersionUpdates = versionUpdates.filter(u => !u.updated);

    if (failedVersionUpdates.length > 0) {
      versionLoader.fail(`Failed to update ${failedVersionUpdates.length} package version(s)`);
      // Rollback and exit
      await restoreSnapshot(repoRoot);
      return { ok: false, error: 'Version update failed' };
    }

    versionLoader.succeed(`Updated ${versionUpdates.length} package version(s)`);

    ctx.tracker.checkpoint('versions');

    // Generate changelog BEFORE publishing (so it's included in the package)
    // Generate changelog using shared changelog generator
    const changelogLoader = useLoader('Generating changelog...');
    changelogLoader.start();

    const llm = useLLM();
    const platform = llm ? { llm } : undefined;
    const locale = (config.changelog?.locale as 'en' | 'ru') || 'en';

    // Determine git working directory (for submodule support)
    let gitCwd = repoRoot;
    if (flags.scope && plan.packages.length > 0 && plan.packages[0]) {
      try {
        gitCwd = await findRepoRoot(plan.packages[0].path);
      } catch {
        gitCwd = plan.packages[0].path;
      }
    }

    // Convert plan packages to ChangelogPackageInfo
    const changelogPackages: ChangelogPackageInfo[] = plan.packages.map(pkg => ({
      name: pkg.name,
      path: pkg.path,
      currentVersion: pkg.currentVersion,
      nextVersion: pkg.nextVersion,
      bump: pkg.bump === 'auto' ? 'patch' : pkg.bump,
    }));

    let changelog = '';
    try {
      const result = await generateChangelog({
        repoRoot,
        gitCwd,
        packages: changelogPackages,
        range: {
          to: 'HEAD',
        },
        changelog: {
          template: config.changelog?.template ?? undefined,
          locale: config.changelog?.locale as 'en' | 'ru',
          metadata: config.changelog?.metadata,
          ignoreAuthors: config.changelog?.ignoreAuthors,
          includeTypes: config.changelog?.includeTypes as string[],
          excludeTypes: config.changelog?.excludeTypes as string[],
          collapseMerges: config.changelog?.collapseMerges,
          collapseReverts: config.changelog?.collapseReverts,
          preferMergeSummary: config.changelog?.preferMergeSummary,
        },
        git: {
          autoUnshallow: config.git?.autoUnshallow,
          requireSignedTags: config.git?.requireSignedTags,
          baseUrl: config.git?.baseUrl ?? undefined,
        },
        platform,
        onProgress: (message) => changelogLoader.update({ text: message }),
      });

      changelog = result.markdown;

      // Write to workspace changelog
      const changelogPath = join(repoRoot, '.kb', 'release', 'CHANGELOG.md');
      await writeFile(changelogPath, changelog, 'utf-8');

      changelogLoader.succeed('Changelog generated');
    } catch (error) {
      changelogLoader.fail('Failed to generate full changelog, using simple fallback');

      ctx.logger?.warn('Failed to generate full changelog, using simple fallback', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to simple changelog
      changelog = generateSimpleChangelog(changelogPackages, locale);
    }

    ctx.tracker.checkpoint('changelog');

    // Copy changelog to each package
    const copyLoader = useLoader('Copying changelog to package directories...');
    copyLoader.start();

    await copyChangelogToPackages({
      cwd: repoRoot,
      plan,
      changelog,
    });

    copyLoader.succeed('Changelog copied to all packages');

    ctx.tracker.checkpoint('changelog-copy');

    // Publish packages with interactive OTP support (after changelog is copied so it's included)
    const packagesToPublish = plan.packages.map(pkg => ({
      name: pkg.name,
      version: pkg.nextVersion,
      path: pkg.path,
    }));

    const publishResult = await publishPackagesWithOTP({
      packages: packagesToPublish,
      dryRun,
      access: 'public',
      ui: ctx.ui,
      logger: ctx.logger,
    });

    ctx.tracker.checkpoint('publish');

    // Commit and tag release
    // Use gitCwd (package directory) for submodule support, not repoRoot (umbrella)
    const gitLoader = useLoader(dryRun ? 'Simulating git operations (dry-run)...' : 'Committing and tagging release...');
    gitLoader.start();

    const gitResult = await commitAndTagRelease({
      cwd: gitCwd,
      plan,
      dryRun,
    });

    if (dryRun) {
      gitLoader.succeed('Git operations skipped (dry-run)');
    } else if (gitResult.pushed) {
      gitLoader.succeed(`Committed, tagged (${gitResult.tagged.length}), and pushed to remote`);
    } else if (gitResult.committed) {
      gitLoader.succeed(`Committed and tagged (${gitResult.tagged.length})`);
    } else {
      gitLoader.stop();
    }

    ctx.tracker.checkpoint('git');

    // Build final report
    const report: ReleaseReport = {
      schemaVersion: '1.0',
      ts: new Date().toISOString(),
      context: {
        repo: repoRoot,
        cwd: repoRoot,
        branch: 'unknown',
        profile: config as any,
        dryRun,
      },
      stage: 'verifying',
      plan,
      result: {
        ok: publishResult.errors.length === 0,
        published: publishResult.published,
        skipped: publishResult.skipped,
        changelog,
        checks,
        git: gitResult,
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
      ctx.ui.json(report);
    } else {
      const sections: Array<{ header?: string; items: string[] }> = [];

      // Published packages with npm links
      if (report.result.published && report.result.published.length > 0) {
        const publishedItems: string[] = [];
        for (const pkg of report.result.published) {
          publishedItems.push(`${ctx.ui.symbols.success} ${pkg}`);
          // Extract package name from "name@version" format
          const pkgName = pkg.split('@').slice(0, -1).join('@') || pkg.replace(/@[\d.]+$/, '');
          if (pkgName.startsWith('@')) {
            publishedItems.push(`  └─ https://www.npmjs.com/package/${pkgName}`);
          }
        }
        sections.push({
          header: 'Published packages',
          items: publishedItems,
        });
      }

      // Skipped packages (dry-run)
      if (report.result.skipped && report.result.skipped.length > 0) {
        const skippedItems: string[] = [];
        for (const pkg of report.result.skipped) {
          skippedItems.push(`${ctx.ui.symbols.info} ${pkg}`);
        }
        sections.push({
          header: 'Skipped (dry-run)',
          items: skippedItems,
        });
      }

      // Errors
      if (report.result.errors && report.result.errors.length > 0) {
        const errorItems: string[] = [];
        for (const error of report.result.errors) {
          errorItems.push(`${ctx.ui.symbols.error} ${error}`);
        }
        sections.push({
          header: 'Errors',
          items: errorItems,
        });
      }

      // Git operations section
      if (report.result.git) {
        const gitItems: string[] = [];
        if (report.result.git.committed) {
          gitItems.push(`${ctx.ui.symbols.success} Changes committed`);
        }
        if (report.result.git.tagged && report.result.git.tagged.length > 0) {
          gitItems.push(`${ctx.ui.symbols.success} Created ${report.result.git.tagged.length} tag(s):`);
          for (const tag of report.result.git.tagged) {
            gitItems.push(`  - ${tag}`);
          }
        }
        if (report.result.git.pushed) {
          gitItems.push(`${ctx.ui.symbols.success} Pushed to remote`);
        }
        if (gitItems.length > 0) {
          sections.push({
            header: 'Git Operations',
            items: gitItems,
          });
        }
      }

      // Use ctx.ui.success for final output
      const title = report.result.ok ? 'Release Completed' : 'Release Failed';
      ctx.ui.success(title, {
        summary: {
          'Packages': String(plan.packages.length),
          'Published': String(report.result.published?.length || 0),
          'Errors': String(report.result.errors?.length || 0),
        },
        sections,
        timing: report.result.timingMs,
      });
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
