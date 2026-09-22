import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readAnswer, readJson, readText, readXml } from '../src/protocol/response.ts'
import { settingsFrom, settingsOf, type CasSettings } from '../src/protocol/settings.ts'
import {
  businessNoOf,
  isServiceTicket,
  loginRedirect,
  serviceFor,
  validationRequest,
} from '../src/protocol/validate.ts'

// What a CAS answer may look like, and what this driver makes of it.
//
// Every fixture is synthetic: the names, numbers and units are made up, and
// the shapes follow what real servers send - the plain CAS 3 answer, a
// server that writes `sso:` and name/value attributes, the specification's
// own multi-valued example. The security cases are the parser contract: a
// later version of the parser, or a later change here, that lets any of them
// through has changed what this driver accepts from the network.

const fixture = (name: string) =>
  fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const bytes = (text: string) => new TextEncoder().encode(text)

describe('a CAS answer', () => {
  it('names the person, and keeps every attribute as it was sent', () => {
    const answer = readXml(fixture('p3-standard.xml'))
    expect(answer).toMatchObject({ kind: 'success', principal: { principal: '20990001' } })
    const attributes = answer.kind === 'success' ? answer.principal.attributes : {}
    expect(Object.keys(attributes)).toHaveLength(9)
    expect(attributes['id_number']).toEqual(['20990001'])
    expect(attributes['user_name']).toEqual(['测试同学'])
  })

  it('does not trust the prefix, keeps names verbatim and repeats whole', () => {
    const answer = readXml(fixture('legacy-mixed.xml'))
    expect(answer.kind).toBe('success')
    const attributes = answer.kind === 'success' ? answer.principal.attributes : {}
    expect(answer.kind === 'success' && answer.principal.principal).toBe('demo.person')
    expect(attributes['id_number']).toEqual(['20990002'])
    expect(attributes['user_name']).toEqual(['示例 & 同学'])
    expect(attributes['memberOf']).toEqual(['group-a', 'group-b'])
    // a name in another case is another name
    expect(attributes['ID_NUMBER']).toEqual(['should-not-fold'])
  })

  it('keeps every value of a repeated attribute', () => {
    const answer = readXml(fixture('multi-valued.xml'))
    const attributes = answer.kind === 'success' ? answer.principal.attributes : {}
    expect(attributes['affiliation']).toEqual(['staff', 'faculty'])
    expect(attributes['employeeNumber']).toEqual(['E1024'])
  })

  it('reports a refusal with the server’s own code', () => {
    expect(readXml(fixture('failure.xml'))).toEqual({ kind: 'failure', code: 'INVALID_TICKET' })
    expect(
      readXml(
        '<cas:serviceResponse xmlns:cas="x"><cas:authenticationFailure code="INVALID_SERVICE">no</cas:authenticationFailure></cas:serviceResponse>',
      ),
    ).toEqual({ kind: 'failure', code: 'INVALID_SERVICE' })
  })

  it('is read by its structure, not by searching for a success anywhere', () => {
    for (const xml of [
      // a success nested inside something else is not the answer
      '<serviceResponse><wrapper><authenticationSuccess><user>a</user></authenticationSuccess></wrapper></serviceResponse>',
      // two outcomes
      '<serviceResponse><authenticationSuccess><user>a</user></authenticationSuccess><authenticationFailure code="X"/></serviceResponse>',
      // another root
      '<response><authenticationSuccess><user>a</user></authenticationSuccess></response>',
      // no user, an empty user, two users
      '<serviceResponse><authenticationSuccess></authenticationSuccess></serviceResponse>',
      '<serviceResponse><authenticationSuccess><user>  </user></authenticationSuccess></serviceResponse>',
      '<serviceResponse><authenticationSuccess><user>a</user><user>b</user></authenticationSuccess></serviceResponse>',
      // two attribute blocks
      '<serviceResponse><authenticationSuccess><user>a</user><attributes/><attributes/></authenticationSuccess></serviceResponse>',
    ]) {
      expect(readXml(xml), xml).toEqual({ kind: 'unreadable' })
    }
  })
})

