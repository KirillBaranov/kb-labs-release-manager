/**
 * Audit check adapter
 * Calls: kb audit run --json
 */

import { execa } from 'execa';
import { BaseCheckAdapter } from './base.js';
import type { CheckResult } from '@kb-labs/release-core';

export class AuditCheck extends BaseCheckAdapter {
  id = 'audit' as const;

  async run(cwd: string, timeoutMs: number): Promise<CheckResult> {
    const start = Date.now();

    try {
      // Check if kb CLI is available
      try {
        await execa('kb', ['--version'], { cwd, timeout: 5000 });
      } catch {
        return this.createSkippedResult('kb CLI not installed');
      }

      // Run kb audit run --json
      const { stdout, exitCode } = await execa(
        'kb',
        ['audit', 'run', '--json'],
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
          'Failed to parse audit output',
          timingMs
        );
      }

      // Check overall result
      const overallOk = result.overall?.ok !== false;
      const ok = exitCode === 0 && overallOk;

      return {
        id: this.id,
        ok,
        details: {
          checks: result.checks,
          overall: result.overall,
        },
        hint: ok
          ? undefined
          : result.overall?.failReasons?.join(', ') || 'Audit checks failed',
        timingMs,
      };
    } catch (error: unknown) {
      const timingMs = Date.now() - start;
      return this.createErrorResult(
        'AUDIT_TOOL_ERROR',
        error instanceof Error ? error.message : String(error),
        timingMs,
        { error: String(error) }
      );
    }
  }
}

