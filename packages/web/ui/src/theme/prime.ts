import { QualyPreset } from './qualy-preset.ts'

// The theme configuration the app hands to PrimeReactProvider. Dark mode is
// owned by the existing ThemeProvider, which toggles .dark on the document
// root; PrimeReact only follows that class and never grows its own state.
export const qualyPrimeTheme = {
  preset: QualyPreset,
  options: {
    darkModeSelector: '.dark',
  },
}