describe('the parser contract', () => {
  const success = (user: string) =>
    `<cas:serviceResponse xmlns:cas="x"><cas:authenticationSuccess><cas:user>${user}</cas:user></cas:authenticationSuccess></cas:serviceResponse>`

  it('refuses any document type and any entity declaration', () => {
    for (const xml of [
      `<!DOCTYPE foo [<!ENTITY a "aaaaaaaaaa">]>${success('&a;')}`,
      `<!DOCTYPE serviceResponse SYSTEM "file:///etc/passwd">${success('x')}`,
      `<!doctype x>${success('x')}`,
      `<!ENTITY a "x">${success('x')}`,
    ]) {
      expect(readXml(xml), xml).toEqual({ kind: 'unreadable' })
    }
  })

  it('reads the five predefined entities and numeric references, and nothing else', () => {
    const read = (user: string) => {
      const answer = readXml(success(user))
      return answer.kind === 'success' ? answer.principal.principal : answer.kind
    }
    expect(read('a&amp;b&lt;c&gt;d&quot;e&apos;f')).toBe(`a&b<c>d"e'f`)
    expect(read('&#50;&#x30;99')).toBe('2099')
    expect(read('&nbsp;x')).toBe('unreadable')
    expect(read('&#0;x')).toBe('unreadable')
    expect(read('&#xD800;x')).toBe('unreadable')
    expect(read('a & b')).toBe('unreadable')
  })

  it('takes character data as text', () => {
    const answer = readXml(success('<![CDATA[20990003]]>'))
    expect(answer.kind === 'success' && answer.principal.principal).toBe('20990003')
  })

  it('refuses what is too deep, too large, cut off or not text', () => {
    const deep = `<serviceResponse>${'<a>'.repeat(64)}${'</a>'.repeat(64)}</serviceResponse>`
    expect(readXml(deep)).toEqual({ kind: 'unreadable' })
    const large = success(`x${' '.repeat(300 * 1024)}`)
    expect(readAnswer(bytes(large), 'xml')).toEqual({ kind: 'unreadable' })
    const cut = success('20990001').slice(0, -20)
    expect(readXml(cut)).toEqual({ kind: 'unreadable' })
    expect(readAnswer(new Uint8Array([0x3c, 0xff, 0xfe, 0x3e]), 'xml')).toEqual({
      kind: 'unreadable',
    })
  })

  it('reads JSON and CAS 1 text in their own shapes', () => {
    expect(
      readJson(
        JSON.stringify({
          serviceResponse: {
            authenticationSuccess: {
              user: '20990004',
              attributes: { affiliation: ['staff', 'faculty'], id_number: '20990004' },
            },
          },
        }),
      ),
    ).toEqual({
      kind: 'success',
      principal: {
        principal: '20990004',
        attributes: { affiliation: ['staff', 'faculty'], id_number: ['20990004'] },
      },
    })
    expect(
      readJson('{"serviceResponse":{"authenticationFailure":{"code":"INVALID_TICKET"}}}'),
    ).toEqual({ kind: 'failure', code: 'INVALID_TICKET' })
    expect(readJson('{"serviceResponse":{}}')).toEqual({ kind: 'unreadable' })
    expect(readText('yes\n20990005\n')).toMatchObject({
      kind: 'success',
      principal: { principal: '20990005' },
    })
    expect(readText('no\n\n')).toEqual({ kind: 'failure', code: 'INVALID_TICKET' })
    expect(readText('maybe')).toEqual({ kind: 'unreadable' })
  })

  it('reads an automatic answer once, in whatever it turned out to be', () => {
    expect(readAnswer(bytes(fixture('p3-standard.xml')), 'auto').kind).toBe('success')
    expect(readAnswer(bytes('yes\nsomeone\n'), 'auto').kind).toBe('success')
    expect(
      readAnswer(bytes('{"serviceResponse":{"authenticationFailure":{"code":"X"}}}'), 'auto'),
    ).toEqual({ kind: 'failure', code: 'X' })
    // asked for XML, answered in something else: not read as that something
    expect(readAnswer(bytes('yes\nsomeone\n'), 'xml')).toEqual({ kind: 'unreadable' })
  })
})

