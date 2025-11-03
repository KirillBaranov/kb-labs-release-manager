/**
 * Release CLI manifest
 */

export type CommandManifest = {
  manifestVersion: '1.0';
  id: string;
  aliases?: string[];
  group: string;
  describe: string;
  longDescription?: string;
  requires?: string[];
  flags?: FlagDefinition[];
  examples?: string[];
  loader: () => Promise<{ run: any }>;
};

export type FlagDefinition = {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  alias?: string;
  default?: any;
  description?: string;
  choices?: string[];
  required?: boolean;
};

export const commands: CommandManifest[] = [
  {
    manifestVersion: '1.0',
    id: 'release:plan',
    group: 'release',
    describe: 'Analyze changes and prepare release plan',
    longDescription: 'Detect modified packages and compute version bumps based on changes',
    flags: [
      {
        name: 'scope',
        type: 'string',
        description: 'Package scope (glob pattern)',
      },
      {
        name: 'bump',
        type: 'string',
        choices: ['patch', 'minor', 'major', 'auto'],
        default: 'auto',
        description: 'Version bump strategy',
      },
      {
        name: 'json',
        type: 'boolean',
        description: 'Print plan as JSON',
      },
    ],
    examples: [
      'kb release plan',
      'kb release plan --scope packages/*',
      'kb release plan --bump minor',
      'kb release plan --json',
    ],
    loader: async () => {
      const mod = await import('./commands/plan');
      return { run: mod.plan.run };
    },
  },
  {
    manifestVersion: '1.0',
    id: 'release:run',
    group: 'release',
    describe: 'Execute release process (plan, check, publish)',
    longDescription: 'Run full release: plan versions, run checks, publish packages',
    flags: [
      {
        name: 'scope',
        type: 'string',
        description: 'Package scope (glob pattern)',
      },
      {
        name: 'strict',
        type: 'boolean',
        description: 'Fail on any check failure',
      },
      {
        name: 'dry-run',
        type: 'boolean',
        description: 'Simulate release without publishing',
      },
      {
        name: 'skip-checks',
        type: 'boolean',
        description: 'Skip pre-release checks',
      },
      {
        name: 'json',
        type: 'boolean',
        description: 'Print result as JSON',
      },
    ],
    examples: [
      'kb release run',
      'kb release run --dry-run',
      'kb release run --strict --json',
      'kb release run --scope packages/core',
    ],
    loader: async () => {
      const mod = await import('./commands/run');
      return { run: mod.run.run };
    },
  },
  {
    manifestVersion: '1.0',
    id: 'release:rollback',
    group: 'release',
    describe: 'Rollback last release',
    longDescription: 'Restore workspace state from backup snapshot',
    flags: [
      {
        name: 'json',
        type: 'boolean',
        description: 'Output in JSON format',
      },
    ],
    examples: [
      'kb release rollback',
      'kb release rollback --json',
    ],
    loader: async () => {
      const mod = await import('./commands/rollback');
      return { run: mod.rollback.run };
    },
  },
  {
    manifestVersion: '1.0',
    id: 'release:report',
    group: 'release',
    describe: 'Show last release report',
    longDescription: 'Display the most recent release execution report',
    flags: [
      {
        name: 'json',
        type: 'boolean',
        description: 'Output in JSON format',
      },
    ],
    examples: [
      'kb release report',
      'kb release report --json',
    ],
    loader: async () => {
      const mod = await import('./commands/report');
      return { run: mod.report.run };
    },
  },
  {
    manifestVersion: '1.0',
    id: 'release:changelog',
    group: 'release',
    describe: 'Generate changelog from conventional commits',
    longDescription: 'Parse git history and generate changelog with conventional commits support',
    flags: [
      {
        name: 'scope',
        type: 'string',
        description: 'Filter to specific package',
      },
      {
        name: 'from',
        type: 'string',
        description: 'Start commit/tag',
      },
      {
        name: 'to',
        type: 'string',
        description: 'End commit/tag (default: HEAD)',
      },
      {
        name: 'since-tag',
        type: 'string',
        description: 'Shorthand for --from <tag>',
      },
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
      {
        name: 'breaking-only',
        type: 'boolean',
        description: 'Show only breaking changes',
      },
      {
        name: 'include',
        type: 'string',
        description: 'Comma-separated types to include',
      },
      {
        name: 'exclude',
        type: 'string',
        description: 'Types to exclude',
      },
      {
        name: 'workspace-only',
        type: 'boolean',
        description: 'Only workspace changelog',
      },
      {
        name: 'per-package',
        type: 'boolean',
        description: 'Only per-package changelogs',
      },
      {
        name: 'force',
        type: 'boolean',
        description: 'Skip audit gate',
      },
      {
        name: 'allow-major',
        type: 'boolean',
        description: 'Allow major bumps for experimental packages',
      },
      {
        name: 'preid',
        type: 'string',
        description: 'Pre-release identifier (rc, beta, alpha)',
      },
    ],
    examples: [
      'kb release changelog',
      'kb release changelog --from v1.0.0',
      'kb release changelog --format md --level detailed',
      'kb release changelog --breaking-only',
    ],
    loader: async () => {
      const mod = await import('./commands/changelog');
      return { run: mod.changelog.run };
    },
  },
  {
    manifestVersion: '1.0',
    id: 'release:preview',
    group: 'release',
    describe: 'Preview release plan without making changes',
    longDescription: 'Show release plan with bump table and changelog preview',
    flags: [
      {
        name: 'md',
        type: 'boolean',
        description: 'Print markdown preview',
      },
    ],
    examples: [
      'kb release preview',
      'kb release preview --md',
    ],
    loader: async () => {
      const mod = await import('./commands/preview');
      return { run: mod.preview.run };
    },
  },
  {
    manifestVersion: '1.0',
    id: 'release:verify',
    group: 'release',
    describe: 'Validate release readiness',
    longDescription: 'Check if repo has substantial changes for release',
    flags: [
      {
        name: 'fail-if-empty',
        type: 'boolean',
        description: 'Fail if no version bumps needed',
      },
      {
        name: 'fail-on-breaking',
        type: 'boolean',
        description: 'Fail if breaking changes detected',
      },
      {
        name: 'allow-types',
        type: 'string',
        description: 'Comma-separated types required (e.g., feat,fix)',
      },
    ],
    examples: [
      'kb release verify',
      'kb release verify --fail-if-empty',
      'kb release verify --allow-types feat,fix',
    ],
    loader: async () => {
      const mod = await import('./commands/verify');
      return { run: mod.verify.run };
    },
  },
];

