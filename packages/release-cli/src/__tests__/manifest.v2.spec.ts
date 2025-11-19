import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.v2.js';

describe('@kb-labs/release manifest', () => {
  it('exposes all CLI commands', () => {
    const commands = manifest.cli?.commands ?? [];
    expect(commands.length).toBeGreaterThan(0);
    const declaredIds = commands.map((cmd) => cmd.id);
    expect(declaredIds).toEqual(
      expect.arrayContaining([
        'release:plan',
        'release:run',
        'release:rollback',
        'release:report',
        'release:changelog',
        'release:preview',
        'release:verify',
      ]),
    );
  });

  it('registers REST routes for plan and report', () => {
    const routes = manifest.rest?.routes ?? [];
    const routePaths = routes.map((route) => route.path);
    expect(routePaths).toEqual(expect.arrayContaining(['/plan/latest', '/report/latest']));
  });

  it('declares artifacts for plan and report', () => {
    const artifactIds = manifest.artifacts?.map((artifact) => artifact.id) ?? [];
    expect(artifactIds).toEqual(expect.arrayContaining(['release.plan.json', 'release.report.json']));
  });
});

