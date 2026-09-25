// What the mail this plugin sends says, in the reader's language.
//
// Written here rather than in the browser catalogs because it leaves from the
// server and is read in a mail client; the language is the one the request
// that caused it asked for, which for every message here is the reader's own
// request. Each message is one short paragraph and the link: what the link
// does, and how long it works.

export type MailLocale = 'zh-CN' | 'en'

/**
 * The reader's language: the first one their browser asks for, when it is
 * one these messages are written in; otherwise the product's own fallback.
 */
export const mailLocaleOf = (acceptLanguage: string | undefined): MailLocale => {
  const first = (acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
  return first.startsWith('zh') ? 'zh-CN' : 'en'
}

export type MailPurpose = 'verify' | 'reset' | 'change'

interface Written {
  readonly subject: string
  readonly text: (link: string) => string
  /** the same message laid out: what it is, what the button does, and what to know */
  readonly title: string
  readonly lead: string
  readonly action: string
  readonly note: string
  readonly footer: string
}

/** words every message shares, by language */
const SHARED: Record<MailLocale, { readonly sentTo: string; readonly fallback: string }> = {
  'zh-CN': {
    sentTo: '发送至',
    fallback: '若按钮无法正常点击，请复制下方链接至浏览器中打开：',
  },
  en: {
    sentTo: 'Sent to',
    fallback: "If the button above doesn't work, copy and paste this link into your browser:",
  },
}

const COPY: Record<MailPurpose, Record<MailLocale, Written>> = {
  verify: {
    'zh-CN': {
      subject: '验证您的邮箱',
      text: (link) =>
        `请点击下方链接完成邮箱验证。此链接有效期为 24 小时，且仅限使用一次。\n\n${link}\n\n如非本人操作，请直接忽略此邮件。`,
      title: '验证您的邮箱',
      lead: '请点击下方链接完成邮箱验证。',
      action: '验证邮箱',
      note: '此链接有效期为 24 小时，且仅限使用一次。',
      footer: '如非本人操作，请直接忽略此邮件。',
    },
    en: {
      subject: 'Verify your email address',
      text: (link) =>
        `Please click the link below to verify your email address. This link is valid for 24 hours and can only be used once.\n\n${link}\n\nIf you did not request this, you can safely ignore this email.`,
      title: 'Verify your email address',
      lead: 'Please click the link below to verify your email address.',
      action: 'Verify Email',
      note: 'This link is valid for 24 hours and can only be used once.',
      footer: 'If you did not request this, you can safely ignore this email.',
    },
  },
  reset: {
    'zh-CN': {
      subject: '重置您的密码',
      text: (link) =>
        `请点击下方链接设置新密码。此链接有效期为 1 小时，且仅限使用一次；重置成功后，所有已登录的设备将自动退出。\n\n${link}\n\n如非本人操作，请直接忽略此邮件，您的密码不会被修改。`,
      title: '重置您的密码',
      lead: '请点击下方链接设置新密码。',
      action: '设置新密码',
      note: '此链接有效期为 1 小时，且仅限使用一次；重置成功后，所有已登录的设备将自动退出。',
      footer: '如非本人操作，请直接忽略此邮件，您的密码不会被修改。',
    },
    en: {
      subject: 'Reset your password',
      text: (link) =>
        `Please click the link below to set a new password. This link is valid for 1 hour and can only be used once. Setting a new password will sign you out of all devices.\n\n${link}\n\nIf you did not request this, you can safely ignore this email. Your password will remain unchanged.`,
      title: 'Reset your password',
      lead: 'Please click the link below to set a new password.',
      action: 'Set New Password',
      note: 'This link is valid for 1 hour and can only be used once. Setting a new password will sign you out of all devices.',
      footer:
        'If you did not request this, you can safely ignore this email. Your password will remain unchanged.',
    },
  },
  change: {
    'zh-CN': {
      subject: '确认新邮箱',
      text: (link) =>
        `请点击下方链接，确认将当前邮箱设置为您的账号邮箱。此链接有效期为 24 小时，且仅限使用一次。\n\n${link}\n\n如非本人操作，请直接忽略此邮件，您账号的关联邮箱不会改变。`,
      title: '确认新邮箱',
      lead: '请点击下方链接，确认将当前邮箱设置为您的账号邮箱。',
      action: '确认新邮箱',
      note: '此链接有效期为 24 小时，且仅限使用一次。',
      footer: '如非本人操作，请直接忽略此邮件，您账号的关联邮箱不会改变。',
    },
    en: {
      subject: 'Confirm your new email address',
      text: (link) =>
        `Please click the link below to confirm this as your new account email address. This link is valid for 24 hours and can only be used once.\n\n${link}\n\nIf you did not request this, you can safely ignore this email. Your account email will remain unchanged.`,
      title: 'Confirm your new email address',
      lead: 'Please click the link below to confirm this as your new account email address.',
      action: 'Confirm New Email',
      note: 'This link is valid for 24 hours and can only be used once.',
      footer:
        'If you did not request this, you can safely ignore this email. Your account email will remain unchanged.',
    },
  },
}

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/** the wordmark tools/brand/export.ts writes into the web release, and the box it is shown in */
const MAIL_WORDMARK = { path: '/mail-wordmark.png', width: 71, height: 24 } as const

const INK = '#1c1b19'
const QUIET = '#6f6d69'
const RULE = '#ecebe8'
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif"

/** what every laid-out message is framed in, around what it says */
interface Framed {
  readonly subject: string
  readonly title: string
  readonly lead: string
  /** the message's own part, as html already escaped */
  readonly main: string
  readonly footer: string
  readonly sentTo: string
  readonly to: string
  readonly workspace: string | null
  /** where the wordmark is served from; without one its name stands in */
  readonly origin: string | null
}

const cell = `font-family:${FONT};`

/**
 * A message as html: a card on a pale ground, the product and the workspace
 * across its top, then what it is, its own part, and the one line for
 * somebody who did not ask for it.
 *
 * Tables and inline styles because that is what mail clients render. The
 * wordmark is a png the web release serves (mail clients drop svg), found at
 * the origin the message points to; a client that holds remote images back
 * shows its alt text, set to look like the name it replaces. Every value
 * that came from outside is escaped.
 */
const framed = (input: Framed) => {
  const name = `${cell}font-size:18px;font-weight:700;color:${INK};`
  const wordmark =
    input.origin === null
      ? `<span style="${name}">Qualy</span>`
      : `<img src="${escape(new URL(MAIL_WORDMARK.path, input.origin).toString())}" width="${String(MAIL_WORDMARK.width)}" height="${String(MAIL_WORDMARK.height)}" alt="Qualy" style="display:block;border:0;outline:none;text-decoration:none;height:${String(MAIL_WORDMARK.height)}px;width:${String(MAIL_WORDMARK.width)}px;${name}">`
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f6f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f4;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid ${RULE};">
<tr><td style="padding:22px 36px;border-bottom:1px solid ${RULE};${cell}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="${cell}font-size:18px;font-weight:700;letter-spacing:-0.02em;color:${INK};">${wordmark}</td>
<td align="right" style="${cell}font-size:12.5px;color:${QUIET};">${input.workspace === null ? '' : escape(input.workspace)}</td>
</tr></table>
</td></tr>
<tr><td style="padding:36px 36px 32px;${cell}">
<h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em;color:${INK};">${escape(input.title)}</h1>
<p style="margin:10px 0 0;font-size:15px;line-height:1.7;color:#4a4845;">${escape(input.lead)}</p>
${input.main}
</td></tr>
<tr><td style="padding:18px 36px;border-top:1px solid ${RULE};${cell}font-size:12.5px;line-height:1.65;color:${QUIET};">${escape(input.footer)}</td></tr>
</table>
<p style="margin:16px 0 0;${cell}font-size:12px;color:#9a9894;">${escape(input.sentTo)} ${escape(input.to)}</p>
</td></tr>
</table>
</body></html>`
}

/** a message whose point is its link: the link as a button, what to know, and the link spelled out */
const htmlOf = (
  written: Written,
  shared: (typeof SHARED)[MailLocale],
  input: { readonly link: string; readonly to: string; readonly workspace: string | null },
) => {
  const link = escape(input.link)
  return framed({
    subject: written.subject,
    title: written.title,
    lead: written.lead,
    main: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;"><tr>
<td style="border-radius:12px;background:${INK};"><a href="${link}" style="display:inline-block;padding:14px 26px;${cell}font-size:15px;font-weight:500;color:#fafaf9;text-decoration:none;border-radius:12px;">${escape(written.action)}</a></td>
</tr></table>
<p style="margin:24px 0 0;font-size:13.5px;line-height:1.7;color:${QUIET};">${escape(written.note)}</p>
<p style="margin:28px 0 0;font-size:12.5px;color:${QUIET};">${escape(shared.fallback)}</p>
<p style="margin:8px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;color:#555350;word-break:break-all;">${link}</p>`,
    footer: written.footer,
    sentTo: shared.sentTo,
    to: input.to,
    workspace: input.workspace,
    origin: input.link,
  })
}

