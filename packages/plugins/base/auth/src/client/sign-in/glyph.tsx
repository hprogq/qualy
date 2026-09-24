import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  GithubIcon,
  GitlabIcon,
  GlobeIcon,
  IdCardIcon,
  KeyRoundIcon,
  LandmarkIcon,
  MailIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { useIconSurface, type IconSurface } from './surface.ts'
import type { BuiltinLoginIcon } from '@qualy/auth-contract/login-icons'
import type { LoginMethodIcon } from '@qualy/auth-contract/login'
import { authUrls } from '../api.ts'
import { authMessages as m } from '../i18n.ts'

// How a way in is drawn wherever it appears: on the sign-in page, and on the
// screens that set it up. One drawing per key, owned by the browser; an
// uploaded image by its version; and a door with neither by the first letter
// of its name, so no door is ever a blank square.
//
// Every drawing has a version for a light surface and one for a dark one,
// chosen by the ground it actually stands on - not by the page's theme: a
// light page's recommended button is dark, and a dark page's is light. The
// outlined icons take the text colour and need nothing more; a mark in the
// brand's own colour keeps it where it reads on both grounds, and changes
// where it does not.

const OUTLINED: Partial<Record<BuiltinLoginIcon, LucideIcon>> = {
  campus: LandmarkIcon,
  key: KeyRoundIcon,
  mail: MailIcon,
  'id-card': IdCardIcon,
  shield: ShieldCheckIcon,
  globe: GlobeIcon,
  github: GithubIcon,
  gitlab: GitlabIcon,
}

/**
 * Marks drawn as a letter on the brand's own colour: a product's logo is its
 * owner's to draw, and a letter in the right colour is what reads as it at
 * fifty pixels without pretending to be it.
 */
/** a message this module formats, whichever one */
type Said = Parameters<ReturnType<typeof useI18n>['format']>[0]

interface Lettered {
  readonly letter: Said
  /** the tile and the letter on a light surface */
  readonly onLight: { readonly tile: string; readonly ink: string }
  /** and on a dark one, where the brand's colour would sink into it */
  readonly onDark: { readonly tile: string; readonly ink: string }
}

/** a brand colour that reads on either ground stays itself on both */
const both = (tile: string) => ({ onLight: { tile, ink: '#fff' }, onDark: { tile, ink: '#fff' } })

const LETTERED: Partial<Record<BuiltinLoginIcon, Lettered>> = {
  google: { letter: m.iconLetterGoogle, ...both('#4285F4') },
  // near-black on light; on dark the mark turns over, as Apple's own does
  apple: {
    letter: m.iconLetterApple,
    onLight: { tile: '#1d1d1f', ink: '#fff' },
    onDark: { tile: '#f5f5f7', ink: '#1d1d1f' },
  },
  wechat: { letter: m.iconLetterWechat, ...both('#07C160') },
  wecom: { letter: m.iconLetterWecom, ...both('#0082EF') },
  dingtalk: { letter: m.iconLetterDingtalk, ...both('#3296FA') },
  feishu: { letter: m.iconLetterFeishu, ...both('#3370FF') },
  qq: { letter: m.iconLetterQq, ...both('#12B7F5') },
}

const styles = stylex.create({
  glyph: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  picture: { display: 'block', objectFit: 'contain' },
  letter: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    fontWeight: 650,
    letterSpacing: '-0.01em',
  },
  initial: { fontWeight: 600, letterSpacing: '-0.01em' },
  squares: { display: 'grid', gridTemplateColumns: '1fr 1fr' },
})

/** the four squares, drawn in their own colours at any size */
function Squares({ size }: { size: number }) {
  const cell = Math.round(size * 0.42)
  const gap = Math.max(1, Math.round(size * 0.07))
  return (
    <span aria-hidden {...stylex.props(styles.squares)} style={{ gap }}>
      {['#F25022', '#7FBA00', '#00A4EF', '#FFB900'].map((color) => (
        <span key={color} style={{ width: cell, height: cell, backgroundColor: color }} />
      ))}
    </span>
  )
}

/** what one door looks like, at a given size in pixels */
export function LoginMethodGlyph({
  code,
  name,
  icon,
  size = 20,
  tone = 'plain',
  surface: given,
}: {
  code: string
  name: string
  icon: LoginMethodIcon
  size?: number
  /** on the page's own ground, or on its inverse (a filled button) */
  tone?: 'plain' | 'inverse'
  /** the ground, when the caller draws it itself - a preview of either */
  surface?: IconSurface
}) {
  const { format } = useI18n()
  const derived = useIconSurface(tone)
  const surface = given ?? derived
  // an image that will not load is drawn by its initial instead
  const [broken, setBroken] = useState<string | null>(null)
  const initial = (
    <span {...stylex.props(styles.initial)} style={{ fontSize: Math.round(size * 0.72) }}>
      {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
    </span>
  )
  // the image for a dark ground where the tenant gave one, else the only one
  const dark = icon?.kind === 'image' && surface === 'dark' && icon.onDark !== null
  const version = icon?.kind === 'image' ? (dark ? icon.onDark : icon.version) : undefined
  const body = (() => {
    if (icon === null) return initial
    if (icon.kind === 'image') {
      if (version === undefined || broken === version) return initial
      return (
        <img
          alt=""
          width={size}
          height={size}
          draggable={false}
          src={authUrls.loginIcon.getLoginMethodIcon({
            params: { providerCode: code },
            query: dark ? { v: version, surface: 'dark' } : { v: version },
          })}
          onError={() => setBroken(version)}
          {...stylex.props(styles.picture)}
        />
      )
    }
    const Outlined = OUTLINED[icon.key]
    if (Outlined !== undefined) return <Outlined size={size} strokeWidth={1.8} aria-hidden />
    if (icon.key === 'microsoft') return <Squares size={size} />
    const lettered = LETTERED[icon.key]
    if (lettered === undefined) return initial
    const said = format(lettered.letter)
    const paint = surface === 'dark' ? lettered.onDark : lettered.onLight
    return (
      <span
        aria-hidden
        {...stylex.props(styles.letter)}
        style={{
          width: size,
          height: size,
          backgroundColor: paint.tile,
          color: paint.ink,
          fontSize: Math.round(size * (Array.from(said).length > 1 ? 0.46 : 0.6)),
        }}
      >
        {said}
      </span>
    )
  })()
  return (
    <span
      aria-hidden
      data-icon={icon === null ? 'initial' : icon.kind === 'image' ? 'image' : icon.key}
      data-surface={surface}
      data-version={version}
      {...stylex.props(styles.glyph)}
      style={{ width: size, height: size }}
    >
      {body}
    </span>
  )
}
