import { findRepoRoot as findRepoRootImpl } from '@kb-labs/core';

export async function findRepoRoot(cwd: string): Promise<string> {
  return await findRepoRootImpl(cwd);
}

