import { findRepoRoot as findRepoRootImpl } from '@kb-labs/core-sys';

export async function findRepoRoot(cwd: string): Promise<string> {
  return await findRepoRootImpl(cwd);
}

