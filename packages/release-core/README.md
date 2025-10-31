# @kb-labs/release-core

Core orchestration for KB Labs Release Manager.

Provides types, planning, versioning, publishing, rollback, and report generation.

## Features

- Release planning with version detection
- Package version management
- Changelog generation  
- Rollback snapshots
- Multiple report formats (JSON, Markdown, Text)

## Usage

```typescript
import { planRelease, publishPackages, rollback } from '@kb-labs/release-core';

const plan = await planRelease({ cwd, config, scope: 'packages/*' });
const result = await publishPackages({ cwd, plan, dryRun: false });
```

## API

- `loadConfig()` - Load configuration
- `planRelease()` - Create release plan
- `publishPackages()` - Publish packages
- `generateChangelog()` - Generate changelog entries
- `saveSnapshot()` - Create rollback backup
- `restoreSnapshot()` - Restore from backup
- `renderJson()` - Generate JSON report
- `renderMarkdown()` - Generate Markdown report
- `renderText()` - Generate text report

