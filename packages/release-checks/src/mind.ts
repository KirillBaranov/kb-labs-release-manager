/**
 * Mind check adapter
 * Calls: kb mind verify --json
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseCheckAdapter } from './base';
import type { CheckResult } from '@kb-labs/release-core';
import type { ShellApi } from '@kb-labs/plugin-contracts';
import { createExecaShellAdapter } from '@kb-labs/release-core';

export class MindCheck extends BaseCheckAdapter {
  id = 'mind' as const;

  async run(cwd: string, timeoutMs: number, shell?: ShellApi): Promise<CheckResult> {
    const shellApi = shell || createExecaShellAdapter();
    const start = Date.now();

    try {
      // Check if .kb/mind directory exists
      const mindDir = join(cwd, '.kb', 'mind');
      if (!existsSync(mindDir)) {
        return this.createSkippedResult('mind workspace not initialized');
      }

      // Check if kb CLI is available
      try {
        const versionResult = await shellApi.exec('kb', ['--version'], { cwd, timeoutMs: 5000 });
        if (!versionResult.ok) {
          return this.createSkippedResult('kb CLI not installed');
        }
      } catch {
        return this.createSkippedResult('kb CLI not installed');
      }

      // Run kb mind verify --json
      const result = await shellApi.exec(
        'kb',
        ['mind', 'verify', '--json'],
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
          'Failed to parse mind verify output',
          timingMs
        );
      }

      // Check freshness and inconsistencies
      const verifyOk = parsedResult.ok !== false;
      const inconsistencies = parsedResult.inconsistencies || [];
      const ok = result.ok && verifyOk && inconsistencies.length === 0;

      return {
        id: this.id,
        ok,
        details: {
          verify: { ok: verifyOk, inconsistencies: inconsistencies },
        },
        hint: ok
          ? undefined
          : inconsistencies.length > 0
            ? `Found ${inconsistencies.length} schema inconsistency(ies)`
            : 'Mind verification failed',
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

