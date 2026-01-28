/**
 * Scopes handler - List available release scopes
 *
 * Returns list of packages/repos that can be released
 * Analogous to commit-plugin scopes
 */

import { defineHandler, findRepoRoot } from '@kb-labs/sdk';
import type { ScopesResponse, ReleaseScopeInfo } from '@kb-labs/release-manager-contracts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { glob } from 'glob';

export default defineHandler({
  async execute(ctx): Promise<ScopesResponse> {
    const cwd = ctx.cwd || process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    const scopes: ReleaseScopeInfo[] = [];

    // 1. Add root scope (umbrella repository)
    try {
      const rootPackageJson = JSON.parse(
        await readFile(join(repoRoot, 'package.json'), 'utf-8')
      );

      scopes.push({
        id: 'root',
        name: rootPackageJson.name || 'Root',
        path: repoRoot,
        currentVersion: rootPackageJson.version,
        description: rootPackageJson.description,
        type: 'root',
      });
    } catch {
      // No package.json at root - skip root scope
    }

    // 2. Find all top-level packages in workspace (kb-labs-*/package.json)
    const packageJsonFiles = await glob('*/package.json', {
      cwd: repoRoot,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      absolute: true,
    });

    for (const pkgPath of packageJsonFiles) {
      if (pkgPath === join(repoRoot, 'package.json')) {
        continue; // Skip root (already added)
      }

      try {
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));

        if (!pkg.name) {continue;} // Skip packages without name
        if (pkg.private === true) {continue;} // Skip private packages

        const pkgDir = join(pkgPath, '..');

        // Check if it's a monorepo (has pnpm-workspace.yaml or lerna.json)
        const isMonorepo =
          (await fileExists(join(pkgDir, 'pnpm-workspace.yaml'))) ||
          (await fileExists(join(pkgDir, 'lerna.json')));

        scopes.push({
          id: pkg.name,
          name: pkg.displayName || pkg.name,
          path: pkgDir,
          currentVersion: pkg.version,
          description: pkg.description,
          type: isMonorepo ? 'monorepo' : 'package',
        });
      } catch {
        // Skip invalid package.json
      }
    }

    // Deduplicate by id (prevents virtual scroll bugs)
    const uniqueScopes = Array.from(
      new Map(scopes.map(scope => [scope.id, scope])).values()
    );

    // Sort by name
    uniqueScopes.sort((a, b) => a.name.localeCompare(b.name));

    return { scopes: uniqueScopes };
  },
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
