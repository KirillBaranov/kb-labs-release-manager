/**
 * @module @kb-labs/release-manager-core/shell-adapter
 * Shell adapter for release-core - wraps execa with types from @kb-labs/plugin-contracts
 */

import { execa } from 'execa';
import type { ShellApi, ShellResult } from '@kb-labs/plugin-contracts';

/**
 * Create a ShellApi adapter using execa
 * This is used in core libraries where ctx.runtime.shell is not available
 */
export function createExecaShellAdapter(): ShellApi {
  return {
    async exec(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<ShellResult> {
      const startTime = Date.now();
      try {
        const result = await execa(command, args, {
          cwd: options?.cwd,
          timeout: options?.timeoutMs,
        });
        return {
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          timingMs: Date.now() - startTime,
        };
      } catch (error: any) {
        return {
          ok: false,
          exitCode: error.exitCode || 1,
          stdout: error.stdout || '',
          stderr: error.stderr || error.message || '',
          timingMs: Date.now() - startTime,
        };
      }
    },
    async spawn(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number; stdio?: 'inherit' | 'pipe' | 'ignore' }) {
      // For spawn, we'll use execa's spawn method
      const { execaNode } = await import('execa');
      const child = execaNode(command, args, {
        cwd: options?.cwd,
        timeout: options?.timeoutMs,
        stdio: options?.stdio || 'pipe',
      });

      const startTime = Date.now();
      const promise = child.then(
        (result) => ({
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          timingMs: Date.now() - startTime,
        }),
        (error: any) => ({
          ok: false,
          exitCode: error.exitCode || 1,
          stdout: error.stdout || '',
          stderr: error.stderr || error.message || '',
          timingMs: Date.now() - startTime,
        })
      );

      return {
        pid: child.pid!,
        promise,
        kill: (signal?: string) => {
          child.kill(signal);
        },
      };
    },
  };
}

