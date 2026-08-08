# 对抗审计(2026-08-08)

> 8 维度发现 + 逐条怀疑者反驳 + 盲区批评家,33 agent。确认 23 条、反驳 1 条。**全部未修复**,按严重度排序作为修复工作清单;修复时逐条重验(代码可能已漂移)。

## 确认的发现

### [high · assembly] A capability provider removed from the manifest while retaining nothing never leaves the lock; its generate/deploy phases keep running and reaching external systems

- 位置:packages/core/assembly/src/resolve.ts:360
- 主张:resolveAssembly records a lock `capabilities[key]` entry for every loaded provider (resolve.ts:359-379) without checking that the provider plugin is in `states`/`plugins`. Providers are loaded from candidates that include plugins recalled from the previous lock's plugins table AND its capabilities sections (resolve.ts:104-111), but retention (resolve.ts:144-187) only ever marks a provider detached when some removed plugin's contribution claims it. So when a provider plugin leaves the manifest wh…
- 失败场景:State: a web-only assembly (e.g. '@qualy/plugin-web' + '@qualy/plugin-database', no plugin owning tables — the exact selection capability-boundary.test supports) with a committed lock. Input: operator deletes '@qualy/plugin-database' from qualy.yml and runs `pnpm qualy resolve` (which prints nothing about the removal), then `pnpm qualy deploy` on a headless box with no postgres because the databas…
- 反驳者判定:certain(The hazard is broader than the finding states. Variant B (verified empirically): removing ONLY the provider plugin from a manifest whose remaining ACTIVE plugins still contribute to the capability res…)

### [high · effect] Per-source log filter is inverted: it drops records MORE severe than the configured minimum and keeps the noise

