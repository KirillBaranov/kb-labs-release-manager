export * from './base';
export { CommandCheckAdapter } from './command';

// Create check registry
import type { CheckId, CheckResult, CustomCheckConfig } from '@kb-labs/release-manager-core';
import type { CheckAdapter } from './base';
import { CommandCheckAdapter } from './command';

/**
 * Create check registry from custom check configs
 * All checks are now declarative - no hardcoded checks
 */
export function createCheckRegistry(
  customChecks: CustomCheckConfig[] = []
): Map<CheckId, CheckAdapter> {
  const registry = new Map<CheckId, CheckAdapter>();

  // Load custom checks from config
  for (const checkConfig of customChecks) {
    registry.set(checkConfig.id as CheckId, new CommandCheckAdapter(checkConfig));
  }

  return registry;
}

/**
 * Run all enabled checks sequentially
 */
export async function runChecks(options: {
  checkIds: CheckId[];
  cwd: string;
  timeoutMs?: number;
  registry?: Map<CheckId, CheckAdapter>;
}): Promise<Partial<Record<CheckId, CheckResult>>> {
  const {
    checkIds,
    cwd,
    timeoutMs = 300000,
    registry = createCheckRegistry(),
  } = options;

  const results: Partial<Record<CheckId, CheckResult>> = {};

  // Run checks sequentially
  for (const checkId of checkIds) {
    const adapter = registry.get(checkId);
    if (!adapter) {
      continue;
    }

    try {
      const result = await adapter.run(cwd, timeoutMs);
      results[checkId] = result;
    } catch (error) {
      results[checkId] = {
        id: checkId,
        ok: false,
        hint: error instanceof Error ? error.message : String(error),
        timingMs: 0,
      };
    }
  }

  return results;
}

/**
 * Run checks for each package in the plan
 * Returns a map of package name to check results
 */
export async function runChecksPerPackage(options: {
  checkIds: CheckId[];
  packages: Array<{ name: string; path: string }>;
  timeoutMs?: number;
  registry?: Map<CheckId, CheckAdapter>;
}): Promise<Record<string, Partial<Record<CheckId, CheckResult>>>> {
  const {
    checkIds,
    packages,
    timeoutMs = 300000,
    registry = createCheckRegistry(),
  } = options;

  const allResults: Record<string, Partial<Record<CheckId, CheckResult>>> = {};

  // Run checks for each package
  for (const pkg of packages) {
    const results = await runChecks({
      checkIds,
      cwd: pkg.path,
      timeoutMs,
      registry,
    });

    allResults[pkg.name] = results;
  }

  return allResults;
}

