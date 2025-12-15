/**
 * Release changelog command
 * Generate changelog from conventional commits
 */

import { join } from 'node:path';
import { stat, writeFile, mkdir } from 'node:fs/promises';
import { defineCommand, type CommandResult, useLLM, useLoader, displayArtifacts, type ArtifactInfo } from '@kb-labs/sdk';
import { loadReleaseConfig } from '@kb-labs/release-manager-core';
import {
  generateChangelog,
  generateSimpleChangelog,
  type Change,
  type ReleaseManifest,
  type ChangelogPackageInfo,
} from '@kb-labs/release-manager-changelog';
import { planRelease } from '@kb-labs/release-manager-core';
import { findRepoRoot } from '../../shared/utils';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events';

type ReleaseChangelogFlags = {
  scope: { type: 'string'; description?: string };
  profile: { type: 'string'; description?: string };
  from: { type: 'string'; description?: string };
  to: { type: 'string'; description?: string };
  'since-tag': { type: 'string'; description?: string };
  format: { type: 'string'; description?: string; choices?: readonly string[]; default?: string };
  level: { type: 'string'; description?: string; choices?: readonly string[]; default?: string };
  template: { type: 'string'; description?: string };
  'breaking-only': { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleaseChangelogResult = CommandResult & {
  manifest?: ReleaseManifest;
  changes?: Change[];
  files?: string[];
};

export const changelogCommand = defineCommand({
  name: 'release:changelog',
  flags: {
    scope: {
      type: 'string',
      description: 'Filter to specific package',
    },
    profile: {
      type: 'string',
      description: 'Release profile to use',
    },
    from: {
      type: 'string',
      description: 'Start commit/tag',
    },
    to: {
      type: 'string',
      description: 'End commit/tag (default: HEAD)',
    },
    'since-tag': {
      type: 'string',
      description: 'Shorthand for --from <tag>',
    },
    format: {
      type: 'string',
      description: 'Output format',
      choices: ['json', 'md', 'both'] as const,
      default: 'both',
    },
    level: {
      type: 'string',
      description: 'Detail level',
      choices: ['compact', 'standard', 'detailed'] as const,
      default: 'standard',
    },
    template: {
      type: 'string',
      description: 'Template name (builtin: corporate, corporate-ai, technical, compact) or custom path',
    },
    'breaking-only': {
      type: 'boolean',
      description: 'Show only breaking changes',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.CHANGELOG_STARTED,
    finishEvent: ANALYTICS_EVENTS.CHANGELOG_FINISHED,
    actor: ANALYTICS_ACTOR.id,
    includeFlags: true,
  },
  async handler(ctx: any, argv: string[], flags: any) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    // === Stage 1: Load configuration ===
    const loader = useLoader('Loading configuration...');
    loader.start();
    ctx.tracker.checkpoint('config');

    const { config } = await loadReleaseConfig({
      cwd: repoRoot,
      profileId: flags.profile,
    });

    // === Stage 2: Discover packages ===
    loader.update({ text: 'Discovering packages...' });
    ctx.tracker.checkpoint('plan');

    const plan = await planRelease({
      cwd: repoRoot,
      config,
      scope: flags.scope,
    });

    if (plan.packages.length === 0) {
      loader.fail(`No packages found matching scope: ${flags.scope || 'all'}`);
      return { ok: false };
    }

    // Convert plan packages to ChangelogPackageInfo
    const packages: ChangelogPackageInfo[] = plan.packages.map(pkg => ({
      name: pkg.name,
      path: pkg.path,
      currentVersion: pkg.currentVersion,
      nextVersion: pkg.nextVersion,
      bump: pkg.bump === 'auto' ? 'patch' : pkg.bump,
    }));

    // Determine git working directory (for submodule support)
    let gitCwd = repoRoot;
    if (flags.scope && plan.packages.length > 0 && plan.packages[0]) {
      try {
        gitCwd = await findRepoRoot(plan.packages[0].path);
      } catch {
        gitCwd = plan.packages[0].path;
      }
    }

    // === Stage 3: Generate changelog ===
    loader.update({ text: 'Generating changelog...' });
    ctx.tracker.checkpoint('generate');

    const llm = useLLM();
    const platform = llm ? { llm } : undefined;
    const format = flags.format || config.changelog?.format || 'both';
    const level = flags.level || config.changelog?.level || 'standard';

    let result;
    try {
      result = await generateChangelog({
        repoRoot,
        gitCwd,
        packages,
        range: {
          from: flags.from,
          to: flags.to,
          sinceTag: flags['since-tag'],
        },
        changelog: {
          template: flags.template || config.changelog?.template,
          locale: config.changelog?.locale as 'en' | 'ru',
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
        platform,
        onProgress: (message) => loader.update({ text: message }),
      });
    } catch (error) {
      loader.fail('Failed to generate changelog');
      ctx.logger?.error('Changelog generation failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to simple changelog
      const locale = (config.changelog?.locale as 'en' | 'ru') || 'en';
      const markdown = generateSimpleChangelog(packages, locale);

      result = {
        markdown,
        manifest: null,
        changes: [],
        range: { from: 'unknown', to: 'HEAD' },
        packages: [],
      };
    }

    // Filter changes if breaking-only flag is set
    const displayChanges = flags['breaking-only']
      ? result.changes.filter(c => c.breaking)
      : result.changes;

    // === Stage 4: Save outputs ===
    loader.update({ text: 'Saving artifacts...' });
    ctx.tracker.checkpoint('save');

    const outputDir = join(repoRoot, '.kb', 'release');
    const artifacts: ArtifactInfo[] = [];

    if (!flags.json) {
      await mkdir(outputDir, { recursive: true });

      if (result.markdown && (format === 'md' || format === 'both')) {
        const changelogPath = join(outputDir, 'CHANGELOG.md');
        await writeFile(changelogPath, result.markdown, 'utf-8');
        const stats = await stat(changelogPath);
        artifacts.push({
          name: 'Changelog',
          path: changelogPath,
          size: stats.size,
          modified: stats.mtime,
          description: 'Generated changelog in Markdown format',
        });
      }

      if (result.manifest && (format === 'json' || format === 'both')) {
        const manifestPath = join(outputDir, 'release.manifest.json');
        await writeFile(manifestPath, JSON.stringify(result.manifest, null, 2), 'utf-8');
        const stats = await stat(manifestPath);
        artifacts.push({
          name: 'Manifest',
          path: manifestPath,
          size: stats.size,
          modified: stats.mtime,
          description: 'Release manifest in JSON format',
        });
      }
    }

    loader.succeed('Changelog generated successfully');
    ctx.tracker.checkpoint('complete');

    ctx.logger?.info('Release changelog completed', {
      changesCount: displayChanges.length,
      packagesCount: packages.length,
      format,
      level,
    });

    const formatLabel = format === 'both' ? 'Markdown + JSON' : format;

    if (flags.json) {
      ctx.ui.json({
        changesCount: displayChanges.length,
        packagesCount: packages.length,
        range: result.range,
        markdown: format === 'md' || format === 'both' ? result.markdown : undefined,
        manifest: format === 'json' || format === 'both' ? result.manifest : undefined,
        artifacts: artifacts.map(a => ({ name: a.name, path: a.path, size: a.size })),
      });
    } else {
      // Build artifacts section if any were created
      const sections: Array<{ header?: string; items: string[] }> = [];
      if (artifacts.length > 0) {
        const artifactsLines = displayArtifacts(artifacts, {
          showSize: true,
          showTime: true,
          showDescription: true,
          maxItems: 10,
          title: '',
        });
        sections.push({
          header: 'Artifacts',
          items: artifactsLines,
        });
      }

      ctx.ui.success('Changelog Generated', {
        summary: {
          'Packages': packages.map(p => p.name).join(', '),
          'Range': `${result.range.from.substring(0, 7)}..${result.range.to.substring(0, 7)}`,
          'Commits': displayChanges.length,
          'Format': formatLabel,
        },
        sections,
        timing: ctx.tracker.total(),
      });
    }

    return { ok: true, changesCount: displayChanges.length, artifacts };
  },
});
