// Browser-suite twin of the <style> in the RSC HTML document: the tester page is
// vitest's own html, so the app's first-in-head layer-order declaration is
// re-created here before any test imports a stylesheet. A layer's position
// is fixed by its first declaration; whichever sheet arrives first would
// otherwise decide the cascade for the whole run. Keep in sync with
// src/rsc/html-document.tsx and src/app.css.
const order = document.createElement('style')
order.textContent =
  '@layer theme, base, mantine, components, priority1, priority2, priority3, priority4, priority5;'
document.head.prepend(order)

// Mantine reads the document's resolved scheme; the widget provider never
// writes it over a document's pre-paint value. The test document owns it too.
document.documentElement.dataset['mantineColorScheme'] = 'light'
