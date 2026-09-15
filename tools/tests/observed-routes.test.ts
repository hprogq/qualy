import { beforeEach, describe, expect, it } from 'vitest'
import { apiRouteTemplates } from '@qualy/api-kit/local'
import {
  apiRouteCount,
  apiRouteFor,
  registerApiRoutes,
  resetApiRoutes,
} from '@qualy/browser-observability/api-routes'
import { servedApi } from './support/served-api.ts'

// What a report may say an api call was, asked of the contract that declared
// it rather than of the address.
//
// The browser reports how long its own api calls took, and a path carries the
// row: `/api/iam/users/<uuid>/role-grants` names a person. The first attempt
// masked segments by shape - a uuid, a long run of digits, anything past
// sixteen characters - and it was wrong in both directions at once. It masked
// thirteen of this product's own route names, `formula-binding-options` among
// them, so the report named no endpoint. And it would have passed on
// `school-cas`, `review-entry` and `1` unmasked, because a parameter is
// allowed to look like a word.
//
// No rule about shape can tell a route name from a parameter value, because
// this product writes them the same way. The declaration can, and does. So
// the routes come from the assembly the runtime serves - the same value the
// browser's clients are built from - and this suite asks it about every
// endpoint that exists rather than about examples somebody chose.
//
// The subpath and not the package: the port's other modules read `window`,
// and this program is compiled for node. The registry is pure string work,
// which is why it can be reached that way at all.

const routes = apiRouteTemplates(servedApi)
const templates = [...new Set(routes.map((route) => route.template))]

const segmentsOf = (template: string) => template.split('/').filter((part) => part !== '')
const isParameter = (segment: string) => segment.startsWith(':')
const parametersOf = (template: string) =>
  segmentsOf(template)
    .filter(isParameter)
    .map((segment) => segment.slice(1))

/** every literal any route uses, so a test value can be chosen not to be one */
const LITERALS = new Set(
  templates.flatMap((template) => segmentsOf(template).filter((s) => !isParameter(s))),
)

/**
 * The address a call to this route would actually have.
 *
 * Every parameter gets a value, `pick` chooses which - the point of the suite
 * is that the choice may not matter.
 */
const addressOf = (template: string, pick: (parameter: string) => string): string =>
  `/${segmentsOf(template)
    .map((segment) => (isParameter(segment) ? pick(segment.slice(1)) : segment))
    .join('/')}`

/**
 * Shapes a parameter value takes in this product, and one it does not take yet.
 *
 * Four of them are real and named in the contract: a uuid primary key, a
 * provider code, a version number, a permission code. The rest are here
 * because the rule must not depend on the list being complete - a format
 * nobody has invented yet has to be hidden on the day it arrives, without
 * this file being edited.
 */
const VALUE_SHAPES = [
  '0199f03e-1111-7abc-8def-000000000001',
  '1',
  '2023123456',
  'school-cas',
  'review-entry',
  'MiXedCaseToken42',
  'some.dotted.value',
  'a',
  '%E5%BC%A0%E4%B8%89',
  'v2026.09-beta',
]

beforeEach(() => {
  resetApiRoutes()
  registerApiRoutes(routes)
})

