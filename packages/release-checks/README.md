# @kb-labs/release-checks

Check adapters for KB Labs Release Manager.

Integrates with audit, devlink, mind, tests, and build checks.

## Features

- Pre-release quality checks
- Sequential execution
- Check registry pattern
- Skipped check handling

## Available Checks

- `AuditCheck` - Code quality via kb audit
- `DevLinkCheck` - Dependency integrity
- `MindCheck` - Schema verification
- `TestsCheck` - Test execution
- `BuildCheck` - Build verification

## Usage

```typescript
import { runChecks, createCheckRegistry } from '@kb-labs/release-checks';

const registry = createCheckRegistry();
const results = await runChecks({
  checkIds: ['audit', 'tests'],
  cwd: process.cwd(),
});
```

