/** Immutable preset identity: changing its behavior requires a new name. */
export const THUMBNAIL_PRESET = 'thumbnail-v1'

/** Raster inputs supported by this first thumbnail preset; other files stay original. */
export const THUMBNAIL_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

/** Only the verified preset selects these options; no client parameter reaches eo.image. */
export const THUMBNAIL_IMAGE = Object.freeze({
  width: 640,
  height: 640,
  fit: 'contain',
  format: 'webp',
  quality: 82,
  stripExif: true,
  // EO may return the original format and dimensions. Response metadata must
  // describe what actually arrived, not what this preset asked it to produce.
  avoidSizeIncrease: true,
} as const)
