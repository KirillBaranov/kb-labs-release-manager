/**
 * Programmatic npm publishing using libnpmpublish
 * Works in sandboxed environments (REST handlers) without shell access
 */

import { publish } from 'libnpmpublish';
import packlist from 'npm-packlist';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { create as tarCreate } from 'tar';
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
 * Read npm token from environment or .npmrc
 */
async function getNpmToken(): Promise<string | undefined> {
  // 1. Check environment variable
  if (process.env.NPM_TOKEN) {
    return process.env.NPM_TOKEN;
  }

  // 2. Try to read from ~/.npmrc
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    try {
      const npmrcPath = join(homeDir, '.npmrc');
      const npmrc = await readFile(npmrcPath, 'utf-8');

      // Look for //registry.npmjs.org/:_authToken=...
      const match = npmrc.match(/\/\/registry\.npmjs\.org\/:_authToken=(.+)/);
      if (match) {
        return match[1].trim();
      }
    } catch {
      // .npmrc doesn't exist or not readable
    }
  }

  return undefined;
}

/**
 * Create a tarball buffer from package directory
 */
async function createTarball(packagePath: string): Promise<Buffer> {
  // Read package.json to create tree object for npm-packlist v10+
  const pkgJsonPath = join(packagePath, 'package.json');
  const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));

  // npm-packlist v10+ requires a tree-like arborist node with:
  // - path: package path
  // - package: package.json content (must have bundleDependencies if not isProjectRoot)
  // - isProjectRoot: true to use bundleDependencies instead of all deps
  const tree = {
    path: packagePath,
    isProjectRoot: true,
    package: {
      ...pkgJson,
      bundleDependencies: pkgJson.bundleDependencies || [],
    },
  };
  const files = await packlist(tree);

  if (files.length === 0) {
    throw new Error(`No files to publish in ${packagePath}`);
  }

  // Create tar stream with gzip compression
  const chunks: Buffer[] = [];

  // Use tar.create to create tarball (tar v7 API)
  const tarStream = tarCreate(
    {
      cwd: packagePath,
      gzip: true,
      prefix: 'package/',
    },
    files
  );

  for await (const chunk of tarStream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

/**
 * Publish packages programmatically using libnpmpublish
 * This works in sandboxed environments without shell access
 */
export async function publishPackagesProgrammatic(
  options: ProgrammaticPublishOptions
): Promise<ProgrammaticPublishResult> {
  const { packages, dryRun, otp, tag, access, registry = 'https://registry.npmjs.org/' } = options;
  const logger = useLogger();

  const results: PublishResult[] = [];

  // Get token
  const token = options.token || (await getNpmToken());

  if (!token && !dryRun) {
    return {
      results: [],
      published: [],
      failed: packages.map((p) => `${p.name}@${p.version}`),
      skipped: [],
      errors: ['No npm token found. Set NPM_TOKEN env or configure ~/.npmrc'],
    };
  }

  for (const pkg of packages) {
    try {
      // Read package.json manifest
      const manifestPath = join(pkg.path, 'package.json');
      const manifestRaw = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw);

      // Verify version matches (skip for dry-run since bump hasn't happened yet)
      if (!dryRun && manifest.version !== pkg.version) {
        throw new Error(
          `Version mismatch: package.json has ${manifest.version}, expected ${pkg.version}`
        );
      }

      if (dryRun) {
        // For dry-run, just validate we can read files
        // npm-packlist v10+ requires a tree-like arborist node
        const tree = {
          path: pkg.path,
          isProjectRoot: true,
          package: {
            ...manifest,
            bundleDependencies: manifest.bundleDependencies || [],
          },
        };
        const files = await packlist(tree);
        if (files.length === 0) {
          throw new Error('No files to publish');
        }

        results.push({
          name: pkg.name,
          version: pkg.version,
          success: true,
        });
        continue;
      }

      // Create tarball
      const tarball = await createTarball(pkg.path);

      // Publish using libnpmpublish
      await publish(manifest, tarball, {
        registry,
        token,
        otp,
        access: access || (manifest.publishConfig?.access as 'public' | 'restricted') || 'public',
        defaultTag: tag || 'latest',
      });

      results.push({
        name: pkg.name,
        version: pkg.version,
        success: true,
      });
    } catch (error: any) {
      // Extract detailed error info from npm errors
      let errorMessage = error.message || String(error);

      // Log full error for debugging via logger
      logger.error('Publish error details', error, {
        code: error.code,
        statusCode: error.statusCode,
        body: error.body,
        headers: error.headers,
        pkgid: error.pkgid,
        uri: error.uri,
      });

      // libnpmpublish errors often have more details
      if (error.code) {
        errorMessage = `[${error.code}] ${errorMessage}`;
      }
      if (error.statusCode) {
        errorMessage = `HTTP ${error.statusCode}: ${errorMessage}`;
      }
      if (error.body) {
        // npm registry returns error details in body
        const body = typeof error.body === 'string' ? error.body : JSON.stringify(error.body);
        errorMessage = `${errorMessage} | Body: ${body}`;
      }

      results.push({
        name: pkg.name,
        version: pkg.version,
        success: false,
        error: errorMessage,
      });
    }
  }

  // Build result summary
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
