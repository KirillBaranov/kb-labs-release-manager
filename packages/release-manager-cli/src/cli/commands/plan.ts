/**
 * Release plan command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand, type CommandResult, useLoader, discoverArtifacts } from '@kb-labs/sdk';
import { loadReleaseConfig, planRelease, type VersionBump } from '@kb-labs/release-manager-core';
import { findRepoRoot } from '../../shared/utils';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events';

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

export const planCommand = defineCommand<any, ReleasePlanFlags, ReleasePlanResult>({
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
  async handler(ctx: any, argv: string[], flags: any) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

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
      },
    });

    configLoader.succeed('Configuration loaded');

    ctx.tracker.checkpoint('plan');

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
    } else {
      planLoader.succeed(`Found ${plan.packages.length} package(s) to release`);
    }

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
      if (!ctx.ui) {
        throw new Error('UI not available');
      }

      const sections: Array<{ header?: string; items: string[] }> = [];

      // Summary as first section
      sections.push({
        header: 'Summary',
        items: [
          `Strategy: ${plan.strategy}`,
          `Registry: ${plan.registry}`,
          `Packages: ${plan.packages.length}`,
        ],
      });

      // Packages section
      if (plan.packages.length > 0) {
        const packageItems: string[] = [];
        for (const pkg of plan.packages) {
          const versionInfo = pkg.currentVersion && pkg.nextVersion
            ? `${pkg.currentVersion} → ${pkg.nextVersion}`
            : pkg.nextVersion || 'new';
          packageItems.push(`${ctx.ui.symbols.success} ${pkg.name}: ${versionInfo}`);
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

      // Artifacts section
      const artifactsDir = join(repoRoot, '.kb', 'release');
      const artifacts = await discoverArtifacts(artifactsDir, [
        { name: 'Release Plan', pattern: 'plan.json', description: 'Detailed release plan (JSON)' },
      ]);

      if (artifacts.length > 0) {
        const artifactItems: string[] = [];
        for (const artifact of artifacts) {
          artifactItems.push(`${ctx.ui.symbols.info} ${artifact.name}: ${artifact.path}`);
        }
        sections.push({
          header: 'Artifacts',
          items: artifactItems,
        });
      }

      const outputText = ctx.ui.sideBox({
        title: 'Release Plan',
        sections,
        status: 'success',
        timing: ctx.tracker.total(),
      });
      ctx.ui.write(outputText);
    }

    return { ok: true, plan };
  },
});
