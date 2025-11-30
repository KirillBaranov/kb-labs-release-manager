import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ReleasePlanSchema } from '../../contracts/release.schema';
import { findRepoRoot } from '../../shared/utils';

type HandlerContext = {
  cwd?: string;
};

const PLAN_NOT_FOUND = 'RELEASE_PLAN_NOT_FOUND';
const PLAN_PARSE_ERROR = 'RELEASE_PLAN_PARSE_ERROR';

export async function handleGetLatestPlan(_input: unknown, ctx: HandlerContext = {}) {
  const cwd = ctx.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const planPath = join(repoRoot, '.kb', 'release', 'plan.json');

  let raw: string;
  try {
    raw = await readFile(planPath, 'utf-8');
  } catch (error) {
    throw createError(PLAN_NOT_FOUND, 'Release plan not found. Run "kb release plan" first.', error);
  }

  try {
    const parsed = JSON.parse(raw);
    return ReleasePlanSchema.parse(parsed);
  } catch (error) {
    throw createError(
      PLAN_PARSE_ERROR,
      error instanceof Error ? error.message : 'Failed to parse release plan',
      error
    );
  }
}

function createError(code: string, message: string, cause?: unknown) {
  const err = new Error(message);
  (err as Error & { code?: string }).code = code;
  if (cause) {
    (err as Error & { cause?: unknown }).cause = cause;
  }
  return err;
}

