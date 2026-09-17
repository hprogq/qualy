import { lazy } from 'react'

// Monaco rides its own chunk: the list page, the app shell and even a formula
// page's first paint stay free of it - an editor arrives when its pane does.

export const LazyFormulaCodeEditor = lazy(() => import('./FormulaCodeEditor.tsx'))

export const LazyFormulaSourceViewer = lazy(() =>
  import('./FormulaCodeEditor.tsx').then((module) => ({ default: module.FormulaSourceViewer })),
)
