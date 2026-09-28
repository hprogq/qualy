import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { usePageQueryState, usePageQueryUpdate, useScreenAsideOffered } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import type { BatchDto } from '../phase/model.ts'
import { RosterNeighbors } from '../roster/RosterNeighbors.tsx'
import { RosterWalkList } from '../roster/RosterWalkList.tsx'
import { rosterPageAddress, useRosterView } from '../roster/roster-view.ts'
import { useRosterWalk } from '../roster/roster-walk.ts'
import { ParticipantResultList } from './ParticipantResultList.tsx'
import { ParticipantResultDetail } from './ParticipantResultDetail.tsx'

// Checking one person's account: who took part, and what this round has
// decided about them.
//
// One page, not two. Opening a participant is a level down inside this
// screen - the list it was opened from is the same page, and going back
// lands on the row that was pressed - so the content travels sideways and
// says so, the rail gives its column to the person for as long as they are
// open, and the browser's own back button is the way out. Which person is open lives in the address, and so does
// where the reader was in the list (roster-view): a reload and a shared link
// both land where the reader was, and an open account can walk to the
// person before or after it in the list it was opened from.
//
// Walking from one person to the next is not a level: the account stays
// where it is, the list beside it scrolls the next one to its middle, and
// only the work changes, stepping up or down the way the list went.
//
// It is a reading surface, not a fourth workbench. Everything it shows is
// already somewhere: the roster says who, the claims say what was filed, the
// determinations say what was decided, and the ledger says what that came
// to. What was missing was one place that holds all four for one person -
// and a way from a number back to the filing that earned it.

const styles = stylex.create({
  grow: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // An open account fills the room below the shell and scrolls inside its
  // own columns, as the participant's own page does. Every box on the way
  // down says it may be shorter than what it holds; without this one the
  // whole workspace took the height of its tree, and the page scrolled
  // behind it. The list stays a page that scrolls as a whole.
  bounded: { minHeight: 0 },
})

export default function ParticipantResultsPage() {
  const { format } = useI18n()
  const [participantId] = usePageQueryState('participant', '', { history: 'push' })
  return (
    <BatchScreen
      title={format(m.participantResultsTab)}
      // A data-dense page takes the whole content area: the list says its
      // own name in a line over it, and an open account stands who it is
      // beside the work, in the column the rail gives up for it.
      chrome={participantId === '' ? 'bare' : 'none'}
      requires="results"
    >
      {(batch) => <Results batch={batch} participantId={participantId} />}
    </BatchScreen>
  )
}

function Results({ batch, participantId }: { batch: BatchDto; participantId: string }) {
  // The address holds who is open and which half of their account is
  // showing. Choosing a person is somewhere to come back to; switching tabs
  // inside one account is not - nobody presses back expecting to be put on
  // the other tab.
  const [view] = usePageQueryState('view', '', { history: 'replace' })
  const [entryId] = usePageQueryState('entry', '', { history: 'push' })
  const [roster, moveRoster] = useRosterView()
  // Every press here moves more than one key - opening a person clears the
  // tab and the open claim, following a number opens the claim AND the half
  // it lives on - and the router's updater reads the location the component
  // rendered with. Two writes from one press would race, and the second
  // would silently drop the first.
  const address = usePageQueryUpdate()
  const beside = useScreenAsideOffered()
  const walk = useRosterWalk({
    batchId: batch.id,
    participantId,
    view: roster,
    onPage: (page) => address(rosterPageAddress(page)),
  })

  // Which way the screen last moved, worked out from where it was rather
  // than recorded at each press: back and forward deserve the same
  // direction as the buttons that do the same thing. Kept with the person
  // it was worked out for, since the render that notices the change is
  // thrown away and drawn again.
  const [moved, setMoved] = useState<{ id: string; level: DrillMove; step: DrillMove }>({
    id: participantId,
    level: 'none',
    step: 'none',
  })
  let { level, step } = moved
  if (moved.id !== participantId) {
    const from = walk.rows.findIndex((row) => row.id === moved.id)
    const to = walk.rows.findIndex((row) => row.id === participantId)
    level = moved.id === '' ? 'in' : participantId === '' ? 'out' : 'none'
    step = from < 0 || to < 0 ? 'none' : to > from ? 'next' : 'previous'
    setMoved({ id: participantId, level, step })
  }

  // Walking to another person keeps the half and the question being read,
  // so one question can be read down the list; the claim open in the drawer
  // was this person's. The list's page follows whoever is open, so going
  // back lands on their row.
  const walkTo = (id: string, page: number) =>
    address({ participant: id, entry: '', ...rosterPageAddress(page) }, { history: 'push' })
  const list = (seat: 'column' | 'sheet', picked?: () => void) => (
    <RosterWalkList
      batchId={batch.id}
      participantId={participantId}
      walk={walk}
      view={roster}
      onView={moveRoster}
      onOpen={(id, page) => {
        picked?.()
        walkTo(id, page)
      }}
      seat={seat}
    />
  )

  return (
    <Drill
      move={level}
      drillKey={participantId === '' ? 'list' : 'one'}
      className={stylex.props(styles.grow, participantId !== '' && styles.bounded).className}
    >
      {participantId === '' ? (
        <ParticipantResultList
          batchId={batch.id}
          manageable={batch.manageable}
          view={roster}
          onView={moveRoster}
          // somebody opened from the list starts on their claims, at the
          // question the workspace lands on
          onOpen={(id) =>
            address({ participant: id, view: '', entry: '', open: '' }, { history: 'push' })
          }
        />
      ) : (
        <ParticipantResultDetail
          batchId={batch.id}
          manageable={batch.manageable}
          writable={batch.status !== 'archived'}
          mayRecord={batch.capabilities.record}
          participantId={participantId}
          step={step}
          // the claims unless the address asks for the total
          view={view === 'score' ? 'score' : 'entries'}
          entryId={entryId}
          neighbors={
            <RosterNeighbors
              walk={walk}
              onOpen={walkTo}
              // with a column of its own the list stands in it; without,
              // where this person stands opens it
              {...(beside ? {} : { list: (close: () => void) => list('sheet', close) })}
            />
          }
          roster={beside ? list('column') : undefined}
          listed={walk.here}
          onListMoved={walk.refresh}
          onView={(next) => address({ view: next === 'entries' ? '' : next })}
          onEntry={(id) => address({ entry: id }, { history: 'push' })}
          // a number leads to the claim behind it: the tab, its question
          // and the claim are one move, so they are one write
          onFollow={(id, itemId) =>
            address({ view: '', open: itemId ?? '', entry: id }, { history: 'push' })
          }
          onItem={(itemId) => address({ view: '', open: itemId, entry: '' }, { history: 'push' })}
          onBack={() => address({ participant: '', view: '', entry: '', open: '' })}
        />
      )}
    </Drill>
  )
}