- 位置:apps/server/src/logging.ts:189
- 主张:qualyLogger's per-source minimum (`settings.sources`, the documented `application.logging.sources` knob) suppresses a record when `LogLevel.isGreaterThan(options.logLevel, minimum)` is true. In Effect v4, isGreaterThan means MORE SEVERE (Trace=0 ... Fatal=50000), so the filter discards records more severe than the minimum and keeps records below it — the exact opposite of a minimum level. Upstream's own minimum gate compares the other way around: `isLogLevelGreaterThan(fiber.minimumLogLevel, log…
- 失败场景:Operator adds the documented knob to qualy.yml: `application.logging: { sources: { '@qualy/plugin-database': 'warn' } }` intending 'database speaks only at Warn and above'. Actual behavior: Debug/Info database lines keep printing (subject only to the global level), while every record at Error or Fatal whose fiber carries `source: '@qualy/plugin-database'` — e.g. a connection failure or a readiness…
- 反驳者判定:certain(One overstatement in the finding: the 'All' sentinel ("silences everything") is unreachable via config — logging.ts's LEVELS map (lines 29-41) has no 'all' alias, so resolveLogging can never place 'Al…)

### [high · database] Boot validation path silently executes CREATE DATABASE on the production server when DATABASE_URL names a nonexistent database

- 位置:packages/plugins/infra/database/src/server/index.ts:161
- 主张:Both boot modes of the database layer ('apply' and the production-default 'off') reach MikroORM's Migrator, whose init() unconditionally runs ensureDatabase(), which creates the target database via the 'postgres' management DB when it does not exist. So a process whose documented contract is 'off refuses to start behind' (server/config.ts:16, server/index.ts:158-160) first performs CREATE DATABASE — a server-mutating DDL write — during what the project frames as validate-only startup, and then e…
- 失败场景:Production instance starts via `pnpm start` (QUALY_MIGRATIONS defaults to off) with DATABASE_URL=postgres://app@db/qualy_prodd (typo for qualy_prod; the role has CREATEDB, the norm in the single-box posture the repo documents). Boot: prepare() → pendingMigrations → Migrator.init → ensureDatabase probes qualy_prodd, gets 3D000, reconnects to the 'postgres' DB and executes CREATE DATABASE qualy_prod…
- 反驳者判定:certain(The 'off'-mode boot actually leaves TWO writes behind, not one: the created database and a `mikro_orm_migrations` ledger table inside it (Migrator.init calls storage.ensureTable() right after ensureDa…)

### [high · gates] Run-at-the-edges gate matches only 5 of 12 Effect run functions; every *With variant and runCallback pass silently

- 位置:tools/tests/test-layers.test.ts:315
- 主张:CLAUDE.md's hard rule (禁止 section: 生产源码在入口/CLI/前端 runtime/测试边界之外 Effect.run*) is enforced solely by the regex /Effect\.run(?:Promise|Sync|Fork|PromiseExit|SyncExit)\b/ in the 'runs effects only at the edges' case. Vendored Effect v4 exports 12 run functions (repos/effect/packages/effect/src/Effect.ts:8709-9204): runFork, runForkWith, runCallback, runCallbackWith, runPromise, runPromiseWith, runPromiseExit, runPromiseExitWith, runSync, runSyncWith, runSyncExit, runSyncExitWith. I executed the gat…
- 失败场景:A service in packages/plugins/base/*/src/server/ holds a ServiceMap and calls `await Effect.runPromiseWith(services)(dbEffect)` inside a request handler (or uses Effect.runCallback to fork background work). pnpm typecheck passes (the effect is not floating), pnpm test passes (regex no-match), and the code ships. The dbEffect now runs on a fresh fiber outside the caller's ambient transaction: under…
- 反驳者判定:certain(Verified stronger than claimed: beyond the regex gap, the language service actively recommends the invisible variants (runEffectInsideEffect fix text suggests run*With; its v4 migration data names Eff…)

### [high · landmines] plugin:add, the mandated entry point for new plugins, is stale after the reorganisation: it crashes mid-flow and its apps/web-dependency step can never fire

- 位置:tools/repo/plugin-add.ts:83
- 主张:CLAUDE.md (角色与隔离) mandates '新增插件一律 pnpm plugin:add <名>: 自动写 apps/server 依赖 + qualy.yml 条目 + qualy resolve, 按 exports 声明补 apps/web 依赖', but the script still targets the pre-reorganisation repo: (1) line 83 runs 'pnpm exec tsx scripts/qualy.ts resolve' — scripts/ was deleted in commit 917dbcf ('scripts/ is gone', CLI moved to apps/cli/src/main.ts), so the script always crashes AFTER it has already modified apps/server/package.json (line 39), appended to qualy.yml (line 46) and run pnpm install (li…
- 失败场景:First step of the next milestone: developer creates packages/plugins/base/assessment and runs 'pnpm plugin:add @qualy/plugin-assessment'. The script edits apps/server/package.json, appends the qualy.yml entry, runs pnpm install, then dies with ERR_MODULE_NOT_FOUND — qualy.lock.json is never re-resolved, so every lock-driven consumer (boot loadAssembly, check-client-components, effect-api-parity ag…
- 反驳者判定:certain(Sub-claim (4) is wrong: Ui.surfaces exists at packages/plugins/infra/ui-registry/src/plugin.ts:93-95 ('the bulk form'); the closing hint at plugin-add.ts:85 is valid. This is cosmetic and not load-bea…)

### [medium · authz] deleteRoleGrant orDies the declared LastAdministrator error, returning 500 instead of the contractual 409 and making the advertised error code unreachable over HTTP

- 位置:packages/plugins/base/rbac/src/server/index.ts:771
- 主张:The `deleteRoleGrant` HTTP handler wires the revoke last-administrator guard as `rbac.assertTenantKeepsAdministrator(tenantId).pipe(Effect.orDie)`. `revoke` invokes this callback AFTER deleting the grant to check the tenant still has an administrator; the callback's only runtime source of `LastAdministrator` is thus converted into a defect. As a result the `LastAdministrator` (409) error declared on this endpoint is unreachable over HTTP, and revoking the tenant's last administrator grant answer…
- 失败场景:A tenant has exactly one enabled administrator holding the canonical tenant-admin role via a single tenant-wide grant. An administrator (who holds canonical admin, so passes mayAdministerRole, and holds iam.tenant-grant.manage) calls DELETE /api/iam/role-grants/{grantId} on that last admin grant. Inside the locked transaction the grant is deleted, assertTenantKeepsAdministrator computes survivors=…
- 反驳者判定:certain(Verified end-to-end including upstream defect-rendering path; the finding's evidence citations are accurate, its severity and category are correct, and no gate (types, tests, or runtime wrapper) preve…)

### [medium · assembly] Capability-derived modules have no writer: the frozen gate demands files no command generates, and its error directs users to a command that cannot fix it

- 位置:apps/cli/src/main.ts:119
- 主张:The kernel documents a two-caller contract for capability modules — 'codegen writes these files, and the frozen gate asks whether the tree already holds them' (packages/core/assembly/src/modules.ts:9-12) and 'Rewritten by codegen and compared by the frozen gate' (packages/contracts/assembly/src/index.ts:174-177) — but only the comparing caller exists. The CLI's drift() includes moduleDrift over capabilityModules (apps/cli/src/main.ts:79-92) and gates resolve --frozen-lockfile, generate, deploy, …
- 失败场景:A future capability provider (the contract's next consumer) declares modules: () => [{ path: 'cache.gen.ts', content: ... }] exactly as assembly-contract documents. Developer runs `pnpm qualy resolve` — succeeds, writes the lock, writes no module. Every subsequent command — `pnpm qualy generate`, `deploy`, `list`, any `qualy <ns> <cmd>`, and CI's `pnpm qualy resolve --frozen-lockfile` — dies with …
- 反驳者判定:certain(The finding's mechanism, history, and reachability are all confirmed. One refinement: the write half did exist (scripts/gen.ts, commit ca906e6) and was removed in e32bd09/161b26b while the compare hal…)

### [medium · assembly] Server boot imports every capability provider module (migrator, MikroORM schema tooling, pg) at each start, contradicting the stated 'boot never pays' discipline in three places

- 位置:apps/server/src/verify-assembly.ts:29
- 主张:CLAUDE.md's assembly section states the capability rule as 'Plugin.capability(key, () => import(...)) (CLI 做事时才 import,boot 永不付费)'; registry.ts repeats it ('this load happens inside a CLI with no server context … and never happens at boot, so a server does not pay for a migrator it will not run', packages/core/assembly/src/registry.ts:9-13) and the database descriptor repeats it again ('Imported by the CLI when the capability does work; boot never pays for it', packages/plugins/infra/database/sr…
- 失败场景:State: production server, database plugin present (or merely still installed after removal, per finding 1). Input: `pnpm start`. Outcome: before binding a port the process imports @mikro-orm/migrations, the SchemaComparator stack, pg and child_process-using generation code it will never execute; a broken transitive import anywhere in that generation-only chain (e.g. an upstream MikroORM sql patch …
- 反驳者判定:certain(Real, with one attribution correction: the heavy external packages named in the title (migrator/@mikro-orm/migrations, MikroORM, pg) enter the boot import graph anyway through the descriptor import — …)

### [medium · effect] Port starts listening before the route layer (incl. Vite dev server) is built, contradicting the composition-root invariant; requests in the window are never answered and can wedge teardown after a failed boot

- 位置:apps/server/src/runtime.ts:105
- 主张:runtime.ts states 'The port is bound by a layer built after the barrier and the routes, so an instance either serves a working assembly or never listens at all: there is no partially assembled state to observe' (lines 23-25). The barrier half holds (booted is an outer dependency of the server composite, and Layer.provide builds the dependency first — repos/effect Layer.ts provideWith). The routes half is false: at line 105 `NodeHttpServer.layer` is piped as a dependency of the HttpRouter.serve c…
- 失败场景:Development restart: `pnpm dev` binds the port, then spends 1-3s creating the Vite dev server inside the routes layer. The developer's browser reloads immediately; its request lands in the window, Node drops the 'request' event, and the tab hangs (no response, no reset) until the browser's own multi-minute timeout — the claimed 'connection refused then working instance' behavior never happens. Wor…
- 反驳者判定:certain(One nuance in the failure scenario is slightly off but does not change the verdict: the Vite client's automatic reload usually lands after the window, because during the window 'upgrade' also has no l…)

### [medium · effect] Documented shutdown escalation ('超时与二次信号强退') does not exist: a hung finalizer leaves the process unkillable by SIGINT/SIGTERM

- 位置:apps/server/src/main.ts:71
- 主张:CLAUDE.md's 工程基线 documents the entry point as 'SIGINT/SIGTERM 优雅关闭(根 fiber dispose 级联清理、超时与二次信号强退)' — cascade cleanup PLUS a teardown timeout and a second-signal force exit. Neither exists. main.ts delegates entirely to NodeRuntime.runMain with a custom teardown that only maps interrupt-only exits to code 0; upstream runMain's signal handler does `fiber.interruptUnsafe(fiber.id)` on every signal — after the first signal the fiber is already interrupting, so a second SIGINT/SIGTERM is a no-op, li…
- 失败场景:SIGTERM arrives while the database network path is dead: the HTTP drain gives up after its 20s timeout, teardown proceeds to the ORM release, and `orm.close()` blocks on a connection stuck in TCP retransmission. The operator (or a supervisor without kill escalation) sends SIGTERM again — upstream's handler just calls interruptUnsafe on the already-interrupting root fiber, a no-op — and again; the …
- 反驳者判定:certain(Confirmed as claimed, including the regression framing: either main.ts is missing the documented escalation or CLAUDE.md's 工程基线 line is stale — as written, the stated discipline is violated. The findi…)

### [medium · web] Browser transport failures are misclassified: network-error UX path is unreachable and isTransportError always returns false for effect-client failures

- 位置:packages/web/i18n/src/format.ts:87
- 主张:isNetworkError (format.ts:87-89) tests `error instanceof TypeError || error.name === 'AbortError'`, but every browser API call goes through FetchHttpClient (packages/web/runtime/src/api.ts:25-27), which wraps a failed fetch's TypeError inside `new HttpClientError({reason: new TransportError({request, cause})})`. That HttpClientError instance (tag 'HttpClientError', an Error subclass, not a TypeError) is what Effect.runPromise rejects with (causeSquash returns the raw Fail error), so it is exactl…
- 失败场景:User loses connectivity (or the server is down) and any screen's query fails: fetch rejects with TypeError -> FetchHttpClient wraps it in HttpClientError -> formatError renders '出现问题，请重试。/Something went wrong. Please try again.' instead of the designed, translated 'Cannot reach the server. Check your connection and try again.' Any future screen or retry policy calling isTransportError(error) to br…
- 反驳者判定:certain(Real, but high overstates it: isTransportError has zero production call sites (only re-exported at web/i18n/src/index.tsx:33), so no behavior misroutes today — that part is a latent hazard for future …)

### [medium · web] UiSlot creates a new component type on every render, so every slot contribution is unmounted and remounted on each RuntimeContext/i18n change (state loss + redundant business-data refetches)

- 位置:packages/web/runtime/src/index.tsx:337
- 主张:UiSlot passes `component={Renderer ? () => <Renderer context={context} /> : undefined}` (index.tsx:337) — a fresh function identity per render — and PluginComponent renders it as an element type (`<Resolved />`, component-boundary.tsx:70). React reconciles function components by type identity, so every re-render of UiSlot tears down and remounts the entire slot subtree. UiSlot re-renders whenever the RuntimeContext value changes, and that value is an object literal rebuilt on every RuntimeLoader…
- 失败场景:User clicks sign-out, the request fails, UserMenu shows the error via setSignOutError (UserMenu.tsx:57). The user then flips the LocaleSwitcher sitting beside it (or an admin change causes the manifest to refetch with different data): RuntimeLoader re-renders -> new RuntimeContext value -> UiSlot re-renders -> new inline component type -> React unmounts UserMenu and mounts a fresh instance. The er…
- 反驳者判定:certain(Minor precision: on a locale switch the slot subtree remounts twice (locale state change, then catalog activation), though TanStack dedupes concurrent identical fetches so at least one, possibly two, …)

### [medium · database] `qualy database adopt` blesses databases missing everything baseline fragments create (functions, seed rows, extensions) and the divergence becomes permanent and invisible

- 位置:packages/plugins/infra/database/src/assembly/index.ts:111
- 主张:CLAUDE.md specifies adopt as '逐对象比对,不一致拒绝,一致只写账本', but the only gate before the ledger write is diffAgainstDeclared, which compares two MikroORM DatabaseSchema introspections that never load routines, never read pg_extension, and cannot see rows — while the declared side has all baseline-fragment SQL executed into it (diff.ts:174-185). diff.ts's own header admits 'Extensions, functions and seed rows are not in this picture at all: nothing reads them into a schema, so nothing can diff them' — yet…
- 失败场景:A plugin adds the documented fragment kinds: rbac ships `db/baseline/0001_seed.sql` (post-structure, `INSERT INTO roles (...) VALUES (canonical tenant-admin) ON CONFLICT DO NOTHING`) and auth ships `0001_checks.sql` (`CREATE OR REPLACE FUNCTION placement_guard() ...`); generate compiles both into migration N. Later the lineage is squashed (the exact use-case adopt exists for) and an operator runs …
- 反驳者判定:likely(Minor corrections: parity.ts lives at packages/plugins/infra/database/src/parity.ts, not src/assembly/parity.ts (content and line range cited are otherwise accurate). The title's "everything baseline …)

### [medium · gates] vendor gate's 'never imported from repos/' scan stops at directory depth 4, leaving 81 of 213 package source files unscanned after the 2026-08-07 reorg

- 位置:tools/tests/vendor.test.ts:19
- 主张:docs/agents/effect-source-policy.md promises that plain `pnpm test` verifies '没有人从中 import' (nobody imports from repos/), and vendor.test.ts's 'is never imported by this repository' case is that guard. Its walk() hard-stops at depth > 4 (tools/tests/vendor.test.ts:18-19). After the physical reorganisation put plugins at packages/plugins/<group>/<name>/, a plugin's src/ is already at depth 4, so every file under src/server/, src/client/, and src/assembly/ is never read. I re-ran the test's own wa…
- 失败场景:A developer (or an agent following a vendored code example) writes `import { identity } from '../../../../../../repos/effect/packages/effect/src/Function.ts'` in packages/plugins/base/auth/src/server/some-service.ts. The dedicated gate never reads that file (depth 5+), tsc emits no diagnostic for that upstream module, pnpm test is green, and the process now executes vendored upstream source that v…
- 反驳者判定:certain(Minor overstatement in the last sentence of the failure scenario: on a clone that never ran vendor:restore, pnpm typecheck would also fail (TS2307 module-not-found), so not literally 'all gates called…)

### [medium · gates] Catalog completeness gate skips any locale whose catalog file is missing entirely, so a plugin shipping zero zh-CN translations passes

- 位置:tools/tests/catalogs.test.ts:83
- 主张:CLAUDE.md states catalogs.test 按声明发现并校验'全语言完整、无孤儿键', and the test's own header says a missing translation must not 'only show up as english text in production'. But the per-locale loop reads `const load = module.catalogs.locales[locale]; if (!load) continue` (tools/tests/catalogs.test.ts:83) — completeness is only checked for locales that ship a catalog file at all. The contract makes this uncatchable elsewhere: PluginCatalogs.locales is typed `Partial<Record<SupportedLocale, ...>>` (packages/co…
- 失败场景:A new plugin is added with definePluginMessages({...30 messages}) and `locales: {}` (the zh-CN.ts file forgotten, or deleted in a refactor). tsc accepts it (Partial), catalogs.test iterates supportedLocales, finds no loader for zh-CN, `continue`s both times, and asserts nothing but the namespace prefix. CI is green; in production every zh-CN user sees untranslated English across that plugin's page…
- 反驳者判定:certain(Verified as claimed. Additional confirming detail beyond the finding: plugin zh-CN catalogs use `satisfies MessageCatalog` rather than the contract's CatalogFor completeness type, so there is no type-…)

### [medium · landmines] The bundle-probe gate against server code leaking into the browser covers exactly one hardcoded plugin (auth); a new plugin's contract chain is unguarded against the documented pg-in-browser incident class

- 位置:tools/tests/browser-graph.test.ts:40
- 主张:tools/tests/browser-graph.test.ts exists because of a recorded incident: every plugin's src/api.ts names its error classes from src/server/errors.ts, and one node-only import four hops down that chain pulled 'pg' into the browser bundle, killing the page with 'Buffer is not defined'. The test's own comment states 'Bundling is the only check that follows the same graph the browser does' (a grep cannot catch it, and the dev server externalizes node builtins 'with a warning and carries on'). Yet th…
- 失败场景:The assessment plugin declares ScoreOutOfRange etc. in src/server/errors.ts and references them from src/api.ts per convention. A developer imports a shared constant or validator from src/db/entities.ts (MikroORM defineEntity) or src/server/index.ts into errors.ts — type-clean under the client tsconfig. pnpm typecheck, pnpm test, the auth-only browser-graph probe, and pnpm build all pass; 'pnpm de…
- 反驳者判定:certain(One imprecision in the finding: effective coverage is auth plus (transitively) rbac's contract chain, because auth/src/client/api.ts imports accessApiGroup from @qualy/plugin-rbac/api — not "exactly o…)

### [low · assembly] qualy database drop-guard --base-ref silently scans nothing when cwd is not the repo root: git paths are root-relative but filtered with cwd-relative existsSync

- 位置:packages/plugins/infra/database/src/assembly/drop-guard.ts:63
- 主张:changedMigrationFiles runs `git diff --name-only <base>...HEAD -- <absolute migrations dir>` and then filters the result with fs.existsSync(file) (drop-guard.ts:54-64). git prints pathnames relative to the repository root regardless of cwd, while existsSync resolves against process.cwd(); the filter exists to drop deleted files, but when cwd is any directory other than the repo root it drops every changed migration, so guardDestructive receives an empty list and refuse() reports success ('databa…
- 失败场景:A branch adds db/migrations/20260810120000.sql containing `drop table evaluations;` without the approval marker. From apps/server (or any non-root cwd, e.g. an agent or script invoking `node ../../apps/cli/src/main.ts database drop-guard --base-ref origin/main` directly), git lists 'db/migrations/20260810120000.sql', existsSync('db/migrations/...') is false relative to apps/server, the file is fil…
- 反驳者判定:certain(The existsSync filter's legitimate purpose (dropping files deleted between base and HEAD so readFileSync won't throw) only works when cwd is the repo root; a fix would join the git output onto the rep…)

### [low · web] apps/web/.qualy aggregate is a single mutable file shared by concurrent vite processes with divergent content (dev/test active-set vs build all-set): mid-run rewrites reload running suites and leave dev serving the superset

- 位置:packages/build/web/src/vite.ts:46
- 主张:qualyPlugins materialises the aggregate to the fixed paths apps/web/.qualy/plugins.ts and scan.ts (vite.ts:23-24) and chooses content by `all = environment.command === 'build'` (vite.ts:32). The writeIfChanged guard (vite.ts:39-49) only suppresses same-content rewrites; it cannot protect against a second vite process whose all-flag differs. The dev server (`pnpm dev` mounts vite middlewareMode over apps/web/vite.config.ts, packages/plugins/infra/web/src/server/index.ts:239-253) and the browser t…
- 失败场景:Developer keeps `pnpm dev` running and runs `pnpm build` in a second terminal to stage assets. Build's config hook rewrites apps/web/.qualy/plugins.ts and scan.ts with the superset; the dev server's watcher sees its module-graph file change and full-reloads the browser mid-work, then serves the superset (disabled plugins' modules, catalogs and error translations active in dev) until manually resta…
- 反驳者判定:likely(Real for the claimed central reason (shared mutable aggregate + divergent all-flag + dev watcher), but materially narrower than reported: the test-runner reload leg is refuted (vitest browser server r…)

### [low · web] check-chunks sentinel matches chunks by bare basename prefix in a flat namespace: cross-plugin basename collisions (which componentKey explicitly permits) make the gate false-pass or false-fail

- 位置:apps/web/scripts/check-chunks.ts:27
- 主张:Registry keys are namespaced `<plugin>/<Basename>` and two plugins may legally ship components with the same file basename — collect.ts's claim map only rejects duplicate full keys (collect.ts:84-93), and componentKey namespaces by plugin (packages/contracts/ui/src/components.ts:54-61). But the sentinel drops the namespace (`chunkName = key.split('/').pop()`, check-chunks.ts:23) and asserts presence with `files.some(file => file.startsWith(`${chunkName}-`))` (line 27) against the flat dist/asset…
- 失败场景:Plugin A and plugin B both declare `./client/SettingsPage.tsx` (valid: keys are `a/SettingsPage` and `b/SettingsPage`, collect passes). A refactor adds a static import of A's SettingsPage from another A module, so rolldown merges it and A no longer gets an independent chunk — the code-splitting property the sentinel exists to guard. CI still prints 'a/SettingsPage: chunk present' because B's Setti…
- 反驳者判定:certain(Aggravator beyond the reported scenario: the flat assets dir also contains non-component chunks (i18n-*, zh-CN-*, api-*, admin-*, card-*, messages-*, etc.), so a future component named e.g. api.tsx or…)

### [low · database] Testkit template protection is a no-op: `datallowconn = true` where the comment (and correctness) require `false`

- 位置:packages/plugins/infra/database/src/testkit.ts:189
- 主张:ensureTemplate ends with `update pg_database set datallowconn = true where datname = $1` under the comment 'a template must not be written to, and postgres refuses to copy one that has connections, so it is marked and left alone'. `true` is datallowconn's default for every created database, so the statement changes nothing: the persistent template stays fully connectable and writable. The intended value is `false`, which delivers exactly the claimed property — connections are refused while `CREA…
- 失败场景:The template database persists across runs with connections allowed. (a) Any session sitting on it — a developer's psql/pgAdmin tab opened while inspecting the odd `qualy_tpl_*` database — makes every concurrent `create database ... template` in a parallel vitest run fail with 55006 'source database is being accessed by other users', producing suite-wide flaky failures the harness comment claims t…
- 反驳者判定:certain(One evidence detail is wrong but immaterial: git log --all -S datallowconn attributes the statement+comment to commit 11b63e4 (the Effect platform migration), not 35f98c9 as the finding states (35f98c…)

### [low · api] Tampered pagination cursor on GET /iam/role-grants returns 500 instead of a 400

- 位置:packages/plugins/base/rbac/src/server/grants.ts:178
- 主张:The opaque, client-held cursor for listRoleGrants decodes to a value that readQueryCursor validates only as 'a string' (never as a UUID); that string is passed straight to `.where('g.id', '>', page.after)` against a uuid primary-key column under Effect.orDie, so a structurally-valid but non-UUID key yields a Postgres cast error surfaced as an unhandled 500 rather than the clean BAD_REQUEST the cursor contract prescribes.
- 失败场景:An authenticated caller with iam.grant.read requests GET /iam/role-grants?cursor=<crafted>, where the cursor is base64url(JSON {v:1,q:'grants:',k:['x']}). readQueryCursor accepts it (arity 1, k[0] is a string), so after='x'; Kysely emits `where "g"."id" > $1` with $1='x'; Postgres raises 22P02 invalid_text_representation coercing 'x' to uuid; QueryFailed hits Effect.orDie and the endpoint answers …
- 反驳者判定:certain(Reachable by ANY authenticated user, not only iam.grant.read holders: listRoleGrants has no rbac.require and grantScopeFor never fails, while the 22P02 uuid-parse error fires at parameter bind time re…)

### [low · api] changed() only rejects empty patches, so updateRole/updateUserType bump the version on an unchanged resubmit

- 位置:packages/core/api-kit/src/schema.ts:110
- 主张:The changed() helper's docstring promises it 'refuses a patch that changes nothing' and explicitly warns that otherwise a concurrent administrator's genuine edit at the same version is spuriously refused; but the implementation only refuses patches where every listed field is absent. A patch that re-sends a field at its current value passes, and updateRole/updateUserType then increment the version unconditionally — contradicting the documented intent and inconsistent with the sibling setStatus/s…
- 失败场景:Admin A opens the user-type edit form at version 5, intending to change sortOrder. A UI (or Admin B) that re-saves the full form with all fields at their current values sends PATCH /iam/user-types/{id} {version:5,name:<same>,description:<same>,...}; changed() passes because name is present, updateUserType commits version 6 though nothing changed. Admin A's genuine PATCH {version:5,sortOrder:3} now…
- 反驳者判定:likely(The schema-level framing is the weak half of the claim: a Schema filter cannot compare against DB state, and changed()'s own example ({version: 3}) plus its error message document presence semantics, …)

### [low · landmines] The CI chunk sentinel matches chunks by component basename prefix, so the first cross-plugin basename repeat silently disables the tree-shaking guarantee for both components

- 位置:apps/web/scripts/check-chunks.ts:27
- 主张:check-chunks.ts (run in CI, .github/workflows/ci.yml:66) asserts 'every registered component must be an independent chunk' by checking files.some(file => file.startsWith(`${basename}-`)) where basename is key.split('/').pop() (lines 23-27). Registry keys are deliberately namespaced '<plugin>/<Basename>' and the collector only rejects duplicate full keys (packages/build/web/src/collect.ts:85-91), so two plugins may legitimately ship components with the same basename — but rolldown's default [name…
- 失败场景:The assessment plugin adds client/RolesPage.tsx for its review-role screen (rbac already has RolesPage.tsx). Build emits RolesPage-<hashA>.js and RolesPage-<hashB>.js; both keys pass the prefix check. Months later a refactor adds a static import of the assessment RolesPage from another assessment module — vite merges it into the parent chunk, per-page code splitting for it is gone, and --expect-ab…
- 反驳者判定:certain(Two secondary inaccuracies, verdict unaffected: (1) with a twin present, --expect-absent becomes falsely RED (always sees the twin's chunk, "UNEXPECTED CHUNK"), i.e. unusable, not "can never fail" as …)

## 被反驳掉的

- [gates] Production smoke accepts an empty manifest: pages:[] passes the one assertion that guards the SPA's route surface — The quoted code is accurate: tools/quality/smoke-production.ts:89-93 only asserts status 200 + Array.isArray(body.pages), so {"pages":[]} passes that one line. But the failure scenario is unreachable because an earlier gate in the same CI job already asserts manifest content on the production assemb…

## 盲区(批评家,未审计区域,非发现)

### Authentication abuse resistance and credential/session lifecycle (authn, as oppo

Authentication abuse resistance and credential/session lifecycle (authn, as opposed to the audited authz): the unauthenticated login flow in packages/plugins/base/auth-local/src/index.ts has no throttling, lockout, or failed-attempt audit trail, and by design burns one argon2id verification at memoryCost 65536 KiB (64 MiB, packages/plugins/base/auth-local/src/password.ts) on every miss via the timing equalizer, so roughly 16 concurrent unauthenticated requests pin 1 GiB of RAM; request bodies are unbounded because Effect's MaxBodySize reference defaults to undefined (repos/effect/packages/effe…

为什么要紧:This is the only unauthenticated writable surface and the first thing an internet-facing demo exposes; credential stuffing is undetectable (no counter, no log), cheap memory-amplification DoS is available to anyone, and the response to a compromised password is a server-side CLI plus a week of still-valid sessions. The authz reviewer scoped to RBAC authorization and the api reviewer to contract se…

### Backup, restore, and data durability

Backup, restore, and data durability: docker-compose.yml declares and mounts a pg_backups volume (/backups) that nothing in the repository ever writes to (zero pg_dump/backup references across tools/, apps/, docs/), there is no dump, restore, or PITR tooling and no recovery documentation, and pnpm db:reset (docker compose down -v, package.json) destroys pg_data and pg_backups in the same gesture. The stated disaster story in packages/plugins/infra/database/src/migrator.ts ('the lineage is the last thing standing in a disaster', psql -f replayable) rebuilds schema only, never data.

为什么要紧:This system will hold student assessment records, the one asset that cannot be re-derived from the repo. The database reviewer audited code paths (boot CREATE DATABASE, adopt, drop-guard) but nobody asked whether a lost or corrupted database can come back; today the honest answer is no, and the decorative backups volume makes it look otherwise. The habit-forming db:reset command deleting the backu…

### Deployment packaging and the production runtime story of the app itself

Deployment packaging and the production runtime story of the app itself: there is no Dockerfile, systemd unit, or ops runbook anywhere (docker-compose.yml runs only postgres); production is 'pnpm start' interpreting workspace TypeScript through tsx on a git checkout, with secrets in a plaintext .env consumed by both node and compose, correctness depending on install-time side effects (the prepare-script typescript patch, pnpm patchedDependencies), and no restart, rollback, or log-retention policy for the app process (only the postgres container gets json-file rotation). Operational toggles lik…

为什么要紧:tools/quality/smoke-production.ts proves a laptop-shaped process boots, not that a deployable artifact exists; the first real deployment will improvise host state (node version, patch reapplication, env files) that no gate observes, and drift between that host and the repo is exactly the class of silent breakage the assembly layer works hard to prevent everywhere else. No reviewer dimension touche…

### Runtime observability and diagnosability

Runtime observability and diagnosability: the codebase pays for spans everywhere (Effect.fn wraps most handlers) yet no tracer or metrics exporter is configured anywhere (zero Otlp/Tracer/Metric/Prometheus references in apps/server, packages/core, packages/plugins/infra), so stdout logs are the entire incident-triage surface; /health/ready in apps/server/src/health.ts runs registered probes sequentially with no per-probe timeout, so a hanging DB connect makes the probe hang rather than answer 503, and each unauthenticated hit does real dependency work; there is no security-event logging (faile…

为什么要紧:The effect reviewer proved the logging pipeline itself has bugs (inverted per-source filter), which shows nobody has operated this system yet; when the first production incident happens there will be no pool-exhaustion, latency, or error-rate signal to notice it, and no trail to reconstruct an account-takeover attempt. Absence of telemetry is invisible to every code-level audit dimension, which is…

### Cross-process and multi-instance concurrency assumptions

Cross-process and multi-instance concurrency assumptions: no reviewer exercised any two-process scenario (the only race finding was vite's aggregate file). Migration mutual exclusion was consciously rolled back (docs/notes/data-layer-retrospective.md trigger table: 'advisory lock <- 真实多副本部署') and packages/plugins/infra/database/src/migrator.ts runs MikroORM Migrator.up() with no lock (the only advisory lock left is in testkit.ts for template creation), but nothing in code or CI watches the trigger condition: a second replica, or 'pnpm dev' with migrations apply racing 'pnpm qualy deploy' on on…

为什么要紧:The freeze discipline says deferred mechanisms return when their trigger fires, but the tripwire is human memory: the constraint '单实例串行' lives in an old STATUS.md paragraph, not in a check, a doc a deployer would read, or a startup assertion. The first horizontal scale-out or concurrent boot-vs-deploy will interleave DDL on the production database with no error message pointing at why, and auditin…

### Platform/tenant operations plane

Platform/tenant operations plane: the entire tenant lifecycle (create, disable, extend expiresAt, re-enable) has no application surface. tools/tests/support/frozen-routes.ts contains no tenant routes, insertInto('Tenant') exists only in tools/fixtures/seed.ts and tests, yet tenant enabled/expiry is enforced at every session resolve (packages/plugins/base/auth/src/server/session.ts lines 71-74), so an expired or disabled default tenant locks out every principal including tenant-admin with no in-product recovery. The only available tool is raw psql, which bypasses all the app-enforced cross-plug…

为什么要紧:Day-2 administration was outside every reviewer's dimension, but it is where the invariant architecture is weakest: the moment an operator must touch tenants they are forced into the one write path (hand SQL) that the carefully single-sourced invariants cannot see, and the resulting corruption (for example a system-account off the root node, or a placement violation) is precisely what the audited …

