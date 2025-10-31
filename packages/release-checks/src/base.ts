/**
 * Base adapter class for release checks
 */

import type { CheckResult, CheckId } from '@kb-labs/release-core';

export interface CheckAdapter {
  id: CheckId;
  run(cwd: string, timeoutMs: number): Promise<CheckResult>;
}

export abstract class BaseCheckAdapter implements CheckAdapter {
  abstract id: CheckId;

  abstract run(cwd: string, timeoutMs: number): Promise<CheckResult>;

  protected createErrorResult(
    code: string,
    hint: string,
    timingMs: number,
    details?: unknown
  ): CheckResult {
    return {
      id: this.id,
      ok: false,
      hint,
      timingMs,
      details: {
        code,
        ...(details || {}),
      },
    };
  }

  protected createSuccessResult(
    details?: unknown,
    hint?: string,
    timingMs?: number
  ): CheckResult {
    return {
      id: this.id,
      ok: true,
      details,
      hint,
      timingMs,
    };
  }

  protected createSkippedResult(reason: string): CheckResult {
    return {
      id: this.id,
      ok: true,
      details: { skipped: reason },
    };
  }
}

