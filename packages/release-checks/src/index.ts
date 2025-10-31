export * from './base';
export { AuditCheck } from './audit';
export { DevLinkCheck } from './devlink';
export { MindCheck } from './mind';
export { TestsCheck } from './tests';
export { BuildCheck } from './build';

// Create check registry
import type { CheckId, CheckResult } from '@kb-labs/release-core';
import type { CheckAdapter } from './base';
import { AuditCheck } from './audit';
import { DevLinkCheck } from './devlink';
import { MindCheck } from './mind';
import { TestsCheck } from './tests';
import { BuildCheck } from './build';

export function createCheckRegistry(): Map<CheckId, CheckAdapter> {
  const registry = new Map<CheckId, CheckAdapter>();
  
  registry.set('audit', new AuditCheck());
  registry.set('devlink', new DevLinkCheck());
  registry.set('mind', new MindCheck());
  registry.set('tests', new TestsCheck());
  registry.set('build', new BuildCheck());
  
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

