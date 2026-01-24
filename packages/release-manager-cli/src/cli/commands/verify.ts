/**
 * Release verify command
 * Validate release readiness
 */

import { defineCommand, type CommandResult, type PluginContextV3, useConfig } from '@kb-labs/sdk';
import { planRelease, type VersionBump, type ReleaseConfig } from '@kb-labs/release-manager-core';
import { resolveGitRange, parseCommits } from '@kb-labs/release-manager-changelog';
import { findRepoRoot } from '../../shared/utils';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events';

type VerifyInput = {
  scope?: string;
  profile?: string;
  bump?: 'patch' | 'minor' | 'major' | 'auto';
  'fail-if-empty'?: boolean;
  'fail-on-breaking'?: boolean;
  'allow-types'?: string;
  json?: boolean;
  argv?: string[];
} & { flags?: any };

type ReleaseVerifyResult = CommandResult & {
  plan?: {
    packages: Array<{ name: string }>;
  };
  commits?: Array<{ type: string; breaking?: boolean }>;
  breakingDetected?: boolean;
  valid?: boolean;
  issues?: string[];
};

export default defineCommand({
  id: 'release:verify',
  description: 'Validate release readiness',

  handler: {
    async execute(ctx: PluginContextV3, input: VerifyInput): Promise<ReleaseVerifyResult> {
      const flags = (input as any).flags ?? input;
      const cwd = ctx.cwd || process.cwd();
      const repoRoot = await findRepoRoot(cwd);

      // Load configuration and create plan
      const fileConfig = await useConfig<ReleaseConfig>();

      // Merge CLI overrides
      const config: ReleaseConfig = {
        ...fileConfig,
        ...(flags.bump && { bump: flags.bump }),
      };

      const plan = await planRelease({
        cwd: repoRoot,
        config,
        scope: flags.scope,
        bumpOverride: flags.bump as VersionBump | undefined,
      });

      // Validation logic
      const hasPackages = plan.packages.length > 0;
      const hasBreaking = plan.packages.some(pkg => {
        if (!pkg.currentVersion || !pkg.nextVersion) {
          return false;
        }
        const currentMajor = parseInt(pkg.currentVersion.split('.')[0] || '0');
        const nextMajor = parseInt(pkg.nextVersion.split('.')[0] || '0');
        return nextMajor > currentMajor;
      });

      let isValid = true;
      const issues: string[] = [];

      if (flags['fail-if-empty'] && !hasPackages) {
        isValid = false;
        issues.push('No packages to release (--fail-if-empty)');
      }

      if (flags['fail-on-breaking'] && hasBreaking) {
        isValid = false;
        issues.push('Breaking changes detected (--fail-on-breaking)');
      }

      if (flags['allow-types']) {
        const allowedTypes = flags['allow-types'].split(',');
        // Parse commits to check for required types
        const range = await resolveGitRange({
          cwd: repoRoot,
          sinceTag: undefined,
          autoUnshallow: config.git?.autoUnshallow,
        });
        const changes = await parseCommits({
          cwd: repoRoot,
          from: range.from,
          to: range.to,
          ignoreAuthors: config.changelog?.ignoreAuthors || [],
        });
        const hasAllowedTypes = changes.some(change => allowedTypes.includes(change.type));
        if (!hasAllowedTypes) {
          isValid = false;
          issues.push(`Required types not found: ${allowedTypes.join(', ')}`);
        }
      }

      ctx.platform?.logger?.info?.('Release verify completed', {
        valid: isValid,
        hasPackages,
        hasBreaking,
        issuesCount: issues.length,
      });

      if (flags.json) {
        ctx.ui?.json?.({
          valid: isValid,
          hasPackages,
          hasBreaking,
          issues,
          plan,
        });
      } else {
        const sections: Array<{ header?: string; items: string[] }> = [
          {
            header: 'Status',
            items: [
              `Has Packages: ${hasPackages ? 'Yes' : 'No'}`,
              `Has Breaking Changes: ${hasBreaking ? 'Yes' : 'No'}`,
              `Result: ${isValid ? 'Valid for release' : 'Blocked'}`,
            ],
          },
        ];

        if (issues.length > 0) {
          const issueItems: string[] = [];
          for (const issue of issues) {
            issueItems.push(`${ctx.ui.symbols.error} ${issue}`);
          }
          sections.push({
            header: 'Issues',
            items: issueItems,
          });
        }

        const status = isValid ? 'success' : 'error';
        ctx.ui.sideBox({
          title: 'Release Verification',
          sections,
          status,
        });
      }

      // Return exit code 2 for validation failure (quality gate)
      return {
        exitCode: isValid ? 0 : 2,
        valid: isValid,
        plan,
        issues,
        breakingDetected: hasBreaking,
      };
    },
  },
});
