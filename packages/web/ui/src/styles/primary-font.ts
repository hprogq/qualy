import latin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'
import faces from './primary-font.css?inline'

// Declare faces in the document head and request Latin early. Optional display
// uses Inter when it arrives before first paint, otherwise preserves the system
// face for this document instead of moving text after it has become readable.
export const primaryFontLatin: string = latin
/** Declare faces once, before streamed body content or development CSS replacement. */
export const primaryFontFaces: string = faces
