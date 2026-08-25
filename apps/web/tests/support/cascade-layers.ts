// Browser-suite twin of the <style> in index.html: the tester page is
// vitest's own html, so the app's first-in-head layer-order declaration is
// re-created here before any test imports a stylesheet. A layer's position
// is fixed by its first declaration; whichever sheet arrives first would
// otherwise decide the cascade for the whole run. Keep in sync with
// index.html and src/app.css.
const order = document.createElement('style')
order.textContent =
  '@layer theme, base, mantine, components, utilities, priority1, priority2, priority3, priority4, priority5;'
document.head.prepend(order)
