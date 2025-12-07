import { defineManifest } from '@kb-labs/shared-command-kit';
import type { ManifestV2 } from '@kb-labs/plugin-manifest';
import { pluginContractsManifest } from '@kb-labs/release-manager-contracts';

/**
 * Level 2: Типизация через contracts для автодополнения и проверки ID
 */

const releaseFsAllow = ['.kb/release/**', 'package.json', '**/package.json', 'pnpm-workspace.yaml', '**/.git/**'];
const releaseFsDeny = ['**/*.key', '**/*.secret'];

type CliCommands = NonNullable<ManifestV2['cli']>['commands'];

const commands: CliCommands = [
  {
    manifestVersion: '1.0',
    id: 'plan',
    group: 'release',
    describe: 'Analyze changes and prepare release plan',
    longDescription: 'Detect modified packages and compute version bumps based on changes',
    flags: [
      { name: 'scope', type: 'string', description: 'Package scope (glob pattern)' },
      {
        name: 'bump',
        type: 'string',
        choices: ['patch', 'minor', 'major', 'auto'],
        default: 'auto',
        description: 'Version bump strategy',
      },
      { name: 'json', type: 'boolean', description: 'Print plan as JSON' },
    ],
    examples: [
      'kb release plan',
      'kb release plan --scope packages/*',
      'kb release plan --bump minor',
      'kb release plan --json',
    ],
    handler: './cli/commands/plan#planCommand',
  },
  {
    manifestVersion: '1.0',
    id: 'run',
    group: 'release',
    describe: 'Execute release process (plan, check, publish)',
    longDescription: 'Run full release: plan versions, run checks, publish packages',
    flags: [
      { name: 'scope', type: 'string', description: 'Package scope (glob pattern)' },
      { name: 'strict', type: 'boolean', description: 'Fail on any check failure' },
      { name: 'dry-run', type: 'boolean', description: 'Simulate release without publishing' },
      { name: 'skip-checks', type: 'boolean', description: 'Skip pre-release checks' },
      { name: 'json', type: 'boolean', description: 'Print result as JSON' },
    ],
    examples: [
      'kb release run',
      'kb release run --dry-run',
      'kb release run --strict --json',
      'kb release run --scope packages/core',
    ],
    handler: './cli/commands/run#runCommand',
  },
  {
    manifestVersion: '1.0',
    id: 'rollback',
    group: 'release',
    describe: 'Rollback last release',
    longDescription: 'Restore workspace state from backup snapshot',
    flags: [{ name: 'json', type: 'boolean', description: 'Output in JSON format' }],
    examples: ['kb release rollback', 'kb release rollback --json'],
    handler: './cli/commands/rollback#rollbackCommand',
  },
  {
    manifestVersion: '1.0',
    id: 'report',
    group: 'release',
    describe: 'Show last release report',
    longDescription: 'Display the most recent release execution report',
    flags: [{ name: 'json', type: 'boolean', description: 'Output in JSON format' }],
    examples: ['kb release report', 'kb release report --json'],
    handler: './cli/commands/report#reportCommand',
  },
  {
    manifestVersion: '1.0',
    id: 'changelog',
    group: 'release',
    describe: 'Generate changelog from conventional commits',
    longDescription: 'Parse git history and generate changelog with conventional commits support',
    flags: [
      { name: 'scope', type: 'string', description: 'Filter to specific package' },
      { name: 'from', type: 'string', description: 'Start commit/tag' },
      { name: 'to', type: 'string', description: 'End commit/tag (default: HEAD)' },
      { name: 'since-tag', type: 'string', description: 'Shorthand for --from <tag>' },
      {
        name: 'format',
        type: 'string',
        choices: ['json', 'md', 'both'],
        default: 'both',
        description: 'Output format',
      },
      {
        name: 'level',
        type: 'string',
        choices: ['compact', 'standard', 'detailed'],
        default: 'standard',
        description: 'Detail level',
      },
      { name: 'breaking-only', type: 'boolean', description: 'Show only breaking changes' },
      { name: 'include', type: 'string', description: 'Comma-separated types to include' },
      { name: 'exclude', type: 'string', description: 'Types to exclude' },
      { name: 'workspace-only', type: 'boolean', description: 'Only workspace changelog' },
      { name: 'per-package', type: 'boolean', description: 'Only per-package changelogs' },
      { name: 'force', type: 'boolean', description: 'Skip audit gate' },
      { name: 'allow-major', type: 'boolean', description: 'Allow major bumps for experimental packages' },
      { name: 'preid', type: 'string', description: 'Pre-release identifier (rc, beta, alpha)' },
    ],
    examples: [
      'kb release changelog',
      'kb release changelog --from v1.0.0',
      'kb release changelog --format md --level detailed',
      'kb release changelog --breaking-only',
    ],
    handler: './cli/commands/changelog#changelogCommand',
  },
  {
    manifestVersion: '1.0',
    id: 'preview',
    group: 'release',
    describe: 'Preview release plan without making changes',
    longDescription: 'Show release plan with bump table and changelog preview',
    flags: [{ name: 'md', type: 'boolean', description: 'Print markdown preview' }],
    examples: ['kb release preview', 'kb release preview --md'],
    handler: './cli/commands/preview#previewCommand',
  },
  {
    manifestVersion: '1.0',
    id: 'verify',
    group: 'release',
    describe: 'Validate release readiness',
    longDescription: 'Check if repo has substantial changes for release',
    flags: [
      { name: 'fail-if-empty', type: 'boolean', description: 'Fail if no version bumps needed' },
      { name: 'fail-on-breaking', type: 'boolean', description: 'Fail if breaking changes detected' },
      { name: 'allow-types', type: 'string', description: 'Comma-separated types required (e.g., feat,fix)' },
    ],
    examples: [
      'kb release verify',
      'kb release verify --fail-if-empty',
      'kb release verify --allow-types feat,fix',
    ],
    handler: './cli/commands/verify#verifyCommand',
  },
];

