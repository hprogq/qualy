# Upstream discussion draft — Aube

Aube keeps GitHub Issues closed, so this goes to
https://github.com/jdx/aube/discussions (Bug / Q&A category).

---

## Title

`autoInstallPeers` puts a dependency's peer into the importer but not the
importer's own declared peer, and both directions break `--frozen-lockfile`
against pnpm

---

## Summary

With `autoInstallPeers` at its default (`true`), Aube 2.2.0 and pnpm 11.24.0
disagree about which auto-installed peers belong in an importer's
`dependencies`, and they disagree in **both directions**:

- **A.** Aube adds a peer of a workspace package's _dependency_ to that
  package's importer, under a specifier that appears in no manifest.
- **B.** Aube does **not** satisfy a peer the workspace package _itself_
  declares in `peerDependencies`, leaving the importer empty and the peer
  unlinked. pnpm does satisfy it.

B looks like the actual bug: `aube config explain autoInstallPeers` says
"missing peer dependencies are auto-installed during resolution and hoisted
into the importer", and in case B the missing peer is the importer's own.

The pair means a lockfile written by either tool is rejected by the other
under `--frozen-lockfile`, which makes a bridged migration off pnpm a one-way
door.

Both cases appear in Aube's native `aube-lock.yaml` as well as in the
`pnpm-lock.yaml` it writes, so this is resolver/graph behaviour rather than a
pnpm-writer detail.

## Reproduction

Four files, no lockfile:

`package.json`

```json
{ "name": "repro-root", "private": true, "version": "0.0.0" }
```

`pnpm-workspace.yaml`

```yaml
packages:
  - packages/*
```

`packages/case-a/package.json` — depends on a package that HAS a peer

```json
{
  "name": "case-a",
  "version": "0.0.0",
  "private": true,
  "dependencies": { "react-dom": "19.2.0" }
}
```

`packages/case-b/package.json` — DECLARES a peer of its own

```json
{
  "name": "case-b",
  "version": "0.0.0",
  "private": true,
  "peerDependencies": { "react": "19.2.0" }
}
```

### pnpm 11.24.0

```yaml
importers:
  packages/case-a:
    dependencies:
      react-dom:
        specifier: 19.2.0
        version: 19.2.0(react@19.2.0)
  packages/case-b:
    dependencies:
      react:
        specifier: 19.2.0
        version: 19.2.0
```

```
packages/case-a/node_modules -> react-dom
packages/case-b/node_modules -> react
```

### aube 2.2.0

```yaml
importers:
  packages/case-a:
    dependencies:
      react:
        specifier: ^19.2.0 # <- appears in no manifest
        version: 19.2.0
      react-dom:
        specifier: 19.2.0
        version: 19.2.0(react@19.2.0)
  packages/case-b: {} # <- its own declared peer is not installed
```

```
packages/case-a/node_modules -> react react-dom
packages/case-b/node_modules -> (empty)
```

### The two frozen failures

```
$ pnpm install --frozen-lockfile      # on the lockfile aube wrote
ERR_PNPM_OUTDATED_LOCKFILE
  specifiers in the lockfile don't match specifiers in package.json:
  * 1 dependencies were removed: react@^19.2.0

$ aube install --frozen-lockfile      # on the lockfile pnpm wrote
× lockfile is out of date with package.json: packages/case-b: manifest removed react
```

Each tool accepts its own lockfile, so neither is internally inconsistent.

## Expected behavior

Whatever is decided for case A, case B should install the peer a package
declares for itself, the way `autoInstallPeers` documents. Matching pnpm on
both would additionally let a project move between the two package managers
without a lockfile rewrite, which is most of what makes trying Aube on an
existing repository safe.

## Additional context

Two smaller things noticed alongside, mentioned in case they are the same
area — happy to split them out:

1. `strict-peer-dependencies=true` does not report case B's unmet peer. It is
   silently unmet rather than diagnosed.
2. In one Linux run an install exited 0 while leaving
   `packages/<pkg>/node_modules/argon2` a dangling symlink and the
   corresponding `node_modules/.aube/argon2@0.45.1/` absent. A repeat install
   repaired it and it did not reproduce, so this is only an observation. What
   is reproducible in that state is the diagnosis: `aube doctor` correctly
   reported the tree stale, while `aube check` answered
   `node_modules symlink tree is consistent (checked 0 packages)` — a
   consistent verdict, on zero packages, for a tree with a broken link.

## Versions

aube 2.2.0 (macos-arm64 and linux-x64), pnpm 11.24.0, Node 24.20.0.

## Why this repository cares

Recorded for our own future reference rather than for upstream: case A is a
blocker for us specifically because our plugin assembly is built on "a host
that did not declare a package cannot resolve it". Under Aube our server
package really can `require('redis')`, which nothing in the project declares.
See `docs/notes/aube.md`.
