/**
 * Programmatic npm publishing for REST handlers (non-interactive context)
 *
 * Uses `npm publish` CLI via spawn with NODE_AUTH_TOKEN env variable.
 * This is the correct approach for granular access tokens (classic tokens
 * were revoked by npm in December 2025).
 *
 * Token resolution order:
 * 1. options.token (explicit override)
 * 2. NPM_TOKEN env variable
 * 3. NODE_AUTH_TOKEN env variable
 */

import { spawn } from 'node:child_process';
import { useLogger } from '@kb-labs/sdk';

export interface PackageToPublish {
  name: string;
  version: string;
  path: string;
}

export interface ProgrammaticPublishOptions {
  packages: PackageToPublish[];
  dryRun?: boolean;
  otp?: string;
  tag?: string;
  access?: 'public' | 'restricted';
  registry?: string;
  token?: string;
}

export interface PublishResult {
  name: string;
  version: string;
  success: boolean;
  error?: string;
}

export interface ProgrammaticPublishResult {
  results: PublishResult[];
  published: string[];
  failed: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Resolve npm auth token from options or environment
 */
function resolveToken(token?: string): string | undefined {
  return token ?? process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;
}

/**
 * Publish a single package using npm CLI
 * Passes auth token via NODE_AUTH_TOKEN env (recommended for granular tokens)
 */
function publishSinglePackage(options: {
  packagePath: string;
  token: string | undefined;
  otp?: string;
  dryRun?: boolean;
  tag?: string;
  access?: string;
  registry?: string;
}): Promise<void> {
  const { packagePath, token, otp, dryRun, tag, access, registry } = options;

  return new Promise((resolve, reject) => {
    const args = ['publish'];

    if (dryRun) {
      args.push('--dry-run');
    }

    if (tag) {
      args.push(`--tag=${tag}`);
    }

    if (access) {
      args.push(`--access=${access}`);
    }

    if (registry) {
      args.push(`--registry=${registry}`);
    }

    if (otp) {
      args.push(`--otp=${otp}`);
    }

    // Pass token via env — this is the correct way for granular tokens
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (token) {
      env['NODE_AUTH_TOKEN'] = token;
    }

    const child = spawn('npm', args, {
      cwd: packagePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || stdout || `npm publish exited with code ${code}`));
      }
    });

    child.on('error', (err: Error) => {
      reject(err);
    });
  });
}

/**
 * Publish packages programmatically (non-interactive, for REST handlers)
 * Uses npm CLI with NODE_AUTH_TOKEN — works with granular access tokens.
 */
export async function publishPackagesProgrammatic(
  options: ProgrammaticPublishOptions
): Promise<ProgrammaticPublishResult> {
  const { packages, dryRun, otp, tag, access, registry } = options;
  const logger = useLogger();

  const token = resolveToken(options.token);

  if (!token && !dryRun) {
    const error = 'No npm token found. Set NPM_TOKEN (or NODE_AUTH_TOKEN) in environment.';
    logger.error(error);
    return {
      results: [],
      published: [],
      failed: packages.map((p) => `${p.name}@${p.version}`),
      skipped: [],
      errors: [error],
    };
  }

  const results: PublishResult[] = [];

  for (const pkg of packages) {
    logger.info(`Publishing ${pkg.name}@${pkg.version}`, { path: pkg.path, dryRun });

    try {
      await publishSinglePackage({
        packagePath: pkg.path,
        token,
        otp,
        dryRun,
        tag,
        access: access ?? 'public',
        registry,
      });

      results.push({ name: pkg.name, version: pkg.version, success: true });
      logger.info(`Published ${pkg.name}@${pkg.version}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error(`Failed to publish ${pkg.name}@${pkg.version}`, undefined, { error: message });

      results.push({
        name: pkg.name,
        version: pkg.version,
        success: false,
        error: message,
      });
    }
  }

  const published = results.filter((r) => r.success).map((r) => `${r.name}@${r.version}`);
  const failed = results.filter((r) => !r.success).map((r) => `${r.name}@${r.version}`);
  const errors = results.filter((r) => !r.success && r.error).map((r) => `${r.name}: ${r.error}`);

  return {
    results,
    published,
    failed,
    skipped: dryRun ? packages.map((p) => `${p.name}@${p.version} (dry-run)`) : [],
    errors,
  };
}
