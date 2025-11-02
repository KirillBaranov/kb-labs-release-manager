# KB Labs Release Manager (@kb-labs/release-manager)

> **Unified release orchestration for monorepo packages.** Combines audit, devlink, mind checks with version management and publishing. Guarantees that releases only happen when all quality gates pass, automatically publishes packages, and maintains full release traceability.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18.18.0+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9.0.0+-orange.svg)](https://pnpm.io/)

## 🎯 Vision

KB Labs Release Manager is the final step in the KB Labs engineering cycle: TTM (Time to Market). It combines audit, devlink, mind checks with version management and publishing, guaranteeing that releases only happen when all quality gates pass, automatically publishes packages, and maintains full release traceability.

The project solves the problem of manual, error-prone release processes in monorepos by providing an automated, orchestrated release workflow that integrates quality checks, version management, changelog generation, and publishing. Instead of manually running multiple commands and checking quality, developers can use `kb release run` to execute a complete, verified release.

This project is part of the **@kb-labs** ecosystem and integrates seamlessly with Audit, DevLink, Mind, and all other KB Labs tools to ensure reliable, traceable releases.

> "If Audit ensures quality — Release Manager ensures trust."

## 🚀 Quick Start

### Installation

```bash
pnpm add -D @kb-labs/release-manager
```

### Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
```

### Basic Usage

#### Plan Release

```bash
# Analyze changes and prepare release plan without publishing
kb release plan --scope packages/* --bump auto
```

#### Execute Release

```bash
# Run full release process: plan → check → publish → report
kb release run

# Dry-run mode for simulation
kb release run --dry-run

# Strict mode (all checks must pass)
kb release run --strict

# JSON output
kb release run --json
```

#### Rollback

```bash
# Restore previous state from backup snapshot
kb release rollback
```

#### Show Report

```bash
# Display last release execution report
kb release report
kb release report --json
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

### Changelog Generation

```bash
# Generate changelog from conventional commits
kb release changelog

# Generate changelog from specific version
kb release changelog --from v1.0.0

# Generate detailed changelog
kb release changelog --format md --level detailed

# Generate breaking changes only
kb release changelog --breaking-only
```

### Release Preview

```bash
# Show release plan with bump table and changelog preview without making changes
kb release preview
kb release preview --md
```

### Release Verification

```bash
# Validate release readiness and check for substantial changes
kb release verify
kb release verify --fail-if-empty
kb release verify --allow-types feat,fix
```

## ✨ Features

### Pre-Release Checks

- **Audit**: Code quality via `kb audit run`
- **Build**: Verification via `pnpm build`
- **Tests**: Coverage via vitest
- **DevLink**: Dependency integrity
- **Mind**: Schema consistency

### Version Management

- **Auto-detect** version bumps from conventional commits
- **Manual override** via `--bump patch|minor|major`
- **Semantic versioning** strategy
- **Dependency graph** aware

### Enhanced Changelog

- **Conventional commits** parsing with single-pass performance
- **Bot filtering** (dependabot, renovate, custom patterns)
- **Git providers** (GitHub, GitLab, self-hosted) with auto-detect
- **Version policies** (independent, ripple, lockstep)
- **Multiple formats** (JSON manifest + Markdown)
- **i18n support** (en, ru locales)
- **Rendering levels** (compact, standard, detailed)
- **Security** (redaction patterns, body truncation)
- **Deterministic output** with SHA256 integrity hashes

### Publishing

- **Safe publishing** only when checks pass
- **Atomic behavior** with rollback on failure
- **Dry-run mode** for simulation
- **Registry configurable** (npm, custom)

### Reporting

Formats generated:
- **JSON** (`.kb/release/report.json`) — for CI/CD
- **Markdown** (`.kb/release/summary.md`) — human readable
- **Text** (`.kb/release/summary.txt`) — minimal output

### Rollback

- **Automatic snapshots** before releases
- **One-command recovery** from failures
- **Backup retention** configurable

## 📁 Repository Structure

```
kb-labs-release-manager/
├── packages/                # Core packages
│   ├── release-core/        # Orchestration, planning, versioning, publishing
│   ├── release-checks/      # Integrations with audit, devlink, mind, tests
│   ├── release-cli/         # CLI commands (plan, run, rollback, report, changelog, preview, verify)
│   └── changelog/           # Conventional commits parser and changelog generator
├── docs/                    # Documentation
│   └── adr/                 # Architecture Decision Records
└── scripts/                 # Utility scripts
```

### Directory Descriptions

- **`packages/release-core/`** - Core orchestration, planning, versioning, and publishing logic
- **`packages/release-checks/`** - Pre-release check integrations with audit, devlink, mind, and tests
- **`packages/release-cli/`** - CLI commands for release operations
- **`packages/changelog/`** - Conventional commits parser and changelog generator
- **`docs/`** - Documentation including ADRs and guides

## 📦 Packages

| Package | Description |
|---------|-------------|
| [@kb-labs/release-core](./packages/release-core/) | Orchestration, planning, versioning, publishing, and reporting |
| [@kb-labs/release-checks](./packages/release-checks/) | Integrations with audit, devlink, mind, tests for pre-release validation |
| [@kb-labs/release-cli](./packages/release-cli/) | CLI commands (plan, run, rollback, report, changelog, preview, verify) |
| [@kb-labs/changelog](./packages/changelog/) | Conventional commits parser and changelog generator |

### Package Details

**@kb-labs/release-core** provides orchestration and publishing:
- Release planning (detect changes, compute versions)
- Pre-release checking coordination
- Version management and package.json updates
- Publishing to npm registry
- Report generation (JSON, Markdown, Text)
- Rollback snapshots and recovery

**@kb-labs/release-checks** provides pre-release validations:
- **Audit Check**: Run `kb audit run` for code quality
- **Build Check**: Verify build via `pnpm build`
- **Tests Check**: Validate test coverage via vitest
- **DevLink Check**: Validate dependency integrity
- **Mind Check**: Validate schema consistency

**@kb-labs/release-cli** provides CLI commands:
- `kb release plan` - Analyze changes and prepare release plan
- `kb release run` - Execute full release process
- `kb release rollback` - Restore previous state
- `kb release report` - Display last release report
- `kb release changelog` - Generate changelog from conventional commits
- `kb release preview` - Preview release plan without making changes
- `kb release verify` - Validate release readiness

**@kb-labs/changelog** provides changelog generation:
- Conventional commits parsing with single-pass performance
- Bot filtering (dependabot, renovate, custom patterns)
- Git provider support (GitHub, GitLab, self-hosted)
- Version policies (independent, ripple, lockstep)
- Multiple output formats (JSON manifest + Markdown)
- i18n support (en, ru locales)
- Rendering levels (compact, standard, detailed)

## 🛠️ Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development mode for all packages |
| `pnpm build` | Build all packages |
| `pnpm build:clean` | Clean and build all packages |
| `pnpm test` | Run all tests |
| `pnpm test:coverage` | Run tests with coverage reporting |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm lint` | Lint all code |
| `pnpm lint:fix` | Fix linting issues |
| `pnpm format` | Format code with Prettier |
| `pnpm type-check` | TypeScript type checking |
| `pnpm check` | Run lint, type-check, and tests |
| `pnpm ci` | Full CI pipeline (clean, build, check) |
| `pnpm clean` | Clean build artifacts |
| `pnpm clean:all` | Clean all node_modules and build artifacts |

## 📋 Development Policies

- **Code Style**: ESLint + Prettier, TypeScript strict mode
- **Testing**: Vitest with comprehensive test coverage
- **Versioning**: SemVer with automated releases through Changesets
- **Architecture**: Document decisions in ADRs (see `docs/adr/`)
- **Safety**: All checks must pass in `--strict` mode, atomic operations with rollback
- **Deterministic**: JSON reports and release plans are reproducible

## 🔧 Requirements

- **Node.js**: >= 18.18.0
- **pnpm**: >= 9.0.0

## ⚙️ Configuration

### Release Configuration

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

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — release published |
| 1 | Infrastructure error |
| 2 | Quality gate failed |
| 3 | Misconfiguration |
| 4 | Rollback executed |

## 📚 Documentation

- [Documentation Standard](./docs/DOCUMENTATION.md) - Full documentation guidelines
- [Contributing Guide](./CONTRIBUTING.md) - How to contribute
- [Architecture Decisions](./docs/adr/) - ADRs for this project

## 🔗 Related Packages

### Dependencies

- [@kb-labs/core](https://github.com/KirillBaranov/kb-labs-core) - Core utilities
- [@kb-labs/audit](https://github.com/KirillBaranov/kb-labs-audit) - Code quality checks
- [@kb-labs/devlink](https://github.com/KirillBaranov/kb-labs-devlink) - Dependency checks
- [@kb-labs/mind](https://github.com/KirillBaranov/kb-labs-mind) - Schema validation
- [@kb-labs/devkit](https://github.com/KirillBaranov/kb-labs-devkit) - Shared tooling
- [@kb-labs/shared](https://github.com/KirillBaranov/kb-labs-shared) - Shared CLI UI

### Used By

- All KB Labs projects for release orchestration
- CI/CD pipelines

### Ecosystem

- [KB Labs](https://github.com/KirillBaranov/kb-labs) - Main ecosystem repository

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and contribution process.

## 📄 License

MIT © KB Labs

---

**See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and contribution process.**
