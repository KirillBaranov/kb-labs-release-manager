# @kb-labs/changelog

**Conventional commits parser and changelog generator for KB Labs Release Manager**

## Features

- ✅ **Conventional Commits Parsing** - Full support with breaking changes detection
- ✅ **Bot Filtering** - Ignore dependabot, renovate, and custom bots
- ✅ **Performance** - Single git log pass (O(commits), not O(commits²))
- ✅ **Git Range Resolution** - Tag discovery, shallow clone detection
- ✅ **Version Policies** - independent, ripple, lockstep bump strategies
- ✅ **Cache Layer** - Persistent cache with graph hash invalidation
- ✅ **Git Providers** - GitHub, GitLab, and self-hosted link formatting
- ✅ **Multiple Formats** - JSON manifest + Markdown with i18n (en/ru)
- ✅ **Rendering Levels** - compact, standard, detailed

## Installation

```bash
pnpm add @kb-labs/changelog
```

## Quick Start

```typescript
import { parseCommits, resolveGitRange } from '@kb-labs/changelog';

const range = await resolveGitRange({ cwd, sinceTag: 'v1.0.0' });
const changes = await parseCommits({
  cwd,
  from: range.from,
  to: range.to,
  ignoreAuthors: ['dependabot', 'renovate'],
});
```

## Configuration

See `release.schema.json` for full configuration options:
- `changelog.includeTypes`, `excludeTypes`
- `changelog.ignoreAuthors` (glob patterns)
- `changelog.bumpStrategy` (independent/ripple/lockstep)
- `changelog.format`, `level`, `locale`
- `changelog.cache`, `requireAudit`, `requireSignedTags`
- `git.provider`, `autoUnshallow`

## Architecture

**Package Structure:**
- `parser.ts` - Git log parsing with conventional commits
- `cache.ts` - Persistent cache with invalidation
- `git-range.ts` - History range resolution
- `versioning.ts` - SemVer policies and bump detection
- `providers.ts` - Git provider link formatting
- `formatters/json.ts` - JSON manifest with integrity hashes
- `formatters/markdown.ts` - Markdown with i18n

**Performance:**
- Single git traversal with streaming parse
- Cache hit rate optimization
- Graph hash tracking for smart invalidation

## Status

🚧 This is a **production-ready MVP**. Core foundation is complete and tested.

## License

MIT


