/**
 * Command check adapter
 * Universal adapter that executes shell commands and parses results
 */

import { BaseCheckAdapter } from './base';
import type { CheckResult, CheckId, CustomCheckConfig } from '@kb-labs/release-manager-core';
import type { ShellApi } from '@kb-labs/plugin-contracts';
import { createExecaShellAdapter } from '@kb-labs/release-manager-core';

interface ExecResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class CommandCheckAdapter extends BaseCheckAdapter {
  id: CheckId;

  constructor(private config: CustomCheckConfig) {
    super();
    this.id = config.id as CheckId;
  }

  async run(cwd: string, timeoutMs: number, shell?: ShellApi): Promise<CheckResult> {
    const shellApi = shell || createExecaShellAdapter();
    const start = Date.now();

    try {
      const result = await shellApi.exec(
        this.config.command,
        this.config.args || [],
        {
          cwd,
          timeoutMs: this.config.timeoutMs || timeoutMs,
        }
      );

      const ok = this.parseResult(result);

      return {
        id: this.id,
        ok,
        timingMs: Date.now() - start,
        details: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
        hint: ok ? undefined : 'Check failed - see details',
      };
    } catch (error) {
      const timingMs = Date.now() - start;
      return this.createErrorResult(
        'CHECK_ERROR',
        error instanceof Error ? error.message : String(error),
        timingMs,
        { error: String(error) }
      );
    }
  }

  private parseResult(result: ExecResult): boolean {
    // Default: exitcode parser
    if (this.config.parser === 'exitcode' || !this.config.parser) {
      return result.ok;
    }

    // JSON parser: expects { ok: boolean }
    if (this.config.parser === 'json') {
      try {
        const parsed = JSON.parse(result.stdout || '{}');
        return parsed.ok !== false;
      } catch {
        return false;
      }
    }

    // Custom function parser
    if (typeof this.config.parser === 'function') {
      return this.config.parser(result.stdout, result.stderr, result.exitCode);
    }

    return result.ok;
  }
}
