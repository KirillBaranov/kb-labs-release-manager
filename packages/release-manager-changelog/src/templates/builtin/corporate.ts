/**
 * Corporate-style changelog template
 *
 * Professional format suitable for enterprise releases:
 * - Emoji for visual hierarchy
 * - Breaking changes prominently displayed
 * - Grouped by impact (Breaking > Features > Improvements > Fixes)
 * - Scope-based organization
 */

import type { ChangelogTemplate, TemplateData } from '../types';

export const version = '1.0' as const;

export function render(data: TemplateData): string {
  const { package: pkg, breaking, changes, locale } = data;
  const lines: string[] = [];

  // Header with version bump reason
  const reasonLabel = getReasonLabel(pkg.reason, locale);
  lines.push(`## ${pkg.name} ${pkg.next}`);
  lines.push('');
  lines.push(`**${pkg.prev} → ${pkg.next}** (${reasonLabel})`);
  lines.push('');

  // Breaking changes (critical section)
  if (breaking.length > 0) {
    const breakingTitle = locale === 'ru' ? '⚠️ КРИТИЧЕСКИЕ ИЗМЕНЕНИЯ' : '⚠️ BREAKING CHANGES';
    lines.push(`### ${breakingTitle}`);
    lines.push('');
    for (const br of breaking) {
      lines.push(`- **${br.summary}**`);
      if (br.notes) {
        lines.push(`  ${br.notes}`);
      }
    }
    lines.push('');
  }

  // Features
  if (changes.feat && changes.feat.length > 0) {
    const featTitle = locale === 'ru' ? '✨ Новые возможности' : '✨ New Features';
    lines.push(`### ${featTitle}`);
    lines.push('');
    for (const feat of changes.feat) {
      const scope = feat.scope ? `**${feat.scope}**` : 'general';
      lines.push(`- ${scope}: ${feat.subject}`);
    }
    lines.push('');
  }

  // Performance improvements
  if (changes.perf && changes.perf.length > 0) {
    const perfTitle = locale === 'ru' ? '⚡ Производительность' : '⚡ Performance Improvements';
    lines.push(`### ${perfTitle}`);
    lines.push('');
    for (const perf of changes.perf) {
      const scope = perf.scope ? `**${perf.scope}**` : 'general';
      lines.push(`- ${scope}: ${perf.subject}`);
    }
    lines.push('');
  }

  // Bug fixes
  if (changes.fix && changes.fix.length > 0) {
    const fixTitle = locale === 'ru' ? '🐛 Исправления' : '🐛 Bug Fixes';
    lines.push(`### ${fixTitle}`);
    lines.push('');
    for (const fix of changes.fix) {
      const scope = fix.scope ? `**${fix.scope}**` : 'general';
      lines.push(`- ${scope}: ${fix.subject}`);
    }
    lines.push('');
  }

  // Refactoring
  if (changes.refactor && changes.refactor.length > 0) {
    const refactorTitle = locale === 'ru' ? '♻️ Рефакторинг' : '♻️ Code Refactoring';
    lines.push(`### ${refactorTitle}`);
    lines.push('');
    for (const refactor of changes.refactor) {
      const scope = refactor.scope ? `**${refactor.scope}**` : 'general';
      lines.push(`- ${scope}: ${refactor.subject}`);
    }
    lines.push('');
  }

  // Documentation
  if (changes.docs && changes.docs.length > 0) {
    const docsTitle = locale === 'ru' ? '📝 Документация' : '📝 Documentation';
    lines.push(`### ${docsTitle}`);
    lines.push('');
    for (const doc of changes.docs) {
      const scope = doc.scope ? `**${doc.scope}**` : 'general';
      lines.push(`- ${scope}: ${doc.subject}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

function getReasonLabel(reason: string, locale: 'en' | 'ru'): string {
  const labels: Record<string, Record<'en' | 'ru', string>> = {
    breaking: { en: 'major bump from breaking changes', ru: 'major из-за breaking changes' },
    feat: { en: 'minor: new features', ru: 'minor: новая функциональность' },
    fix: { en: 'patch: bug fixes', ru: 'patch: исправления' },
    perf: { en: 'patch: performance', ru: 'patch: производительность' },
    ripple: { en: 'patch: dependency update', ru: 'patch: обновление зависимостей' },
    manual: { en: 'manual', ru: 'ручное' },
  };

  return labels[reason]?.[locale] || reason;
}
