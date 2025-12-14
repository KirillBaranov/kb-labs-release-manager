/**
 * Release run command
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineCommand, type CommandResult, useLLM, useLoader, discoverArtifacts } from '@kb-labs/sdk';
import {
  loadReleaseConfig,
  planRelease,
  saveSnapshot,
  restoreSnapshot,
  publishPackages,
  copyChangelogToPackages,
  commitAndTagRelease,
  renderJson,
  renderMarkdown,
  renderText,
  type ReleaseReport,
  type VersionBump,
} from '@kb-labs/release-manager-core';
import {
  resolveGitRange,
  parseCommits,
  createReleaseManifest,
  detectProvider,
  enhanceChangeWithLinks,
  loadTemplate,
  packageToTemplateData,
  type PackageRelease,
} from '@kb-labs/release-manager-changelog';
import { runChecks, createCheckRegistry } from '@kb-labs/release-manager-checks';
import { findRepoRoot } from '../../shared/utils';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../../infra/analytics/events';

type ReleaseRunFlags = {
  scope: { type: 'string'; description?: string };
  profile: { type: 'string'; description?: string };
  bump: { type: 'string'; description?: string; choices?: readonly string[] };
  strict: { type: 'boolean'; description?: string; default?: boolean };
  'dry-run': { type: 'boolean'; description?: string; default?: boolean; alias?: string };
  'skip-checks': { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type ReleaseRunResult = CommandResult & {
  report?: ReleaseReport;
};

export const runCommand = defineCommand<any, ReleaseRunFlags, ReleaseRunResult>({
  name: 'release:run',
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
    strict: {
      type: 'boolean',
      description: 'Fail on any check failure',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Simulate release without publishing',
      default: false,
      alias: 'n',
    },
    'skip-checks': {
      type: 'boolean',
      description: 'Skip pre-release checks',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Print result as JSON',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.RUN_STARTED,
    finishEvent: ANALYTICS_EVENTS.RUN_FINISHED,
    actor: ANALYTICS_ACTOR.id,
    includeFlags: true,
  },
  async handler(ctx: any, _argv: string[], flags: any) {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    const dryRun = flags['dry-run'] === true;

    ctx.tracker.checkpoint('config');

    // Load configuration with loader
    const configLoader = useLoader('Loading release configuration...');
    configLoader.start();

    const { config } = await loadReleaseConfig({
      cwd: repoRoot,
      profileId: flags.profile,
      cli: {
        bump: flags.bump,
        strict: flags.strict,
        'dry-run': flags['dry-run'],
      },
    });

    configLoader.succeed('Configuration loaded');

    // Create release plan with loader
    const planLoader = useLoader('Discovering packages and planning release...');
    planLoader.start();

    const plan = await planRelease({
      cwd: repoRoot,
      config,
      scope: flags.scope,
      bumpOverride: flags.bump as VersionBump | undefined,
    });

    if (plan.packages.length === 0) {
      planLoader.fail(`No packages found matching scope: ${flags.scope || 'all'}`);
      return { ok: false };
    }

    planLoader.succeed(`Found ${plan.packages.length} package(s) to release`);

    ctx.tracker.checkpoint('plan');

    // Save snapshot for rollback
    await saveSnapshot({
      cwd: repoRoot,
      plan,
    });

    // Run pre-release checks
    let checks: Partial<Record<string, any>> | undefined;
    if (config.verify && config.verify.length > 0 && !flags['skip-checks']) {
      const checksLoader = useLoader(`Running ${config.verify.length} pre-release check(s)...`);
      checksLoader.start();

      checks = await runChecks({
        checkIds: config.verify,
        cwd: repoRoot,
        registry: createCheckRegistry(),
      });

      checksLoader.succeed('Pre-release checks completed');
    }

    ctx.tracker.checkpoint('checks');

    // Check for failures in strict mode
    if (config.strict && checks) {
      const failedChecks = Object.entries(checks)
        .filter(([_, result]) => result && !result.ok)
        .map(([id]) => id);
      
      if (failedChecks.length > 0) {
        // Rollback
        await restoreSnapshot(repoRoot);
        
        const report: ReleaseReport = {
          schemaVersion: '1.0',
          ts: new Date().toISOString(),
          context: {
            repo: repoRoot,
            cwd: repoRoot,
            branch: 'unknown',
            profile: config as any,
            dryRun,
          },
          stage: 'rollback',
          plan,
          result: {
            ok: false,
            timingMs: ctx.tracker.total(),
            errors: [`Pre-release checks failed: ${failedChecks.join(', ')}`],
            checks,
          },
        };

        await writeReport(repoRoot, report);
        
        ctx.logger?.warn('Release run failed checks', { failedChecks });
        
        // Return object with ok: false for quality gate failure
        // defineCommand will convert to exit code 1, but we need special handling
        // For now, return 2 directly to indicate quality gate failure
        if (flags.json) {
          ctx.output?.json(report);
        } else {
          ctx.output?.error(`Pre-release checks failed: ${failedChecks.join(', ')}`);
        }
        
        // Return exit code 2 for quality gate failure
        return 2;
      }
    }

    // Publish packages
    const publishLoader = useLoader(dryRun
      ? `Simulating publish for ${plan.packages.length} package(s) (dry-run)...`
      : `Publishing ${plan.packages.length} package(s)...`
    );
    publishLoader.start();

    const publishResult = await publishPackages({
      cwd: repoRoot,
      plan,
      dryRun,
    });

    if (publishResult.errors.length > 0) {
      publishLoader.fail(`Publishing failed with ${publishResult.errors.length} error(s)`);
    } else if (dryRun) {
      publishLoader.succeed(`Dry-run completed for ${publishResult.skipped.length} package(s)`);
    } else {
      publishLoader.succeed(`Published ${publishResult.published.length} package(s)`);
    }

    ctx.tracker.checkpoint('publish');

    // Generate changelog using full changelog generation with templates
    const changelogLoader = useLoader('Generating changelog...');
    changelogLoader.start();

    const llm = useLLM();
    const platform = llm ? { llm } : undefined;
    const locale = (config.changelog?.locale as 'en' | 'ru') || 'en';

    let changelog = '';
    try {
      // Determine git directory based on scope
      // If scope is set, find git root starting from package directory (supports submodules)
      // If no scope, use repo root
      let gitCwd = repoRoot;
      if (flags.scope && plan.packages.length > 0 && plan.packages[0]) {
        try {
          gitCwd = await findRepoRoot(plan.packages[0].path);
        } catch {
          // Fallback to package path if git root not found
          gitCwd = plan.packages[0].path;
        }
      }

      // Resolve git range
      const range = await resolveGitRange({
        cwd: gitCwd,
        from: undefined,
        to: 'HEAD',
        autoUnshallow: config.git?.autoUnshallow,
        requireSignedTags: config.git?.requireSignedTags,
      });

      // Detect git provider
      const provider = await detectProvider(gitCwd, config.git?.baseUrl);

      // Parse commits
      const changes = await parseCommits({
        cwd: gitCwd,
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

      // Create release manifest with packages
      // Include ALL changes for all packages (no scope filtering for monorepo)
      const packages: PackageRelease[] = plan.packages.map(pkg => {
        // Convert 'auto' to actual bump type for changelog
        const bumpType = pkg.bump === 'auto' ? 'patch' : pkg.bump;

        // Include all changes (monorepo-wide changelog)
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
          bump: bumpType,
          reason,
          breaking: enhancedChanges.filter(c => c.breaking).flatMap(c => c.breaking!),
          changes: enhancedChanges, // Include all changes
        };
      });

      createReleaseManifest(range, packages);

      // Load template (use corporate-ai by default)
      const templateName = config.changelog?.template || 'corporate-ai';
      const template = await loadTemplate(templateName, repoRoot);

      // Format each package with LLM
      const formattedPackages: string[] = [];
      for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        if (!pkg) continue;

        changelogLoader.update({ text: `Formatting changelog for ${pkg.name} (${i + 1}/${packages.length})...` });

        const templateData = packageToTemplateData(pkg, locale, config.changelog?.metadata);

        // Templates can be sync or async
        const result = template.render(templateData, platform);
        const formatted = typeof result === 'string' ? result : await result;

        formattedPackages.push(formatted);
      }

      changelog = formattedPackages.join('\n\n');

      // Write to workspace changelog
      const changelogPath = join(repoRoot, '.kb', 'release', 'CHANGELOG.md');
      await writeFile(changelogPath, changelog, 'utf-8');

      changelogLoader.succeed('Changelog generated');
    } catch (error) {
      changelogLoader.fail('Failed to generate full changelog, using simple fallback');

      ctx.logger?.warn('Failed to generate full changelog, using simple fallback', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback to simple changelog
      const date = new Date().toISOString().split('T')[0];
      const lines: string[] = [`## [${date}] Release\n\n`];
      for (const pkg of plan.packages) {
        lines.push(`- **${pkg.name}**: ${pkg.currentVersion} → ${pkg.nextVersion}`);
      }
      changelog = lines.join('\n');
    }

    ctx.tracker.checkpoint('changelog');

    // Copy changelog to each package
    const copyLoader = useLoader('Copying changelog to package directories...');
    copyLoader.start();

    await copyChangelogToPackages({
      cwd: repoRoot,
      plan,
      changelog,
    });

    copyLoader.succeed('Changelog copied to all packages');

    ctx.tracker.checkpoint('changelog-copy');

    // Commit and tag release
    const gitLoader = useLoader(dryRun ? 'Simulating git operations (dry-run)...' : 'Committing and tagging release...');
    gitLoader.start();

    const gitResult = await commitAndTagRelease({
      cwd: repoRoot,
      plan,
      dryRun,
    });

    if (dryRun) {
      gitLoader.succeed('Git operations skipped (dry-run)');
    } else if (gitResult.pushed) {
      gitLoader.succeed(`Committed, tagged (${gitResult.tagged.length}), and pushed to remote`);
    } else if (gitResult.committed) {
      gitLoader.succeed(`Committed and tagged (${gitResult.tagged.length})`);
    } else {
      gitLoader.stop();
    }

    ctx.tracker.checkpoint('git');

    // Build final report
    const report: ReleaseReport = {
      schemaVersion: '1.0',
      ts: new Date().toISOString(),
      context: {
        repo: repoRoot,
        cwd: repoRoot,
        branch: 'unknown',
        profile: config as any,
        dryRun,
      },
      stage: 'verifying',
      plan,
      result: {
        ok: publishResult.errors.length === 0,
        published: publishResult.published,
        skipped: publishResult.skipped,
        changelog,
        checks,
        git: gitResult,
        timingMs: ctx.tracker.total(),
        errors: publishResult.errors.length > 0 ? publishResult.errors : undefined,
      },
    };

    await writeReport(repoRoot, report);

    ctx.logger?.info('Release run completed', { 
      ok: report.result.ok,
      publishedCount: report.result.published?.length || 0,
      errorsCount: report.result.errors?.length || 0,
      timingMs: report.result.timingMs,
    });

    if (flags.json) {
      ctx.output?.json(report);
    } else {
      if (!ctx.output) {
        throw new Error('Output not available');
      }

      const sections: Array<{ header?: string; items: string[] }> = [];

      if (report.result.published && report.result.published.length > 0) {
        const publishedItems: string[] = [];
        for (const pkg of report.result.published) {
          publishedItems.push(`${ctx.ui.symbols.success} ${pkg}`);
        }
        sections.push({
          header: 'Published packages',
          items: publishedItems,
        });
      }

      if (report.result.skipped && report.result.skipped.length > 0) {
        const skippedItems: string[] = [];
        for (const pkg of report.result.skipped) {
          skippedItems.push(`${ctx.ui.symbols.info} ${pkg}`);
        }
        sections.push({
          header: 'Skipped (dry-run)',
          items: skippedItems,
        });
      }

      if (report.result.errors && report.result.errors.length > 0) {
        const errorItems: string[] = [];
        for (const error of report.result.errors) {
          errorItems.push(`${ctx.ui.symbols.error} ${error}`);
        }
        sections.push({
          header: 'Errors',
          items: errorItems,
        });
      }

      // Git operations section
      if (report.result.git) {
        const gitItems: string[] = [];
        if (report.result.git.committed) {
          gitItems.push(`${ctx.ui.symbols.success} Changes committed`);
        }
        if (report.result.git.tagged && report.result.git.tagged.length > 0) {
          gitItems.push(`${ctx.ui.symbols.success} Created ${report.result.git.tagged.length} tag(s):`);
          for (const tag of report.result.git.tagged) {
            gitItems.push(`  - ${tag}`);
          }
        }
        if (report.result.git.pushed) {
          gitItems.push(`${ctx.ui.symbols.success} Pushed to remote`);
        }
        if (gitItems.length > 0) {
          sections.push({
            header: 'Git Operations',
            items: gitItems,
          });
        }
      }

      // Artifacts section
      const artifactsDir = join(repoRoot, '.kb', 'release');
      const artifacts = await discoverArtifacts(artifactsDir, [
        { name: 'Release Report', pattern: 'report.json', description: 'Detailed release report (JSON)' },
        { name: 'Changelog', pattern: 'CHANGELOG.md', description: 'Generated changelog (Markdown)' },
        { name: 'Summary (MD)', pattern: 'summary.md', description: 'Release summary (Markdown)' },
        { name: 'Summary (TXT)', pattern: 'summary.txt', description: 'Release summary (Plain text)' },
      ]);

      if (artifacts.length > 0) {
        const artifactItems: string[] = [];
        for (const artifact of artifacts) {
          artifactItems.push(`${ctx.ui.symbols.info} ${artifact.name}: ${artifact.path}`);
        }
        sections.push({
          header: 'Artifacts',
          items: artifactItems,
        });
      }

      const status = report.result.ok ? 'success' : 'error';
      const outputText = ctx.ui.sideBox({
        title: 'Release Summary',
        sections,
        status,
        timing: report.result.timingMs,
      });
      ctx.ui.write(outputText);
    }

    // Return exit code based on result
    return report.result.ok ? 0 : 1;
  },
});

async function writeReport(repoRoot: string, report: ReleaseReport): Promise<void> {
  const reportDir = join(repoRoot, '.kb', 'release');
  await mkdir(reportDir, { recursive: true });
  
  // Write JSON report
  const jsonPath = join(reportDir, 'report.json');
  await writeFile(jsonPath, renderJson(report), 'utf-8');
  
  // Write markdown summary
  const mdPath = join(reportDir, 'summary.md');
  await writeFile(mdPath, renderMarkdown(report), 'utf-8');
  
  // Write text summary
  const txtPath = join(reportDir, 'summary.txt');
  await writeFile(txtPath, renderText(report), 'utf-8');
}
