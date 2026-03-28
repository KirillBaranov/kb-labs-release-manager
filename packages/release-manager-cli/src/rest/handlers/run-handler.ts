/**
 * Run release handler — thin adapter over core runReleasePipeline().
 */

import { defineHandler, findRepoRoot, type RestInput, useConfig, useLLM } from '@kb-labs/sdk';
import type {
  RunReleaseRequest,
  RunReleaseResponse,
} from '@kb-labs/release-manager-contracts';
import {
  runReleasePipeline,
  type ReleaseConfig,
  type PublishablePackage,
  type PublishResult,
  type ChangelogGenerator,
} from '@kb-labs/release-manager-core';
import {
  generateChangelog,
  generateSimpleChangelog,
  type ChangelogPackageInfo,
} from '@kb-labs/release-manager-changelog';
import { publishPackagesProgrammatic } from '../../shared/publish-programmatic';
import { resolveScopePath } from '@kb-labs/release-manager-core';

export default defineHandler({
  async execute(ctx, input: RestInput<unknown, RunReleaseRequest>): Promise<RunReleaseResponse> {
    const scope = input.body?.scope || 'root';
    const dryRun = input.body?.dryRun ?? false;
    const skipChecks = input.body?.skipChecks ?? false;
    const otp = input.body?.otp;
    const cwd = ctx.cwd ?? process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    const scopeCwd = await resolveScopePath(repoRoot, scope);

    const config = await useConfig<ReleaseConfig>() ?? {};

    // Changelog generator (with LLM if available)
    const llm = useLLM();
    const changelog: ChangelogGenerator = {
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

    // Programmatic publisher (token-based, no interactive OTP)
    const publisher = {
      async publish(packages: PublishablePackage[], opts: { dryRun?: boolean }): Promise<PublishResult> {
        return publishPackagesProgrammatic({
          packages,
          dryRun: opts.dryRun,
          otp,
        });
      },
    };

    const result = await runReleasePipeline({
      cwd,
      repoRoot,
      scopeCwd,
      scope,
      config,
      dryRun,
      skipChecks,
      checks: config.scopes?.[scope]?.checks ?? config.checks ?? [],
      publisher,
      changelog,
      logger: ctx.platform?.logger,
    });

    // Track analytics
    await ctx.platform?.analytics?.track?.(result.success ? 'release.completed' : 'release.failed', {
      scope,
      packagesCount: result.plan.packages.length,
      publishedCount: result.report.result.published?.length ?? 0,
      dryRun,
      durationMs: result.report.result.timingMs,
    });

    return {
      scope,
      report: result.report as any,
      success: result.success,
      errors: result.report.result.errors,
    };
  },
});
