/**
 * Build check adapter
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BaseCheckAdapter } from './base';
import type { CheckResult } from '@kb-labs/release-manager-core';
import type { ShellApi } from '@kb-labs/plugin-contracts';
import { createExecaShellAdapter } from '@kb-labs/release-manager-core';

export class BuildCheck extends BaseCheckAdapter {
  id = 'build' as const;

  async run(cwd: string, timeoutMs: number, shell?: ShellApi): Promise<CheckResult> {
    const shellApi = shell || createExecaShellAdapter();
    const start = Date.now();

    try {
      // Detect build tool and run build
      const buildCommand = this.detectBuildTool(cwd);
      if (!buildCommand) {
        return this.createSkippedResult('no build configuration found');
      }

      const [cmd, ...args] = buildCommand;
      if (!cmd) {
        return this.createSkippedResult('no build command');
      }
      
      const result = await shellApi.exec(cmd, args, {
        cwd,
        timeoutMs,
      });

      const timingMs = Date.now() - start;
      const ok = result.ok;

      return {
        id: this.id,
        ok,
        details: {
          exitCode: result.exitCode,
          tool: this.detectBuildToolName(cwd),
        },
        hint: ok
          ? undefined
          : 'Build failed - check output for errors',
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

  private detectBuildTool(cwd: string): string[] | null {
    // Check for tsup
    if (existsSync(join(cwd, 'tsup.config.ts')) || existsSync(join(cwd, 'tsup.config.js'))) {
      return ['pnpm', 'build'];
    }

    // Check for rollup
    if (existsSync(join(cwd, 'rollup.config.js')) || existsSync(join(cwd, 'rollup.config.ts'))) {
      return ['pnpm', 'build'];
    }

    // Check for vite
    if (existsSync(join(cwd, 'vite.config.ts')) || existsSync(join(cwd, 'vite.config.js'))) {
      return ['pnpm', 'exec', 'vite', 'build', '--mode', 'production'];
    }

    return null;
  }

  private detectBuildToolName(cwd: string): string {
    if (existsSync(join(cwd, 'tsup.config.ts')) || existsSync(join(cwd, 'tsup.config.js'))) {
      return 'tsup';
    }
    if (existsSync(join(cwd, 'rollup.config.js')) || existsSync(join(cwd, 'rollup.config.ts'))) {
      return 'rollup';
    }
    if (existsSync(join(cwd, 'vite.config.ts')) || existsSync(join(cwd, 'vite.config.js'))) {
      return 'vite';
    }
    return 'pnpm';
  }
}

