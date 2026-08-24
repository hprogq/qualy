# 本地可观测性栈

开发机上的 traces + metrics 通路,默认不启动,与业务开发互不打扰。

```text
Qualy Server ──OTLP/HTTP──▶ otel-collector ──OTLP──▶ grafana/otel-lgtm
   :4318(仅 localhost)                                ├─ Tempo(traces)
                                                       ├─ Prometheus 兼容存储(metrics)
                                                       └─ Grafana(http://localhost:3001)
```

应用只认识 `127.0.0.1:4318` 这一个标准 OTLP endpoint;collector 之后的一切
(本地是 LGTM,生产是腾讯云 APM/TMP)都是部署配置的事。生产 collector 配置
在 Phase 6.7 落地时进入本目录。

## 启动

```bash
docker compose --profile observability up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 pnpm dev
```

Grafana 开在 <http://localhost:3001>(匿名 admin,无需登录),Drilldown → Traces
里能看到 `qualy-server` 的请求与服务 span;metrics 每 60 秒导出一批。

`OTEL_EXPORTER_OTLP_ENDPOINT` 也可以写进 `.env`——没有它时应用的遥测层是彻底的
no-op,所以平时 `pnpm dev` 不需要这个 profile,也不会刷导出失败的日志。

## 健康

- collector:`curl -sf http://127.0.0.1:13133`(health_check extension;镜像是
  scratch 基底,没有 shell,所以 compose 里没有 docker healthcheck,这个端口
  就是探针)。
- LGTM:`docker compose ps` 的 healthy 状态(Grafana `/api/health`)。

## 停止与清理

```bash
docker compose --profile observability down otel-collector otel-lgtm
```

要点名这两个服务:不带服务名的 `down` 在启用 profile 后会把默认组的
postgres 一并停掉。

LGTM 容器不带 volume:本地遥测数据的保留期就是容器的生命期,重启即清空,
这是诊断工具该有的样子。

## 版本

镜像 pin 在 docker-compose.yml:`otel/opentelemetry-collector-contrib:0.159.0`、
`grafana/otel-lgtm:0.31.0`。升级时先跑
`docker compose --profile observability run --rm --no-deps otel-collector validate --config=/etc/otelcol/config.yaml`
确认 collector.local.yaml 仍被新版本 schema 接受。
