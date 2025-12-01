/**
 * Release changelog command
 * Generate changelog from conventional commits
 */

import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { defineCommand, type CommandResult } from '@kb-labs/shared-command-kit';
import { loadReleaseConfig } from '@kb-labs/release-manager-core';
import {
  resolveGitRange,
  parseCommits,
  formatAsJson,
  createReleaseManifest,
  detectProvider,
  enhanceChangeWithLinks,
  type Change,
  type ReleaseManifest,
  type PackageRelease,
} from '@kb-labs/release-manager-changelog';
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
  'breaking-only': { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleaseChangelogResult = CommandResult & {
  manifest?: ReleaseManifest;
  changes?: Change[];
  files?: string[];
};

/**
 * Helper: Format simple markdown changelog
 */
function formatSimpleMarkdown(changes: Change[], level: string, locale: 'en' | 'ru'): string {
  const lines: string[] = [];
  lines.push(locale === 'ru' ? '# Журнал изменений\n' : '# Changelog\n');
  
  if (changes.length === 0) {
    lines.push('_No changes_\n');
    return lines.join('\n');
  }
  
  // Group by type
  const grouped: Record<string, Change[]> = {};
  for (const change of changes) {
    const type = change.type;
    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type].push(change);
  }
  
  // Render grouped
  for (const [type, changesList] of Object.entries(grouped)) {
    const title = type.charAt(0).toUpperCase() + type.slice(1);
    lines.push(`## ${title}\n`);
    
    for (const change of changesList) {
      let line = `- ${change.subject}`;
      if (level !== 'compact' && change.providerLinks?.commit) {
        line += ` ([${change.sha.substring(0, 7)}](${change.providerLinks.commit}))`;
      }
      lines.push(line);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

export const changelogCommand = defineCommand<ReleaseChangelogFlags, ReleaseChangelogResult>({
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
  async handler(ctx, argv, flags) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    
    ctx.tracker.checkpoint('config');

    // Load configuration
    const { config } = await loadReleaseConfig({
      cwd: repoRoot,
      profileKey: flags.profile,
    });

    ctx.tracker.checkpoint('range');

    // Resolve git range
    const range = await resolveGitRange({
      cwd: repoRoot,
      from: flags.from,
      to: flags.to,
      sinceTag: flags['since-tag'],
      autoUnshallow: config.git?.autoUnshallow,
      requireSignedTags: config.git?.requireSignedTags,
    });

    ctx.tracker.checkpoint('parse');

    // Detect git provider
    const provider = await detectProvider(repoRoot, config.git?.baseUrl);

    // Parse commits
    const changes = await parseCommits({
      cwd: repoRoot,
      from: range.from,
      to: range.to,
      ignoreAuthors: config.changelog?.ignoreAuthors || [],
      includeTypes: config.changelog?.includeTypes as string[] | undefined,
      excludeTypes: config.changelog?.excludeTypes as string[] | undefined,
      collapseMerges: config.changelog?.collapseMerges,
      collapseReverts: config.changelog?.collapseReverts,
      preferMergeSummary: config.changelog?.preferMergeSummary,
    });

    // Filter breaking changes if requested
    const filteredChanges = flags['breaking-only']
      ? changes.filter(change => change.breaking)
      : changes;

    // Enhance changes with provider links
    const enhancedChanges = filteredChanges.map(change => enhanceChangeWithLinks(change, provider));

    ctx.tracker.checkpoint('format');

    // Format output
    const format = flags.format || config.changelog?.format || 'both';
    const level = flags.level || config.changelog?.level || 'standard';
    const locale = (config.changelog?.locale as 'en' | 'ru') || 'en';

    let markdown = '';
    let jsonManifest: ReleaseManifest | null = null;

    if (format === 'md' || format === 'both') {
      markdown = formatSimpleMarkdown(enhancedChanges, level, locale);
    }

    if (format === 'json' || format === 'both') {
      const packages: PackageRelease[] = [];
      jsonManifest = createReleaseManifest(range, packages);
      jsonManifest = JSON.parse(formatAsJson(jsonManifest));
    }

    ctx.tracker.checkpoint('save');

    // Save outputs
    if (!flags.json) {
      const outputDir = join(repoRoot, '.kb', 'release');
      await mkdir(outputDir, { recursive: true });

      if (markdown) {
        await writeFile(join(outputDir, 'CHANGELOG.md'), markdown, 'utf-8');
      }

      if (jsonManifest) {
        await writeFile(join(outputDir, 'release.manifest.json'), JSON.stringify(jsonManifest, null, 2), 'utf-8');
      }
    }

    ctx.tracker.checkpoint('complete');

    ctx.logger?.info('Release changelog completed', { 
      changesCount: enhancedChanges.length,
      format,
      level,
    });

    if (flags.json) {
      ctx.output?.json({
        changesCount: enhancedChanges.length,
        range,
        markdown: format === 'md' || format === 'both' ? markdown : undefined,
        manifest: format === 'json' || format === 'both' ? jsonManifest : undefined,
      });
    } else {
      if (!ctx.output) {
        throw new Error('Output not available');
      }

      const formatLabel = format === 'both' ? 'Markdown + JSON' : format;
      const outputLabel = format.includes('md') && format.includes('json')
        ? '.kb/release/CHANGELOG.md + release.manifest.json'
        : format === 'md'
        ? '.kb/release/CHANGELOG.md'
        : '.kb/release/release.manifest.json';

      const sections: Array<{ header?: string; items: string[] }> = [
        {
          header: 'Summary',
          items: [
            `Range: ${range.from}..${range.to}`,
            `Commits: ${enhancedChanges.length}`,
            `Format: ${formatLabel}`,
            `Level: ${level}`,
          ],
        },
        {
          header: 'Output',
          items: [outputLabel],
        },
      ];

      const outputText = ctx.output.ui.sideBox({
        title: 'Changelog Generated',
        sections,
        status: 'success',
        timing: ctx.tracker.total(),
      });
      ctx.output.write(outputText);
    }

    return { ok: true, changesCount: enhancedChanges.length };
  },
});
