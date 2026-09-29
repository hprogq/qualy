import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// How many people at once the deployment serves, and how it feels to them.
//
//   node tools/benchmarks/capacity/run.ts [--users 10,25,50] [--workloads student,reviewer]
//
// Against the local deployment e2e-stack.ts started - never a public one: a
// load test on production is an incident rehearsal, not a measurement. For
// each workload and each number of people, k6 (run.ts pins its image) runs
// load.js inside the deployment's network while this samples the serving
// server container's CPU and memory; the report is the requests a second,
// request and whole-screen latency, the failure rate, and the container's
// peaks, written to .qualy/e2e/capacity/report.md.
//
// What the numbers are: one machine's docker (the server's own limits from
// compose.yaml apply), the demonstration baseline's data, reads only - the
// baseline's round is in review, so filing and submitting are not in them.

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const out = path.join(repoRoot, '.qualy/e2e/capacity')
const K6 =
  'grafana/k6:1.3.0@sha256:3ddc8b1a33a2c3d8edc6e99b6a762ae36cba08788463458f5e6a7703e14eb77d'
const NETWORK = 'qualy-e2e_default'
const SERVER = 'qualy-e2e-server-blue-1'

const option = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return (at >= 0 ? process.argv[at + 1] : undefined) ?? fallback
}
const levels = option('users', '10,25,50').split(',').map(Number)
const workloads = option('workloads', 'student,reviewer').split(',')

if (!fs.existsSync(path.join(out, 'plan.json'))) {
  console.error('no .qualy/e2e/capacity/plan.json: run record.ts against the e2e deployment first')
  process.exit(1)
}
if (spawnSync('docker', ['inspect', SERVER]).status !== 0) {
  console.error(`no ${SERVER}: start the deployment with node tools/quality/e2e-stack.ts up`)
  process.exit(1)
}

/** the server container's cpu (% of one core) and memory (MiB), every two seconds */
const sampling = () => {
  const samples: { cpu: number; memory: number }[] = []
  let running = true
  const loop = async () => {
    while (running) {
      const read = spawnSync(
        'docker',
        ['stats', '--no-stream', '--format', '{{.CPUPerc}} {{.MemUsage}}', SERVER],
        {
          encoding: 'utf8',
        },
      )
      const [cpu, memory] = read.stdout.trim().split(' ')
      const mib = (memory ?? '').endsWith('GiB')
        ? Number.parseFloat(memory!) * 1024
        : Number.parseFloat(memory ?? '')
      if (cpu !== undefined) samples.push({ cpu: Number.parseFloat(cpu), memory: mib })
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  const done = loop()
  return async () => {
    running = false
    await done
    return samples
  }
}

const k6 = (workload: string, users: number) =>
  new Promise<number>((resolve) => {
    const child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        NETWORK,
        '-v',
        `${out}:/plan:ro`,
        '-v',
        `${out}:/out`,
        '-v',
        `${path.join(import.meta.dirname, 'load.js')}:/scripts/load.js:ro`,
        '-e',
        `WORKLOAD=${workload}`,
        '-e',
        `USERS=${String(users)}`,
        '-e',
        'BASE=http://server-blue:3000',
        K6,
        'run',
        '--quiet',
        '/scripts/load.js',
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    )
    child.on('exit', (code) => resolve(code ?? 1))
  })

interface Row {
  workload: string
  users: number
  rps: number
  p50: number
  p95: number
  p99: number
  screenP95: number
  failed: number
  cpuPeak: number
  memoryPeak: number
}
const rows: Row[] = []
for (const workload of workloads) {
  for (const users of levels) {
    fs.rmSync(path.join(out, 'summary.json'), { force: true })
    const stop = sampling()
    const code = await k6(workload, users)
    const samples = await stop()
    if (code !== 0 || !fs.existsSync(path.join(out, 'summary.json'))) {
      console.error(`k6 exited ${String(code)} for ${workload} × ${String(users)}`)
      process.exit(1)
    }
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')) as {
      metrics: Record<string, { values: Record<string, number> }>
    }
    const duration = summary.metrics['http_req_duration']!.values
    const row: Row = {
      workload,
      users,
      rps: summary.metrics['http_reqs']!.values['rate']!,
      p50: duration['p(50)']!,
      p95: duration['p(95)']!,
      p99: duration['p(99)']!,
      screenP95: summary.metrics['screen_duration']!.values['p(95)']!,
      failed: summary.metrics['screen_failed']!.values['rate']!,
      cpuPeak: Math.max(0, ...samples.map((sample) => sample.cpu)),
      memoryPeak: Math.max(0, ...samples.map((sample) => sample.memory)),
    }
    rows.push(row)
    console.log(
      `${workload} × ${String(users)}: ${row.rps.toFixed(0)} req/s, p50 ${row.p50.toFixed(0)} ms, p95 ${row.p95.toFixed(0)} ms, p99 ${row.p99.toFixed(0)} ms, screen p95 ${row.screenP95.toFixed(0)} ms, failed ${(row.failed * 100).toFixed(1)}%, cpu peak ${row.cpuPeak.toFixed(0)}%, memory peak ${row.memoryPeak.toFixed(0)} MiB`,
    )
  }
}

const table = [
  '| workload | people | req/s | p50 ms | p95 ms | p99 ms | screen p95 ms | failed | server cpu peak | server memory peak |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map(
    (row) =>
      `| ${row.workload} | ${String(row.users)} | ${row.rps.toFixed(0)} | ${row.p50.toFixed(0)} | ${row.p95.toFixed(0)} | ${row.p99.toFixed(0)} | ${row.screenP95.toFixed(0)} | ${(row.failed * 100).toFixed(1)}% | ${row.cpuPeak.toFixed(0)}% | ${row.memoryPeak.toFixed(0)} MiB |`,
  ),
]
fs.writeFileSync(path.join(out, 'report.md'), `${table.join('\n')}\n`)
console.log(`\n${table.join('\n')}`)
