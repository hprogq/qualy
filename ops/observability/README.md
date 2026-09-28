# Observability

Optional local OpenTelemetry stack for development, and the production
Collector configuration for Tencent Cloud.

```text
Qualy Server
    │
    │ OTLP/HTTP
    ▼
OpenTelemetry Collector
    │
    ▼
Grafana OTEL-LGTM
    ├─ Traces
    ├─ Metrics
    └─ Grafana
```

Qualy exports telemetry to the local Collector at `http://127.0.0.1:4318`. The Collector forwards it to the local LGTM stack.

The observability profile is optional and is not required for normal development.

## Start

```bash
docker compose --profile observability up -d

OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm dev
```

You may also set `OTEL_EXPORTER_OTLP_ENDPOINT` in `.env`.

When the variable is not configured, telemetry is disabled and `pnpm dev` runs normally without the observability stack.

Grafana is available at:

[http://localhost:3001](http://localhost:3001)

Traces for `qualy-server` can be inspected in Grafana under **Drilldown → Traces**.

## Health Check

Collector:

```bash
curl -sf http://127.0.0.1:13133
```

Container status:

```bash
docker compose ps
```

## Stop

```bash
docker compose --profile observability down otel-collector otel-lgtm
```

Specify the service names to avoid stopping the default PostgreSQL services.

Local telemetry data is ephemeral and is removed with the LGTM container.

## Staging bridge (local → Tencent APM)

`collector.staging.yaml` is the local stack plus one addition: traces are
exported to Tencent APM's public OTLP gRPC/TLS endpoint as well as to the
local Tempo. Grafana on :3001 keeps working exactly as before — the file is
for verifying the cloud path from a development machine, before any server
exists in the VPC. Metrics stay local in step one; the APM→Prometheus metric
sync is configured in the Tencent console, and nothing here ever speaks to a
VPC-internal address.

```bash
cp ops/observability/collector.env.example ops/observability/collector.env
# fill in TENCENT_APM_TOKEN (the file is gitignored; compose feeds it to the
# collector container only - the Qualy process never sees it)

QUALY_COLLECTOR_CONFIG=collector.staging.yaml docker compose --profile observability up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm dev
```

`QUALY_COLLECTOR_CONFIG` can also live in `.env` (it is not a secret). To
tell whether the uplink works, watch the collector:

```bash
docker logs -f qualy-otel-collector
```

An accepted export is silent; a rejected one says which exporter and why
(an invalid token answers `No Data Report` — the TLS/gRPC path itself is
fine when you see that). Unset `QUALY_COLLECTOR_CONFIG` to fall back to the
purely local stack.

## Production (Tencent Cloud)

`deploy/otel-collector.yaml` is the one place Tencent Cloud exists; it runs
as the `otel-collector` service of `deploy/compose.yaml` (profile
`telemetry`), and the servers export to it over the compose network
(`OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`,
`OTEL_LOGS_EXPORTER=otlp` in `deploy/.env`). The Collector fans out over the
region's private-network endpoints:

```text
traces  → Tencent APM  (OTLP gRPC over TLS on 4320; token + host.name
                        injected by the resource processor, never set by
                        the application)
metrics → Tencent APM  (the same uplink; the console's sync rules carry them
                        on into TMP until a remote write to the TMP instance
                        is measured reachable from the server)
logs    → Tencent CLS  (OTLP/HTTP, Basic Auth over a CAM credential)
```

Credentials and endpoints come from `deploy/collector.env` only (copied from
`deploy/collector.env.example`, never committed) - never the Qualy process,
never this repository. Start it once; upgrades leave it running:

```bash
docker compose --profile telemetry up -d otel-collector
```

Health probe: `curl -sf http://127.0.0.1:13133`. An unreachable APM/TMP
endpoint is a background retry, not a startup failure (verified against the
pinned image), and the application is unaffected either way.

No sampling initially — collect real span/day volume and cost first. When a
trigger arrives, a `tail_sampling` processor slots into the traces pipeline
between `memory_limiter` and `resource/tencent_apm` (errors 100%, slow 100%,
ordinary 10–20%); the config marks the spot.

## Logs (Tencent CLS)

CLS ingests OTLP/HTTP natively, so logs ride the same collector as traces
and metrics — no LogListener, no machine group. Export from the application
is **opt-in**: set `OTEL_LOGS_EXPORTER=otlp` beside the endpoint and every
log record reaches the collector (→ Loki locally, → CLS on the staging
config, dual-written), carrying the trace/span ids of the emitting fiber.
The staging config authenticates with HTTP Basic Auth (SecretId/SecretKey
via the basicauth extension) and addresses the topic with a `topic_id`
header; all four values live in `collector.env`.

The stdout JSON logger stays the primary log surface either way (the OTLP
logger merges beside it, never replaces it), and its top-level
`request_id`/`trace_id`/`span_id` contract is unchanged. One honest gap:
the OTLP record carries `TraceId`/`SpanId` natively but not `request_id` —
that key lives in log annotations only on the stdout side. Correlate CLS ↔
audit through `trace_id` for now.

Every line carries its correlation as top-level keys, injected by the logger
itself from the emitting fiber — a line logged inside a business child span
carries that span's id, not the HTTP root's:

```json
{
  "timestamp": "2026-08-25T…",
  "level": "Info",
  "source": "http",
  "request_id": "7bd8a7b8-…",
  "trace_id": "e579d4b66e53742c1d4d7da3d8c8c7de",
  "span_id": "0288aa3a5b5a6711",
  "message": "GET /api/app/manifest 200 2ms",
  "annotations": {}
}
```

Configure CLS key-value index on exactly these fields (no full-text index
initially, retention 15 days to start):

```text
timestamp  level  source  message  request_id  trace_id  span_id
```

`trace_id`/`span_id` match what APM receives, which is what lets the APM
trace view jump to the CLS lines of the same request; `request_id` matches
the audit trail and the sign-in records. Keys are absent — never faked — on
lines outside a request or a trace.

## Versions

The container versions are pinned in `docker-compose.yml`:

- `otel/opentelemetry-collector-contrib:0.159.0`
- `grafana/otel-lgtm:0.31.0`

After upgrading the Collector, validate the development configuration
against the pinned image, and the deployment's as the comment at the top of
`deploy/otel-collector.yaml` says (the deployment pins the same version by
digest in `deploy/compose.yaml`):

```bash
docker compose --profile observability run --rm --no-deps \
  otel-collector validate --config=/etc/otelcol/config.yaml
```
