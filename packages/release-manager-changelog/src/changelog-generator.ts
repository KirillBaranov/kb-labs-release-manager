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
import { formatLockstepChangelog } from './formatters/markdown';
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

  // Normalize a package path to a relative-from-gitCwd prefix for matching against
  // filesChanged entries (which git reports relative to gitCwd).
  function normalizePkgPath(pkgPath: string): string {
    // Prefer normalizing relative to gitCwd (where git was run from),
    // then fall back to repoRoot.
    let rel: string;
    if (pkgPath.startsWith(gitCwd)) {
      rel = pkgPath.slice(gitCwd.length).replace(/^\/+/, '');
    } else if (pkgPath.startsWith(repoRoot)) {
      rel = pkgPath.slice(repoRoot.length).replace(/^\/+/, '');
    } else {
      rel = pkgPath.replace(/^\/+/, '');
    }
    return rel.endsWith('/') ? rel : rel + '/';
  }

  const packageReleases: PackageRelease[] = packages.map(pkg => {
    const pkgPrefix = normalizePkgPath(pkg.path);

    // Filter changes that touched at least one file inside this package's directory.
    // Falls back to all changes when the package sits at repo root (monorepo root release).
    const isRoot = pkgPrefix === '/' || pkgPrefix === '' || pkgPrefix === './';
    const pkgChanges = isRoot
      ? enhancedChanges
      : enhancedChanges.filter(c =>
          !c.filesChanged || c.filesChanged.length === 0
            ? true // keep commits with no file info (e.g. merge commits, empty commits)
            : c.filesChanged.some(f => f.startsWith(pkgPrefix))
        );

    const hasBreaking = pkgChanges.some(c => c.breaking && c.breaking.length > 0);
    const hasFeat = pkgChanges.some(c => c.type === 'feat');
    const hasFix = pkgChanges.some(c => c.type === 'fix');
    const hasPerf = pkgChanges.some(c => c.type === 'perf');

    let reason: 'breaking' | 'feat' | 'fix' | 'perf' | 'ripple' | 'manual' = 'manual';
    if (hasBreaking) {reason = 'breaking';}
    else if (hasFeat) {reason = 'feat';}
    else if (hasFix) {reason = 'fix';}
    else if (hasPerf) {reason = 'perf';}

    return {
      name: pkg.name,
      prev: pkg.currentVersion,
      next: pkg.nextVersion,
      bump: pkg.bump,
      reason,
      breaking: pkgChanges.filter(c => c.breaking && c.breaking.length > 0).flatMap(c => c.breaking!),
      changes: pkgChanges,
    };
  });

  // Step 6: Create release manifest
  const manifest = createReleaseManifest(range, packageReleases);

  // Step 7: Detect lockstep — all packages share the same next version
  const uniqueNextVersions = new Set(packageReleases.map(p => p.next));
  const isLockstep = packageReleases.length > 1 && uniqueNextVersions.size === 1;

  let markdown: string;

  if (isLockstep) {
    // Consolidated single-section changelog for lockstep monorepo releases
    onProgress?.('Formatting consolidated lockstep changelog...');
    const sharedVersion = packageReleases[0]!.next;
    markdown = formatLockstepChangelog(packageReleases, sharedVersion, locale);
  } else {
    // Step 8 (original): Load template and format each package separately
    const templateName = changelogConfig?.template || 'corporate-ai';
    onProgress?.(`Loading template "${templateName}"...`);
    const template = await loadTemplate(templateName, repoRoot);

    const formattedPackages: string[] = [];
    for (let i = 0; i < packageReleases.length; i++) {
      const pkg = packageReleases[i];
      if (!pkg) {continue;}

      onProgress?.(`Formatting changelog for ${pkg.name} (${i + 1}/${packageReleases.length})...`);

      const templateData = packageToTemplateData(pkg, locale, changelogConfig?.metadata);
      const result = template.render(templateData, platform);
      const formatted = typeof result === 'string' ? result : await result;

      formattedPackages.push(formatted);
    }

    markdown = formattedPackages.join('\n\n');
  }

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
  const date = new Date().toISOString().split('T')[0]!;

  // Detect lockstep (all packages share same next version)
  const uniqueVersions = new Set(packages.map(p => p.nextVersion));
  const isLockstep = packages.length > 1 && uniqueVersions.size === 1;

  if (isLockstep) {
    const version = packages[0]!.nextVersion;
    const title = locale === 'ru' ? 'Релиз' : 'Release';
    const pkgWord = locale === 'ru' ? 'пакетов' : packages.length === 1 ? 'package' : 'packages';
    const lines: string[] = [
      `## [${version}] - ${date}`,
      '',
      `**${packages.length} ${pkgWord}** bumped to v${version}`,
      '',
      `| Package | Previous | Bump |`,
      `|---------|----------|------|`,
      ...packages.map(p => `| \`${p.name}\` | ${p.currentVersion} | ${p.bump} |`),
    ];
    return lines.join('\n');
  }

  const title = locale === 'ru' ? 'Релиз' : 'Release';
  const lines: string[] = [`## [${date}] ${title}\n\n`];

  for (const pkg of packages) {
    lines.push(`- **${pkg.name}**: ${pkg.currentVersion} → ${pkg.nextVersion}`);
  }

  return lines.join('\n');
}
