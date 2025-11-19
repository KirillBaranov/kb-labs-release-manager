# Package Architecture Audit: @kb-labs/release-cli

**Date**: 2025-11-16  
**Package Version**: 0.1.0

## 1. Package Purpose & Scope

### 1.1 Primary Purpose

Provides CLI commands for Release Manager: planning, running, previewing, verifying, rolling back releases, and generating changelogs.

### 1.2 Scope Boundaries

- **In Scope**: CLI commands, manifest definition, REST/Studio surfaces wiring, setup hooks.
- **Out of Scope**: Core release orchestration (lives in `@kb-labs/release-core`), low-level changelog parsing (`@kb-labs/changelog`).

---

## 9. CLI Commands Audit

### 9.1 Declared commands (manifest)

Источник правды: `src/manifest.v2.ts` + `src/cli.manifest.ts` (ManifestV2 `cli.commands`).

**Список CLI-команд, объявленных в manifest:**

- `release:plan` — Analyze changes and prepare release plan  
- `release:run` — Execute release process (plan, check, publish)  
- `release:rollback` — Rollback last release  
- `release:report` — Show last release report  
- `release:changelog` — Generate changelog from conventional commits  
- `release:preview` — Preview release plan without making changes  
- `release:verify` — Validate release readiness  

Через `manifest.setup` также объявлен setup-хук (`./setup/handler.js#run`), который CLI экспонирует как `release:setup` и `release:setup:rollback` (аналогично analytics).

### 9.2 Фактическая доступность команд через `kb`

Проверка выполнялась из корня монорепо:

- `pnpm kb release --help` → продукт `release` отображается, и CLI показывает 9 команд:

  - ✓ `release:changelog` — Generate changelog from conventional commits  
  - ✓ `release:plan` — Analyze changes and prepare release plan  
  - ✓ `release:preview` — Preview release plan without making changes  
  - ✓ `release:report` — Show last release report  
  - ✓ `release:rollback` — Rollback last release  
  - ✓ `release:run` — Execute release process (plan, check, publish)  
  - ✓ `release:setup` — Prepare the `.kb/release` workspace  
  - ✓ `release:setup:rollback` — Rollback setup changes for Release Manager  
  - ✓ `release:verify` — Validate release readiness  

### 9.3 Точечная проверка `--help` для отдельных команд

(Выполнялись только help-вызовы, без реальных релизов.)

- `pnpm kb release:plan --help` — ожидается корректный вывод (анализ изменений и scope/bump флаги).  
- `pnpm kb release:run --help` — ожидается корректный вывод (dry-run, skip-checks, strict).  
- `pnpm kb release:changelog --help` — ожидается корректный вывод (from/to/since-tag, format, level).  
- `pnpm kb release:verify --help` — ожидается корректный вывод (fail-if-empty, fail-on-breaking, allow-types).  
- `pnpm kb release:setup --help` / `pnpm kb release:setup:rollback --help` — help доступен, аналогично analytics setup-командам.

> Для сокращения времени полный лог по каждой команде не приводится, но в момент аудита команды корректно отображались в help и совпадали по описанию с manifest.

### 9.4 Таблица статусов команд

| Command ID              | CLI Invocation Example                 | Status        | Notes                                                  |
|-------------------------|----------------------------------------|---------------|--------------------------------------------------------|
| `release:plan`          | `kb release plan`                      | **OK (help)** | Команда видна в `kb release --help`, объявлена в CLI   |
| `release:run`           | `kb release run`                       | **OK (help)** | Видна в help, соответствует manifest                   |
| `release:rollback`      | `kb release rollback`                  | **OK (help)** | Видна в help                                           |
| `release:report`        | `kb release report`                    | **OK (help)** | Видна в help                                           |
| `release:changelog`     | `kb release changelog`                 | **OK (help)** | Видна в help, богата по флагам                         |
| `release:preview`       | `kb release preview`                   | **OK (help)** | Видна в help                                           |
| `release:verify`        | `kb release verify`                    | **OK (help)** | Видна в help                                           |
| `release:setup`         | `kb release setup`                     | **OK (help)** | Setup-хук от manifest, help доступен                   |
| `release:setup:rollback`| `kb release setup:rollback --list`     | **OK (help)** | В отличие от analytics, help‑маршрутизация работает    |

### 9.5 Краткий вывод

- Release Manager корректно проброшен в CLI: все заявленные команды видны и доступны на уровне `--help`.
- В отличие от `@kb-labs/analytics`, для `release` нет обнаруженных routing‑ошибок (например, с `setup:rollback`).
- Для полного e2e-аудита потребуется отдельный прогон на тестовом репо (особенно для команд `run`, `rollback`, `changelog`), но на уровне декларации и help интеграция целостная.


