/**
 * Mind check adapter
 * Calls: kb mind verify --json
 */

import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseCheckAdapter } from './base.js';
import type { CheckResult } from '@kb-labs/release-core';

export class MindCheck extends BaseCheckAdapter {
  id = 'mind' as const;

  async run(cwd: string, timeoutMs: number): Promise<CheckResult> {
    const start = Date.now();

    try {
      // Check if .kb/mind directory exists
      const mindDir = join(cwd, '.kb', 'mind');
      if (!existsSync(mindDir)) {
        return this.createSkippedResult('mind workspace not initialized');
      }

      // Check if kb CLI is available
      try {
        await execa('kb', ['--version'], { cwd, timeout: 5000 });
      } catch {
        return this.createSkippedResult('kb CLI not installed');
      }

      // Run kb mind verify --json
      const { stdout, exitCode } = await execa(
        'kb',
        ['mind', 'verify', '--json'],
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
          'Failed to parse mind verify output',
          timingMs
        );
      }

      // Check freshness and inconsistencies
      const verifyOk = result.ok !== false;
      const inconsistencies = result.inconsistencies || [];
      const ok = exitCode === 0 && verifyOk && inconsistencies.length === 0;

      return {
        id: this.id,
        ok,
        details: {
          verify: { ok: verifyOk, inconsistencies },
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

