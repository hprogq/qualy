import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  GlobeIcon,
  IdCardIcon,
  KeyRoundIcon,
  LandmarkIcon,
  MailIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import { useIconSurface, type IconSurface } from './surface.ts'
import { GithubIcon, GitlabIcon } from './brand-icons.ts'
import type { BuiltinLoginIcon } from '@qualy/auth-contract/login-icons'
import type { LoginMethodIcon } from '@qualy/auth-contract/login'
import { authUrls } from '../api.ts'
import type { Message } from '@qualy/i18n-contract'
import * as m from '#messages'
import { glyphRoot } from './glyph.stylex.ts'

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
  // the owners' own filled marks, not outlines (brand-icons.ts)
  github: GithubIcon,
  gitlab: GitlabIcon,
}

/**
 * Marks drawn as a letter on the brand's own colour: a product's logo is its
 * owner's to draw, and a letter in the right colour is what reads as it at
 * fifty pixels without pretending to be it.
 */
/** a message this module formats, whichever one */
interface Lettered {
  readonly letter: Message
  /** the tile and the letter on a light surface */
  readonly onLight: { readonly tile: string; readonly ink: string }
  /** and on a dark one, where the brand's colour would sink into it */
  readonly onDark: { readonly tile: string; readonly ink: string }
}

/** a brand colour that reads on either ground stays itself on both */
const both = (tile: string) => ({ onLight: { tile, ink: '#fff' }, onDark: { tile, ink: '#fff' } })

const LETTERED: Partial<Record<BuiltinLoginIcon, Lettered>> = {
  google: { letter: m.login_iconGoogle, ...both('#4285F4') },
  // near-black on light; on dark the mark turns over, as Apple's own does
  apple: {
    letter: m.login_iconApple,
    onLight: { tile: '#1d1d1f', ink: '#fff' },
    onDark: { tile: '#f5f5f7', ink: '#1d1d1f' },
  },
  wechat: { letter: m.login_iconWechat, ...both('#07C160') },
  wecom: { letter: m.login_iconWecom, ...both('#0082EF') },
  dingtalk: { letter: m.login_iconDingtalk, ...both('#3296FA') },
  feishu: { letter: m.login_iconFeishu, ...both('#3370FF') },
  qq: { letter: m.login_iconQq, ...both('#12B7F5') },
}

const shimmer = stylex.keyframes({
  '0%': { opacity: 0.12 },
  '50%': { opacity: 0.24 },
  '100%': { opacity: 0.12 },
})
const REDUCE = '@media (prefers-reduced-motion: reduce)'
const styles = stylex.create({
  glyph: {
    position: 'relative',
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
  picture: {
    display: 'block',
    objectFit: 'contain',
    visibility: {
      default: 'visible',
      [stylex.when.ancestor('[data-login-glyph-state="error"]', glyphRoot)]: 'hidden',
    },
  },
  placeholder: {
    position: 'absolute',
    inset: 0,
    borderRadius: 4,
    backgroundColor: 'currentColor',
    opacity: 0.12,
    pointerEvents: 'none',
    animationName: { default: shimmer, [REDUCE]: 'none' },
    animationDuration: '1.5s',
    animationIterationCount: 'infinite',
    display: {
      default: 'block',
      [stylex.when.ancestor('[data-login-glyph-state="loaded"]', glyphRoot)]: 'none',
      [stylex.when.ancestor('[data-login-glyph-state="error"]', glyphRoot)]: 'none',
    },
  },
  fallback: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    display: {
      default: 'none',
      [stylex.when.ancestor('[data-login-glyph-state="error"]', glyphRoot)]: 'flex',
    },
  },
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
  const derived = useIconSurface(tone)
  const surface = given ?? derived
  const [finished, setFinished] = useState<{ src: string; state: 'loaded' | 'error' } | null>(null)
  const image = useRef<HTMLImageElement | null>(null)
  const initial = (
    <span {...stylex.props(styles.initial)} style={{ fontSize: Math.round(size * 0.72) }}>
      {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
    </span>
  )
  // the image for a dark ground where the tenant gave one, else the only one
  const dark = icon?.kind === 'image' && surface === 'dark' && icon.onDark !== null
  const version = icon?.kind === 'image' ? (dark ? icon.onDark : icon.version) : undefined
  const src =
    version === undefined
      ? undefined
      : authUrls.loginIcon.getLoginMethodIcon({
          params: { providerCode: code },
          query: dark ? { v: version, surface: 'dark' } : { v: version },
        })
  const imageState = finished !== null && finished.src === src ? finished.state : 'pending'
  // The load or error event may have happened before React attached its
  // handlers. The bootstrap already paints it; adopt that fact on takeover.
  useEffect(() => {
    const current = image.current
    if (src !== undefined && current?.complete) {
      setFinished({ src, state: current.naturalWidth > 0 ? 'loaded' : 'error' })
    }
  }, [src])
  const body = (() => {
    if (icon === null) return initial
    if (icon.kind === 'image') {
      if (src === undefined) return initial
      return (
        <>
          <span aria-hidden data-login-glyph-placeholder="" {...stylex.props(styles.placeholder)} />
          <span aria-hidden {...stylex.props(styles.fallback)}>
            {initial}
          </span>
          <img
            key={src}
            ref={image}
            alt=""
            width={size}
            height={size}
            draggable={false}
            src={src}
            data-login-glyph-image=""
            onLoad={() => setFinished({ src, state: 'loaded' })}
            onError={() => setFinished({ src, state: 'error' })}
            {...stylex.props(styles.picture)}
          />
        </>
      )
    }
    const Outlined = OUTLINED[icon.key]
    if (Outlined !== undefined) return <Outlined size={size} strokeWidth={1.8} aria-hidden />
    if (icon.key === 'microsoft') return <Squares size={size} />
    const lettered = LETTERED[icon.key]
    if (lettered === undefined) return initial
    const said = lettered.letter()
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
      data-login-glyph-state={icon?.kind === 'image' && src !== undefined ? imageState : undefined}
      suppressHydrationWarning
      {...stylex.props(styles.glyph, glyphRoot)}
      style={{ width: size, height: size }}
    >
      {body}
    </span>
  )
}
