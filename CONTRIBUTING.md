# Contributing Guide

Thanks for considering a contribution to **KB Labs** projects!

---

## Development setup

```bash
pnpm i
pnpm dev
```

## Guidelines

- **Coding style**: follow ESLint + Prettier rules. Run `pnpm lint` before pushing.
- **Testing**: cover all changes with Vitest. Run `pnpm test`.
- **Commits**: use clear, conventional messages (e.g., `feat: add X`, `fix: correct Y`).
- **ADRs**: for architectural changes, add a new record in `docs/adr`.

## DevKit Integration

This project uses `@kb-labs/devkit` for shared tooling configurations. Key points:

- **Configurations**: ESLint, Prettier, Vitest, TypeScript, and GitHub Actions are managed by devkit
- **Local configs**: Act as thin wrappers over devkit configurations
- **Updates**: When devkit is updated, run `pnpm install` to get the latest configurations
- **Customization**: For project-specific rules, extend devkit configs rather than overriding them

### DevKit Commands

- `pnpm devkit:sync` - Sync DevKit configurations (runs automatically on install)
- `pnpm devkit:check` - Check if sync is needed
- `pnpm devkit:force` - Force sync (overwrites existing configs)
- `pnpm devkit:help` - Show help and available options

For more details, see [ADR-0005: Use DevKit for Shared Tooling](docs/adr/0005-use-devkit-for-shared-tooling.md).

---

## Pull requests

1. Fork the repo and create a feature branch.
2. Make your changes.
3. Run `pnpm check` (lint + type-check + tests).
4. Submit a PR with a clear description of your changes.
