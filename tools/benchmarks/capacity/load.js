// The load: many people at once opening the screens record.ts recorded.
//
// Each virtual user signs nothing and guesses nothing: it is one of the
// recorded accounts, and every iteration opens that workload's screens in
// order - all of a screen's reads at once, as a browser loading the page
// does (six to a host, k6's default and a browser's) - then reads it for a
// moment before the next. Run by run.ts inside the deployment's own network,
// straight at the serving color: the load is on the server and the
// database, not on the local TLS edge.
//
//   WORKLOAD  student | reviewer
//   USERS     how many people at once, held for a minute after a ramp
//   BASE      the serving color, e.g. http://server-blue:3000
import http from 'k6/http'
import { sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const plan = JSON.parse(open('/plan/plan.json'))
const workload = plan.workloads[__ENV.WORKLOAD]
const base = __ENV.BASE
const users = Number(__ENV.USERS)

/** how long a whole screen's reads took together: what a person waits for */
const screenTime = new Trend('screen_duration', true)
/** a screen with any answer at or above 400 */
const screenFailed = new Rate('screen_failed')

export const options = {
  scenarios: {
    people: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: users },
        { duration: '60s', target: users },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  for (const screen of workload.screens) {
    const started = Date.now()
    const answers = http.batch(
      screen.requests.map((request) => [
        'GET',
        `${base}${request.path}`,
        null,
        {
          headers: { ...request.headers, cookie: workload.cookie },
          tags: { screen: screen.route },
        },
      ]),
    )
    screenTime.add(Date.now() - started, { screen: screen.route })
    screenFailed.add(answers.some((answer) => answer.status === 0 || answer.status >= 400))
    sleep(1 + Math.random() * 2)
  }
}

export function handleSummary(data) {
  return { '/out/summary.json': JSON.stringify(data) }
}
