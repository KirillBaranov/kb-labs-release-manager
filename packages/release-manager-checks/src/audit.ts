/**
 * Audit check adapter
 * Calls: kb audit run --json
 */

import { BaseCheckAdapter } from './base';
import type { CheckResult } from '@kb-labs/release-manager-core';
import type { ShellApi } from '@kb-labs/plugin-contracts';
import { createExecaShellAdapter } from '@kb-labs/release-manager-core';

export class AuditCheck extends BaseCheckAdapter {
  id = 'audit' as const;

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

      // Run kb audit run --json
      const result = await shellApi.exec(
        'kb',
        ['audit', 'run', '--json'],
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
          'Failed to parse audit output',
          timingMs
        );
      }

      // Check overall result
      const overallOk = parsedResult.overall?.ok !== false;
      const ok = result.ok && overallOk;

      return {
        id: this.id,
        ok,
        details: {
          checks: parsedResult.checks,
          overall: parsedResult.overall,
        },
        hint: ok
          ? undefined
          : parsedResult.overall?.failReasons?.join(', ') || 'Audit checks failed',
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

