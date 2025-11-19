import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ReleaseReportSchema } from '../../contracts/release.schema.js';
import { findRepoRoot } from '../../shared/utils.js';

type HandlerContext = {
  cwd?: string;
};

const REPORT_NOT_FOUND = 'RELEASE_REPORT_NOT_FOUND';
const REPORT_PARSE_ERROR = 'RELEASE_REPORT_PARSE_ERROR';

export async function handleGetLatestReport(_input: unknown, ctx: HandlerContext = {}) {
  const cwd = ctx.cwd ?? process.cwd();
  const repoRoot = await findRepoRoot(cwd);
  const reportPath = join(repoRoot, '.kb', 'release', 'report.json');

  let raw: string;
  try {
    raw = await readFile(reportPath, 'utf-8');
  } catch (error) {
    throw createError(REPORT_NOT_FOUND, 'Release report not found. Run "kb release run" first.', error);
  }

  try {
    const parsed = JSON.parse(raw);
    return ReleaseReportSchema.parse(parsed);
  } catch (error) {
    throw createError(
      REPORT_PARSE_ERROR,
      error instanceof Error ? error.message : 'Failed to parse release report',
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

