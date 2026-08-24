# Local Observability

Optional local OpenTelemetry stack for development.

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

## Versions

The container versions are pinned in `docker-compose.yml`:

- `otel/opentelemetry-collector-contrib:0.159.0`
- `grafana/otel-lgtm:0.31.0`

After upgrading the Collector, validate the configuration with:

```bash
docker compose --profile observability run --rm --no-deps \
  otel-collector validate --config=/etc/otelcol/config.yaml
```
