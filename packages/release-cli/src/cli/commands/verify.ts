/**
 * Release verify command
 * Validate release readiness
 */

import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { keyValue } from '@kb-labs/shared-cli-ui';
import { loadReleaseConfig, planRelease, type VersionBump } from '@kb-labs/release-core';
import { resolveGitRange, parseCommits } from '@kb-labs/changelog';
import { findRepoRoot } from '../../shared/utils.js';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events.js';

type ReleaseVerifyFlags = {
  scope: { type: 'string'; description?: string };
  profile: { type: 'string'; description?: string };
  bump: { type: 'string'; description?: string; choices?: readonly string[] };
  'fail-if-empty': { type: 'boolean'; description?: string; default?: boolean };
  'fail-on-breaking': { type: 'boolean'; description?: string; default?: boolean };
  'allow-types': { type: 'string'; description?: string };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleaseVerifyResult = CommandResult & {
  plan?: {
    packages: Array<{ name: string }>;
  };
  commits?: Array<{ type: string; breaking?: boolean }>;
  breakingDetected?: boolean;
};

export const verifyCommand = defineCommand<ReleaseVerifyFlags, ReleaseVerifyResult>({
  name: 'release:verify',
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
    'fail-if-empty': {
      type: 'boolean',
      description: 'Fail if no packages to release',
      default: false,
    },
    'fail-on-breaking': {
      type: 'boolean',
      description: 'Fail if breaking changes detected',
      default: false,
    },
    'allow-types': {
      type: 'string',
      description: 'Comma-separated list of required commit types',
    },
    json: {
      type: 'boolean',
      description: 'Output in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.VERIFY_STARTED,
    finishEvent: ANALYTICS_EVENTS.VERIFY_FINISHED,
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
      },
    });

    ctx.tracker.checkpoint('plan');

    const plan = await planRelease({
      cwd: repoRoot,
      config,
      scope: flags.scope,
      bumpOverride: flags.bump as VersionBump | undefined,
    });

    ctx.tracker.checkpoint('verify');

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

    ctx.tracker.checkpoint('complete');

    ctx.logger?.info('Release verify completed', { 
      valid: isValid,
      hasPackages,
      hasBreaking,
      issuesCount: issues.length,
    });

    if (flags.json) {
      ctx.output?.json({
        valid: isValid,
        hasPackages,
        hasBreaking,
        issues,
        plan,
      });
    } else {
      if (!ctx.output) {
        throw new Error('Output not available');
      }
      
      const lines: string[] = [];
      lines.push(`Release Verification: ${isValid ? ctx.output.ui.colors.info('✓ PASSED') : ctx.output.ui.colors.error('✗ FAILED')}`);
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
          lines.push(`  - ${ctx.output.ui.colors.error(issue)}`);
        }
      }

      const outputText = ctx.output.ui.box('Release Verification', lines);
      ctx.output.write(outputText);
    }

    // Return exit code 2 for validation failure (quality gate)
    return isValid ? 0 : 2;
  },
});
