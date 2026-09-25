import { describe, expect, it } from 'vitest'
import { Plugin } from '@qualy/plugin-kit'
import { UiSurfaceDeclarations } from '@qualy/plugin-ui-registry/plugin'
import { AUTHENTICATED, orgNodePickerView, peoplePickerView } from '@qualy/ui-contract'
import auth from '../src/index.ts'

// The drawings a screen fills with its own authorized population ask for no
// permission of their own: a screen that proved its list and then found the
// drawing withheld for want of the directory's read permission drew nothing
// at all - a blank column where a round's unit tree should have been.

const slots = Plugin.contributionsOf(auth, UiSurfaceDeclarations).flatMap(
  (surfaces) => surfaces.slots ?? [],
)

describe('the pickers a caller fills itself', () => {
  it('are drawn for anyone signed in', () => {
    for (const key of [orgNodePickerView.key, peoplePickerView.key]) {
      const declared = slots.filter((slot) => slot.key === key)
      expect(declared).toHaveLength(1)
      expect(declared[0]!.visibility).toEqual(AUTHENTICATED)
    }
  })
})
