/**
 * Shared publishing logic with interactive OTP support
 * Used by both `release:run` and `release publish` commands
 */

import { spawn } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { useLoader } from '@kb-labs/sdk';

export interface PackageToPublish {
  name: string;
  version: string;
  path: string;
}

export interface PublishWithOTPOptions {
  packages: PackageToPublish[];
  dryRun?: boolean;
  otp?: string;
  tag?: string;
  access?: string;
  ui: {
    write?: (text: string) => void;
  };
  logger?: {
    info: (msg: string, meta?: any) => void;
    warn: (msg: string, meta?: any) => void;
    error: (msg: string, meta?: any) => void;
    debug: (msg: string, meta?: any) => void;
  };
}

export interface PublishResult {
  name: string;
  version: string;
  success: boolean;
  error?: string;
}

export interface PublishWithOTPResult {
  results: PublishResult[];
  published: string[];
  failed: string[];
  skipped: string[];
  errors: string[];
}

/**
 * Publish packages with interactive OTP support
 */
export async function publishPackagesWithOTP(
  options: PublishWithOTPOptions
): Promise<PublishWithOTPResult> {
  const { packages, dryRun, tag, access, ui, logger } = options;
  let otp = options.otp;

  const results: PublishResult[] = [];

  for (const pkg of packages) {
    logger?.info('Publishing package', { name: pkg.name, version: pkg.version });

    const loader = useLoader(`Publishing ${pkg.name}@${pkg.version}...`);
    loader.start();

    let attempts = 0;
    const maxAttempts = 3;
    let published = false;

    while (!published && attempts < maxAttempts) {
      attempts++;

      try {
        await publishSinglePackage({
          packagePath: pkg.path,
          otp,
          dryRun,
          tag,
          access,
        });

        published = true;
        results.push({ name: pkg.name, version: pkg.version, success: true });

        const successMsg = dryRun
          ? `Dry-run succeeded for ${pkg.name}@${pkg.version}`
          : `Published ${pkg.name}@${pkg.version}`;

        loader.succeed(successMsg);
        logger?.info('Package published successfully', {
          name: pkg.name,
          version: pkg.version,
          dryRun,
        });
      } catch (error: any) {
        const errorMessage = error.message || String(error);

        // Check if OTP is required
        if (errorMessage.includes('EOTP') || errorMessage.includes('one-time password')) {
          if (attempts < maxAttempts) {
            // Stop loader and show OTP prompt - this is not an error, use succeed with lock emoji
            loader.succeed(`🔐 2FA required for ${pkg.name}`);
            logger?.info('OTP required for publishing', {
              name: pkg.name,
              attempt: attempts,
            });

            // Prompt for OTP
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            try {
              otp = await rl.question('   Enter OTP code: ');
              rl.close();

              if (!otp || otp.trim().length !== 6) {
                ui.write?.('   ⚠️  Invalid OTP code (must be 6 digits)\n');
                logger?.warn('Invalid OTP code provided', { length: otp?.trim().length });
                otp = undefined;
                continue;
              }

              // Create new loader for retry attempt
              loader.update({ text: `Publishing ${pkg.name}@${pkg.version} with OTP...` });
              loader.start();
              logger?.debug('Retrying with OTP');
            } catch (e) {
              rl.close();
              throw e;
            }
          } else {
            loader.fail('Max OTP attempts reached');
            logger?.error('Max OTP attempts reached', {
              name: pkg.name,
              attempts: maxAttempts,
            });
            results.push({
              name: pkg.name,
              version: pkg.version,
              success: false,
              error: 'Max OTP attempts reached',
            });
            break;
          }
        } else {
          // Other error - don't retry
          loader.fail(`Failed: ${errorMessage}`);
          logger?.error('Package publish failed', {
            name: pkg.name,
            version: pkg.version,
            error: errorMessage,
          });
          results.push({
            name: pkg.name,
            version: pkg.version,
            success: false,
            error: errorMessage,
          });
          break;
        }
      }
    }
  }

  // Build result summary
  const published = results
    .filter((r) => r.success)
    .map((r) => `${r.name}@${r.version}`);
  const failed = results
    .filter((r) => !r.success)
    .map((r) => `${r.name}@${r.version}`);
  const errors = results
    .filter((r) => !r.success && r.error)
    .map((r) => `${r.name}: ${r.error}`);

  return {
    results,
    published,
    failed,
    skipped: dryRun ? packages.map((p) => `${p.name}@${p.version} (dry-run)`) : [],
    errors,
  };
}

interface PublishSingleOptions {
  packagePath: string;
  otp?: string;
  dryRun?: boolean;
  tag?: string;
  access?: string;
}

/**
 * Publish a single package using npm CLI
 */
function publishSinglePackage(options: PublishSingleOptions): Promise<void> {
  const { packagePath, otp, dryRun, tag, access } = options;

  return new Promise((resolve, reject) => {
    const args = ['publish'];

    if (dryRun) {
      args.push('--dry-run');
    }

    if (otp) {
      args.push(`--otp=${otp}`);
    }

    if (tag) {
      args.push(`--tag=${tag}`);
    }

    if (access) {
      args.push(`--access=${access}`);
    }

    const child = spawn('npm', args, {
      cwd: packagePath,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const errorOutput = stderr || stdout;
        reject(new Error(errorOutput));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}
