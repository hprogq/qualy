/// <reference types="node" />
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SupportedLocale } from '@qualy/i18n-contract'

// The language of the document a server is rendering
// (docs/adr/0012-rsc-data-mode.md).
//
// In a browser the shell marks the root before the first frame, and every
// message reads that mark. A server renders many documents at once, each in
// its own language, so the language is held for the duration of one render
// instead: entered where the request is taken, and read by whatever runs
// inside it, however many awaits and streamed boundaries later.
//
// One store per module instance. The server component environment and the
// html renderer are two module graphs, each with its own copy of this module,
// so each enters its own scope with the locale it was handed; nothing is
// shared through a global to make the two look like one.

const store = new AsyncLocalStorage<SupportedLocale>()

/** the language of the document being rendered here, or nothing outside one */
export const documentLocale = (): SupportedLocale | undefined => store.getStore()

/** runs `render` as part of a document in `locale`, including everything it starts */
export const withDocumentLocale = <A>(locale: SupportedLocale, render: () => A): A =>
  store.run(locale, render)
