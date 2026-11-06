import latin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'

// Where the face the interface is set in lives, for a document to ask for it
// before its stylesheet does (docs/adr/0012-rsc-data-mode.md).
//
// The theme loads Inter with font-display: swap, so text first set in the
// fallback moves when Inter arrives: a line of digits shifts sideways. A page
// that drew itself in script hid that behind its loading screen; a page a
// server drew is read from its first frame, so the face is asked for with
// the html instead of after the stylesheet has been read and laid out. Only
// the latin file: the text that is not latin is set in the system's face.
export const primaryFontLatin: string = latin
