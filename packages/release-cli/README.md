# @kb-labs/release-cli

CLI commands for KB Labs Release Manager.

Provides commands for planning, executing, rolling back, and reporting releases.

## Commands

- `release:plan` - Analyze changes and prepare release plan
- `release:run` - Execute full release process
- `release:rollback` - Restore from backup snapshot
- `release:report` - Show last release report

## Examples

```bash
# Plan release
kb release plan --scope packages/* --bump auto

# Execute release
kb release run --dry-run
kb release run --strict --json

# Rollback
kb release rollback

# Report
kb release report
kb release report --json
```

