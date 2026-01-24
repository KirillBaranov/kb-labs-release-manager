/**
 * Release changelog command
 * Generate changelog from conventional commits
 */

import { join } from 'node:path';
import { stat, writeFile, mkdir, readFile } from 'node:fs/promises';
import { defineCommand, type CommandResult, type PluginContextV3, useLLM, useLoader, displayArtifacts, type ArtifactInfo, useConfig } from '@kb-labs/sdk';
import { type ReleaseConfig } from '@kb-labs/release-manager-core';
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

type ChangelogInput = {
  scope?: string;
  profile?: string;
  from?: string;
  to?: string;
  'since-tag'?: string;
  format?: 'json' | 'md' | 'both';
  level?: 'compact' | 'standard' | 'detailed';
  template?: string;
  'breaking-only'?: boolean;
  json?: boolean;
  argv?: string[];
} & { flags?: any };

type ReleaseChangelogResult = CommandResult & {
  manifest?: ReleaseManifest;
  changes?: Change[];
  changesCount?: number;
  artifacts?: Array<{ name: string; path: string; size: number }>;
};

export default defineCommand({
  id: 'release:changelog',
  description: 'Generate changelog from conventional commits',

  handler: {
    async execute(ctx: PluginContextV3, input: ChangelogInput): Promise<ReleaseChangelogResult> {
      const flags = (input as any).flags ?? input;
      const cwd = ctx.cwd || process.cwd();
      const repoRoot = await findRepoRoot(cwd);

      // Stage 1: Load configuration
      const loader = useLoader('Loading configuration...');
      loader.start();

      const fileConfig = await useConfig<ReleaseConfig>();
      const config: ReleaseConfig = fileConfig ?? {};

      // Stage 2: Discover packages
      loader.update({ text: 'Discovering packages...' });

      const plan = await planRelease({
        cwd: repoRoot,
        config,
        scope: flags.scope,
      });

      if (plan.packages.length === 0) {
        loader.fail(`No packages found matching scope: ${flags.scope || 'all'}`);
        return { exitCode: 1 };
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

      // Stage 3: Generate changelog
      loader.update({ text: 'Generating changelog...' });

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
      } catch (err) {
        loader.fail('Failed to generate changelog');
        const errorMessage = err instanceof Error ? err.message : String(err);
        ctx.platform?.logger?.error?.(`Changelog generation failed: ${errorMessage}`);

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

      // Stage 4: Save outputs
      loader.update({ text: 'Saving artifacts...' });

      const outputDir = join(repoRoot, '.kb', 'release');
      const artifacts: ArtifactInfo[] = [];

      if (!flags.json) {
        await mkdir(outputDir, { recursive: true });

        if (result.markdown && (format === 'md' || format === 'both')) {
          const changelogPath = join(outputDir, 'CHANGELOG.md');

          // Read existing changelog if it exists and prepend new content
          let existingChangelog = '';
          try {
            existingChangelog = await readFile(changelogPath, 'utf-8');
            // Remove the footer from existing changelog if present
            const footerStart = existingChangelog.indexOf('\n---\n\n*Generated automatically');
            if (footerStart !== -1) {
              existingChangelog = existingChangelog.substring(0, footerStart);
            }
          } catch {
            // File doesn't exist yet, that's fine
          }

          // Prepend new changelog entry (newest first)
          const combinedChangelog = existingChangelog
            ? `${result.markdown}\n\n${existingChangelog}`
            : result.markdown;

          await writeFile(changelogPath, combinedChangelog, 'utf-8');
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

      ctx.platform?.logger?.info?.('Release changelog completed', {
        changesCount: displayChanges.length,
        packagesCount: packages.length,
        format,
        level,
      });

      const formatLabel = format === 'both' ? 'Markdown + JSON' : format;

      if (flags.json) {
        ctx.ui?.json?.({
          changesCount: displayChanges.length,
          packagesCount: packages.length,
          range: result.range,
          markdown: format === 'md' || format === 'both' ? result.markdown : undefined,
          manifest: format === 'json' || format === 'both' ? result.manifest : undefined,
          artifacts: artifacts.map(a => ({ name: a.name, path: a.path, size: a.size ?? 0 })),
        });
      } else {
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

        ctx.ui.sideBox({
          title: 'Changelog Generated',
          sections: [
            {
              header: 'Summary',
              items: [
                `Packages: ${packages.map(p => p.name).join(', ')}`,
                `Range: ${result.range.from.substring(0, 7)}..${result.range.to.substring(0, 7)}`,
                `Commits: ${displayChanges.length}`,
                `Format: ${formatLabel}`,
              ],
            },
            ...sections,
          ],
          status: 'success',
        });
      }

      return {
        exitCode: 0,
        changesCount: displayChanges.length,
        artifacts: artifacts.map(a => ({ name: a.name, path: a.path, size: a.size ?? 0 })),
      };
    },
  },
});
