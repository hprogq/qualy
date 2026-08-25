// The shape every administration screen shares. Text-free like the rest of
// this package: every visible string arrives as a prop, so the primitives
// never need a locale and a plugin never needs to re-implement a panel.
//
// One public module (`@qualy/ui/admin`), split by migration unit: page
// structure, async states, form fields, overlays.
export { PageHeader, Panel } from './page.tsx'
export { AsyncSection, Feedback } from './async.tsx'
export { RequiredMark, Field, CheckboxGroup, RadioGroup, type CheckboxOption } from './field.tsx'
export { FormDialog, SidePanel, ConfirmDialog } from './dialog.tsx'