export const mailFor = (
  purpose: MailPurpose,
  locale: MailLocale,
  link: string,
  // who it is going to, and from which workspace, for the html alone
  context: { readonly to: string; readonly workspace: string | null } = { to: '', workspace: null },
) => {
  const written = COPY[purpose][locale]
  return {
    subject: written.subject,
    // the plain part stays as it was, for every client that shows no html
    text: written.text(link),
    html: htmlOf(written, SHARED[locale], { link, ...context }),
  }
}

/**
 * A message with nothing to follow: a code to type back into the page that
 * asked for it, or word of a change already made. Apart from the links above
 * because it names no link, and so says where it came from only by its
 * workspace.
 */
export type NoticePurpose =
  | 'reauthentication-code'
  | 'email-changed'
  /** the same word, of a change an administrator made */
  | 'email-changed-by-administrator'

interface WrittenNotice {
  readonly subject: string
  readonly title: string
  readonly lead: string
  readonly note: string
  readonly footer: string
}

const NOTICES: Record<NoticePurpose, Record<MailLocale, WrittenNotice>> = {
  'reauthentication-code': {
    'zh-CN': {
      subject: '您的身份验证码',
      title: '身份验证码',
      lead: '您正在更改账号的邮箱或登录方式，请在发起操作的页面中输入以下验证码：',
      note: '验证码 10 分钟内有效，仅限在发起操作的页面中使用一次。',
      footer: '如非本人操作，请勿将验证码告知他人，并尽快联系管理员。',
    },
    en: {
      subject: 'Your verification code',
      title: 'Your verification code',
      lead: 'You are changing how your account is reached. Enter this code on the page that asked for it:',
      note: 'The code works for 10 minutes, once, and only on the page that asked for it.',
      footer:
        'If you did not ask for this, do not share the code with anyone, and contact your administrator.',
    },
  },
  'email-changed': {
    'zh-CN': {
      subject: '账号邮箱已更改',
      title: '账号邮箱已更改',
      lead: '您账号的邮箱已更改为新地址，此邮箱将不再用于登录和找回密码。',
      note: '该账号在其他设备上的登录已全部退出。',
      footer: '如非本人操作，请立即联系管理员。',
    },
    en: {
      subject: 'Your account email was changed',
      title: 'Your account email was changed',
      lead: 'The email for your account was changed to a new address. This address is no longer used to sign in or to reset the password.',
      note: 'Every other device signed in to the account was signed out.',
      footer: 'If you did not make this change, contact your administrator right away.',
    },
  },
  'email-changed-by-administrator': {
    'zh-CN': {
      subject: '账号邮箱已由管理员更改',
      title: '账号邮箱已更改',
      lead: '管理员已将您账号的邮箱更改为新地址，此邮箱将不再用于登录和找回密码。',
      note: '该账号在各设备上的登录已全部退出。',
      footer: '如对此有疑问，请尽快联系管理员。',
    },
    en: {
      subject: 'An administrator changed your account email',
      title: 'Your account email was changed',
      lead: 'An administrator changed the email for your account to a new address. This address is no longer used to sign in or to reset the password.',
      note: 'Every device signed in to the account was signed out.',
      footer: 'If you have questions about this change, contact your administrator.',
    },
  },
}

