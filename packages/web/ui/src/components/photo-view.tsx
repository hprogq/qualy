// Looking at a picture full size without leaving the page.
//
// The stylesheet the viewer needs is pulled in by `theme.css` rather than
// from here: a `.css` import inside a `.tsx` is invisible to the compiler
// this package is typechecked with, and the theme is already where this
// product collects the stylesheets it did not write.
export { PhotoProvider, PhotoView } from 'react-photo-view'
