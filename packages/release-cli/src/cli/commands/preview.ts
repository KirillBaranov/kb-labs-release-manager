/**
 * Release preview command
 * Dry-run release planning
 */

import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { keyValue } from '@kb-labs/shared-cli-ui';
import { loadReleaseConfig, planRelease, type VersionBump } from '@kb-labs/release-core';
import { findRepoRoot } from '../../shared/utils.js';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events.js';

type ReleasePreviewFlags = {
  scope: { type: 'string'; description?: string };
  profile: { type: 'string'; description?: string };
  bump: { type: 'string'; description?: string; choices?: readonly string[] };
  strict: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleasePreviewResult = CommandResult & {
  plan?: {
    strategy: string;
    packages: Array<{ name: string; currentVersion?: string; nextVersion?: string }>;
  };
};

export const previewCommand = defineCommand<ReleasePreviewFlags, ReleasePreviewResult>({
  name: 'release:preview',
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
    json: {
      type: 'boolean',
      description: 'Output in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.PREVIEW_STARTED,
    finishEvent: ANALYTICS_EVENTS.PREVIEW_FINISHED,
    actor: ANALYTICS_ACTOR.id,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    
    ctx.tracker.checkpoint('config');

    // Load configuration and create plan
    const { config } = await loadReleaseConfig({
      cwd: repoRoot,
      profileKey: flags.profile,
      cli: {
        bump: flags.bump,
        strict: flags.strict,
      },
    });

    ctx.tracker.checkpoint('plan');

    const plan = await planRelease({
      cwd: repoRoot,
      config,
      scope: flags.scope,
      bumpOverride: flags.bump as VersionBump | undefined,
    });

    ctx.tracker.checkpoint('complete');

    ctx.logger?.info('Release preview completed', { 
      packagesCount: plan.packages.length,
      strategy: plan.strategy,
    });

    if (flags.json) {
      ctx.output?.json(plan);
    } else {
      if (!ctx.output) {
        throw new Error('Output not available');
      }
      
      const lines: string[] = [];
      lines.push('Release Preview (dry-run):');
      lines.push('');
      
      if (plan.packages.length === 0) {
        lines.push('No packages to release.');
      } else {
        const packageDisplay: Record<string, string> = {};
        for (const pkg of plan.packages) {
          const versionInfo = pkg.currentVersion && pkg.nextVersion
            ? `${pkg.currentVersion} → ${pkg.nextVersion}`
            : pkg.nextVersion || 'new';
          packageDisplay[pkg.name] = `${versionInfo} [${pkg.bump}]`;
        }
        lines.push(...keyValue(packageDisplay));
      }

      lines.push('');
      const summary: Record<string, string> = {
        'Strategy': plan.strategy,
        'Registry': plan.registry,
        'Rollback': plan.rollbackEnabled ? 'enabled' : 'disabled',
      };
      lines.push(...keyValue(summary));

      const outputText = ctx.output.ui.box('Release Preview', lines);
      ctx.output.write(outputText);
    }

    return { ok: true, plan };
  },
});
