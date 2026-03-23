/**
 * Run release handler — thin adapter over core runReleasePipeline().
 */

import { defineHandler, findRepoRoot, type RestInput, useConfig } from '@kb-labs/sdk';
import type {
  RunReleaseRequest,
  RunReleaseResponse,
} from '@kb-labs/release-manager-contracts';
import {
  runReleasePipeline,
  type ReleaseConfig,
  type PublishablePackage,
  type PublishResult,
} from '@kb-labs/release-manager-core';
import { publishPackagesProgrammatic } from '../../shared/publish-programmatic';

export default defineHandler({
  async execute(ctx, input: RestInput<unknown, RunReleaseRequest>): Promise<RunReleaseResponse> {
    const scope = input.body?.scope || 'root';
    const dryRun = input.body?.dryRun ?? false;
    const skipChecks = input.body?.skipChecks ?? false;
    const otp = input.body?.otp;
    const cwd = ctx.cwd ?? process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    const config = await useConfig<ReleaseConfig>() ?? {};

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
      scope,
      config,
      dryRun,
      skipChecks,
      checks: config.checks ?? [],
      publisher,
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
