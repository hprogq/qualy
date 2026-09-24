import PersonCard from '../src/client/iam/PersonCard.tsx'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { Table, TableBody, TableCell, TableRow } from '@qualy/ui/table'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// A person's name in a table row.
//
// The card fetches nothing until somebody points at it, so what is worth
// pinning here is what it does to the row it sits in before anybody has.

const USER_ID = '88888888-8888-4888-8888-888888888888'

/** what a computed colour reads as when nothing is painted */
const BLANK = 'rgba(0, 0, 0, 0)'

describe('a person in a table row', () => {
  // The row tints when the control inside it is OPEN. It used to tint on the
  // control merely existing - the popover target carries aria-expanded at all
  // times, false included - so a table drew white and then went grey a beat
  // later, when the card's chunk landed and mounted a closed hover card in
  // every row.
  it('leaves the row unpainted while its card is shut', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        // never called: the card fetches only once somebody points at it,
        // and this case is about the row before anybody has
        identity: { getUser: () => Effect.never as never },
      }),
      children: (
        <Table>
          <TableBody>
            <TableRow data-testid="person-row">
              <TableCell>
                <PersonCard
                  context={{ userId: USER_ID, displayName: '王君惠', businessNo: '2023123457' }}
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      ),
    })

    const trigger = page.getByRole('button', { name: '王君惠', exact: false })
    await expect.element(trigger).toBeVisible()
    // the card is mounted and shut, which is the state the whole table is in
    // before anybody points at anything
    await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
    const row = page.getByTestId('person-row').element()
    // The row also tints under the pointer, and the pointer is wherever the
    // last test left it - over this row often enough that the assertion read
    // a hover tint, or the 150ms transition out of one, as the card's doing.
    // Move it away, then wait for the transition to finish before reading.
    await userEvent.unhover(row)
    await expect.poll(() => getComputedStyle(row).backgroundColor, { timeout: 2_000 }).toBe(BLANK)
  })
})
