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

`.env` holds the connection strings and keys for your machine; `.env.example`
is the schema and stays committed. The environment is read once, when a
process starts, so a changed variable takes a restart of `pnpm dev`.

If you keep secrets in a manager that can mount an environment (1Password
Environments, for example), point it at `.env` instead of writing the file -
`.1password/environments.toml` already names that path. Nothing here depends
on such a tool, and nothing changes for anyone who does not use one. See
[docs/notes/mounted-env.md](docs/notes/mounted-env.md).

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
