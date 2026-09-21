// The shape every administration screen shares: a band that names the page,
// and a body laid out in columns under it.
//
// The band spans the content area and is cut from the body by one rule. Under
// it the page is one shade off white, and what can be read or pressed sits on
// white cards: a table is one card, a strip of facts is one card, the panel a
// row opens into is cards again. The older furniture here - sections cut by
// a hairline, the bordered rail - is still what the person record and the
// import screens are built from.
//
// Sizes and spacing are the product's, not a mock's: a heading here is the
// same heading as on every other page, and a control is whatever the design
// system says a control is.
//
// One public module (`@qualy/ui/screen`), split by migration unit: the page
// shell, section furniture, tick lists, the rail, and the blank state.
export {
  BandAction,
  BandActions,
  BandBack,
  BandFootScope,
  Screen,
  Segmented,
  useBandFoot,
} from './shell.tsx'
export { SectionHead, Facts, DefRow, Barred, EditorHead, ModeChoice, SaveBar } from './sections.tsx'
export { PickGrid, PickList } from './pick.tsx'
export { Rail, RailRow, RailSkeleton, EditorSkeleton } from './rail.tsx'
export { Blank } from './blank.tsx'
export {
  Card,
  CardEmpty,
  CardFoot,
  CardHead,
  CardHint,
  Cell,
  DefLine,
  DefList,
  FactStrip,
  LeadWord,
  MetaLine,
  Spacer,
  Status,
  Table,
  TableHead,
  TableRow,
  TableSkeleton,
  Tag,
  Tick,
  TickGrid,
} from './surface.tsx'
export { DetailSheet, FootNote, UnsavedMark } from './panel.tsx'
export { TreeRow } from './tree.tsx'
export { SearchField } from './field.tsx'
export { ResizableSplit, StickyFill } from './layout.tsx'
