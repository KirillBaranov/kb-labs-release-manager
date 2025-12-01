/**
 * Markdown changelog formatter with i18n support and rendering levels
 */

import type { PackageRelease, Change, CommitType } from '../types';

export type RenderingLevel = 'compact' | 'standard' | 'detailed';

/**
 * Format package release as markdown
 */
export function formatPackageAsMarkdown(
  pkg: PackageRelease,
  level: RenderingLevel = 'standard',
  locale: 'en' | 'ru' = 'en'
): string {
  const lines: string[] = [];
  
  // Extract version info
  const versionSection = formatVersionInfo(pkg, locale);
  if (versionSection) {
    lines.push(versionSection);
  }
  
  // Breaking changes
  if (pkg.breaking && pkg.breaking.length > 0) {
    lines.push('### ' + t('breaking_changes', locale));
    for (const breaking of pkg.breaking) {
      lines.push(`- **${pkg.name}**: ${breaking.summary}`);
    }
  }
  
  // Group changes by type
  const groupedChanges = groupChangesByType(pkg.changes);
  
  // Render by type groups
  for (const [type, changes] of Object.entries(groupedChanges)) {
    if (changes.length === 0) continue;
    
    const sectionTitle = formatSectionTitle(type as CommitType, locale);
    lines.push(`### ${sectionTitle}`);
    
    for (const change of changes) {
      lines.push(formatChangeLine(change, level));
    }
  }
  
  // Package versions summary
  const versionsSection = formatPackageVersions(pkg, locale);
  lines.push(versionsSection);
  
  return lines.join('\n');
}

/**
 * Format change line based on rendering level
 */
function formatChangeLine(change: Change, level: RenderingLevel): string {
  const bullet = '-';
  let line = `${bullet} **${change.scope || 'global'}**: ${change.subject}`;
  
  if (level === 'compact') {
    return line;
  }
  
  // Standard: add links
  const links: string[] = [];
  
  if (change.providerLinks?.commit) {
    links.push(`[${change.sha.substring(0, 7)}](${change.providerLinks.commit})`);
  }
  
  if (change.providerLinks?.pr && change.providerLinks.pr.length > 0) {
    for (const prLink of change.providerLinks.pr) {
      const match = prLink.match(/[^/]+$/);
      links.push(`[${match && match[0] ? match[0] : 'PR'}](${prLink})`);
    }
  }
  
  if (links.length > 0) {
    line += ` (${links.join(', ')})`;
  }
  
  // Detailed: add authors, file counts
  if (level === 'detailed') {
    const details: string[] = [];
    if (change.author) {
      details.push(`@${change.author.name}`);
    }
    if (change.coAuthors && change.coAuthors.length > 0) {
      details.push(...change.coAuthors.map(a => `@${a.name}`));
    }
    if (change.filesChanged && change.filesChanged.length > 0) {
      details.push(`${change.filesChanged.length} files`);
    }
    if (details.length > 0) {
      line += ` — ${details.join(', ')}`;
    }
  }
  
  return line;
}

/**
 * Group changes by type
 */
function groupChangesByType(changes: Change[]): Record<string, Change[]> {
  const grouped: Record<string, Change[]> = {};
  
  for (const change of changes) {
    const type = change.type;
    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type].push(change);
  }
  
  return grouped;
}

/**
 * Format section title based on locale
 */
function formatSectionTitle(type: CommitType, locale: 'en' | 'ru'): string {
  const titles: Record<string, Record<'en' | 'ru', string>> = {
    feat: { en: 'Features', ru: 'Новые возможности' },
    fix: { en: 'Bug Fixes', ru: 'Исправления' },
    perf: { en: 'Performance', ru: 'Производительность' },
    refactor: { en: 'Refactoring', ru: 'Рефакторинг' },
    docs: { en: 'Documentation', ru: 'Документация' },
    build: { en: 'Build', ru: 'Сборка' },
    ci: { en: 'CI/CD', ru: 'CI/CD' },
    test: { en: 'Tests', ru: 'Тесты' },
    chore: { en: 'Chores', ru: 'Обслуживание' },
    revert: { en: 'Reverts', ru: 'Откаты' },
  };
  
  return titles[type]?.[locale] || type;
}

/**
 * Format version info with reason
 */
function formatVersionInfo(pkg: PackageRelease, locale: 'en' | 'ru'): string {
  const reasonLabels: Record<string, Record<'en' | 'ru', string>> = {
    breaking: { en: 'major bump from breaking changes', ru: 'major из-за breaking changes' },
    feat: { en: 'minor: feat', ru: 'minor: новая функциональность' },
    fix: { en: 'patch: fix', ru: 'patch: исправление' },
    perf: { en: 'patch: perf', ru: 'patch: производительность' },
    ripple: { en: 'patch: ripple', ru: 'patch: зависимость' },
    manual: { en: 'manual', ru: 'ручное' },
  };
  
  const label = reasonLabels[pkg.reason]?.[locale] || pkg.reason;
  
  if (pkg.rippleFrom && pkg.rippleFrom.length > 0) {
    return `### ${pkg.name}: ${pkg.prev} → ${pkg.next} (${label}) from ${pkg.rippleFrom.join(', ')}`;
  }
  
  return `### ${pkg.name}: ${pkg.prev} → ${pkg.next} (${label})`;
}

/**
 * Format package versions summary
 */
function formatPackageVersions(pkg: PackageRelease, locale: 'en' | 'ru'): string {
  const header = t('package_versions', locale);
  return `### ${header}\n- ${pkg.name}: ${pkg.prev} → ${pkg.next}`;
}

/**
 * Simple translation helper
 */
function t(key: string, locale: 'en' | 'ru'): string {
  const translations: Record<string, Record<'en' | 'ru', string>> = {
    breaking_changes: { en: 'BREAKING CHANGES', ru: 'КРИТИЧЕСКИЕ ИЗМЕНЕНИЯ' },
    package_versions: { en: 'Package Versions', ru: 'Версии пакетов' },
  };
  
  return translations[key]?.[locale] || key;
}

