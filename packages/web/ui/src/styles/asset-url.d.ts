// What a bundler hands back for an asset imported for its address: the
// address. Declared here rather than by pulling the bundler's client types
// into a package that is not tied to one.
declare module '*?url' {
  const url: string
  export default url
}

declare module '*.css?inline' {
  const css: string
  export default css
}
