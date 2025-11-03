/**
 * Release changelog command
 * Generate changelog from conventional commits
 */

import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import type { Command } from '@kb-labs/cli-commands';
import { box, safeColors, keyValue, TimingTracker } from '@kb-labs/shared-cli-ui';
import { loadReleaseConfig } from '@kb-labs/release-core';
import {
  resolveGitRange,
  parseCommits,
  formatAsJson,
  createReleaseManifest,
  detectProvider,
  enhanceChangeWithLinks,
  formatPackageAsMarkdown,
  type Change,
  type ReleaseManifest,
  type GitProvider,
  type PackageRelease,
} from '@kb-labs/changelog';
import { findRepoRoot } from '../utils.js';
import { runScope, type AnalyticsEventV1, type EmitResult } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../analytics/events';

/**
 * Helper: Format simple markdown changelog
 */
function formatSimpleMarkdown(changes: Change[], level: string, locale: 'en' | 'ru'): string {
  const lines: string[] = [];
  lines.push('# Changelog\n');
  
  if (changes.length === 0) {
    lines.push('_No changes_\n');
    return lines.join('\n');
  }
  
  // Group by type
  const grouped: Record<string, Change[]> = {};
  for (const change of changes) {
    const type = change.type;
    if (!grouped[type]) grouped[type] = [];
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

export const changelog: Command = {
  name: 'release:changelog',
  category: 'release',
  describe: 'Generate changelog from conventional commits',
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
            type: ANALYTICS_EVENTS.CHANGELOG_STARTED,
            payload: {
              profile: flags.profile as string | undefined,
              format: flags.format as string | undefined,
              level: flags.level as string | undefined,
              from: flags.from as string | undefined,
              sinceTag: flags['since-tag'] as string | undefined,
            },
          });

          // Load configuration
          const { config } = await loadReleaseConfig({
            cwd: repoRoot,
            profileKey: flags.profile as string | undefined,
          });

          // Resolve git range
          const range = await resolveGitRange({
            cwd: repoRoot,
            from: flags.from as string | undefined,
            to: flags.to as string | undefined,
            sinceTag: flags['since-tag'] as string | undefined,
            autoUnshallow: config.git?.autoUnshallow,
            requireSignedTags: config.git?.requireSignedTags,
          });

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

          // Enhance changes with provider links
          const enhancedChanges = changes.map(change => enhanceChangeWithLinks(change, provider));

          // Format output
          const format = (flags.format as 'json' | 'md' | 'both') || config.changelog?.format || 'both';
          const level = (flags.level as 'compact' | 'standard' | 'detailed') || config.changelog?.level || 'standard';
          const locale = (config.changelog?.locale as 'en' | 'ru') || 'en';

          let markdown = '';
          let jsonManifest: ReleaseManifest | null = null;

          if (format === 'md' || format === 'both') {
            // For now, simple markdown output
            markdown = formatSimpleMarkdown(enhancedChanges, level, locale);
          }

          if (format === 'json' || format === 'both') {
            // Create simplified manifest
            const packages: PackageRelease[] = [];
            jsonManifest = createReleaseManifest(range, packages);
            jsonManifest = JSON.parse(formatAsJson(jsonManifest));
          }

          // Save outputs
          if (!jsonMode) {
            const outputDir = join(repoRoot, '.kb', 'release');
            await mkdir(outputDir, { recursive: true });

            if (markdown) {
              await writeFile(join(outputDir, 'CHANGELOG.md'), markdown, 'utf-8');
            }

            if (jsonManifest) {
              await writeFile(join(outputDir, 'release.manifest.json'), JSON.stringify(jsonManifest, null, 2), 'utf-8');
            }
          }

          // Summarize
          if (jsonMode) {
            ctx.presenter.json({
              changesCount: enhancedChanges.length,
              range,
              markdown: format === 'md' || format === 'both' ? markdown : undefined,
              manifest: format === 'json' || format === 'both' ? jsonManifest : undefined,
            });
          } else {
            const lines: string[] = [];
            lines.push('Changelog Generated:');
            lines.push('');

            const stats: Record<string, string> = {
              'Range': `${range.from}..${range.to}`,
              'Commits': `${enhancedChanges.length}`,
              'Format': format === 'both' ? 'Markdown + JSON' : format,
              'Level': level,
              'Output': format.includes('md') && format.includes('json') ? '.kb/release/CHANGELOG.md + release.manifest.json' : format === 'md' ? '.kb/release/CHANGELOG.md' : '.kb/release/release.manifest.json',
            };
            lines.push(...keyValue(stats));

            const output = box('Changelog', lines);
            ctx.presenter.write(output);
          }

          // Track completion
          await emit({
            type: ANALYTICS_EVENTS.CHANGELOG_FINISHED,
            payload: {
              profile: flags.profile as string | undefined,
              changesCount: enhancedChanges.length,
              format,
              level,
              durationMs: tracker.total(),
              result: 'success',
            },
          });

          return 0;
        } catch (error) {
          // Track failure
          await emit({
            type: ANALYTICS_EVENTS.CHANGELOG_FINISHED,
            payload: {
              profile: flags.profile as string | undefined,
              durationMs: tracker.total(),
              result: 'error',
              error: error instanceof Error ? error.message : String(error),
            },
          });

          if (jsonMode) {
            ctx.presenter.json({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            ctx.presenter.error(`Failed to generate changelog: ${error instanceof Error ? error.message : String(error)}`);
          }
          return 1;
        }
      }
    );
  },
};


