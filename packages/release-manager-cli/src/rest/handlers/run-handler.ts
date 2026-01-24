/**
 * Run release handler - Execute full release process
 *
 * Reads: .kb/release/plans/{scope}/current/plan.json
 * Writes: .kb/release/history/{timestamp}/report.json
 */

import { defineHandler, findRepoRoot, type RestInput } from '@kb-labs/sdk';
import type {
  RunReleaseRequest,
  RunReleaseResponse,
  ReleaseReport,
  ReleasePlan,
} from '@kb-labs/release-manager-contracts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { scopeToDir } from '../../shared/utils';
import { join, isAbsolute } from 'node:path';
import { publishPackagesProgrammatic } from '../../shared/publish-programmatic';

export default defineHandler({
  async execute(ctx, input: RestInput<unknown, RunReleaseRequest>): Promise<RunReleaseResponse> {
    const scope = input.body?.scope || 'root';
    const dryRun = input.body?.dryRun ?? false;
    const strict = input.body?.strict ?? false;
    const skipChecks = input.body?.skipChecks ?? false;
    const otp = input.body?.otp;
    const cwd = ctx.cwd ?? process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    const startTime = Date.now();
    const errors: string[] = [];

    try {
      // 1. Read plan
      const scopeDir = scopeToDir(scope);
      const planPath = join(repoRoot, '.kb/release/plans', scopeDir, 'current', 'plan.json');
      let plan: ReleasePlan;

      try {
        const planRaw = await readFile(planPath, 'utf-8');
        plan = JSON.parse(planRaw);
      } catch (error) {
        throw new Error(`No release plan found for scope "${scope}". Run generate first.`);
      }

      // 2. Run checks (if not skipped)
      if (!skipChecks) {
        // TODO: Implement pre-release checks (tests, build, audit)
        // For now, skip checks
      }

      // 3. Bump versions in package.json files (skip for dry-run)
      if (!dryRun) {
        for (const pkg of plan.packages) {
          const pkgPath = isAbsolute(pkg.path) ? pkg.path : join(repoRoot, pkg.path);
          const pkgJsonPath = join(pkgPath, 'package.json');

          try {
            const pkgJsonRaw = await readFile(pkgJsonPath, 'utf-8');
            const pkgJson = JSON.parse(pkgJsonRaw);

            // Update version
            pkgJson.version = pkg.nextVersion;

            // Write back with same formatting
            await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf-8');

            ctx.platform?.logger?.info?.(`Bumped ${pkg.name} to ${pkg.nextVersion}`);
          } catch (error) {
            throw new Error(`Failed to bump version for ${pkg.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      // 4. Publish packages (for dry-run, skip version check in publish-programmatic)
      const packagesToPublish = plan.packages.map(pkg => ({
        name: pkg.name,
        version: pkg.nextVersion,
        path: isAbsolute(pkg.path) ? pkg.path : join(repoRoot, pkg.path),
      }));

      // Debug: log token info
      const token = process.env.NPM_TOKEN;
      ctx.platform?.logger?.info?.(`NPM_TOKEN env: ${token ? token.substring(0, 8) + '...' : 'NOT SET'}`);

      const publishResult = await publishPackagesProgrammatic({
        packages: packagesToPublish,
        dryRun,
        otp,
      });

      const published = publishResult.published;
      if (publishResult.errors.length > 0) {
        errors.push(...publishResult.errors);
      }

      // 4. Create release report
      const timestamp = new Date().toISOString();
      const releaseId = timestamp.replace(/[:.]/g, '-').replace('Z', '');
      const duration = Date.now() - startTime;

      const success = publishResult.failed.length === 0;

      const report: ReleaseReport = {
        schemaVersion: '1.0',
        ts: timestamp,
        scope,
        context: {
          repo: repoRoot,
          cwd,
          branch: 'main', // TODO: Get actual branch from git
          dryRun,
        },
        stage: 'publishing',
        plan,
        result: {
          ok: success,
          version: plan.packages[0]?.nextVersion,
          published,
          skipped: publishResult.skipped,
          timingMs: duration,
          errors: errors.length > 0 ? errors : undefined,
        },
      };

      // 5. Save to history (per-scope)
      if (!dryRun) {
        const historyDir = join(repoRoot, '.kb/release/history', scopeDir, releaseId);
        await mkdir(historyDir, { recursive: true });

        const reportPath = join(historyDir, 'report.json');
        await ctx.runtime.fs.writeFile(reportPath, JSON.stringify(report, null, 2), { encoding: 'utf-8' });

        // Copy plan to history
        const planHistoryPath = join(historyDir, 'plan.json');
        await ctx.runtime.fs.writeFile(planHistoryPath, JSON.stringify(plan, null, 2), { encoding: 'utf-8' });

        // Copy changelog if exists
        const changelogPath = join(repoRoot, '.kb/release/plans', scopeDir, 'current', 'changelog.md');
        try {
          const changelog = await readFile(changelogPath, 'utf-8');
          const changelogHistoryPath = join(historyDir, 'changelog.md');
          await ctx.runtime.fs.writeFile(changelogHistoryPath, changelog, { encoding: 'utf-8' });
        } catch {
          // Changelog optional
        }
      }

      // Track release completion
      await ctx.platform?.analytics?.track?.('release.completed', {
        scope,
        packagesCount: plan.packages.length,
        publishedCount: published.length,
        dryRun,
        strict,
        skipChecks,
        durationMs: duration,
      });

      return {
        scope,
        report,
        success,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMessage);

      // Create failed report
      const timestamp = new Date().toISOString();
      const duration = Date.now() - startTime;

      const failedReport: ReleaseReport = {
        schemaVersion: '1.0',
        ts: timestamp,
        scope,
        context: {
          repo: repoRoot,
          cwd,
          branch: 'main',
          dryRun,
        },
        stage: 'planning',
        result: {
          ok: false,
          timingMs: duration,
          errors,
        },
      };

      // Track release failure
      await ctx.platform?.analytics?.track?.('release.failed', {
        scope,
        errorMessage: errorMessage,
        errorsCount: errors.length,
        dryRun,
        durationMs: duration,
      });

      return {
        scope,
        report: failedReport,
        success: false,
        errors,
      };
    }
  }
});
