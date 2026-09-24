import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ImageUpIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { upload } from '@qualy/plugin-storage/client'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { BUILTIN_LOGIN_ICONS, type BuiltinLoginIcon } from '@qualy/auth-contract/login-icons'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@qualy/ui/popover'
import { Card, CardHead, DefLine, DefList } from '@qualy/ui/screen'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { iamMessages as m } from '../../i18n.ts'
import { authApi } from '../../api.ts'
import { LOGIN_ICON_MAX_BYTES, LOGIN_ICON_SVG_MAX_BYTES, LOGIN_ICON_TYPES } from '../../../api.ts'
import { LoginMethodGlyph } from '../../sign-in/glyph.tsx'
import type { IconSurface } from '../../sign-in/surface.ts'
import type { ProviderRow } from './MethodSheet.tsx'

// Where an entrance stands on the sign-in page and how it is drawn there.
//
// Its place is set by dragging it in the list, because a place is only
// meaningful next to the others; what it is drawn by and whether the tenant
// recommends it are its own, and set here.
//
// An icon is shown on both grounds it can stand on, because a mark that reads
// on one can vanish on the other; the tenant's own image may come in a
// version for each.

/** a message this module formats, whichever one */
type Said = Parameters<ReturnType<typeof useI18n>['format']>[0]

const NAMES: Record<BuiltinLoginIcon, Said> = {
  campus: m.iconNameCampus,
  key: m.iconNameKey,
  mail: m.iconNameMail,
  'id-card': m.iconNameIdCard,
  shield: m.iconNameShield,
  globe: m.iconNameGlobe,
  github: m.iconNameGithub,
  gitlab: m.iconNameGitlab,
  microsoft: m.iconNameMicrosoft,
  google: m.iconNameGoogle,
  apple: m.iconNameApple,
  wechat: m.iconNameWechat,
  wecom: m.iconNameWecom,
  dingtalk: m.iconNameDingtalk,
  feishu: m.iconNameFeishu,
  qq: m.iconNameQq,
}

