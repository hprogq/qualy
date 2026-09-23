/**
 * A device as a person recognises their own: the browser and the system,
 * read off the user agent a session or a sign-in was recorded with.
 *
 * Names only, and only the ones worth telling apart on a list of one's own
 * devices; anything else is left for the caller to call unknown. Order
 * matters: every Chromium browser also says Chrome, and every browser on
 * iOS also says Safari.
 */
export interface Device {
  readonly browser: string | null
  readonly system: string | null
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/MicroMessenger/i, 'WeChat'],
  [/DingTalk/i, 'DingTalk'],
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/HarmonyOS/i, 'HarmonyOS'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
]

const first = (patterns: readonly (readonly [RegExp, string])[], agent: string) =>
  patterns.find(([pattern]) => pattern.test(agent))?.[1] ?? null

export const deviceOf = (userAgent: string | null): Device =>
  userAgent === null
    ? { browser: null, system: null }
    : { browser: first(BROWSERS, userAgent), system: first(SYSTEMS, userAgent) }

/** "Chrome - macOS", or whichever half is known; null when neither is */
export const deviceWords = (userAgent: string | null): string | null => {
  const { browser, system } = deviceOf(userAgent)
  const words = [browser, system].filter((word): word is string => word !== null)
  return words.length === 0 ? null : words.join(' - ')
}
