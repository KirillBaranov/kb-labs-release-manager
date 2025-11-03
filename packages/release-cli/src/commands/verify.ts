/**
 * Release verify command
 * Validate release readiness
 */

import type { Command } from '@kb-labs/cli-commands';
import { box, safeColors, keyValue, TimingTracker } from '@kb-labs/shared-cli-ui';
import { loadReleaseConfig, planRelease } from '@kb-labs/release-core';
import { resolveGitRange, parseCommits } from '@kb-labs/changelog';
import { findRepoRoot } from '../utils.js';
import { runScope, type AnalyticsEventV1, type EmitResult } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../analytics/events';

export const verify: Command = {
  name: 'release:verify',
  category: 'release',
  describe: 'Validate release readiness',
  async run(ctx, argv, flags) {
    const tracker = new TimingTracker();
    const jsonMode = !!flags.json;
    const cwd = ctx?.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    return await runScope(
      {
        actor: ANALYTICS_ACTOR,
        ctx: { workspace: cwd },
      },
      async (emit: (event: Partial<AnalyticsEventV1>) => Promise<EmitResult>) => {
        try {
          // Track command start
          await emit({
            type: ANALYTICS_EVENTS.VERIFY_STARTED,
            payload: {
              failIfEmpty: !!flags['fail-if-empty'],
              failOnBreaking: !!flags['fail-on-breaking'],
              allowTypes: (flags['allow-types'] as string | undefined)?.split(',') || undefined,
            },
          });

          // Load configuration and create plan
          const { config } = await loadReleaseConfig({
            cwd: repoRoot,
            profileKey: flags.profile as string | undefined,
            cli: {
              bump: flags.bump,
            },
          });

          const plan = await planRelease({
            cwd: repoRoot,
            config,
            scope: flags.scope as string | undefined,
            bumpOverride: flags.bump as any,
          });

          // Validation logic
          const hasPackages = plan.packages.length > 0;
          const hasBreaking = plan.packages.some(pkg => {
            if (!pkg.currentVersion || !pkg.nextVersion) return false;
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
            const allowedTypes = (flags['allow-types'] as string).split(',');
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

          // Format output
          if (jsonMode) {
            ctx.presenter.json({
              valid: isValid,
              hasPackages,
              hasBreaking,
              issues,
              plan,
            });
          } else {
            const lines: string[] = [];
            lines.push(`Release Verification: ${isValid ? safeColors.info('✓ PASSED') : safeColors.error('✗ FAILED')}`);
            lines.push('');
            
            const status: Record<string, string> = {
              'Has Packages': hasPackages ? 'Yes' : 'No',
              'Has Breaking Changes': hasBreaking ? 'Yes' : 'No',
              'Status': isValid ? 'Valid for release' : 'Blocked',
            };
            lines.push(...keyValue(status));

            if (issues.length > 0) {
              lines.push('');
              lines.push('Issues:');
              for (const issue of issues) {
                lines.push(`  - ${safeColors.error(issue)}`);
              }
            }

            const output = box('Release Verification', lines);
            ctx.presenter.write(output);
          }

          // Track completion
          await emit({
            type: ANALYTICS_EVENTS.VERIFY_FINISHED,
            payload: {
              valid: isValid,
              hasPackages,
              hasBreaking,
              issuesCount: issues.length,
              durationMs: tracker.total(),
              result: isValid ? 'success' : 'failed',
            },
          });

          return isValid ? 0 : 2; // Exit code 2 for validation failure
        } catch (error) {
          // Track failure
          await emit({
            type: ANALYTICS_EVENTS.VERIFY_FINISHED,
            payload: {
              durationMs: tracker.total(),
              result: 'error',
              error: error instanceof Error ? error.message : String(error),
            },
          });

          ctx.presenter.error(`Verification failed: ${error instanceof Error ? error.message : String(error)}`);
          return 1;
        }
      }
    );
  },
};


