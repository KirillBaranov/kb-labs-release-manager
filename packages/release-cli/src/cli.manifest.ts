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
];

