/**
 * Release plan command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { loadReleaseConfig, planRelease, type VersionBump } from '@kb-labs/release-core';
import { findRepoRoot } from '../../shared/utils.js';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events.js';

type ReleasePlanFlags = {
  scope: { type: 'string'; description?: string };
  profile: { type: 'string'; description?: string };
  bump: { type: 'string'; description?: string; choices?: readonly string[]; default?: string };
  strict: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleasePlanResult = CommandResult & {
  plan?: {
    strategy: string;
    registry: string;
    packages: Array<{
      name: string;
      currentVersion?: string;
      nextVersion?: string;
    }>;
  };
};

export const planCommand = defineCommand<ReleasePlanFlags, ReleasePlanResult>({
  name: 'release:plan',
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
      default: 'auto',
    },
    strict: {
      type: 'boolean',
      description: 'Fail on any check failure',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Print plan as JSON',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.PLAN_STARTED,
    finishEvent: ANALYTICS_EVENTS.PLAN_FINISHED,
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
      },
    });

    ctx.tracker.checkpoint('plan');

    // Create release plan
    const plan = await planRelease({
      cwd: repoRoot,
      config,
      scope: flags.scope,
      bumpOverride: flags.bump as VersionBump | undefined,
    });

    ctx.tracker.checkpoint('complete');

    // Save plan to .kb/release/plan.json
    if (!flags.json) {
      const planDir = join(repoRoot, '.kb', 'release');
      await mkdir(planDir, { recursive: true });
      const planPath = join(planDir, 'plan.json');
      await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
    }

    ctx.logger?.info('Release plan completed', { 
      packagesCount: plan.packages.length,
      strategy: plan.strategy,
      registry: plan.registry,
    });

    if (flags.json) {
      ctx.output?.json(plan);
    } else {
      if (!ctx.output) {
        throw new Error('Output not available');
      }

      const sections: Array<{ header?: string; items: string[] }> = [
        {
          header: 'Summary',
          items: [
            `Strategy: ${plan.strategy}`,
            `Registry: ${plan.registry}`,
            `Packages: ${plan.packages.length}`,
          ],
        },
      ];

      if (plan.packages.length > 0) {
        const packageItems: string[] = [];
        for (const pkg of plan.packages) {
          const versionInfo = pkg.currentVersion && pkg.nextVersion
            ? `${pkg.currentVersion} → ${pkg.nextVersion}`
            : pkg.nextVersion || 'new';
          packageItems.push(`${ctx.output.ui.symbols.success} ${pkg.name}: ${versionInfo}`);
        }
        sections.push({
          header: 'Packages to release',
          items: packageItems,
        });
      } else {
        sections.push({
          items: ['No packages to release'],
        });
      }

      const outputText = ctx.output.ui.sideBox({
        title: 'Release Plan',
        sections,
        status: 'success',
        timing: ctx.tracker.total(),
      });
      ctx.output.write(outputText);
    }

    return { ok: true, plan };
  },
});
