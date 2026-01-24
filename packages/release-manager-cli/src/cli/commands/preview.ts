/**
 * Release preview command
 */

import { defineCommand, type CommandResult, type PluginContextV3, useConfig } from '@kb-labs/sdk';
import { planRelease, type VersionBump, type ReleaseConfig } from '@kb-labs/release-manager-core';
import { findRepoRoot } from '../../shared/utils';

// Input type combining flags with backward compatibility
type PreviewInput = {
  scope?: string;
  profile?: string;
  bump?: 'patch' | 'minor' | 'major' | 'auto';
  strict?: boolean;
  json?: boolean;
  argv?: string[];
} & { flags?: any };

type ReleasePreviewResult = CommandResult & {
  plan?: {
    strategy: string;
    packages: Array<{ name: string; currentVersion?: string; nextVersion?: string }>;
  };
};

export default defineCommand({
  id: 'release:preview',
  description: 'Preview release plan without making changes',

  handler: {
    async execute(ctx: PluginContextV3, input: PreviewInput): Promise<ReleasePreviewResult> {
      const flags = (input as any).flags ?? input;
      const cwd = ctx.cwd || process.cwd();
      const repoRoot = await findRepoRoot(cwd);

      // Load configuration and create plan
      const fileConfig = await useConfig<ReleaseConfig>();

      // Merge CLI overrides
      const config: ReleaseConfig = {
        ...fileConfig,
        ...(flags.bump && { bump: flags.bump }),
        ...(flags.strict !== undefined && { strict: flags.strict }),
      };

      const plan = await planRelease({
        cwd: repoRoot,
        config,
        scope: flags.scope,
        bumpOverride: flags.bump as VersionBump | undefined,
      });

      // Platform services with optional chaining
      ctx.platform?.logger?.info?.('Release preview completed', {
        packagesCount: plan.packages.length,
        strategy: plan.strategy,
      });

      if (flags.json) {
        ctx.ui?.json?.(plan);
      } else {
        if (!ctx.ui) {
          throw new Error('UI not available');
        }

        const sections: Array<{ header?: string; items: string[] }> = [];

        if (plan.packages.length === 0) {
          sections.push({
            items: ['No packages to release.'],
          });
        } else {
          const packageItems: string[] = [];
          for (const pkg of plan.packages) {
            const versionInfo =
              pkg.currentVersion && pkg.nextVersion
                ? `${pkg.currentVersion} → ${pkg.nextVersion}`
                : pkg.nextVersion || 'new';
            packageItems.push(`${pkg.name}: ${versionInfo} [${pkg.bump}]`);
          }
          sections.push({
            header: 'Packages',
            items: packageItems,
          });
        }

        sections.push({
          header: 'Summary',
          items: [
            `Strategy: ${plan.strategy}`,
            `Registry: ${plan.registry}`,
            `Rollback: ${plan.rollbackEnabled ? 'enabled' : 'disabled'}`,
          ],
        });

        ctx.ui.sideBox({
          title: 'Release Preview',
          sections,
          status: 'info',
        });
      }

      return { exitCode: 0, plan };
    },
  },
});