describe('an entrance’s settings', () => {
  it('expand the standard versions into their endpoints', () => {
    const cas3 = settingsFrom({ serverUrl: 'https://cas.example.edu/cas/' })
    expect(cas3).toEqual({
      ok: true,
      settings: {
        loginUrl: 'https://cas.example.edu/cas/login',
        validateUrl: 'https://cas.example.edu/cas/p3/serviceValidate',
        validateMethod: 'GET',
        responseFormat: 'xml',
        identity: { source: 'principal' },
        renew: false,
      },
    })
    const cas2 = settingsFrom({ serverUrl: 'https://cas.example.edu/cas', protocol: 'cas2' })
    expect(cas2.ok && cas2.settings?.validateUrl).toBe('https://cas.example.edu/cas/serviceValidate')
    const cas1 = settingsFrom({ serverUrl: 'https://cas.example.edu/cas', protocol: 'cas1' })
    expect(cas1.ok && cas1.settings).toMatchObject({
      validateUrl: 'https://cas.example.edu/cas/validate',
      responseFormat: 'text',
    })
  })

  it('take each endpoint as named in the custom profile, and only there', () => {
    const custom = settingsFrom({
      serverUrl: 'https://cas.example.edu/cas',
      protocol: 'custom',
      validateUrl: 'https://cas.example.edu/cas/proxyValidate',
      validateMethod: 'POST',
      responseFormat: 'xml',
      identitySource: 'attribute',
      identityAttribute: 'id_number',
      identityFallback: true,
      renew: true,
    })
    expect(custom).toEqual({
      ok: true,
      settings: {
        loginUrl: 'https://cas.example.edu/cas/login',
        validateUrl: 'https://cas.example.edu/cas/proxyValidate',
        validateMethod: 'POST',
        responseFormat: 'xml',
        identity: { source: 'attribute', attribute: 'id_number', fallbackToPrincipal: true },
        renew: true,
      },
    })
    // the same boxes, left over from a custom profile, mean nothing in a standard one
    const standard = settingsFrom({
      serverUrl: 'https://cas.example.edu/cas',
      protocol: 'cas3',
      validateUrl: 'https://elsewhere.example/validate',
      validateMethod: 'POST',
    })
    expect(standard.ok && standard.settings).toMatchObject({
      validateUrl: 'https://cas.example.edu/cas/p3/serviceValidate',
      validateMethod: 'GET',
    })
  })

  it('refuse what cannot stand, and wait for what is not there yet', () => {
    expect(settingsFrom({ serverUrl: 'https://cas.example.edu/cas?x=1' })).toEqual({
      ok: false,
      invalid: 'serverUrl',
    })
    expect(settingsFrom({ serverUrl: 'ftp://cas.example.edu' })).toEqual({
      ok: false,
      invalid: 'serverUrl',
    })
    expect(
      settingsFrom({ serverUrl: 'https://cas.example.edu', identityAttribute: 'id number' }),
    ).toEqual({ ok: false, invalid: 'identityAttribute' })
    expect(settingsFrom({ protocol: 'cas3' })).toEqual({ ok: true })
    expect(
      settingsFrom({ serverUrl: 'https://cas.example.edu', identitySource: 'attribute' }),
    ).toEqual({ ok: true })
  })

  it('run from what was stored, and work it out again when nothing was', () => {
    const stored = settingsFrom({ serverUrl: 'https://cas.example.edu/cas' })
    const settings = (stored.ok && stored.settings) as CasSettings
    expect(settingsOf({ serverUrl: 'https://moved.example.edu', derived: settings })).toEqual(
      settings,
    )
    expect(settingsOf({ serverUrl: 'https://cas.example.edu/cas' })).toEqual(settings)
    expect(settingsOf({ derived: { loginUrl: 1 } })).toBeUndefined()
  })
})

describe('one round trip', () => {
  const settings = {
    loginUrl: 'https://cas.example.edu/cas/login?locale=zh',
    validateUrl: 'https://cas.example.edu/cas/p3/serviceValidate',
    validateMethod: 'GET',
    responseFormat: 'xml',
    identity: { source: 'principal' },
    renew: true,
  } satisfies CasSettings

  it('sends the person away with the service, and asks about the ticket with the same string', () => {
    const service = serviceFor(new URL('https://qualy.example.edu/api/auth/cas/campus/callback'), 'st4te_-x')
    expect(service).toBe('https://qualy.example.edu/api/auth/cas/campus/callback?flow=st4te_-x')
    const away = new URL(loginRedirect(settings, service))
    expect(away.origin + away.pathname).toBe('https://cas.example.edu/cas/login')
    expect(away.searchParams.get('locale')).toBe('zh')
    expect(away.searchParams.get('service')).toBe(service)
    expect(away.searchParams.get('renew')).toBe('true')

    const get = validationRequest(settings, service, 'ST-1-abc')
    const asked = new URL(get.url)
    expect(get.method).toBe('GET')
    expect(asked.searchParams.get('service')).toBe(service)
    expect(asked.searchParams.get('ticket')).toBe('ST-1-abc')
    expect(asked.searchParams.get('format')).toBeNull()

    const post = validationRequest(
      { ...settings, validateMethod: 'POST', responseFormat: 'json' },
      service,
      'ST-1-abc',
    )
    expect(post.method).toBe('POST')
    expect(new URL(post.url).searchParams.get('format')).toBe('JSON')
    expect(new URL(post.url).searchParams.get('ticket')).toBeNull()
    expect((post.body as URLSearchParams).get('service')).toBe(service)
    expect((post.body as URLSearchParams).get('ticket')).toBe('ST-1-abc')
  })

  it('takes only a service ticket', () => {
    expect(isServiceTicket('ST-1856339-aA5Yuvrxzpv8Tau1cYQ7')).toBe(true)
    for (const ticket of ['PT-1-abc', 'TGT-1-abc', 'ST-', 'st-1-abc', 'ST-1 abc', `ST-${'x'.repeat(300)}`]) {
      expect(isServiceTicket(ticket), ticket).toBe(false)
    }
  })

  it('finds the person identifier by the entrance’s rule', () => {
    const principal = {
      principal: 'demo.person',
      attributes: { id_number: ['', ' 20990002 '], other: ['x'] },
    }
    expect(businessNoOf(principal, { source: 'principal' })).toBe('demo.person')
    expect(
      businessNoOf(principal, { source: 'attribute', attribute: 'id_number', fallbackToPrincipal: false }),
    ).toBe('20990002')
    expect(
      businessNoOf(principal, { source: 'attribute', attribute: 'ID_NUMBER', fallbackToPrincipal: false }),
    ).toBeUndefined()
    expect(
      businessNoOf(principal, { source: 'attribute', attribute: 'missing', fallbackToPrincipal: true }),
    ).toBe('demo.person')
  })
})
