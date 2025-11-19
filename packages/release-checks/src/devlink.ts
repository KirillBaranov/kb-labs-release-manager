/**
 * DevLink check adapter
 * Calls: kb devlink check --json
 */

import { BaseCheckAdapter } from './base.js';
import type { CheckResult } from '@kb-labs/release-core';
import type { ShellApi } from '@kb-labs/plugin-contracts';
import { createExecaShellAdapter } from '@kb-labs/release-core';

export class DevLinkCheck extends BaseCheckAdapter {
  id = 'devlink' as const;

  async run(cwd: string, timeoutMs: number, shell?: ShellApi): Promise<CheckResult> {
    const shellApi = shell || createExecaShellAdapter();
    const start = Date.now();

    try {
      // Check if kb CLI is available
      try {
        const versionResult = await shellApi.exec('kb', ['--version'], { cwd, timeoutMs: 5000 });
        if (!versionResult.ok) {
          return this.createSkippedResult('kb CLI not installed');
        }
      } catch {
        return this.createSkippedResult('kb CLI not installed');
      }

      // Run kb devlink check --json
      const result = await shellApi.exec(
        'kb',
        ['devlink', 'check', '--json'],
        {
          cwd,
          timeoutMs,
        }
      );

      const timingMs = Date.now() - start;

      // Parse JSON output
      let parsedResult: any;
      try {
        parsedResult = JSON.parse(result.stdout || '{}');
      } catch {
        return this.createErrorResult(
          'PARSE_ERROR',
          'Failed to parse devlink output',
          timingMs
        );
      }

      // Extract cycles and mismatches
      const cycles = parsedResult.cycles || [];
      const mismatches = parsedResult.mismatches || [];
      const ok = result.ok && cycles.length === 0 && mismatches.length === 0;

      return {
        id: this.id,
        ok,
        details: {
          cycles: cycles,
          mismatches: mismatches,
        },
        hint: ok
          ? undefined
          : cycles.length > 0
            ? `Found ${cycles.length} dependency cycle(s)`
            : mismatches.length > 0
              ? `Found ${mismatches.length} dependency mismatch(es)`
              : 'DevLink check failed',
        timingMs,
      };
    } catch (error: unknown) {
      const timingMs = Date.now() - start;
      return this.createErrorResult(
        'CHECK_ERROR',
        error instanceof Error ? error.message : String(error),
        timingMs,
        { error: String(error) }
      );
    }
  }
}