export const manifest = defineManifest({
  schema: 'kb.plugin/2',
  id: '@kb-labs/release',
  version: '0.1.0',
  display: {
    name: 'Release Manager',
    description: 'Plan, execute, and audit releases across the KB Labs workspace.',
    tags: ['release', 'publish', 'versioning'],
  },
  setup: {
    handler: './setup/handler.js#run',
    describe: 'Prepare the .kb/release workspace (plans, reports, backups).',
    permissions: {
      fs: {
        mode: 'readWrite',
        allow: releaseFsAllow,
        deny: releaseFsDeny,
      },
      net: 'none',
      env: {
        allow: ['NODE_ENV', 'CI'],
      },
      quotas: {
        timeoutMs: 20000,
        memoryMb: 256,
        cpuMs: 5000,
      },
      capabilities: ['fs:read', 'fs:write'],
    },
  },
  cli: {
    commands,
  },
  rest: {
    basePath: '/v1/plugins/release',
    routes: [
      {
        method: 'GET',
        path: '/plan/latest',
        output: {
          zod: './contracts/release.schema.js#ReleasePlanSchema',
        },
        errors: [
          {
            code: 'RELEASE_PLAN_NOT_FOUND',
            http: 404,
            description: 'No release plan found. Run "kb release plan" first.',
          },
          {
            code: 'RELEASE_PLAN_PARSE_ERROR',
            http: 422,
            description: 'Release plan exists but failed schema validation.',
          },
        ],
        handler: './rest/handlers/plan-handler.js#handleGetLatestPlan',
        permissions: {
          fs: {
            mode: 'read',
            allow: releaseFsAllow,
            deny: releaseFsDeny,
          },
          net: 'none',
          env: {
            allow: ['NODE_ENV'],
          },
          quotas: {
            timeoutMs: 5000,
            memoryMb: 128,
            cpuMs: 2000,
          },
          capabilities: ['fs:read'],
        },
      },
      {
        method: 'GET',
        path: '/report/latest',
        output: {
          zod: './contracts/release.schema.js#ReleaseReportSchema',
        },
        errors: [
          {
            code: 'RELEASE_REPORT_NOT_FOUND',
            http: 404,
            description: 'No release report available. Run "kb release run" first.',
          },
          {
            code: 'RELEASE_REPORT_PARSE_ERROR',
            http: 422,
            description: 'Release report exists but failed schema validation.',
          },
        ],
        handler: './rest/handlers/report-handler.js#handleGetLatestReport',
        permissions: {
          fs: {
            mode: 'read',
            allow: releaseFsAllow,
            deny: releaseFsDeny,
          },
          net: 'none',
          env: {
            allow: ['NODE_ENV'],
          },
          quotas: {
            timeoutMs: 5000,
            memoryMb: 128,
            cpuMs: 2000,
          },
          capabilities: ['fs:read'],
        },
      },
    ],
  },
  studio: {
    widgets: [
      {
        id: 'release.plan',
        kind: 'infopanel',
        title: 'Latest Release Plan',
        description: 'Shows the most recent release plan generated via `kb release plan`.',
        data: {
          source: {
            type: 'rest',
            routeId: 'plan/latest',
            method: 'GET',
          },
        },
        layoutHint: {
          w: 4,
          h: 5,
          minW: 3,
          minH: 3,
        },
      },
      {
        id: 'release.report',
        kind: 'cardlist',
        title: 'Release Report',
        description: 'Status of the last release execution.',
        data: {
          source: {
            type: 'rest',
            routeId: 'report/latest',
            method: 'GET',
          },
        },
        options: {
          layout: 'list',
        },
        layoutHint: {
          w: 4,
          h: 4,
          minW: 3,
          minH: 3,
        },
      },
    ],
    menus: [
      {
        id: 'release-dashboard',
        label: 'Release Dashboard',
        target: '/plugins/release/dashboard',
        order: 0,
      },
    ],
    layouts: [
      {
        id: 'release.dashboard',
        kind: 'grid',
        title: 'Release Dashboard',
        description: 'Overview of release planning and execution.',
        config: {
          cols: { sm: 2, md: 4, lg: 6 },
          rowHeight: 5,
        },
      },
    ],
  },
  capabilities: ['fs:read', 'fs:write'],
  permissions: {
    fs: {
      mode: 'readWrite',
      allow: [...releaseFsAllow, '**/*.yml', '**/*.yaml'],
      deny: [...releaseFsDeny, '**/node_modules/**'],
    },
    net: 'none',
    env: {
      allow: ['NODE_ENV', 'CI', 'NPM_TOKEN', 'GITHUB_TOKEN', 'KB_RELEASE_*'],
    },
    quotas: {
      timeoutMs: 180000,
      memoryMb: 1536,
      cpuMs: 60000,
    },
    capabilities: ['fs:read', 'fs:write'],
    artifacts: {
      write: [
        {
          to: 'self',
          paths: ['.kb/release/**'],
        },
      ],
      read: [
        {
          from: 'self',
          paths: ['.kb/release/**'],
        },
      ],
    },
  },
  artifacts: [
    {
      id: 'release.plan.json',
      pathTemplate: '.kb/release/plan.json',
      description: 'Serialized release plan generated by `kb release plan`.',
    },
    {
      id: 'release.report.json',
      pathTemplate: '.kb/release/report.json',
      description: 'Execution report emitted by `kb release run`.',
    },
    {
      id: 'release.changelog.md',
      pathTemplate: '.kb/release/changelog.md',
      description: 'Workspace changelog output produced during release.',
    },
  ],
});

export default manifest;

