/**
 * Configuration loader for @kb-labs/release-core
 * Merges: kb-labs.config.json → devkit profile → defaults
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveProfile } from '@kb-labs/shared-profiles';
import { findRepoRoot } from '@kb-labs/core';
import type { ReleaseConfig } from './types.js';

const DEFAULT_CONFIG: ReleaseConfig = {
  registry: 'https://registry.npmjs.org',
  strategy: 'semver',
  bump: 'auto',
  strict: true,
  verify: ['audit', 'build', 'tests'],
  publish: {
    npm: true,
    github: false,
  },
  rollback: {
    enabled: true,
    maxHistory: 5,
  },
  output: {
    json: true,
    md: true,
    text: true,
  },
};

/**
 * Load configuration with priority: config file → profile → defaults
 */
export async function loadConfig(opts: {
  cwd?: string;
  profileId?: string;
  profilesDir?: string;
}): Promise<ReleaseConfig> {
  const cwd = opts.cwd || process.cwd();
  const repoRoot = await findRepoRoot(cwd);

  // Start with defaults
  let config: ReleaseConfig = { ...DEFAULT_CONFIG };

  // Try to load devkit profile if specified
  if (opts.profileId || opts.profilesDir) {
    try {
      const profileId = opts.profileId || 'frontend';
      const { profile } = await resolveProfile({
        repoRoot,
        profileId,
        profilesDir: opts.profilesDir,
      });

      // Extract release config from profile meta if available
      if (profile.meta && typeof profile.meta === 'object' && 'release' in profile.meta) {
        const profileConfig = profile.meta.release as Partial<ReleaseConfig>;
        config = {
          ...config,
          ...profileConfig,
        };
      }
    } catch (error) {
      // Profile not found or invalid - continue with defaults
      console.warn(`[release] Could not load profile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Load kb-labs.config.json and merge (highest priority)
  try {
    const configPath = join(repoRoot, 'kb-labs.config.json');
    const configContent = await readFile(configPath, 'utf-8');
    const fileConfig = JSON.parse(configContent) as { release?: Partial<ReleaseConfig> };

    if (fileConfig.release) {
      // Deep merge
      config = {
        registry: fileConfig.release.registry ?? config.registry,
        strategy: fileConfig.release.strategy ?? config.strategy,
        bump: fileConfig.release.bump ?? config.bump,
        strict: fileConfig.release.strict ?? config.strict,
        verify: fileConfig.release.verify ?? config.verify,
        publish: {
          ...config.publish,
          ...fileConfig.release.publish,
        },
        rollback: {
          ...config.rollback,
          ...fileConfig.release.rollback,
        },
        output: {
          ...config.output,
          ...fileConfig.release.output,
        },
      };
    }
  } catch (error) {
    // Config file not found - continue with profile/defaults
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[release] Could not load kb-labs.config.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return config;
}

