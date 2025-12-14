/**
 * Core types for @kb-labs/release-manager-core
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

// CheckId is now dynamic - any string is allowed
export type CheckId = string;

/**
 * Custom check configuration
 * Allows defining checks declaratively through config
 */
export interface CustomCheckConfig {
  id: string;
  command: string;
  args?: string[];
  parser?: 'json' | 'exitcode' | ((stdout: string, stderr: string, exitCode: number) => boolean);
  timeoutMs?: number;
  optional?: boolean;
}

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
  skipped?: string[];
  changelog?: string;
  checks?: Partial<Record<CheckId, CheckResult>>;
  checksPerPackage?: Record<string, Partial<Record<CheckId, CheckResult>>>;
  versionUpdates?: Array<{
    package: string;
    from: string;
    to: string;
    updated: boolean;
  }>;
  git?: {
    committed: boolean;
    tagged: string[];
    pushed: boolean;
  };
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
  checks?: CustomCheckConfig[];
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
  changelog?: {
    enabled?: boolean;
    includeTypes?: string[];
    excludeTypes?: string[];
    ignoreAuthors?: string[];
    scopeMap?: Record<string, string>;
    collapseMerges?: boolean;
    collapseReverts?: boolean;
    preferMergeSummary?: boolean;
    bumpStrategy?: 'independent' | 'ripple' | 'lockstep';
    workspace?: boolean;
    perPackage?: boolean;
    format?: 'json' | 'md' | 'both';
    level?: 'compact' | 'standard' | 'detailed';
    template?: string | null;
    locale?: 'en' | 'ru';
    cache?: boolean;
    requireAudit?: boolean;
    requireSignedTags?: boolean;
    redactPatterns?: string[];
    maxBodyLength?: number;
    stabilityGuards?: {
      experimental?: { allowMajor?: boolean };
    };
    ignoreSubmodules?: boolean;
    metadata?: Record<string, unknown>;
  };
  git?: {
    provider?: 'auto' | 'github' | 'gitlab' | 'generic';
    baseUrl?: string | null;
    autoUnshallow?: boolean;
    requireSignedTags?: boolean;
  };
}

export interface AuditSummary {
  ok: boolean;
  checks: Partial<Record<string, { ok: boolean; code?: string; hint?: string }>>;
  overall?: { ok: boolean; failReasons: string[] };
}

