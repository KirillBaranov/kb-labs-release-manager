/**
 * Tests check adapter
 * Calls: vitest run --reporter=json
 */

import { BaseCheckAdapter } from './base';
import type { CheckResult } from '@kb-labs/release-core';
import type { ShellApi } from '@kb-labs/plugin-contracts';
import { createExecaShellAdapter } from '@kb-labs/release-core';

export class TestsCheck extends BaseCheckAdapter {
  id = 'tests' as const;

  async run(cwd: string, timeoutMs: number, shell?: ShellApi): Promise<CheckResult> {
    const shellApi = shell || createExecaShellAdapter();
    const start = Date.now();

    try {
      // Check if vitest is available
      try {
        const versionResult = await shellApi.exec('vitest', ['--version'], { cwd, timeoutMs: 5000 });
        if (!versionResult.ok) {
          return this.createSkippedResult('vitest not installed');
        }
      } catch {
        return this.createSkippedResult('vitest not installed');
      }

      // Run vitest with JSON reporter
      const result = await shellApi.exec(
        'vitest',
        ['run', '--reporter=json'],
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
          'Failed to parse vitest output',
          timingMs
        );
      }

      // Extract test results
      const numFailedTests = parsedResult.numFailedTests || 0;
      const numPassedTests = parsedResult.numPassedTests || 0;
      const numTotalTests = parsedResult.numTotalTests || 0;
      const ok = result.ok && numFailedTests === 0;

      return {
        id: this.id,
        ok,
        details: {
          passed: numPassedTests,
          failed: numFailedTests,
          total: numTotalTests,
        },
        hint: ok
          ? undefined
          : numFailedTests > 0
            ? `${numFailedTests} test(s) failed`
            : 'Tests failed',
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

