import { describe, expect, it } from 'vitest'
import { forgetLocalDraft, readLocalDrafts } from '../src/client/local-draft.ts'

// Edits a browser kept before pages were told apart - one row per formula -
// are still somebody's unsaved work after the store is keyed by page, so
// the upgrade carries them over rather than starting the store empty.

const DATABASE = 'qualy-formula-local'
const FN_ID = '01920000-0000-7000-8000-0000000000c1'

/** the store as the first version of this browser's formula data left it */
const keptByTheFirstVersion = () =>
  new Promise<void>((resolve, reject) => {
    const removed = indexedDB.deleteDatabase(DATABASE)
    removed.onerror = () => reject(removed.error)
    removed.onsuccess = () => {
      const opened = indexedDB.open(DATABASE, 1)
      opened.onupgradeneeded = () => {
        const db = opened.result
        db.createObjectStore('drafts', { keyPath: 'functionId' }).put({
          functionId: FN_ID,
          name: '认定分值',
          source: 'const kept_before = 1\n',
          tests: [],
          baseRevision: 3,
          keptAt: 1_700_000_000_000,
        })
        const tries = db.createObjectStore('tryRecords', { keyPath: 'id' })
        tries.createIndex('byScopeAndTime', ['scopeKey', 'at'])
        tries.createIndex('byFunctionId', 'functionId')
      }
      opened.onerror = () => reject(opened.error)
      opened.onsuccess = () => {
        opened.result.close()
        resolve()
      }
    }
  })

describe("this browser's kept formula edits, across the upgrade", () => {
  it('carries a row the first version kept into the page-keyed store', async () => {
    await keptByTheFirstVersion()
    try {
      const kept = await readLocalDrafts(FN_ID)
      expect(kept.map((one) => one.source)).toEqual(['const kept_before = 1\n'])
      expect(kept[0]?.keptBy).toBe('an-earlier-visit')
    } finally {
      await forgetLocalDraft(FN_ID)
    }
  })
})
