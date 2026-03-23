/**
 * Unified check runner for release manager.
 * Reads config.checks[], supports safe build, script path resolution, perPackage routing.
 */

import { join } from 'node:path';
import type { CustomCheckConfig, CheckResult } from './types';
import { runSafeBuild, isBuildCommand, spawnCommand } from './build';

export interface CheckRunnerOptions {
  repoRoot: string;
  packagePaths: string[];
  scopePath?: string;
  logger?: { info?: (...args: any[]) => void; warn?: (...args: any[]) => void };
}

/**
 * Run all configured checks against packages.
 * Handles: safe build for build commands, script path resolution, perPackage/scopePath/repoRoot routing.
 */
export async function runReleaseChecks(
  checks: CustomCheckConfig[],
  options: CheckRunnerOptions,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const check of checks) {
    const result = await runSingleCheck(check, options);
    results.push(result);

    options.logger?.info?.(`Check ${check.id}: ${result.ok ? 'passed' : 'failed'} (${result.timingMs}ms)`);

    // Stop on first non-optional failure
    if (!result.ok && !check.optional) {
      break;
    }
  }

  return results;
}

async function runSingleCheck(
  check: CustomCheckConfig,
  options: CheckRunnerOptions,
): Promise<CheckResult> {
  const startTime = Date.now();

  // Determine which directories to run this check in
  const runIn = check.runIn ?? 'perPackage';
  let pathsToRun: string[];

  if (runIn === 'repoRoot') {
    pathsToRun = [options.repoRoot];
  } else if (runIn === 'scopePath') {
    pathsToRun = [options.scopePath ?? options.repoRoot];
  } else {
    pathsToRun = options.packagePaths.length > 0 ? options.packagePaths : [options.repoRoot];
  }

  let checkOk = true;
  let checkError: string | undefined;
  let totalDurationMs = 0;

  for (const pkgPath of pathsToRun) {
    // If this check runs a build command, use safe build
    if (isBuildCommand(check.command, check.args)) {
      const result = await runSafeBuild(pkgPath, check.id);
      totalDurationMs += result.durationMs;
      if (!result.success) {
        checkOk = false;
        checkError = result.error;
        break;
      }
      continue;
    }

    // Resolve script paths in args relative to repo root
    const resolvedArgs = (check.args ?? []).map(arg =>
      arg.match(/\.(sh|js|ts|mjs|cjs)$/) ? join(options.repoRoot, arg) : arg
    );

    const fullCommand = [check.command, ...resolvedArgs].join(' ');
    const timeoutMs = check.timeoutMs ?? 120_000;
    const result = await spawnCommand(fullCommand, pkgPath, timeoutMs);
    totalDurationMs += result.durationMs;

    if (!result.success) {
      checkOk = false;
      checkError = result.error;
      break;
    }
  }

  return {
    id: check.id,
    ok: checkOk,
    details: checkError ? { error: checkError } : undefined,
    hint: check.optional ? 'optional' : undefined,
    timingMs: totalDurationMs,
  };
}
