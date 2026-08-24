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

`collector.production.yaml` is the one place Tencent Cloud exists. The
application keeps exporting to `http://127.0.0.1:4318` exactly as in
development; the Collector fans out:

```text
traces  → Tencent APM  (OTLP gRPC; token + host.name injected by the
                        resource processor, never set by the application)
metrics → Tencent TMP  (Prometheus remote write, bearer token)
```

Credentials and endpoints come from the Collector's environment only —
deployment secrets, never the Qualy process, never this repository:

```text
TENCENT_APM_OTLP_ENDPOINT     regional APM OTLP endpoint (prefer private network)
TENCENT_APM_TOKEN             APM business system token
TENCENT_TMP_REMOTE_WRITE_URL  TMP remote-write URL
TENCENT_TMP_TOKEN             TMP bearer token
QUALY_INSTANCE_ID             same stable instance id the application carries
```

Run it beside the server (the config binds receivers to `127.0.0.1` only):

```bash
docker run -d --name qualy-otel-collector --network host \
  -v /path/to/collector.production.yaml:/etc/otelcol/config.yaml:ro \
  --env-file /path/to/collector.env \
  otel/opentelemetry-collector-contrib:0.159.0 --config=/etc/otelcol/config.yaml
```

Health probe: `curl -sf http://127.0.0.1:13133`. An unreachable APM/TMP
endpoint is a background retry, not a startup failure (verified against the
pinned image), and the application is unaffected either way.

No sampling initially — collect real span/day volume and cost first. When a
trigger arrives, a `tail_sampling` processor slots into the traces pipeline
between `memory_limiter` and `resource/tencent_apm` (errors 100%, slow 100%,
ordinary 10–20%); the config marks the spot.

## Logs (Tencent CLS)

Logs do not pass through the Collector and there is no OTel Logs SDK: the
production JSON log goes to stdout (or a file the deployment redirects to,
e.g. `/var/log/qualy/server.jsonl`) and LogListener ships it to a CLS topic
as JSON.

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

After upgrading the Collector, validate both configurations against the
pinned image:

```bash
docker compose --profile observability run --rm --no-deps \
  otel-collector validate --config=/etc/otelcol/config.yaml

docker run --rm -v ./ops/observability/collector.production.yaml:/etc/otelcol/config.yaml:ro \
  -e TENCENT_APM_OTLP_ENDPOINT=host:4317 -e TENCENT_APM_TOKEN=placeholder \
  -e TENCENT_TMP_REMOTE_WRITE_URL=https://host/write -e TENCENT_TMP_TOKEN=placeholder \
  -e QUALY_INSTANCE_ID=placeholder \
  otel/opentelemetry-collector-contrib:0.159.0 validate --config=/etc/otelcol/config.yaml
```
