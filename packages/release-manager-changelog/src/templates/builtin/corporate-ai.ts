/**
 * AI-Enhanced Corporate Changelog Template
 *
 * Combines structured template format with LLM-powered descriptions:
 * - Template defines sections and hierarchy (Breaking > Features > Fixes)
 * - LLM enhances each group with human-friendly summaries
 * - Graceful degradation if LLM unavailable (falls back to basic descriptions)
 */

import type { ChangelogTemplate, TemplateData, PlatformLike } from '../types';
import type { Change } from '../../types';

export const version = '1.0' as const;

export async function render(data: TemplateData, platform?: PlatformLike): Promise<string> {
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

  // Features (AI-enhanced)
  if (changes.feat && changes.feat.length > 0) {
    const featTitle = locale === 'ru' ? '✨ Новые возможности' : '✨ New Features';
    lines.push(`### ${featTitle}`);
    lines.push('');

    const featuresText = await enhanceGroup(platform, changes.feat, 'features', locale);
    lines.push(featuresText);
    lines.push('');
  }

  // Performance improvements (AI-enhanced)
  if (changes.perf && changes.perf.length > 0) {
    const perfTitle = locale === 'ru' ? '⚡ Производительность' : '⚡ Performance Improvements';
    lines.push(`### ${perfTitle}`);
    lines.push('');

    const perfText = await enhanceGroup(platform, changes.perf, 'performance', locale);
    lines.push(perfText);
    lines.push('');
  }

  // Bug fixes (AI-enhanced)
  if (changes.fix && changes.fix.length > 0) {
    const fixTitle = locale === 'ru' ? '🐛 Исправления' : '🐛 Bug Fixes';
    lines.push(`### ${fixTitle}`);
    lines.push('');

    const fixesText = await enhanceGroup(platform, changes.fix, 'fixes', locale);
    lines.push(fixesText);
    lines.push('');
  }

  // Refactoring
  if (changes.refactor && changes.refactor.length > 0) {
    const refactorTitle = locale === 'ru' ? '♻️ Рефакторинг' : '♻️ Code Refactoring';
    lines.push(`### ${refactorTitle}`);
    lines.push('');

    const refactorText = await enhanceGroup(platform, changes.refactor, 'refactoring', locale);
    lines.push(refactorText);
    lines.push('');
  }

  // Documentation
  if (changes.docs && changes.docs.length > 0) {
    const docsTitle = locale === 'ru' ? '📝 Документация' : '📝 Documentation';
    lines.push(`### ${docsTitle}`);
    lines.push('');

    const docsText = await enhanceGroup(platform, changes.docs, 'documentation', locale);
    lines.push(docsText);
    lines.push('');
  }

  // Professional footer
  const footer = buildChangelogFooter(locale);
  lines.push(footer);

  return lines.join('\n').trim();
}

/**
 * Build professional changelog footer
 */
function buildChangelogFooter(locale: 'en' | 'ru'): string {
  const year = new Date().getFullYear();

  if (locale === 'ru') {
    return `---

*Сгенерировано автоматически с помощью [**@kb-labs/release-manager**](https://github.com/kb-labs/kb-labs)*
*Часть экосистемы **KB Labs Platform** — профессиональные инструменты для разработки*

<sub>© ${year} KB Labs. Released under KB Public License v1.1</sub>`;
  }

  return `---

*Generated automatically by [**@kb-labs/release-manager**](https://github.com/kb-labs/kb-labs)*
*Part of the **KB Labs Platform** — Professional developer tools ecosystem*

<sub>© ${year} KB Labs. Released under KB Public License v1.1</sub>`;
}

/**
 * Enhance a group of changes with LLM
 * Falls back to basic formatting if LLM unavailable
 */
async function enhanceGroup(
  platform: PlatformLike | undefined,
  commits: Change[],
  groupType: string,
  locale: 'en' | 'ru'
): Promise<string> {
  // Fallback if no LLM
  if (!platform?.llm) {
    platform?.logger?.info?.(`[corporate-ai] No LLM platform for ${groupType}, using basic format`);
    return formatBasicGroup(commits);
  }

  try {
    // Prepare context for LLM
    const commitsContext = commits.map(c => ({
      scope: c.scope || 'general',
      subject: c.subject,
      body: c.body,
    }));

    const prompt = buildEnhancementPrompt(commitsContext, groupType, locale);

    const startTime = Date.now();
    const response = await platform.llm.complete(prompt, {
      temperature: 0.7,
      maxTokens: 500,
    });
    const durationMs = Date.now() - startTime;

    // Track LLM usage via analytics
    await platform?.analytics?.track?.('changelog.llm.enhanced', {
      groupType,
      locale,
      commitsCount: commits.length,
      contentLength: response.content.length,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.promptTokens + response.usage.completionTokens,
      durationMs,
      model: response.model,
    });

    // Validate LLM output
    const enhanced = response.content.trim();
    if (enhanced.length === 0) {
      platform?.logger?.warn?.(`[corporate-ai] LLM returned empty content for ${groupType}, using basic format`);
      return formatBasicGroup(commits);
    }

    return enhanced;

  } catch (error) {
    // Graceful degradation on error
    platform?.logger?.error?.(
      `[corporate-ai] LLM enhancement failed for ${groupType}, using basic format`,
      error instanceof Error ? error : undefined
    );
    return formatBasicGroup(commits);
  }
}

/**
 * Build prompt for LLM to enhance a group
 */
function buildEnhancementPrompt(
  commits: Array<{ scope: string; subject: string; body?: string }>,
  groupType: string,
  locale: 'en' | 'ru'
): string {
  const lang = locale === 'ru' ? 'Russian' : 'English';

  const commitsText = commits.map(c => `- ${c.scope}: ${c.subject}`).join('\n');

  return `You are writing a professional changelog for a software release.

Group type: ${groupType}
Language: ${lang}

Commits in this group:
${commitsText}

Task: Write a clear, user-focused description for each commit as a markdown list.
- Explain WHY each change matters to users, not just WHAT changed
- Use clear, non-technical language when possible
- Keep each item to 1-2 sentences
- Start with scope in **bold** if present

Example output format:
- **api**: Enables async request handling, improving throughput by 40% under high load
- **logger**: Fixes memory leak that occurred after 1000+ log entries

Write ONLY the markdown list, no explanations or meta-commentary.`;
}

/**
 * Basic formatting without LLM (fallback)
 */
function formatBasicGroup(commits: Change[]): string {
  return commits
    .map(c => {
      const scope = c.scope ? `**${c.scope}**` : 'general';
      return `- ${scope}: ${c.subject}`;
    })
    .join('\n');
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