describe('what a report may say an api call was', () => {
  it('takes every route the assembled api declares', () => {
    expect(apiRouteCount()).toBe(templates.length)
    // not vacuous: this is the whole product's api surface, not a sample
    expect(templates.length).toBeGreaterThan(100)
  })

  it('answers with its own template for every endpoint, whatever fills the parameters', () => {
    // the values are chosen not to be any route's literal, so that a match on
    // a different template would be a real misclassification rather than the
    // correct reading of a path that happens to name a fixed route
    for (const shape of VALUE_SHAPES) {
      expect(LITERALS.has(shape), `${shape} is a route word; pick another test value`).toBe(false)
    }
    const wrong: string[] = []
    for (const route of routes) {
      for (const shape of VALUE_SHAPES) {
        const address = addressOf(route.template, () => shape)
        const answer = apiRouteFor(address, route.method)
        if (answer !== route.template) wrong.push(`${address} -> ${answer ?? 'nothing'}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('hides the parameters this product actually has, by name', () => {
    // the four the design was asked about, each looked up in the contract
    // rather than written out here: a slug, a small number, an enum word, a
    // uuid. Three of the four would have survived a shape rule untouched.
    for (const [parameter, value] of [
      ['providerCode', 'school-cas'],
      ['versionNo', '1'],
      ['permission', 'review-entry'],
      ['userId', '0199f03e-1111-7abc-8def-000000000001'],
    ] as const) {
      const route = routes.find((one) => parametersOf(one.template).includes(parameter))
      expect(route, `no endpoint declares :${parameter}`).toBeDefined()
      const address = addressOf(route!.template, (name) =>
        name === parameter ? value : '0199f03e-1111-7abc-8def-000000000002',
      )
      const answer = apiRouteFor(address, route!.method)
      expect(answer).toBe(route!.template)
      expect(answer).toContain(`:${parameter}`)
      expect(answer).not.toContain(value)
    }
  })

  it('keeps every literal segment of the route it answers with', () => {
    for (const route of routes) {
      const address = addressOf(route.template, () => 'MiXedCaseToken42')
      const answer = apiRouteFor(address, route.method)!
      for (const literal of segmentsOf(route.template).filter((s) => !isParameter(s))) {
        expect(answer.split('/')).toContain(literal)
      }
    }
  })

  it('reads a fixed segment as itself where a parameter could also claim it', () => {
    // `/api/assessment/attachments/uploads` is a route AND a possible value of
    // `/api/assessment/attachments/:attachmentId`. More literals wins, which
    // is the reading every router gives. Derived, so this stays true of
    // whichever pair the api has next.
    const overlaps = templates.flatMap((fixed) => {
      const parts = segmentsOf(fixed)
      if (parts.some(isParameter)) return []
      const claimed = templates.filter(
        (other) =>
          other !== fixed &&
          segmentsOf(other).length === parts.length &&
          segmentsOf(other).every((segment, at) => isParameter(segment) || segment === parts[at]),
      )
      return claimed.length === 0 ? [] : [fixed]
    })
    expect(overlaps.length).toBeGreaterThan(0)
    // Both orders, because the routes arrive in whichever order clients are
    // built and a rule that only holds for one of them is not a rule. Asserted
    // after deliberately reversing: with the api's own order, answering with
    // the first claimant happens to be right, so this case passed a registry
    // that had no specificity rule at all.
    for (const order of [routes, [...routes].reverse()]) {
      resetApiRoutes()
      registerApiRoutes(order)
      for (const fixed of overlaps) expect(apiRouteFor(fixed)).toBe(fixed)
    }
  })

  it('leaves no two routes tied, which is what the answer would refuse', () => {
    // A tie is two templates of equal specificity claiming one address, and
    // it has no right answer: resolving it by declaration order would make a
    // report depend on which plugin loaded first. So the registry answers
    // with nothing and the record is dropped - correct, and a silent hole.
    // This is where a route that would open one gets noticed instead.
    const ties: string[] = []
    for (let i = 0; i < templates.length; i += 1) {
      for (let j = i + 1; j < templates.length; j += 1) {
        const left = segmentsOf(templates[i]!)
        const right = segmentsOf(templates[j]!)
        if (left.length !== right.length) continue
        const overlap = left.every(
          (segment, at) => isParameter(segment) || isParameter(right[at]!) || segment === right[at],
        )
        if (!overlap) continue
        if (
          left.filter((s) => !isParameter(s)).length !== right.filter((s) => !isParameter(s)).length
        )
          continue
        ties.push(`${templates[i]} and ${templates[j]}`)
      }
    }
    expect(ties).toEqual([])
  })

  it('answers with nothing for an address no route declares', () => {
    // fail closed: an unknown api path is not sanitized and sent, it is
    // refused. One missing timing record costs a line on a chart; one leaked
    // segment cannot be taken back
    const known = routes.find((route) => parametersOf(route.template).length > 0)!
    const address = addressOf(known.template, () => '0199f03e-1111-7abc-8def-000000000001')
    expect(apiRouteFor(`${address}/invented`)).toBeUndefined()
    expect(apiRouteFor('/api/iam/users/x/y/z/invented')).toBeUndefined()
    expect(apiRouteFor('/api/not-a-plugin/anything')).toBeUndefined()
    expect(apiRouteFor('/assessment/batches/0199f03e-1111-7abc-8def-000000000001')).toBeUndefined()
    expect(apiRouteFor('')).toBeUndefined()
    expect(apiRouteFor('/')).toBeUndefined()
  })

  it('takes a path and not an address, so a query can never ride along', () => {
    const known = templates.find((template) => !segmentsOf(template).some(isParameter))!
    expect(apiRouteFor(known)).toBe(known)
    // the caller strips these; the registry refuses rather than matching past
    // them, which is what makes stripping the caller's job and not a wish
    expect(apiRouteFor(`${known}?student=QUALY_PRIVATE_SENTINEL`)).toBeUndefined()
    expect(apiRouteFor(`${known}#fragment`)).toBeUndefined()
  })

  it('knows nothing before it is told, which is what a page with no client sees', () => {
    const known = templates[0]!
    resetApiRoutes()
    expect(apiRouteCount()).toBe(0)
    expect(apiRouteFor(known)).toBeUndefined()
  })
})
