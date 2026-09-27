import * as stylex from '@stylexjs/stylex'

// The record book's three tables, laid out by the width of their own card.
//
// The card is the container: beside an open workspace rail a 1024 window
// leaves the table 736 pixels, and a rule keyed to the window drew the desk
// layout into a card that had the room of a tablet's. Keyed to the card,
// the rail open or folded makes no difference to what a line looks like.
//
// Three bands. Narrow, a record is a stacked card. From there to a desk's
// width it is one line whose every column gives a share of what is left,
// the recorder's included, so the item never pays for a name's worth of
// air. At a desk the recorder's column stops at a name's width and the item
// keeps the rest; that is also where the record book finds the room to say
// how each record came in.
//
// The tables and the skeleton that stands in for them read the same
// templates from here, so the bones sit under the columns they wait for.
//
// The bands do not overlap: StyleX orders overlapping media queries so the
// last one wins, but not container queries.
export const recordColumns = stylex.defineConsts({
  stacked: '@container (max-width: 719.98px)',
  desk: '@container (min-width: 960px)',
  // name, number, item, standing, recorder, time, the chevron's seat
  entries: 'minmax(5rem, 0.8fr) 7rem minmax(0, 1.8fr) 5.5rem minmax(4rem, 0.7fr) 7.5rem 1rem',
  // and how it came in, after the item
  entriesDesk:
    'minmax(5rem, 0.8fr) 7rem minmax(0, 2.4fr) 5rem 5.5rem minmax(4rem, 7rem) 7.5rem 1rem',
  entriesStacked: 'minmax(0, 1fr) auto 1rem',
  // what an act recorded, how its people were found, what it comes to now,
  // who, when
  acts: 'minmax(0, 2fr) minmax(0, 1fr) 9rem minmax(4rem, 0.8fr) 7.5rem 1rem',
  actsDesk: 'minmax(0, 2fr) minmax(0, 1fr) 9rem minmax(4rem, 7rem) 7.5rem 1rem',
  // the file, what it filled, what it comes to now, who, when
  imports: 'minmax(0, 1.4fr) minmax(0, 1.6fr) 9rem minmax(4rem, 0.8fr) 7.5rem 1rem',
  importsDesk: 'minmax(0, 1.4fr) minmax(0, 1.6fr) 9rem minmax(4rem, 7rem) 7.5rem 1rem',
  historyStacked: 'minmax(0, 1fr) 1rem',
})
