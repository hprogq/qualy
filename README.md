# Qualy

Qualy is a plugin-based platform for configurable assessment, submission, review, scoring, and result workflows.

The project is currently under active development and has not reached a stable release. APIs, data models, and behavior may change without backward compatibility.

## Development

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm dev
```

Qualy is managed as a pnpm monorepo. Most application capabilities are provided through plugins and assembled by the host at startup.

## Useful Commands

```bash
pnpm typecheck
pnpm test
pnpm test:browser
pnpm format
```

Additional project commands are available through:

```bash
pnpm qualy list
```

## License

Licensed under the [GNU Affero General Public License v3.0 only](./LICENSE) (`AGPL-3.0-only`).