export const noticeFor = (
  purpose: NoticePurpose,
  locale: MailLocale,
  context: {
    readonly to: string
    readonly workspace: string | null
    /** the address this deployment is reached at, for the wordmark; null when it has none */
    readonly origin: string | null
    /** the code to type back, for a message that carries one */
    readonly code?: string
    /**
     * For word of a changed address: whether anybody was signed out with
     * it. False drops the sentence saying so, which would otherwise tell the
     * reader something that did not happen.
     */
    readonly signedOut?: boolean
  },
) => {
  const chosen = NOTICES[purpose][locale]
  const written = context.signedOut === false ? { ...chosen, note: '' } : chosen
  const code =
    context.code === undefined
      ? ''
      : `<p style="margin:28px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;font-weight:600;letter-spacing:0.3em;color:${INK};">${escape(context.code)}</p>`
  return {
    subject: written.subject,
    text: [
      written.lead,
      ...(context.code === undefined ? [] : [context.code]),
      ...(written.note === '' ? [] : [written.note]),
      written.footer,
    ].join('\n\n'),
    html: framed({
      subject: written.subject,
      title: written.title,
      lead: written.lead,
      main:
        written.note === ''
          ? code
          : `${code}
<p style="margin:24px 0 0;font-size:13.5px;line-height:1.7;color:${QUIET};">${escape(written.note)}</p>`,
      footer: written.footer,
      sentTo: SHARED[locale].sentTo,
      to: context.to,
      workspace: context.workspace,
      origin: context.origin,
    }),
  }
}
