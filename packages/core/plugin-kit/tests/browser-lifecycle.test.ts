import { describe, expect, it, vi } from 'vitest'
import { startBrowserPlugins, type BrowserPlugin } from '../src/browser.ts'

// The order a browser half runs in, and the end of it.
//
// It used to be an import for its side effect: no moment, no order anybody
// declared, and no way back - which is why a disabled plugin could only be
// "present but not asked", a suite could not reset between cases, and a hot
// reload registered everything twice.

const context = { release: { releaseId: 'r_test', clientProtocol: 2 } }

describe('running a build’s browser halves', () => {
  it('sets every one up before it starts any, and tears down in reverse', async () => {
    const said: string[] = []
    const plugin = (name: string): BrowserPlugin => ({
      setup: () => {
        said.push(`setup ${name}`)
        return () => said.push(`dispose ${name}`)
      },
      start: () => {
        said.push(`start ${name}`)
      },
    })
    const stop = startBrowserPlugins([plugin('a'), plugin('b')], context)
    // everything a screen may look for is registered before anything that
    // costs something begins
    expect(said).toEqual(['setup a', 'setup b', 'start a', 'start b'])
    stop()
    expect(said.slice(4)).toEqual(['dispose b', 'dispose a'])
  })

  it('stops exactly once, however often it is asked', () => {
    const dispose = vi.fn()
    const stop = startBrowserPlugins([{ setup: () => dispose }], context)
    stop()
    stop()
    stop()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('does not wait for a start, however long it takes', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const after: string[] = []
    startBrowserPlugins(
      [{ start: () => held }, { setup: () => void after.push('the next one still set up') }],
      context,
    )
    // the host returned: a provider that never answers cannot hold a render
    expect(after).toEqual(['the next one still set up'])
    release()
    await held
  })

  it('keeps one plugin’s failure to itself, at every stage', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const said: string[] = []
    const broken: BrowserPlugin = {
      setup: () => {
        throw new Error('this third party exploded')
      },
      start: () => void said.push('the broken one started'),
    }
    const brokenDisposer: BrowserPlugin = {
      setup: () => () => {
        throw new Error('and this one will not let go')
      },
    }
    const good: BrowserPlugin = {
      setup: () => () => said.push('the good one let go'),
      start: () => void said.push('the good one started'),
    }
    const stop = startBrowserPlugins([broken, brokenDisposer, good], context)
    // it set nothing up, so it is not started either: it asked to exist and
    // did not manage to
    expect(said).toEqual(['the good one started'])
    stop()
    // and a disposer that throws does not strand the ones after it
    expect(said).toContain('the good one let go')
    expect(warned).toHaveBeenCalled()
    warned.mockRestore()
  })

  it('reports a start that rejects, and lets everything else run', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const said: string[] = []
    startBrowserPlugins(
      [
        { start: () => Promise.reject(new Error('the platform is down')) },
        { start: () => void said.push('the next one still started') },
      ],
      context,
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(said).toEqual(['the next one still started'])
    expect(warned).toHaveBeenCalled()
    warned.mockRestore()
  })
})
