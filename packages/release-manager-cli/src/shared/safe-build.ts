/**
 * Safe build utilities for release manager.
 *
 * Builds into a temp directory, then atomically swaps dist/.
 * Prevents crashing running services whose dist/ is wiped by tsup's `clean: true`.
 */

import { rename, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { ILogger } from '@kb-labs/sdk';

export interface BuildResult {
  success: boolean;
  error?: string;
  durationMs: number;
}

/**
 * Run build for a package using safe temp-dir strategy when tsup is detected.
 * Falls back to regular `pnpm run build` for non-tsup packages.
 */
export async function runSafeBuild(packagePath: string, packageName: string, logger?: ILogger): Promise<BuildResult> {
  const usesTsup = existsSync(join(packagePath, 'tsup.config.ts'))
    || existsSync(join(packagePath, 'tsup.config.js'));

  if (usesTsup) {
    return runTsupSafeBuild(packagePath, packageName, logger);
  }

  return runDirectBuild(packagePath);
}

/**
 * Check if a shell command is a build command that should use safe build.
 * Detects: `pnpm run build`, `pnpm build`, `npm run build`, etc.
 */
export function isBuildCommand(command: string, args?: string[]): boolean {
  const full = [command, ...(args ?? [])].join(' ').trim();
  return /\b(pnpm|npm|yarn)\s+(run\s+)?build\b/.test(full);
}

/**
 * Safe build: tsup → temp dir → atomic swap
 */
async function runTsupSafeBuild(packagePath: string, packageName: string, logger?: ILogger): Promise<BuildResult> {
  const startTime = Date.now();
  const buildId = randomBytes(6).toString('hex');
  const tempDir = join(tmpdir(), `kb-release-build-${buildId}`);
  const distDir = join(packagePath, 'dist');
  const backupDir = join(packagePath, `dist.bak-${buildId}`);

  try {
    // Phase 1: Build into temp dir
    const buildResult = await spawnCommand(`npx tsup -d ${tempDir}`, packagePath);

    if (!buildResult.success) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return { ...buildResult, durationMs: Date.now() - startTime };
    }

    // Phase 2: Atomic swap dist/
    if (existsSync(distDir)) {
      await rename(distDir, backupDir);
    }

    try {
      await rename(tempDir, distDir);
    } catch {
      // rename fails across filesystems — fall back to copy
      await cp(tempDir, distDir, { recursive: true });
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    await rm(backupDir, { recursive: true, force: true }).catch(() => {});

    logger?.info?.(`Safe build complete for ${packageName}`);
    return { success: true, durationMs: Date.now() - startTime };
  } catch (err) {
    // Restore backup if swap failed
    if (existsSync(backupDir) && !existsSync(distDir)) {
      await rename(backupDir, distDir).catch(() => {});
    }
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Direct build: regular `pnpm run build` (fallback for non-tsup packages)
 */
async function runDirectBuild(packagePath: string): Promise<BuildResult> {
  return spawnCommand('pnpm run build', packagePath);
}

/**
 * Spawn a shell command and collect results
 */
export function spawnCommand(command: string, cwd: string, timeoutMs = 5 * 60 * 1000): Promise<BuildResult> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, [], {
      cwd,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env },
    });

    let stderr = '';

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      if (code === 0) {
        resolve({ success: true, durationMs });
      } else {
        resolve({
          success: false,
          error: stderr || `Build failed with exit code ${code}`,
          durationMs,
        });
      }
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      resolve({ success: false, error: err.message, durationMs });
    });

    setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        error: `Timed out after ${timeoutMs / 1000}s`,
        durationMs: Date.now() - startTime,
      });
    }, timeoutMs);
  });
}
