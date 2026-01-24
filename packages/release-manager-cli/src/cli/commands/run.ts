/**
 * Release run command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defineCommand,
  type CommandResult,
  type PluginContextV3,
  useLLM,
  useLoader,
  useConfig,
} from '@kb-labs/sdk';
import {
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
  type ReleaseConfig,
} from '@kb-labs/release-manager-core';
import {
  generateChangelog,
  generateSimpleChangelog,
  type ChangelogPackageInfo,
} from '@kb-labs/release-manager-changelog';
import { runChecks, type CheckConfig } from '@kb-labs/release-manager-checks';
import { findRepoRoot } from '../../shared/utils';
import { publishPackagesWithOTP } from '../../shared/publish-with-otp';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events';

// Input type combining flags with backward compatibility
type RunInput = {
  scope?: string;
  profile?: string;
  bump?: 'patch' | 'minor' | 'major' | 'auto';
  strict?: boolean;
  'dry-run'?: boolean;
  'skip-checks'?: boolean;
  json?: boolean;
  argv?: string[];
} & { flags?: any };

type ReleaseRunResult = CommandResult & {
  report?: ReleaseReport;
};

/**
 * Map check ID to shell command
 */
function getCheckCommandForId(id: string): string {
  const checkCommands: Record<string, string> = {
    tests: 'npm test',
    build: 'npm run build',
    lint: 'npm run lint',
    audit: 'npm audit --audit-level=moderate',
    'type-check': 'npm run type-check || tsc --noEmit',
  };
  return checkCommands[id] || id; // Fallback: use ID as command
}

export default defineCommand({
  id: 'release:run',
  description: 'Execute release process (plan, check, publish)',

  handler: {
    async execute(ctx: PluginContextV3, input: RunInput): Promise<ReleaseRunResult> {
      // Access flags via input.flags (with fallback for direct input)
      const flags = (input as any).flags ?? input;
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    const dryRun = flags['dry-run'] === true;


      // Load configuration with loader
      const configLoader = useLoader('Loading release configuration...');
      configLoader.start();

      const fileConfig = await useConfig<ReleaseConfig>();

      // Merge CLI overrides
      const config: ReleaseConfig = {
        ...fileConfig,
        ...(flags.bump && { bump: flags.bump }),
        ...(flags.strict !== undefined && { strict: flags.strict }),
        ...(flags['dry-run'] !== undefined && { 'dry-run': flags['dry-run'] }),
      };

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
        return { exitCode: 1 };
      }

      planLoader.succeed(`Found ${plan.packages.length} package(s) to release`);


      // Save snapshot for rollback
      await saveSnapshot({
        cwd: repoRoot,
        plan,
      });

      // Run pre-release checks
      let checkResults: any[] = [];
      if (config.verify && config.verify.length > 0 && !flags['skip-checks']) {
        const checksLoader = useLoader(`Running ${config.verify.length} pre-release check(s)...`);
        checksLoader.start();

        // Convert verify IDs to CheckConfig
        const checkConfigs: CheckConfig[] = config.verify.map((id) => ({
          id,
          name: id,
          command: getCheckCommandForId(id),
        }));

        checkResults = await runChecks(checkConfigs, {
          cwd: repoRoot,
          shell: ctx.api?.shell,
        });

        checksLoader.succeed('Pre-release checks completed');
      }


      // Check for failures in strict mode
      if (config.strict && checkResults.length > 0) {
        const failedChecks = checkResults
          .filter((result) => !result.ok)
          .map((result) => result.id);

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
              errors: [`Pre-release checks failed: ${failedChecks.join(', ')}`],
              checks: checkResults.reduce((acc, r) => ({ ...acc, [r.id]: r }), {}),
              timingMs: 0,
            },
          };

          await writeReport(repoRoot, report);

          // Platform services with optional chaining
          ctx.platform?.logger?.warn?.('Release run failed checks', { failedChecks });

          if (flags.json) {
            ctx.ui?.json?.(report);
          } else {
            ctx.ui?.error?.(`Pre-release checks failed: ${failedChecks.join(', ')}`);
          }

          // Return exit code 2 for quality gate failure
          return { exitCode: 2, report };
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
        return { exitCode: 1, meta: { error: 'Version update failed' } };
      }

      versionLoader.succeed(`Updated ${versionUpdates.length} package version(s)`);


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

        // Platform services with optional chaining
        ctx.platform?.logger?.warn?.('Failed to generate full changelog, using simple fallback', {
          error: error instanceof Error ? error.message : String(error),
        });

        // Fallback to simple changelog
        changelog = generateSimpleChangelog(changelogPackages, locale);
      }


      // Copy changelog to each package
      const copyLoader = useLoader('Copying changelog to package directories...');
      copyLoader.start();

      await copyChangelogToPackages({
        cwd: repoRoot,
        plan,
        changelog,
      });

      copyLoader.succeed('Changelog copied to all packages');


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
        logger: ctx.platform?.logger,
      });


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
          checks: checkResults.length > 0 ? checkResults.reduce((acc, r) => ({ ...acc, [r.id]: r }), {}) : undefined,
          git: gitResult,
          errors: publishResult.errors.length > 0 ? publishResult.errors : undefined,
          timingMs: 0,
        },
      };

      await writeReport(repoRoot, report);

      // Platform services with optional chaining
      ctx.platform?.logger?.info?.('Release run completed', {
        ok: report.result.ok,
        publishedCount: report.result.published?.length || 0,
        errorsCount: report.result.errors?.length || 0,
        timingMs: report.result.timingMs,
      });

      if (flags.json) {
        ctx.ui?.json?.(report);
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

        // Use ctx.ui.sideBox for final output
        const title = report.result.ok ? 'Release Completed' : 'Release Failed';
        const status = report.result.ok ? 'success' : 'error';
        ctx.ui.sideBox({
          title,
          sections,
          status,
        });
      }

      // Return exitCode instead of numeric code directly
      return { exitCode: report.result.ok ? 0 : 1, report };
    },
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
