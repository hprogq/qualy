import { describe, expect, it } from 'vitest'
import { LIVE_PONG, LIVE_SUBPROTOCOL } from '@qualy/api-kit/live-socket'
import { LiveChannels, type LiveChannelState, type LiveTiming } from '../src/live-channel.ts'
import { fakeLiveServer, type FakeLiveSocket } from '../src/testkit/live.ts'

// One tab's live channels against a scripted server: how many sockets a tab
// opens for how many screens, how long one outlives the last screen, and
// what the tab does about every way a connection ends. The waits are the
// channel's own, shortened.

const timing: Partial<LiveTiming> = {
  openTimeout: 500,
  answer: 200,
  steady: 300,
  watch: 20,
  silence: 1_000,
  grace: 60,
  renewSpread: 10,
  retry: { floor: 40, cap: 200 },
  quota: { floor: 80, cap: 400 },
}

const PATH = '/api/assessment/batches/b1/events'
const OTHER = '/api/assessment/batches/b2/events'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const until = async (predicate: () => boolean, ms = 2_000) => {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('the condition never held')
    await sleep(5)
  }
}

/** a holder that keeps everything it is told */
const listener = () => {
  const states: LiveChannelState[] = []
  const kinds: string[] = []
  return {
    states,
    kinds,
    holder: {
      onMessage: (kind: string) => kinds.push(kind),
      onState: (s: LiveChannelState) => states.push(s),
    },
    now: () => states.at(-1),
  }
}

/** a server that opens every socket and says sync */
const welcoming = (socket: FakeLiveSocket) => {
  socket.accept()
  socket.send('sync')
}

const channelsOn = (
  script: (socket: FakeLiveSocket, index: number) => void,
  options: ConstructorParameters<typeof LiveChannels>[0] = {},
) => {
  let opened = 0
  const server = fakeLiveServer((socket) => script(socket, opened++))
  const channels = new LiveChannels({
    webSocket: server.webSocket,
    base: () => 'https://qualy.test/assessment',
    timing,
    ...options,
  })
  return { server, channels }
}

describe('a tab holding a batch open', () => {
  it('opens one connection for every screen of the batch, and lets it go after a grace', async () => {
    const { server, channels } = channelsOn(welcoming)
    const first = listener()
    const second = listener()
    const releaseFirst = channels.hold('user:a', PATH, first.holder)
    const releaseSecond = channels.hold('user:a', PATH, second.holder)
    await until(() => first.now()?.live === true && second.now()?.live === true)
    expect(server.sockets).toHaveLength(1)

    releaseFirst()
    releaseSecond()
    // still open inside the grace, gone after it
    expect(server.sockets[0]!.closedWith).toBeUndefined()
    await until(() => server.sockets[0]!.closedWith === 1000)
    expect(channels.size()).toBe(0)
  })

  it('keeps the connection for a screen that comes back inside the grace', async () => {
    const { server, channels } = channelsOn(welcoming)
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => screen.now()?.live === true)
    // a strict-mode remount: let go, and held again at once
    release()
    const again = listener()
    const releaseAgain = channels.hold('user:a', PATH, again.holder)
    expect(again.now()?.live).toBe(true)
    await sleep(150)
    expect(server.sockets).toHaveLength(1)
    expect(server.sockets[0]!.open).toBe(true)
    releaseAgain()
  })

  it('lets go once, however many times the release is called', async () => {
    const { server, channels } = channelsOn(welcoming)
    const first = listener()
    const second = listener()
    const release = channels.hold('user:a', PATH, first.holder)
    const releaseSecond = channels.hold('user:a', PATH, second.holder)
    await until(() => second.now()?.live === true)
    release()
    release()
    await sleep(150)
    // the second screen still holds it
    expect(server.sockets[0]!.open).toBe(true)
    releaseSecond()
    await until(() => server.sockets[0]!.closedWith === 1000)
  })

  it('says nothing for a connection let go of before it opened', async () => {
    const { server, channels } = channelsOn((socket) => {
      setTimeout(() => welcoming(socket), 100)
    })
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    release()
    const told = screen.states.length
    await sleep(300)
    // the screen heard its first state and nothing from the connection after
    expect(screen.states).toHaveLength(told)
    expect(screen.kinds).toEqual([])
    expect(server.sockets[0]!.closedWith).toBe(1000)
    expect(channels.size()).toBe(0)
  })

  it('opens one connection per batch, never one for two', async () => {
    const { server, channels } = channelsOn(welcoming)
    const one = listener()
    const two = listener()
    const releaseOne = channels.hold('user:a', PATH, one.holder)
    const releaseTwo = channels.hold('user:a', OTHER, two.holder)
    await until(() => one.now()?.live === true && two.now()?.live === true)
    expect(server.sockets.map((socket) => socket.url.pathname).sort()).toEqual([PATH, OTHER].sort())
    releaseOne()
    releaseTwo()
  })

  it('never lends one identity’s connection to the next, and lets the last one’s go at once', async () => {
    const { server, channels } = channelsOn(welcoming, { timing: { ...timing, grace: 5_000 } })
    const before = listener()
    channels.hold('user:a', PATH, before.holder)
    await until(() => before.now()?.live === true)
    const after = listener()
    const release = channels.hold('user:b', PATH, after.holder)
    // not at the end of a five-second grace: now
    await until(() => server.sockets[0]!.closedWith === 1000, 500)
    await until(() => after.now()?.live === true)
    expect(server.sockets).toHaveLength(2)
    release()
    channels.dispose()
  })

  it('dials the socket address with who the page is, and the channel’s subprotocol', async () => {
    const { server, channels } = channelsOn(welcoming, {
      clientIdentity: { releaseId: 'web-r1', clientProtocol: 4 },
    })
    const release = channels.hold('user:a', PATH, listener().holder)
    await until(() => server.sockets.length === 1)
    const socket = server.sockets[0]!
    expect(socket.url.protocol).toBe('wss:')
    expect(socket.url.host).toBe('qualy.test')
    expect(socket.url.pathname).toBe(PATH)
    expect(Object.fromEntries(socket.url.searchParams)).toEqual({
      protocol: '4',
      release: 'web-r1',
    })
    expect(socket.protocols).toEqual([LIVE_SUBPROTOCOL])
    release()
  })
})

