/**
 * Configuration loader for @kb-labs/release-core
 * Uses @kb-labs/core-bundle for layered config resolution
 */

import { loadBundle } from '@kb-labs/core-bundle';
import type { ReleaseConfig } from './types.js';

export interface LoadReleaseConfigOptions {
  cwd?: string;
  profileKey?: string;
  cli?: Record<string, unknown>;
  trace?: boolean;
}

export interface ReleaseConfigResult {
  config: ReleaseConfig;
  trace?: any;
}

/**
 * Load release configuration using core bundle system
 */
export async function loadReleaseConfig(
  opts: LoadReleaseConfigOptions
): Promise<ReleaseConfigResult> {
  const bundle = await loadBundle({
    cwd: opts.cwd || process.cwd(),
    product: 'release',
    profileKey: opts.profileKey || 'default',
    cli: opts.cli,
    validate: 'warn', // Validate with warnings
  });
  
  return {
    config: bundle.config as ReleaseConfig,
    trace: opts.trace ? bundle.trace : undefined,
  };
}

