// oxlint-disable-next-line typescript/triple-slash-reference -- Ambient CSS declarations must follow workspace source consumers without a runtime import.
/// <reference path="../styles/assets.d.ts" />
import 'react-photo-view/dist/react-photo-view.css'

// The viewer and its stylesheet enter the graph together. This re-export
// module is marked as a side effect in package.json so bundlers keep the CSS.
export { PhotoProvider, PhotoView } from 'react-photo-view'
