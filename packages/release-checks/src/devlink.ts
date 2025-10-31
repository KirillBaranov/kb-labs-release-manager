/**
 * DevLink check adapter
 * Calls: kb devlink check --json
 */

import { execa } from 'execa';
import { BaseCheckAdapter } from './base.js';
import type { CheckResult } from '@kb-labs/release-core';

export class DevLinkCheck extends BaseCheckAdapter {
  id = 'devlink' as const;

  async run(cwd: string, timeoutMs: number): Promise<CheckResult> {
    const start = Date.now();

    try {
      // Check if kb CLI is available
      try {
        await execa('kb', ['--version'], { cwd, timeout: 5000 });
      } catch {
        return this.createSkippedResult('kb CLI not installed');
      }

      // Run kb devlink check --json
      const { stdout, exitCode } = await execa(
        'kb',
        ['devlink', 'check', '--json'],
        {
          cwd,
          timeout: timeoutMs,
          reject: false,
        }
      );

      const timingMs = Date.now() - start;

      // Parse JSON output
      let result: any;
      try {
        result = JSON.parse(stdout || '{}');
      } catch {
        return this.createErrorResult(
          'PARSE_ERROR',
          'Failed to parse devlink output',
          timingMs
        );
      }

      // Extract cycles and mismatches
      const cycles = result.cycles || [];
      const mismatches = result.mismatches || [];
      const ok = exitCode === 0 && cycles.length === 0 && mismatches.length === 0;

      return {
        id: this.id,
        ok,
        details: {
          cycles,
          mismatches,
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

