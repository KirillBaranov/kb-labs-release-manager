# KB Labs Release Manager

> **Professional release orchestration for modern monorepos.** Automate version management, quality checks, and publishing with enterprise-grade reliability.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18.18.0+-green.svg)](https://nodejs.org/)
[![KB Labs Platform](https://img.shields.io/badge/KB_Labs-Platform-blue.svg)](https://github.com/kb-labs)

## Overview

KB Labs Release Manager is a complete release automation solution that combines quality gates, version management, and publishing into a single, reliable workflow. It's designed for teams who want to ship confidently without manual release processes.

**Key benefits:**
- ✅ **Automated quality gates** - Integrates with audit, tests, and build checks
- ✅ **Smart versioning** - Detects changes and computes versions automatically
- ✅ **Safe publishing** - Atomic operations with automatic rollback on failure
- ✅ **Full traceability** - Complete audit trail of every release
- ✅ **Human-friendly changelogs** - AI-powered changelog generation

## Quick Start

### Installation

Release Manager is part of the KB Labs platform and available through the marketplace:

```bash
# Add Release Manager to your workspace
pnpm kb marketplace add @kb-labs/release-manager

# Or install via CLI
pnpm kb plugins install @kb-labs/release-manager
```

### Setup

Initialize the release workspace in your project:

```bash
# Create .kb/release/ directory structure
pnpm kb plugins setup @kb-labs/release
```

This creates:
- `.kb/release/plans/` - Release plans and version calculations
- `.kb/release/reports/` - Execution reports and audit trails
- `.kb/release/backups/` - Automatic snapshots for rollback
- `.kb/release/.gitignore` - Prevents accidental commits
- `.kb/release/README.md` - Workspace documentation

### First Release

```bash
# 1. Preview what will be released
pnpm kb release plan

# 2. Run the release (dry-run first!)
pnpm kb release run --dry-run

# 3. Execute the actual release
pnpm kb release run
```

That's it! Release Manager will:
1. Detect changed packages
2. Compute semantic versions
3. Run quality checks (audit, tests, build)
4. Generate changelog
5. Publish to registry
6. Create full release report

## Why Release Manager?

### Before Release Manager ❌
```bash
# Manual, error-prone process
git diff --name-only
# ... analyze changes manually
npm version patch
# ... repeat for each package
npm run build
npm run test
# ... hope everything passes
npm publish
# ... manually write changelog
git tag v1.0.1
git push --tags
```

**Problems:**
- 🔴 Easy to forget a step
- 🔴 No automatic quality validation
- 🔴 Manual version calculation
- 🔴 No rollback on failure
- 🔴 Hard to track what was released

### With Release Manager ✅
```bash
pnpm kb release run
```

**Benefits:**
- ✅ Single command for entire process
- ✅ Automatic quality gates
- ✅ Smart version detection
- ✅ Automatic rollback on errors
- ✅ Complete release audit trail

## Features

### 🎯 Intelligent Version Management

**Automatic version detection from commits:**
- Parses conventional commits (`feat:`, `fix:`, `BREAKING CHANGE:`)
- Computes semantic versions (major.minor.patch)
- Supports manual override when needed

**Multiple versioning strategies:**
- **Independent** - Each package has its own version
- **Lockstep** - All packages share the same version
- **Adaptive** - Lockstep for breaking changes, independent otherwise

```bash
# Let Release Manager decide the version
pnpm kb release plan

# Override for manual control
pnpm kb release plan --bump minor

# Scope to specific packages
pnpm kb release plan --scope packages/core/*
```

### 🛡️ Quality Gates

**Built-in checks before publishing:**
- **Audit** - Code quality and security scan
- **Tests** - Full test suite validation
- **Build** - Compilation verification
- **DevLink** - Dependency integrity check

```bash
# All checks must pass
pnpm kb release run --strict

# Skip specific checks if needed
pnpm kb release run --skip-checks
```

### 📝 AI-Powered Changelogs

Generate professional, human-readable changelogs:
- Conventional commits parsing
- AI summarization for clarity
- Multi-format output (Markdown, JSON)
- Bilingual support (English, Russian)

```bash
# Generate changelog for latest changes
pnpm kb release changelog

# From specific version
pnpm kb release changelog --from v1.0.0

# Breaking changes only
pnpm kb release changelog --breaking-only
```

**Example output:**
```markdown
## @kb-labs/core 2.1.0

This release introduces async logging support and improves performance
by 40% through batched operations.

### ✨ New Features
- Async logging API for non-blocking operations
- Batch processing for improved throughput

### 🐛 Bug Fixes
- Fixed race condition in concurrent writes
- Resolved memory leak in long-running processes

### ⚡ Performance
- 40% faster write operations through batching
```

### 🔄 Automatic Rollback

If anything goes wrong during release, Release Manager automatically:
1. Restores package.json versions
2. Reverts git tags
3. Cleans up registry artifacts
4. Provides detailed error report

```bash
# Manual rollback if needed
pnpm kb release rollback
```

### 📊 Release Reports

Get comprehensive reports in multiple formats:
- **JSON** - For CI/CD integration (`.kb/release/report.json`)
- **Markdown** - For humans (`.kb/release/summary.md`)
- **Console** - Real-time progress

```bash
# View last release report
pnpm kb release report

# JSON output for automation
pnpm kb release report --json
```

## Advanced Usage

### Monorepo Support

Release Manager natively supports complex monorepo structures:

```bash
# Release specific workspace
pnpm kb release plan --scope kb-labs-core

# Release all packages
pnpm kb release run

# Nested monorepos (umbrellas)
pnpm kb release plan --scope kb-labs-mind/packages/*
```

**Supported structures:**
- Flat monorepos (`packages/*`)
- Nested umbrellas (`kb-*/packages/**`)
- Mixed hierarchies (any structure)

### Configuration

Create `kb.config.json` in your workspace:

```json
{
  "release": {
    "registry": "https://registry.npmjs.org",
    "strategy": "semver",
    "strict": true,
    "verify": ["audit", "tests", "build"],
    "changelog": {
      "bumpStrategy": "adaptive",
      "format": "both",
      "level": "standard",
      "locale": "en"
    },
    "rollback": {
      "enabled": true,
      "maxHistory": 5
    }
  }
}
```

### CI/CD Integration

**GitHub Actions:**
```yaml
name: Release
on:
  workflow_dispatch:

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4

      - run: pnpm install
      - run: pnpm kb release run --strict --json
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**GitLab CI:**
```yaml
release:
  script:
    - pnpm install
    - pnpm kb release run --strict --json
  only:
    - main
  when: manual
```

## Command Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `pnpm kb release plan` | Preview release plan without publishing |
| `pnpm kb release run` | Execute full release workflow |
| `pnpm kb release rollback` | Revert to previous state |
| `pnpm kb release report` | View last release report |
| `pnpm kb release changelog` | Generate changelog from commits |
| `pnpm kb release preview` | Show detailed release preview |
| `pnpm kb release verify` | Validate release readiness |

### Common Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Simulate release without publishing |
| `--strict` | All checks must pass (fail-fast) |
| `--scope <pattern>` | Filter to specific packages |
| `--bump <type>` | Override version bump (patch/minor/major) |
| `--json` | JSON output for automation |
| `--skip-checks` | Skip pre-release validation |

## Use Cases

### 1. Regular Release
```bash
# Standard workflow
pnpm kb release run
```

### 2. Emergency Hotfix
```bash
# Quick patch release
pnpm kb release run --bump patch --skip-checks
```

### 3. Major Version Bump
```bash
# Review changes first
pnpm kb release plan --bump major
# Then execute
pnpm kb release run --bump major
```

### 4. Scoped Release
```bash
# Release only core packages
pnpm kb release run --scope packages/core-*
```

## FAQ

### Q: Do I need to install Release Manager separately?

**A:** No! Release Manager comes with the KB Labs platform. Just add it via marketplace:
```bash
pnpm kb marketplace add @kb-labs/release-manager
```

### Q: Do I need to run setup before first use?

**A:** Yes, run setup once per project to create the `.kb/release/` workspace:
```bash
pnpm kb plugins setup @kb-labs/release
```
This creates the directory structure for plans, reports, and backups. Setup is automatic and safe to run multiple times.

### Q: Can I use Release Manager without the full KB Labs platform?

**A:** Release Manager is designed to work within the KB Labs ecosystem. While technically possible to use standalone, you'll get the best experience with the full platform including audit, devlink, and mind integration.

### Q: What happens if my release fails?

**A:** Release Manager automatically rolls back all changes:
- Package versions are restored
- Git tags are removed
- Registry artifacts are cleaned (if possible)
- You get a detailed error report showing what failed

### Q: Can I customize the changelog format?

**A:** Yes! Configure in `kb.config.json`:
```json
{
  "release": {
    "changelog": {
      "level": "detailed",      // compact | standard | detailed
      "locale": "en",            // en | ru
      "format": "both"           // json | md | both
    }
  }
}
```

### Q: How does version detection work?

**A:** Release Manager uses conventional commits:
- `feat:` → minor version bump
- `fix:` → patch version bump
- `BREAKING CHANGE:` → major version bump
- Manual override with `--bump` flag

### Q: Can I release specific packages only?

**A:** Yes! Use the `--scope` flag:
```bash
pnpm kb release run --scope packages/core-*
```

### Q: Is rollback automatic?

**A:** Yes, if ANY check fails or publishing errors occur, Release Manager automatically rolls back all changes.

### Q: Can I skip quality checks?

**A:** Yes, with `--skip-checks`, but NOT recommended for production releases:
```bash
pnpm kb release run --skip-checks  # Use with caution!
```

### Q: How do I view release history?

**A:** Check the `.kb/release/` directory:
- `report.json` - Last release details
- `plan.json` - Last release plan
- `changelog.md` - Generated changelog

## Support & Resources

- **Documentation**: [Full docs →](./docs/)
- **Marketplace**: Add plugins via `pnpm kb marketplace`
- **Issues**: [Report bugs →](https://github.com/kb-labs/kb-labs-release-manager/issues)
- **Discussions**: [Ask questions →](https://github.com/kb-labs/kb-labs/discussions)

## License

MIT © KB Labs

---

**Part of the [KB Labs Platform](https://github.com/kb-labs) - Modern development tools for serious teams.**
