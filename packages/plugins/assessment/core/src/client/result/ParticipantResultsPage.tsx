import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { usePageQueryState, usePageQueryUpdate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Drill, type DrillMove } from '@qualy/ui/reveal'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { RosterNeighbors } from '../roster/RosterNeighbors.tsx'
import { rosterPageAddress, useRosterView } from '../roster/roster-view.ts'
import { ParticipantResultList } from './ParticipantResultList.tsx'
import { ParticipantResultDetail } from './ParticipantResultDetail.tsx'

// Checking one person's account: who took part, and what this round has
// decided about them.
//
// One page, not two. Opening a participant is a level down inside this
// screen - the list it was opened from is the same page, and going back
// lands on the row that was pressed - so the content travels sideways and
// says so, the rail stays on this section, and the browser's own back button
// is the way out. Which person is open lives in the address, and so does
// where the reader was in the list (roster-view): a reload and a shared link
// both land where the reader was, and an open account can walk to the
// person before or after it in the list it was opened from.
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
})

export default function ParticipantResultsPage() {
  const { format } = useI18n()
  // The address holds who is open and which half of their account is
  // showing. Choosing a person is somewhere to come back to; switching tabs
  // inside one account is not - nobody presses back expecting to be put on
  // the other tab.
  const [participantId] = usePageQueryState('participant', '', { history: 'push' })
  const [view] = usePageQueryState('view', '', { history: 'replace' })
  const [entryId] = usePageQueryState('entry', '', { history: 'push' })
  const [roster, moveRoster] = useRosterView()
  // Every press here moves more than one key - opening a person clears the
  // tab and the open claim, following a number opens the claim AND the half
  // it lives on - and the router's updater reads the location the component
  // rendered with. Two writes from one press would race, and the second
  // would silently drop the first.
  const address = usePageQueryUpdate()
  // which way the screen last moved, worked out from where it was rather
  // than recorded at each press: back and forward deserve the same direction
  // as the buttons that do the same thing
  const [seen, setSeen] = useState(participantId)
  const move: DrillMove = seen === participantId ? 'none' : participantId === '' ? 'out' : 'in'
  if (seen !== participantId) setSeen(participantId)

  return (
    <BatchScreen
      title={format(m.participantResultsTab)}
      description={format(m.participantResultsHint)}
      // an open account speaks through the band at the top, the way an open
      // question does on the questions page
      banner={participantId === '' ? 'section' : 'open'}
    >
      {(batch) => (
        <Drill
          move={move}
          drillKey={participantId === '' ? 'list' : `one:${participantId}`}
          className={stylex.props(styles.grow).className}
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
              // the claims unless the address asks for the total
              view={view === 'score' ? 'score' : 'entries'}
              entryId={entryId}
              aside={
                <RosterNeighbors
                  batchId={batch.id}
                  participantId={participantId}
                  view={roster}
                  // Walking to the next person keeps the half and the
                  // question being read, so one question can be read down
                  // the list; the claim open in the drawer was this
                  // person's. The list's page follows whoever is open, so
                  // going back lands on their row.
                  onOpen={(id, page) =>
                    address(
                      { participant: id, entry: '', ...rosterPageAddress(page) },
                      { history: 'push' },
                    )
                  }
                />
              }
              onView={(next) => address({ view: next === 'entries' ? '' : next })}
              onEntry={(id) => address({ entry: id }, { history: 'push' })}
              // a number leads to the claim behind it: the tab, its question
              // and the claim are one move, so they are one write
              onFollow={(id, itemId) =>
                address({ view: '', open: itemId ?? '', entry: id }, { history: 'push' })
              }
              onItem={(itemId) =>
                address({ view: '', open: itemId, entry: '' }, { history: 'push' })
              }
              onBack={() => address({ participant: '', view: '', entry: '', open: '' })}
            />
          )}
        </Drill>
      )}
    </BatchScreen>
  )
}
