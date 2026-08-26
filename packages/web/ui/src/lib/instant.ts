// The line between an instant and a wall clock.
//
// The product stores an INSTANT - one moment on the world's timeline, written
// as an iso string - while a person picks a wall-clock time: the hour they
// see on their own wall. The two are only the same thing if you know the
// offset, so every crossing between them happens here, in the open, rather
// than through whatever `new Date(string)` happens to do with a given
// spelling.
//
// The date-only pickers do not come through here at all. `2026-08-27` is a
// calendar date and has no instant in it; turning it into one and back is how
// a date silently becomes the day before in half the world.

const pad = (part: number) => String(part).padStart(2, '0')

/** the widget's wall-clock spelling: YYYY-MM-DD HH:mm:ss */
export function instantToLocal(instant: string | null): string | null {
  if (instant === null || instant === '') return null
  const at = new Date(instant)
  if (Number.isNaN(at.getTime())) return null
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${day} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * The way back: read the parts by hand and build the date from them.
 *
 * `new Date('2026-08-27 09:30:00')` is not iso, so what it means is left to
 * the engine; the numeric constructor is defined to read its arguments as
 * local time, which is exactly what the person typed.
 */
export function localToInstant(local: string | null): string | null {
  if (local === null || local === '') return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim())
  if (parts === null) return null
  const [, year, month, day, hour, minute, second] = parts
  const at = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second === undefined ? 0 : Number(second),
    0,
  )
  if (Number.isNaN(at.getTime())) return null
  return at.toISOString()
}
