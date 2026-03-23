/**
 * Release run command — thin adapter over core pipeline.
 */

import {
  defineCommand,
  type CommandResult,
  type PluginContextV3,
  useLLM,
  useLoader,
  useConfig,
} from '@kb-labs/sdk';
import {
  runReleasePipeline,
  type ReleaseConfig,
  type ReleaseReport,
  type VersionBump,
  type ReleasePlan,
  type PublishablePackage,
  type PublishResult,
  type ChangelogGenerator,
} from '@kb-labs/release-manager-core';
import {
  generateChangelog,
  generateSimpleChangelog,
  type ChangelogPackageInfo,
} from '@kb-labs/release-manager-changelog';
import { findRepoRoot } from '../../shared/utils';
import { publishPackagesWithOTP } from '../../shared/publish-with-otp';

type RunInput = {
  scope?: string;
  bump?: 'patch' | 'minor' | 'major' | 'auto';
  strict?: boolean;
  'dry-run'?: boolean;
  'skip-checks'?: boolean;
  'skip-build'?: boolean;
  'skip-verify'?: boolean;
  json?: boolean;
  argv?: string[];
} & { flags?: any };

type ReleaseRunResult = CommandResult & {
  report?: ReleaseReport;
};

export default defineCommand({
  id: 'release:run',
  description: 'Execute release process (plan, check, build, verify, publish)',

  handler: {
    async execute(ctx: PluginContextV3, input: RunInput): Promise<ReleaseRunResult> {
      const flags = (input as any).flags ?? input;
      const cwd = ctx.cwd || process.cwd();
      const repoRoot = await findRepoRoot(cwd);
      const dryRun = flags['dry-run'] === true;

      // Load config
      const configLoader = useLoader('Loading configuration...');
      configLoader.start();
      const fileConfig = await useConfig<ReleaseConfig>();
      const config: ReleaseConfig = {
        ...fileConfig,
        ...(flags.bump && { bump: flags.bump }),
        ...(flags.strict !== undefined && { strict: flags.strict }),
      };
      configLoader.succeed('Configuration loaded');

      // Create changelog generator (with LLM if available)
      const llm = useLLM();
      const changelogGenerator: ChangelogGenerator = {
        async generate(plan, opts) {
          const locale = (config.changelog?.locale as 'en' | 'ru') || 'en';
          const packages: ChangelogPackageInfo[] = plan.packages.map(pkg => ({
            name: pkg.name,
            path: pkg.path,
            currentVersion: pkg.currentVersion,
            nextVersion: pkg.nextVersion,
            bump: pkg.bump === 'auto' ? 'patch' : pkg.bump,
          }));

          try {
            const result = await generateChangelog({
              repoRoot: opts.repoRoot,
              gitCwd: opts.gitCwd,
              packages,
              range: { to: 'HEAD' },
              changelog: {
                template: config.changelog?.template ?? undefined,
                locale,
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
              platform: llm ? { llm } : undefined,
            });
            return result.markdown;
          } catch {
            return generateSimpleChangelog(packages, locale);
          }
        },
      };

      // Create publisher (interactive with OTP for CLI)
      const publisher = {
        async publish(packages: PublishablePackage[], opts: { dryRun?: boolean; access?: string }): Promise<PublishResult> {
          return publishPackagesWithOTP({
            packages,
            dryRun: opts.dryRun,
            access: opts.access ?? 'public',
            ui: ctx.ui,
            logger: ctx.platform?.logger,
          });
        },
      };

      // Run pipeline
      const pipelineLoader = useLoader('Running release pipeline...');
      pipelineLoader.start();

      const result = await runReleasePipeline({
        cwd,
        repoRoot,
        scope: flags.scope,
        config,
        dryRun,
        skipChecks: flags['skip-checks'],
        skipBuild: flags['skip-build'],
        skipVerify: flags['skip-verify'],
        checks: config.checks ?? [],
        publisher,
        changelog: changelogGenerator,
        logger: ctx.platform?.logger,
        onProgress: (_stage, message) => pipelineLoader.update({ text: message }),
      });

      pipelineLoader.succeed(result.success ? 'Release completed' : 'Release failed');

      // Output
      if (flags.json) {
        ctx.ui?.json?.(result.report);
      } else {
        const report = result.report;
        const sections: Array<{ header?: string; items: string[] }> = [];

        if (report.result.published?.length) {
          sections.push({
            header: 'Published',
            items: report.result.published.map(p => `${ctx.ui.symbols.success} ${p}`),
          });
        }

        if (report.result.skipped?.length) {
          sections.push({
            header: 'Skipped (dry-run)',
            items: report.result.skipped.map(p => `${ctx.ui.symbols.info} ${p}`),
          });
        }

        if (report.result.errors?.length) {
          sections.push({
            header: 'Errors',
            items: report.result.errors.map(e => `${ctx.ui.symbols.error} ${e}`),
          });
        }

        if (report.result.git) {
          const g = report.result.git;
          sections.push({
            header: 'Git',
            items: [
              `Committed: ${g.committed}`,
              `Tags: ${g.tagged?.join(', ') || 'none'}`,
              `Pushed: ${g.pushed}`,
            ],
          });
        }

        ctx.ui.sideBox({
          title: 'Release',
          sections,
          status: result.success ? 'success' : 'error',
          timing: report.result.timingMs,
        });
      }

      return { exitCode: result.success ? 0 : 1, report: result.report };
    },
  },
});