const styles = stylex.create({
  aside: { fontSize: 12.5, color: tokens.mutedForeground },
  iconLine: { display: 'flex', alignItems: 'center', gap: 12 },
  previews: { display: 'inline-flex', gap: 6 },
  preview: {
    display: 'inline-flex',
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  // the two grounds, fixed rather than themed: each is the one it names
  onLight: { backgroundColor: '#ffffff', color: '#18181b' },
  onDark: { backgroundColor: '#18181b', color: '#fafafa' },
  small: { width: 36, height: 36, borderRadius: 9 },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  slot: { display: 'flex', alignItems: 'center', gap: 10 },
  slotWords: { display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column', gap: 2 },
  slotName: { fontSize: 13 },
  // the line sits on the words' baseline, as the label beside it does; the
  // box is centred on them rather than lending the line its bottom edge
  recommend: { display: 'flex', alignItems: 'baseline', gap: 10, cursor: 'pointer' },
  recommendBox: { display: 'inline-flex', alignSelf: 'center' },
  picker: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12 },
  pickerTitle: { fontSize: 13.5, fontWeight: 600 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 6 },
  choice: {
    display: 'inline-flex',
    width: '100%',
    aspectRatio: '1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 10,
    backgroundColor: { default: tokens.background, ':hover': tokens.surfaceMuted },
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    color: tokens.foreground,
    cursor: 'pointer',
  },
  choiceOn: { boxShadow: `inset 0 0 0 2px ${tokens.foreground}` },
  pickerActions: { display: 'flex', flexDirection: 'column', gap: 6 },
  hidden: { display: 'none' },
})

export function ShownCard({
  provider,
  position,
  canManage,
}: {
  provider: ProviderRow
  position: number
  canManage: boolean
}) {
  const api = useApi(authApi)
  const query = useApiQuery(authApi)
  const runApi = useRunApi()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [picking, setPicking] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: query.identity.key() })
  const primary = provider.prominence === 'primary'

  const recommend = useMutation({
    mutationFn: (on: boolean) =>
      runApi(
        api.identity.setRecommendedAuthProvider({
          payload: { providerId: on ? provider.id : null },
        }),
      ),
    onSuccess: refresh,
    onError: (error: unknown) => toast.error(formatError(error)),
  })

  type Choice =
    | { kind: 'builtin'; key: BuiltinLoginIcon }
    | { kind: 'default' }
    | { kind: 'clear'; surface: 'dark' }
    | { kind: 'file'; file: File; surface: IconSurface }
  const choose = useMutation({
    mutationFn: async (choice: Choice) => {
      const params = { providerId: provider.id }
      if (choice.kind !== 'file') {
        return runApi(api.loginIcon.setProviderIcon({ params, payload: { icon: choice } }))
      }
      const { file: picked, surface } = choice
      // a drawing travels as it is and is checked on arrival; a picture
      // goes through the store, which is what weighs it
      if (picked.type === 'image/svg+xml' || picked.name.toLowerCase().endsWith('.svg')) {
        const markup = await picked.text()
        return runApi(
          api.loginIcon.setProviderIcon({
            params,
            payload: { icon: { kind: 'svg', markup, surface } },
          }),
        )
      }
      const ticket = await runApi(
        api.loginIcon.prepareProviderIconUpload({
          params,
          payload: {
            filename: picked.name,
            declaredMime: picked.type as (typeof LOGIN_ICON_TYPES)[number],
            size: String(picked.size),
          },
        }),
      )
      await upload(
        {
          reservationId: ticket.reservationId,
          attachmentId: ticket.attachmentId,
          grant: ticket.grant,
          expiresAt: Date.parse(ticket.expiresAt),
        },
        picked,
      )
      return runApi(
        api.loginIcon.setProviderIcon({
          params,
          payload: { icon: { kind: 'upload', reservationId: ticket.reservationId, surface } },
        }),
      )
    },
    onSuccess: async () => {
      setPicking(false)
      toast.success(format(m.methodIconSaved))
      await refresh()
    },
    onError: (error: unknown) => toast.error(formatError(error)),
  })

  /** which ground the file being picked is for */
  const aim = useRef<IconSurface>('light')
  const pick = (surface: IconSurface) => {
    aim.current = surface
    file.current?.click()
  }
  const image = provider.iconChosen && provider.icon?.kind === 'image' ? provider.icon : null

  /** the door as drawn on one ground */
  const preview = (surface: IconSurface, small = false) => (
    <span
      data-testid={`method-icon-${surface}`}
      title={format(surface === 'light' ? m.methodIconOnLight : m.methodIconOnDark)}
      {...stylex.props(
        styles.preview,
        surface === 'light' ? styles.onLight : styles.onDark,
        small && styles.small,
      )}
    >
      <LoginMethodGlyph
        code={provider.code}
        name={provider.name}
        icon={provider.icon}
        size={small ? 18 : 22}
        surface={surface}
      />
    </span>
  )

  const chosenKey =
    provider.iconChosen && provider.icon?.kind === 'builtin' ? provider.icon.key : null

  return (
    <Card data-testid="method-shown" data-prominence={provider.prominence}>
      <CardHead title={format(m.methodShownTitle)} />
      <DefList>
        <DefLine label={format(m.methodShownAs)}>
          <span>
            {format(primary ? m.methodShownPrimary : m.methodShownSecondary, { position })}
          </span>
          <span {...stylex.props(styles.aside)}>{format(m.methodOrderHint)}</span>
        </DefLine>
        <DefLine label={format(m.methodIconLabel)}>
          <span {...stylex.props(styles.iconLine)}>
            <span data-testid="method-icon" {...stylex.props(styles.previews)}>
              {preview('light')}
              {preview('dark')}
            </span>
            {canManage && (
              <Popover open={picking} onOpenChange={setPicking}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" disabled={choose.isPending}>
                    {format(choose.isPending ? m.methodIconUploading : m.methodIconChange)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" width={340}>
                  <div data-testid="icon-picker" {...stylex.props(styles.picker)}>
                    <span {...stylex.props(styles.pickerTitle)}>{format(m.methodIconTitle)}</span>
                    <div {...stylex.props(styles.grid)}>
                      {BUILTIN_LOGIN_ICONS.map((key) => (
                        <button
                          key={key}
                          type="button"
                          title={format(NAMES[key])}
                          aria-label={format(NAMES[key])}
                          aria-pressed={chosenKey === key}
                          data-icon-choice={key}
                          disabled={choose.isPending}
                          {...stylex.props(styles.choice, chosenKey === key && styles.choiceOn)}
                          onClick={() => choose.mutate({ kind: 'builtin', key })}
                        >
                          <LoginMethodGlyph
                            code={provider.code}
                            name={provider.name}
                            icon={{ kind: 'builtin', key }}
                            size={18}
                          />
                        </button>
                      ))}
                    </div>
                    <div {...stylex.props(styles.section)}>
                      <span {...stylex.props(styles.pickerTitle)}>{format(m.methodIconOwn)}</span>
                      <div {...stylex.props(styles.slot)} data-testid="icon-slot-light">
                        {preview('light', true)}
                        <span {...stylex.props(styles.slotWords)}>
                          <span {...stylex.props(styles.slotName)}>
                            {format(m.methodIconOnLight)}
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={choose.isPending}
                          onClick={() => pick('light')}
                        >
                          <ImageUpIcon aria-hidden />
                          {format(m.methodIconUpload)}
                        </Button>
                      </div>
                      <div {...stylex.props(styles.slot)} data-testid="icon-slot-dark">
                        {preview('dark', true)}
                        <span {...stylex.props(styles.slotWords)}>
                          <span {...stylex.props(styles.slotName)}>
                            {format(m.methodIconOnDark)}
                          </span>
                          <span {...stylex.props(styles.aside)}>
                            {format(
                              image === null
                                ? m.methodIconDarkNeedsLight
                                : m.methodIconDarkOptional,
                            )}
                          </span>
                        </span>
                        {image?.onDark != null ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={choose.isPending}
                            onClick={() => choose.mutate({ kind: 'clear', surface: 'dark' })}
                          >
                            <XIcon aria-hidden />
                            {format(m.methodIconRemoveDark)}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            // a version for the dark ground stands beside one for the light
                            disabled={choose.isPending || image === null}
                            onClick={() => pick('dark')}
                          >
                            <ImageUpIcon aria-hidden />
                            {format(m.methodIconUpload)}
                          </Button>
                        )}
                      </div>
                      <span {...stylex.props(styles.aside)}>{format(m.methodIconUploadHint)}</span>
                    </div>
                    {provider.iconChosen && (
                      <div {...stylex.props(styles.pickerActions)}>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={choose.isPending}
                          onClick={() => choose.mutate({ kind: 'default' })}
                        >
                          <RotateCcwIcon aria-hidden />
                          {format(m.methodIconDefault)}
                        </Button>
                      </div>
                    )}
                    <input
                      ref={file}
                      type="file"
                      accept={[...LOGIN_ICON_TYPES, 'image/svg+xml', '.svg'].join(',')}
                      data-testid="icon-file"
                      {...stylex.props(styles.hidden)}
                      onChange={(event) => {
                        const picked = event.target.files?.[0]
                        event.target.value = ''
                        if (picked === undefined) return
                        const drawing =
                          picked.type === 'image/svg+xml' ||
                          picked.name.toLowerCase().endsWith('.svg')
                        // said here rather than after an upload that would be refused
                        const fits = drawing
                          ? picked.size <= LOGIN_ICON_SVG_MAX_BYTES
                          : (LOGIN_ICON_TYPES as readonly string[]).includes(picked.type) &&
                            picked.size <= LOGIN_ICON_MAX_BYTES
                        if (!fits) {
                          toast.error(
                            formatError({ _tag: 'AUTH_PROVIDER_ICON_INVALID', reason: 'type' }),
                          )
                          return
                        }
                        choose.mutate({ kind: 'file', file: picked, surface: aim.current })
                      }}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </span>
        </DefLine>
        <DefLine label={format(m.methodRecommend)}>
          <label {...stylex.props(styles.recommend)}>
            <span {...stylex.props(styles.recommendBox)}>
              <Checkbox
                data-testid="method-recommend"
                checked={provider.recommended}
                disabled={!canManage || !primary || recommend.isPending}
                onCheckedChange={(next) => recommend.mutate(next === true)}
              />
            </span>
            <span {...stylex.props(styles.aside)}>{format(m.methodRecommendHint)}</span>
          </label>
        </DefLine>
      </DefList>
    </Card>
  )
}
