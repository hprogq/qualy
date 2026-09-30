import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

// the messages the server names over the wire, by the id it sends
export const wireMessages: Record<string, Message> = {
  'ping/navigation/ping': m.navigation_ping,
}
