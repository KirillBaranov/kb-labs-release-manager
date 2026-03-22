/**
 * Run pre-release checks handler
 *
 * Executes checks defined in kb.config.json profiles[].products.release.checks
 * for each package in the current release plan.
 */

import { defineHandler, findRepoRoot, type RestInput, useConfig } from '@kb-labs/sdk';
import type { RunChecksRequest, RunChecksResponse, CheckResultItem } from '@kb-labs/release-manager-contracts';
import type { ReleaseConfig, CustomCheckConfig } from '@kb-labs/release-manager-core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scopeToDir } from '../../shared/utils.js';
import { runSafeBuild, isBuildCommand, spawnCommand } from '../../shared/safe-build.js';

async function runCheck(
  check: CustomCheckConfig,
  cwd: string,
  repoRoot: string,
): Promise<CheckResultItem> {
  const startTime = Date.now();

  // If this check runs a build command, use safe build to avoid crashing running services
  if (isBuildCommand(check.command, check.args)) {
    const result = await runSafeBuild(cwd, check.id);
    return {
      id: check.id,
      name: check.name ?? check.id,
      success: result.success,
      error: result.error,
      durationMs: result.durationMs,
      optional: check.optional,
    };
  }

  // Resolve script paths in args relative to repo root
  // (checks run perPackage with cwd=packagePath, but scripts live in repo root)
  const resolvedArgs = (check.args ?? []).map(arg =>
    arg.match(/\.(sh|js|ts|mjs|cjs)$/) ? join(repoRoot, arg) : arg
  );

  const fullCommand = [check.command, ...resolvedArgs].join(' ');
  const timeoutMs = check.timeoutMs ?? 120000;
  const result = await spawnCommand(fullCommand, cwd, timeoutMs);

  return {
    id: check.id,
    name: check.name ?? check.id,
    success: result.success,
    error: result.error,
    durationMs: result.durationMs,
    optional: check.optional,
  };
}

export default defineHandler({
  async execute(ctx, input: RestInput<unknown, RunChecksRequest>): Promise<RunChecksResponse> {
    const scope = input.body?.scope ?? 'root';
    const cwd = ctx.cwd ?? process.cwd();
    const repoRoot = await findRepoRoot(cwd);
    const startTime = Date.now();

    const config = await useConfig<ReleaseConfig>();
    const checks: CustomCheckConfig[] = config?.checks ?? [];

    if (checks.length === 0) {
      ctx.platform?.logger?.warn?.('No checks configured in kb.config.json release.checks');
      return {
        scope,
        success: true,
        checks: [],
        totalDurationMs: Date.now() - startTime,
      };
    }

    // Read plan to get package paths and scope path
    const scopeDir = scopeToDir(scope);
    const planPath = join(repoRoot, '.kb/release/plans', scopeDir, 'current', 'plan.json');
    let packagePaths: string[] = [];
    let scopePath: string = repoRoot;
    try {
      const planRaw = await readFile(planPath, 'utf-8');
      const plan: { packages: Array<{ name: string; path: string }> } = JSON.parse(planRaw);
      packagePaths = plan.packages.map((pkg) =>
        pkg.path.startsWith('/') ? pkg.path : join(repoRoot, pkg.path)
      );
      // Scope path = common ancestor of all package paths (first package's parent for monorepos)
      if (packagePaths.length > 0) {
        // For a monorepo like kb-labs-core, packages live in kb-labs-core/packages/*
        // The scope root is one level above the first package
        const firstPkg = packagePaths[0]!;
        // Walk up until we find a directory that contains all package paths
        scopePath = findCommonAncestor(packagePaths) ?? repoRoot;
      }
    } catch {
      ctx.platform?.logger?.warn?.('No plan found, running checks in repo root');
      packagePaths = [repoRoot];
      scopePath = repoRoot;
    }

    const results: CheckResultItem[] = [];
    let allPassed = true;

    for (const check of checks) {
      // Determine which directories to run this check in
      const runIn = check.runIn ?? 'perPackage';
      let pathsToRun: string[];

      if (runIn === 'repoRoot') {
        pathsToRun = [repoRoot];
      } else if (runIn === 'scopePath') {
        pathsToRun = [scopePath];
      } else {
        // perPackage (default)
        pathsToRun = packagePaths.length > 0 ? packagePaths : [repoRoot];
      }

      let checkSuccess = true;
      let checkError: string | undefined;
      let totalDurationMs = 0;

      for (const pkgPath of pathsToRun) {
        ctx.platform?.logger?.info?.(`Running check: ${check.id} in ${pkgPath}`, { command: check.command, args: check.args });
        const result = await runCheck(check, pkgPath, repoRoot);
        totalDurationMs += result.durationMs;

        if (!result.success) {
          checkSuccess = false;
          checkError = result.error;
          break;
        }
      }

      results.push({
        id: check.id,
        name: check.name ?? check.id,
        success: checkSuccess,
        error: checkError,
        durationMs: totalDurationMs,
        optional: check.optional,
      });

      ctx.platform?.logger?.info?.(`Check ${check.id}: ${checkSuccess ? 'passed' : 'failed'} (${totalDurationMs}ms)`);

      if (!checkSuccess && !check.optional) {
        allPassed = false;
        break;
      }
    }

    return {
      scope,
      success: allPassed,
      checks: results,
      totalDurationMs: Date.now() - startTime,
    };
  },
});

/**
 * Find the common ancestor directory of a list of paths.
 * For ["/a/b/c", "/a/b/d"] returns "/a/b"
 */
function findCommonAncestor(paths: string[]): string | null {
  if (paths.length === 0) {return null;}
  if (paths.length === 1) {return paths[0]!;}

  // Use Node's path.resolve to normalize, then split on separator
  const sep = '/';
  const parts = paths.map(p => p.split(sep));
  const first = parts[0]!;
  const commonParts: string[] = [];

  for (let i = 0; i < first.length; i++) {
    const segment: string | undefined = first[i];
    if (segment === undefined) {break;}
    if (parts.every(p => p[i] === segment)) {
      commonParts.push(segment);
    } else {
      break;
    }
  }

  if (commonParts.length === 0) {return '/';}
  const result = commonParts.join(sep);
  // Re-add leading slash for absolute paths (split('/foo') gives ['', 'foo'])
  return result.startsWith('/') ? result : '/' + result;
}
