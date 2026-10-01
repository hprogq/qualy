// These side-effect imports are stylesheet assets, not JavaScript modules.
// Vite resolves the concrete files; the declarations keep the UI package
// browser-host independent without adding all of vite/client's globals.
declare module '@mantine/dates/styles.layer.css'
declare module 'react-photo-view/dist/react-photo-view.css'
