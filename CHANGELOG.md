# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-04

### Added

- `check`, `generate` and `diff` commands
- `.env` parser with quoting, multi-line values, duplicate detection and bounded input handling
- JSON schema with `string`, `number`, `integer`, `port`, `boolean`, `url` and `enum` types
- Secret detection and masking by schema flag, variable name or credentials in URLs
- Library API: `loadEnv`, `checkEnv`, `parseEnv`, `validateEnv`, `diffEnv`, `generateFromSchema`
- TypeScript type inference from the schema via `defineSchema`
