# KB Labs Release Manager

**@kb-labs/release-manager** — unified release orchestration for monorepo packages.

Combines audit, devlink, mind checks with version management and publishing. Guarantees that releases only happen when all quality gates pass, automatically publishes packages, and maintains full release traceability.

> "If Audit ensures quality — Release Manager ensures trust."

---

## Overview

Release Manager is the final step in the KB Labs engineering cycle: TTM (Time to Market). It:

- ✅ Checks code quality (audit, build, tests)
- ✅ Validates dependencies (devlink, mind)
- ✅ Computes next version (semver strategy)
- ✅ Generates changelog
- ✅ Publishes to npm registry
- ✅ Creates rollback snapshots
- ✅ Outputs machine-readable reports

---

## Architecture

### Packages

| Package | Purpose |
|---------|---------|
| **@kb-labs/release-core** | Orchestration, planning, versioning, publishing |
| **@kb-labs/release-checks** | Integrations with audit, devlink, mind, tests |
| **@kb-labs/release-cli** | CLI commands (plan, run, rollback, report) |

---

## Usage

### Installation

```bash
pnpm add -D @kb-labs/release-manager
```

### Configuration

Add to `kb-labs.config.json`:

```json
{
  "release": {
    "registry": "https://registry.npmjs.org",
    "strategy": "semver",
    "bump": "auto",
    "strict": true,
    "verify": ["audit", "build", "tests"],
    "publish": {
      "npm": true,
      "github": false
    },
    "rollback": {
      "enabled": true,
      "maxHistory": 5
    }
  }
}
```

### Commands

#### Plan Release

```bash
kb release plan --scope packages/* --bump auto
```

Analyzes changes and prepares release plan without publishing.

#### Execute Release

```bash
kb release run --dry-run
kb release run --strict
kb release run --json
```

Runs full release process: plan → check → publish → report.

#### Rollback

```bash
kb release rollback
```

Restores previous state from backup snapshot.

#### Show Report

```bash
kb release report
kb release report --json
```

Displays last release execution report.

---

## Features

### ✅ Pre-Release Checks

- **Audit**: Code quality via `kb audit run`
- **Build**: Verification via `pnpm build`
- **Tests**: Coverage via vitest
- **DevLink**: Dependency integrity
- **Mind**: Schema consistency

### 📦 Version Management

- **Auto-detect** version bumps from conventional commits
- **Manual override** via `--bump patch|minor|major`
- **Semantic versioning** strategy
- **Dependency graph** aware

### 🚀 Publishing

- **Safe publishing** only when checks pass
- **Atomic behavior** with rollback on failure
- **Dry-run mode** for simulation
- **Registry configurable** (npm, custom)

### 📊 Reporting

Formats generated:

- **JSON** (`.kb/release/report.json`) — for CI/CD
- **Markdown** (`.kb/release/summary.md`) — human readable
- **Text** (`.kb/release/summary.txt`) — minimal output

### 🔄 Rollback

- **Automatic snapshots** before releases
- **One-command recovery** from failures
- **Backup retention** configurable

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — release published |
| 1 | Infrastructure error |
| 2 | Quality gate failed |
| 3 | Misconfiguration |
| 4 | Rollback executed |

---

## Implementation Details

### Release Stages

1. **Planning** — detect changes, compute versions
2. **Checking** — run pre-release quality checks
3. **Versioning** — update package.json versions
4. **Publishing** — build and publish to registry
5. **Verifying** — confirm publish success
6. **Rollback** — restore on failure

### Safety Features

- All checks must pass in `--strict` mode
- Atomic operations with rollback
- Deterministic JSON reports
- Reproducible release plans

---

## Dependencies

**Internal:**
- `@kb-labs/audit` — code quality
- `@kb-labs/devlink` — dependency checks
- `@kb-labs/mind-*` — schema validation
- `@kb-labs/devkit` — shared tooling
- `@kb-labs/shared-cli-ui` — CLI presentation

**External:**
- `execa`, `fs-extra`, `globby`
- `semver`, `simple-git`, `yaml`

---

## License

MIT

---

## Author

Kirill Baranov — [@kirill-baranov](https://github.com/kirill-baranov)
