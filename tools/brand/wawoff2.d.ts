// wawoff2 ships no types: Google's woff2 reference codec compiled to WASM,
// wrapped in two functions
declare module 'wawoff2' {
  const wawoff2: {
    compress(ttf: Uint8Array): Promise<Uint8Array>
    decompress(woff2: Uint8Array): Promise<Uint8Array>
  }
  export = wawoff2
}
