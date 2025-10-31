/**
 * Core types for @kb-labs/release-core
 */

export type ReleaseStage = 'planning' | 'checking' | 'versioning' | 'publishing' | 'verifying' | 'rollback';

export type VersionBump = 'patch' | 'minor' | 'major' | 'auto';

export interface ReleaseContext {
  repo: string;
  cwd: string;
  branch: string;
  profile?: string;
  dryRun?: boolean;
}

export interface PackageVersion {
  name: string;
  path: string;
  currentVersion: string;
  nextVersion: string;
  bump: VersionBump;
  isPublished: boolean;
  dependencies?: string[];
}

export interface ReleasePlan {
  packages: PackageVersion[];
  strategy: 'semver';
  registry: string;
  rollbackEnabled: boolean;
}

export interface CheckResult {
  id: CheckId;
  ok: boolean;
  details?: unknown;
  hint?: string;
  timingMs?: number;
}

export type CheckId = 'audit' | 'devlink' | 'mind' | 'tests' | 'build';

export interface ReleaseChecks {
  audit?: CheckResult;
  devlink?: CheckResult;
  mind?: CheckResult;
  tests?: CheckResult;
  build?: CheckResult;
}

export interface ReleaseResult {
  ok: boolean;
  version?: string;
  published?: string[];
  changelog?: string;
  checks?: ReleaseChecks;
  timingMs: number;
  errors?: string[];
}

export interface ReleaseReport {
  schemaVersion: '1.0';
  ts: string;
  context: ReleaseContext;
  stage: ReleaseStage;
  plan?: ReleasePlan;
  result: ReleaseResult;
}

export interface ReleaseConfig {
  registry?: string;
  strategy?: 'semver';
  bump?: VersionBump;
  strict?: boolean;
  verify?: CheckId[];
  publish?: {
    npm?: boolean;
    github?: boolean;
  };
  rollback?: {
    enabled?: boolean;
    maxHistory?: number;
  };
  output?: {
    json?: boolean;
    md?: boolean;
    text?: boolean;
  };
}

export interface AuditSummary {
  ok: boolean;
  checks: Partial<Record<string, { ok: boolean; code?: string; hint?: string }>>;
  overall?: { ok: boolean; failReasons: string[] };
}

