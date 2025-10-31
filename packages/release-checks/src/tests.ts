/**
 * Tests check adapter
 * Calls: vitest run --reporter=json
 */

import { execa } from 'execa';
import { BaseCheckAdapter } from './base.js';
import type { CheckResult } from '@kb-labs/release-core';

export class TestsCheck extends BaseCheckAdapter {
  id = 'tests' as const;

  async run(cwd: string, timeoutMs: number): Promise<CheckResult> {
    const start = Date.now();

    try {
      // Check if vitest is available
      try {
        await execa('vitest', ['--version'], { cwd, timeout: 5000 });
      } catch {
        return this.createSkippedResult('vitest not installed');
      }

      // Run vitest with JSON reporter
      const { stdout, exitCode } = await execa(
        'vitest',
        ['run', '--reporter=json'],
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
          'Failed to parse vitest output',
          timingMs
        );
      }

      // Extract test results
      const numFailedTests = result.numFailedTests || 0;
      const numPassedTests = result.numPassedTests || 0;
      const numTotalTests = result.numTotalTests || 0;
      const ok = exitCode === 0 && numFailedTests === 0;

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

