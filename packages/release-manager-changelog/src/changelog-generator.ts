/**
 * Changelog Generator - Reusable changelog generation logic
 * Used by both release:run and release:changelog commands
 */

import type { Change, PackageRelease, ReleaseManifest, GitRange } from './types';
import type { ILLM, ILogger, IAnalytics } from '@kb-labs/sdk';
import { resolveGitRange } from './git-range';
import { parseCommits } from './parser';
import { detectProvider, enhanceChangeWithLinks } from './providers';
import { createReleaseManifest, formatAsJson } from './formatters/json';
import { loadTemplate, packageToTemplateData } from './templates';

/**
 * Package info for changelog generation
 */
export interface ChangelogPackageInfo {
  name: string;
  path: string;
  currentVersion: string;
  nextVersion: string;
  bump: 'patch' | 'minor' | 'major' | 'none';
}

/**
 * Changelog generation options
 */
export interface GenerateChangelogOptions {
  /** Root directory of the repository */
  repoRoot: string;
  /** Git working directory (for submodule support) */
  gitCwd?: string;
  /** Packages to generate changelog for */
  packages: ChangelogPackageInfo[];
  /** Git range options */
  range?: {
    from?: string;
    to?: string;
    sinceTag?: string;
  };
  /** Changelog configuration */
  changelog?: {
    template?: string;
    locale?: 'en' | 'ru';
    metadata?: Record<string, unknown>;
    ignoreAuthors?: string[];
    includeTypes?: string[];
    excludeTypes?: string[];
    collapseMerges?: boolean;
    collapseReverts?: boolean;
    preferMergeSummary?: boolean;
  };
  /** Git configuration */
  git?: {
    autoUnshallow?: boolean;
    requireSignedTags?: boolean;
    baseUrl?: string;
  };
  /** Platform services for AI-powered formatting, logging, and analytics */
  platform?: { llm?: ILLM; logger?: ILogger; analytics?: IAnalytics };
  /** Progress callback */
  onProgress?: (message: string) => void;
}

/**
 * Changelog generation result
 */
export interface GenerateChangelogResult {
  /** Generated markdown content */
  markdown: string;
  /** Release manifest (JSON structure) */
  manifest: ReleaseManifest;
  /** Parsed and enhanced changes */
  changes: Change[];
  /** Git range used */
  range: GitRange;
  /** Package releases */
  packages: PackageRelease[];
}

/**
 * Generate changelog for packages
 *
 * This is the main reusable function for changelog generation.
 * Used by both release:run and release:changelog commands.
 */
export async function generateChangelog(
  options: GenerateChangelogOptions
): Promise<GenerateChangelogResult> {
  const {
    repoRoot,
    gitCwd = repoRoot,
    packages,
    range: rangeOptions,
    changelog: changelogConfig,
    git: gitConfig,
    platform,
    onProgress,
  } = options;

  const locale = changelogConfig?.locale || 'en';

  // Step 1: Resolve git range
  onProgress?.('Resolving git range...');
  const range = await resolveGitRange({
    cwd: gitCwd,
    from: rangeOptions?.from,
    to: rangeOptions?.to || 'HEAD',
    sinceTag: rangeOptions?.sinceTag,
    autoUnshallow: gitConfig?.autoUnshallow,
    requireSignedTags: gitConfig?.requireSignedTags,
  });

  // Step 2: Detect git provider
  onProgress?.('Detecting git provider...');
  const provider = await detectProvider(gitCwd, gitConfig?.baseUrl);

  // Step 3: Parse commits
  onProgress?.('Parsing commits...');
  const changes = await parseCommits({
    cwd: gitCwd,
    from: range.from,
    to: range.to,
    ignoreAuthors: changelogConfig?.ignoreAuthors || [],
    includeTypes: changelogConfig?.includeTypes,
    excludeTypes: changelogConfig?.excludeTypes,
    collapseMerges: changelogConfig?.collapseMerges,
    collapseReverts: changelogConfig?.collapseReverts,
    preferMergeSummary: changelogConfig?.preferMergeSummary,
  });

  // Step 4: Enhance changes with provider links
  onProgress?.('Enhancing changes with links...');
  const enhancedChanges = changes.map(change => enhanceChangeWithLinks(change, provider));

  // Step 5: Build package releases
  onProgress?.('Building package releases...');
  const packageReleases: PackageRelease[] = packages.map(pkg => {
    const hasBreaking = enhancedChanges.some(c => c.breaking);
    const hasFeat = enhancedChanges.some(c => c.type === 'feat');
    const hasFix = enhancedChanges.some(c => c.type === 'fix');
    const hasPerf = enhancedChanges.some(c => c.type === 'perf');

    let reason: 'breaking' | 'feat' | 'fix' | 'perf' | 'ripple' | 'manual' = 'manual';
    if (hasBreaking) reason = 'breaking';
    else if (hasFeat) reason = 'feat';
    else if (hasFix) reason = 'fix';
    else if (hasPerf) reason = 'perf';

    return {
      name: pkg.name,
      prev: pkg.currentVersion,
      next: pkg.nextVersion,
      bump: pkg.bump,
      reason,
      breaking: enhancedChanges.filter(c => c.breaking).flatMap(c => c.breaking!),
      changes: enhancedChanges,
    };
  });

  // Step 6: Create release manifest
  const manifest = createReleaseManifest(range, packageReleases);

  // Step 7: Load template and format
  const templateName = changelogConfig?.template || 'corporate-ai';
  onProgress?.(`Loading template "${templateName}"...`);
  const template = await loadTemplate(templateName, repoRoot);

  // Step 8: Format each package
  const formattedPackages: string[] = [];
  for (let i = 0; i < packageReleases.length; i++) {
    const pkg = packageReleases[i];
    if (!pkg) continue;

    onProgress?.(`Formatting changelog for ${pkg.name} (${i + 1}/${packageReleases.length})...`);

    const templateData = packageToTemplateData(pkg, locale, changelogConfig?.metadata);
    const result = template.render(templateData, platform);
    const formatted = typeof result === 'string' ? result : await result;

    formattedPackages.push(formatted);
  }

  const markdown = formattedPackages.join('\n\n');

  return {
    markdown,
    manifest: JSON.parse(formatAsJson(manifest)),
    changes: enhancedChanges,
    range,
    packages: packageReleases,
  };
}

/**
 * Generate simple fallback changelog (no LLM, no templates)
 */
export function generateSimpleChangelog(
  packages: ChangelogPackageInfo[],
  locale: 'en' | 'ru' = 'en'
): string {
  const date = new Date().toISOString().split('T')[0];
  const title = locale === 'ru' ? 'Релиз' : 'Release';
  const lines: string[] = [`## [${date}] ${title}\n\n`];

  for (const pkg of packages) {
    lines.push(`- **${pkg.name}**: ${pkg.currentVersion} → ${pkg.nextVersion}`);
  }

  return lines.join('\n');
}