describe('how a tab answers the end of a connection', () => {
  it('renews at once, re-reads, and never says the line was lost', async () => {
    const { server, channels } = channelsOn((socket, index) => {
      welcoming(socket)
      if (index === 0) setTimeout(() => socket.close(4000, 'renew'), 60)
    })
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => server.sockets.length === 2 && screen.kinds.length === 2)
    expect(screen.kinds).toEqual(['sync', 'sync'])
    expect(screen.states.some((state) => state.lost)).toBe(false)
    release()
  })

  it('says a line that dropped before it proved steady is lost, and comes back to read again', async () => {
    const { server, channels } = channelsOn((socket, index) => {
      welcoming(socket)
      if (index === 0) setTimeout(() => socket.close(1006), 30)
    })
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => screen.states.some((state) => state.lost))
    await until(() => screen.now()?.live === true && server.sockets.length === 2)
    expect(screen.now()).toEqual({ live: true, lost: false, heard: true, waiting: false })
    expect(screen.kinds).toEqual(['sync', 'sync'])
    release()
  })

  it('does not call the end of a steady connection lost when the next dial answers', async () => {
    const { server, channels } = channelsOn((socket, index) => {
      welcoming(socket)
      // past the 300ms a connection needs to prove steady
      if (index === 0) setTimeout(() => socket.close(1006), 350)
    })
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => server.sockets.length === 2 && screen.kinds.length === 2)
    expect(screen.states.some((state) => state.lost)).toBe(false)
    release()
  })

  it('calls a steady connection lost when the dial after it goes unanswered', async () => {
    const { channels } = channelsOn((socket, index) => {
      if (index === 0) {
        welcoming(socket)
        setTimeout(() => socket.close(1006), 350)
      }
      // the next one never opens
    })
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => screen.now()?.live === true)
    await until(() => screen.now()?.lost === true, 2_000)
    // still a line that was heard: the screen says reconnecting
    expect(screen.now()?.heard).toBe(true)
    release()
  })

  it('does not count a channel that never answered as heard', async () => {
    const { channels } = channelsOn(() => undefined)
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => screen.now()?.lost === true)
    expect(screen.now()).toEqual({ live: false, lost: true, heard: false, waiting: false })
    release()
  })

  it('backs away further from a server that keeps dropping it', async () => {
    const opened: number[] = []
    const { channels } = channelsOn(
      (socket) => {
        opened.push(Date.now())
        socket.accept()
        setTimeout(() => socket.close(1006), 0)
      },
      { random: () => 1 },
    )
    const release = channels.hold('user:a', PATH, listener().holder)
    await until(() => opened.length >= 5)
    release()
    const gaps = opened.slice(1).map((at, index) => at - opened[index]!)
    // 40, 80, 160, 200: each wait at least the last, up to the cap
    expect(gaps[1]!).toBeGreaterThan(gaps[0]!)
    expect(gaps[2]!).toBeGreaterThan(gaps[1]!)
    expect(Math.max(...gaps)).toBeLessThan(400)
  })

  it('waits for a seat while every one is taken, and comes back once one is free', async () => {
    const { server, channels } = channelsOn((socket, index) => {
      socket.accept()
      if (index < 3) setTimeout(() => socket.close(4429, 'session'), 0)
      else socket.send('sync')
    })
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => screen.now()?.waiting === true)
    expect(screen.now()?.live).toBe(false)
    await until(() => screen.now()?.live === true, 3_000)
    expect(screen.now()?.waiting).toBe(false)
    expect(server.sockets).toHaveLength(4)
    release()
  })

  it('stops saying it waits for a seat once what refuses it is the network', async () => {
    const { channels } = channelsOn((socket, index) => {
      if (index === 0) {
        socket.accept()
        setTimeout(() => socket.close(4429, 'capacity'), 0)
      } else {
        // the next dial never reaches anything
        setTimeout(() => socket.close(1006), 0)
      }
    })
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => screen.now()?.waiting === true)
    await until(() => screen.now()?.waiting === false, 2_000)
    expect(screen.now()).toMatchObject({ live: false, lost: true })
    release()
  })

  it('offers a seat it gave back to the channel of this tab waiting for one', async () => {
    let seatTaken = false
    const { server, channels } = channelsOn(
      (socket) => {
        socket.accept()
        if (socket.url.pathname === PATH) {
          seatTaken = true
          socket.onClosed(() => (seatTaken = false))
          socket.send('sync')
        } else if (seatTaken) {
          setTimeout(() => socket.close(4429, 'session'), 0)
        } else {
          socket.send('sync')
        }
      },
      // a wait for a seat far longer than the test
      { timing: { ...timing, quota: { floor: 20_000, cap: 20_000 } } },
    )
    const holding = listener()
    const waiting = listener()
    const releaseHolding = channels.hold('user:a', PATH, holding.holder)
    await until(() => holding.now()?.live === true)
    const releaseWaiting = channels.hold('user:a', OTHER, waiting.holder)
    await until(() => waiting.now()?.waiting === true)
    releaseHolding()
    await until(() => waiting.now()?.live === true, 2_000)
    expect(server.sockets.filter((socket) => socket.url.pathname === OTHER)).toHaveLength(2)
    releaseWaiting()
  })

  it('does not bring tabs refused together back together', async () => {
    const dials: number[][] = []
    const tabs = Array.from({ length: 30 }, (_, tab) => {
      dials[tab] = []
      return channelsOn((socket, index) => {
        dials[tab]!.push(Date.now())
        socket.accept()
        if (index === 0) setTimeout(() => socket.close(4429, 'session'), 0)
        else socket.send('sync')
      })
    })
    const releases = tabs.map(({ channels }) => channels.hold('user:a', PATH, listener().holder))
    await until(() => dials.every((tab) => tab.length === 2), 3_000)
    const second = dials.map((tab) => tab[1]!)
    expect(Math.max(...second) - Math.min(...second)).toBeGreaterThan(15)
    for (const release of releases) release()
  })

  it('hands a session gone to the identity flow and dials no more', async () => {
    let lost = 0
    const { server, channels } = channelsOn(
      (socket) => {
        socket.accept()
        setTimeout(() => socket.close(4401, 'unauthenticated'), 0)
      },
      { onSessionLost: () => (lost += 1) },
    )
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => lost === 1)
    await sleep(300)
    expect(lost).toBe(1)
    expect(server.sockets).toHaveLength(1)
    expect(screen.now()).toEqual({ live: false, lost: false, heard: false, waiting: false })
    release()
  })

  it('stops dialling a batch it may not watch', async () => {
    const { server, channels } = channelsOn((socket) => {
      socket.accept()
      setTimeout(() => socket.close(4403, 'forbidden'), 0)
    })
    const release = channels.hold('user:a', PATH, listener().holder)
    await sleep(300)
    expect(server.sockets).toHaveLength(1)
    release()
  })

  it('tells the release coordinator why the server will not talk to the page', async () => {
    const reasons: string[] = []
    const { server, channels } = channelsOn(
      (socket) => {
        socket.accept()
        setTimeout(() => socket.close(4409, 'assembly'), 0)
      },
      { onClientUnsupported: (reason) => reasons.push(reason) },
    )
    const release = channels.hold('user:a', PATH, listener().holder)
    await until(() => reasons.length === 1)
    await sleep(200)
    expect(reasons).toEqual(['assembly'])
    expect(server.sockets).toHaveLength(1)
    release()
  })

  it('answers every heartbeat, and lets a server that went silent go', async () => {
    const { server, channels } = channelsOn(
      (socket, index) => {
        welcoming(socket)
        if (index === 0) socket.send('heartbeat')
      },
      { timing: { ...timing, silence: 150 } },
    )
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => server.sockets[0]!.received.includes(LIVE_PONG))
    // the heartbeat itself never reaches a screen
    expect(screen.kinds).toEqual(['sync'])
    // nothing more is said: past the silence the page closes and dials again
    await until(() => server.sockets.length === 2, 2_000)
    expect(server.sockets[0]!.closedWith).toBe(1000)
    release()
  })

  it('takes a frame that is not a word of the protocol as a broken connection', async () => {
    const { server, channels } = channelsOn((socket, index) => {
      welcoming(socket)
      if (index === 0) socket.sendRaw('not json')
    })
    const screen = listener()
    const release = channels.hold('user:a', PATH, screen.holder)
    await until(() => server.sockets.length === 2)
    expect(server.sockets[0]!.closedWith).toBe(1000)
    expect(screen.kinds).not.toContain('not json')
    release()
  })
})
