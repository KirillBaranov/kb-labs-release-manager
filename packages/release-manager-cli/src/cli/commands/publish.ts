/**
 * Smart npm publish command with interactive 2FA support
 *
 * Features:
 * - Interactive OTP prompt when needed
 * - Better error messages
 * - Retry logic for expired OTP
 * - Support for multiple packages
 * - Dry-run mode
 */

import { defineCommand, type CommandResult, type PluginContext, useLoader } from '@kb-labs/sdk';
import { loadReleaseConfig, planRelease } from '@kb-labs/release-manager-core';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events.js';
import { findRepoRoot } from '../../shared/utils';
import { publishPackagesWithOTP } from '../../shared/publish-with-otp';

interface PublishFlags {
  scope?: string;
  otp?: string;
  'dry-run'?: boolean;
  tag?: string;
  access?: string;
  json?: boolean;
}

interface PublishResult extends CommandResult {
  ok: boolean;
  error?: string;
  published?: Array<{ name: string; version: string }>;
  failed?: Array<{ name: string; version: string; error: string }>;
  summary?: {
    total: number;
    successful: number;
    failed: number;
  };
  timingMs?: number;
}

export const publishCommand = defineCommand({
  name: 'publish',
  flags: {
    scope: { type: 'string', description: 'Package scope' },
    otp: { type: 'string', description: 'One-time password' },
    'dry-run': { type: 'boolean', description: 'Dry run' },
    tag: { type: 'string', description: 'NPM tag' },
    access: { type: 'string', description: 'Access level' },
    json: { type: 'boolean', description: 'JSON output' },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.PUBLISH_STARTED,
    finishEvent: ANALYTICS_EVENTS.PUBLISH_FINISHED,
    actor: ANALYTICS_ACTOR.id,
    includeFlags: true,
  },
  async handler(ctx: PluginContext, argv: any, flags: PublishFlags): Promise<PublishResult> {
    const { scope, otp: initialOtp, tag, access, json } = flags;
    const dryRun = flags['dry-run'];

    if (!ctx.ui) {
      throw new Error('UI not available');
    }

    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    ctx.logger?.info('Searching for packages to publish', { scope, cwd: repoRoot });

    // Load release configuration and discover packages using planRelease
    const discoveryLoader = useLoader('Discovering packages...');
    discoveryLoader.start();

    const { config } = await loadReleaseConfig({ cwd: repoRoot });
    const plan = await planRelease({
      cwd: repoRoot,
      config,
      scope,
    });

    const packages = plan.packages.map(pkg => ({
      name: pkg.name,
      version: pkg.nextVersion,
      path: pkg.path,
    }));

    discoveryLoader.succeed(`Found ${packages.length} package(s)`);

    if (packages.length === 0) {
      ctx.logger?.warn('No packages found to publish', { scope });
      if (json) {
        ctx.ui.json({ ok: false, error: 'No packages found to publish' });
      } else {
        ctx.ui.write?.(`No packages found to publish${scope ? ` matching scope: ${scope}` : ''}`);
      }
      return { ok: false, error: 'No packages found to publish' };
    }

    ctx.logger?.info('Found packages to publish', {
      count: packages.length,
      packages: packages.map((p) => `${p.name}@${p.version}`),
    });

    // Publish packages with interactive OTP support
    const result = await publishPackagesWithOTP({
      packages,
      dryRun,
      otp: initialOtp,
      tag,
      access,
      ui: ctx.ui,
      logger: ctx.logger,
    });

    // Summary
    const successful = result.results.filter((r) => r.success).length;
    const failed = result.results.filter((r) => !r.success).length;
    const timingMs = 0; // Timing tracking not yet implemented

    ctx.logger?.info('Publish operation completed', {
      total: result.results.length,
      successful,
      failed,
    });

    const publishResult: PublishResult = {
      ok: failed === 0,
      published: result.results.filter((r) => r.success).map((r) => ({ name: r.name, version: r.version })),
      failed: result.results.filter((r) => !r.success).map((r) => ({
        name: r.name,
        version: r.version,
        error: r.error || 'Unknown error',
      })),
      summary: { total: result.results.length, successful, failed },
      timingMs,
    };

    if (json) {
      ctx.ui.json(publishResult);
      return publishResult;
    }

    // Build sections for sideBox
    const sections: Array<{ header?: string; items: string[] }> = [];

    if (successful > 0) {
      const successItems: string[] = [];
      for (const r of result.results.filter((r) => r.success)) {
        successItems.push(`${ctx.ui.symbols.success} ${r.name}@${r.version}`);
        // Add npm link for scoped packages
        const npmUrl = `https://www.npmjs.com/package/${r.name}`;
        successItems.push(`  └─ ${npmUrl}`);
      }
      sections.push({
        header: 'Successfully published',
        items: successItems,
      });
    }

    if (failed > 0) {
      const failItems = result.results
        .filter((r) => !r.success)
        .map((r) => `${ctx.ui.symbols.error} ${r.name}@${r.version} - ${r.error}`);
      sections.push({
        header: 'Failed to publish',
        items: failItems,
      });
    }

    const status = failed === 0 ? 'success' : 'error';
    const outputText = ctx.ui.sideBox?.({
      title: dryRun ? 'Publish Dry-Run Summary' : 'Publish Summary',
      sections,
      status,
      timing: timingMs,
    });
    if (outputText) {
      ctx.ui.write?.(outputText);
    }

    return publishResult;
  },
});
