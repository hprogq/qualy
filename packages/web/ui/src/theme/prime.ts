import { QualyPreset } from './qualy-preset.ts'

// The theme configuration the app hands to PrimeReactProvider. Dark mode is
// owned by the existing ThemeProvider, which toggles .dark on the document
// root; PrimeReact only follows that class and never grows its own state.
export const qualyPrimeTheme = {
  preset: QualyPreset,
  options: {
    darkModeSelector: '.dark',
    // Prime's runtime-injected CSS joins the `primereact` cascade layer,
    // pinned between Tailwind's base and utilities. The full order rides
    // here because Prime injects its layer declaration at the very top of
    // <head>, ahead of the compiled stylesheet - whoever declares first
    // fixes the order, so the first declaration must state all of it.
    // Unlayered, Prime would outrank every layered rule on the page
    // (including a caller's own utility classes on a widget); declared
    // alone, it would sink below Tailwind's preflight, which strips button
    // backgrounds. Both happened; app.css carries the same order statement
    // for the production asset. StyleX layers append later and rank higher.
    cssLayer: {
      name: 'primereact',
      order: 'theme, base, primereact, components, utilities',
    },
  },
}
