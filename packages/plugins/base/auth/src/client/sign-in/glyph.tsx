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
import type { BuiltinLoginIcon } from '@qualy/auth-contract/login-icons'
import type { LoginMethodIcon } from '@qualy/auth-contract/login'
import { authUrls } from '../api.ts'
import { authMessages as m } from '../i18n.ts'

// How a way in is drawn wherever it appears: on the sign-in page, and on the
// screens that set it up. One drawing per key, owned by the browser; an
// uploaded image by its version; and a door with neither by the first letter
// of its name, so no door is ever a blank square.

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

const LETTERED: Partial<Record<BuiltinLoginIcon, { color: string; letter: Said }>> = {
  google: { color: '#4285F4', letter: m.iconLetterGoogle },
  apple: { color: '#1d1d1f', letter: m.iconLetterApple },
  wechat: { color: '#07C160', letter: m.iconLetterWechat },
  wecom: { color: '#0082EF', letter: m.iconLetterWecom },
  dingtalk: { color: '#3296FA', letter: m.iconLetterDingtalk },
  feishu: { color: '#3370FF', letter: m.iconLetterFeishu },
  qq: { color: '#12B7F5', letter: m.iconLetterQq },
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
    color: '#fff',
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
}: {
  code: string
  name: string
  icon: LoginMethodIcon
  size?: number
}) {
  const { format } = useI18n()
  // an image that will not load is drawn by its initial instead
  const [broken, setBroken] = useState<string | null>(null)
  const initial = (
    <span {...stylex.props(styles.initial)} style={{ fontSize: Math.round(size * 0.72) }}>
      {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
    </span>
  )
  const body = (() => {
    if (icon === null) return initial
    if (icon.kind === 'image') {
      if (broken === icon.version) return initial
      return (
        <img
          alt=""
          width={size}
          height={size}
          draggable={false}
          src={authUrls.loginIcon.getLoginMethodIcon({
            params: { providerCode: code },
            query: { v: icon.version },
          })}
          onError={() => setBroken(icon.version)}
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
    return (
      <span
        aria-hidden
        {...stylex.props(styles.letter)}
        style={{
          width: size,
          height: size,
          backgroundColor: lettered.color,
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
      {...stylex.props(styles.glyph)}
      style={{ width: size, height: size }}
    >
      {body}
    </span>
  )
}
