/**
 * The formula ABI: the contract between a published artifact and the host —
 * entrypoint names, the result envelope, the decode/encode representation.
 * A published version records this number; it moves only when that protocol
 * changes shape, never for an ordinary SDK edit (artifact drift is what the
 * runtime hash is for).
 */

export const FORMULA_ABI_VERSION = 1
