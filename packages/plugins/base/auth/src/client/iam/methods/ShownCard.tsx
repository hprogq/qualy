import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ImageUpIcon, RotateCcwIcon } from 'lucide-react'
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
import { LOGIN_ICON_MAX_BYTES, LOGIN_ICON_TYPES } from '../../../api.ts'
import { LoginMethodGlyph } from '../../sign-in/glyph.tsx'
import type { ProviderRow } from './MethodSheet.tsx'

// Where an entrance stands on the sign-in page and how it is drawn there.
//
// Its place is set by dragging it in the list, because a place is only
// meaningful next to the others; what it is drawn by and whether the tenant
// recommends it are its own, and set here.

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
  preview: {
    display: 'inline-flex',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  recommend: { display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' },
  recommendWords: { display: 'flex', flexDirection: 'column', gap: 2 },
  recommendName: { fontSize: 14 },
  picker: { display: 'flex', width: 296, flexDirection: 'column', gap: 12, padding: 4 },
  pickerTitle: { fontSize: 13.5, fontWeight: 600 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(6, 40px)', gap: 6 },
  choice: {
    display: 'inline-flex',
    width: 40,
    height: 40,
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
    | { kind: 'upload'; file: File }
  const choose = useMutation({
    mutationFn: async (choice: Choice) => {
      if (choice.kind !== 'upload') {
        return runApi(
          api.loginIcon.setProviderIcon({ params: { providerId: provider.id }, payload: { icon: choice } }),
        )
      }
      const ticket = await runApi(
        api.loginIcon.prepareProviderIconUpload({
          params: { providerId: provider.id },
          payload: {
            filename: choice.file.name,
            declaredMime: choice.file.type as (typeof LOGIN_ICON_TYPES)[number],
            size: String(choice.file.size),
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
        choice.file,
      )
      return runApi(
        api.loginIcon.setProviderIcon({
          params: { providerId: provider.id },
          payload: { icon: { kind: 'upload', reservationId: ticket.reservationId } },
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

  const chosenKey = provider.iconChosen && provider.icon?.kind === 'builtin' ? provider.icon.key : null

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
            <span {...stylex.props(styles.preview)} data-testid="method-icon">
              <LoginMethodGlyph code={provider.code} name={provider.name} icon={provider.icon} size={22} />
            </span>
            {canManage && (
              <Popover open={picking} onOpenChange={setPicking}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" disabled={choose.isPending}>
                    {format(choose.isPending ? m.methodIconUploading : m.methodIconChange)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start">
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
                    <div {...stylex.props(styles.pickerActions)}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={choose.isPending}
                        onClick={() => file.current?.click()}
                      >
                        <ImageUpIcon aria-hidden />
                        {format(m.methodIconUpload)}
                      </Button>
                      <span {...stylex.props(styles.aside)}>{format(m.methodIconUploadHint)}</span>
                      {provider.iconChosen && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={choose.isPending}
                          onClick={() => choose.mutate({ kind: 'default' })}
                        >
                          <RotateCcwIcon aria-hidden />
                          {format(m.methodIconDefault)}
                        </Button>
                      )}
                    </div>
                    <input
                      ref={file}
                      type="file"
                      accept={LOGIN_ICON_TYPES.join(',')}
                      data-testid="icon-file"
                      {...stylex.props(styles.hidden)}
                      onChange={(event) => {
                        const picked = event.target.files?.[0]
                        event.target.value = ''
                        if (picked === undefined) return
                        // said here rather than after an upload that would be refused
                        if (
                          !(LOGIN_ICON_TYPES as readonly string[]).includes(picked.type) ||
                          picked.size > LOGIN_ICON_MAX_BYTES
                        ) {
                          toast.error(formatError({ _tag: 'AUTH_PROVIDER_ICON_INVALID' }))
                          return
                        }
                        choose.mutate({ kind: 'upload', file: picked })
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
            <Checkbox
              data-testid="method-recommend"
              checked={provider.recommended}
              disabled={!canManage || !primary || recommend.isPending}
              onCheckedChange={(next) => recommend.mutate(next === true)}
            />
            <span {...stylex.props(styles.recommendWords)}>
              <span {...stylex.props(styles.aside)}>{format(m.methodRecommendHint)}</span>
            </span>
          </label>
        </DefLine>
      </DefList>
    </Card>
  )
}
