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

/**
 * The message as html: a card on a pale ground, the product and the
 * workspace across its top, then what it is, the button, what to know, the
 * address spelled out for a client that will not follow the button, and the
 * one line for somebody who did not ask for it.
 *
 * Tables and inline styles because that is what mail clients render. The
 * wordmark is a png the web release serves (mail clients drop svg), found at
 * the origin the link points to; a client that holds remote images back shows
 * its alt text, set to look like the name it replaces. Every value that came
 * from outside is escaped.
 */
const htmlOf = (
  written: Written,
  shared: (typeof SHARED)[MailLocale],
  input: { readonly link: string; readonly to: string; readonly workspace: string | null },
) => {
  const link = escape(input.link)
  const cell = `font-family:${FONT};`
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(written.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f6f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f4;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid ${RULE};">
<tr><td style="padding:22px 36px;border-bottom:1px solid ${RULE};${cell}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="${cell}font-size:18px;font-weight:700;letter-spacing:-0.02em;color:${INK};"><img src="${escape(new URL(MAIL_WORDMARK.path, input.link).toString())}" width="${String(MAIL_WORDMARK.width)}" height="${String(MAIL_WORDMARK.height)}" alt="Qualy" style="display:block;border:0;outline:none;text-decoration:none;height:${String(MAIL_WORDMARK.height)}px;width:${String(MAIL_WORDMARK.width)}px;${cell}font-size:18px;font-weight:700;color:${INK};"></td>
<td align="right" style="${cell}font-size:12.5px;color:${QUIET};">${input.workspace === null ? '' : escape(input.workspace)}</td>
</tr></table>
</td></tr>
<tr><td style="padding:36px 36px 32px;${cell}">
<h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em;color:${INK};">${escape(written.title)}</h1>
<p style="margin:10px 0 0;font-size:15px;line-height:1.7;color:#4a4845;">${escape(written.lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;"><tr>
<td style="border-radius:12px;background:${INK};"><a href="${link}" style="display:inline-block;padding:14px 26px;${cell}font-size:15px;font-weight:500;color:#fafaf9;text-decoration:none;border-radius:12px;">${escape(written.action)}</a></td>
</tr></table>
<p style="margin:24px 0 0;font-size:13.5px;line-height:1.7;color:${QUIET};">${escape(written.note)}</p>
<p style="margin:28px 0 0;font-size:12.5px;color:${QUIET};">${escape(shared.fallback)}</p>
<p style="margin:8px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;color:#555350;word-break:break-all;">${link}</p>
</td></tr>
<tr><td style="padding:18px 36px;border-top:1px solid ${RULE};${cell}font-size:12.5px;line-height:1.65;color:${QUIET};">${escape(written.footer)}</td></tr>
</table>
<p style="margin:16px 0 0;${cell}font-size:12px;color:#9a9894;">${escape(shared.sentTo)} ${escape(input.to)}</p>
</td></tr>
</table>
</body></html>`
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
