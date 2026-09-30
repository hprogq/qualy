// What the mail this plugin sends says, in the reader's language
// (docs/adr/0011-i18n-paraglide.md).
//
// The words are this plugin's messages, like everything else it says; this
// module only lays them out. The language is the reader's: the page's own
// for mail the reader asked for, the recipient's choice for mail somebody
// else caused, and the product's default where neither is known. Each
// message is one short paragraph and the link: what the link does, and how
// long it works.

import type { SupportedLocale } from '@qualy/i18n-contract'
import { render, text, type MessageRef } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

const m = messageRefs<typeof M>(import.meta.url)

export type MailPurpose = 'verify' | 'reset' | 'change'

/**
 * What a link's mail says: one per purpose, and the proof of an address a
 * second time, for when an administrator asked for it rather than the reader.
 */
export type MailCopy = MailPurpose | 'verify-by-administrator'

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

const said = (ref: MessageRef, locale: SupportedLocale) => render(text(ref), { locale })

/** words every message shares */
const shared = (locale: SupportedLocale) => ({
  sentTo: said(m.mail_sentTo, locale),
  fallback: said(m.mail_fallback, locale),
})

const LINKS = {
  'verify-by-administrator': {
    subject: m.mail_verifyByAdministrator_subject,
    text: m.mail_verifyByAdministrator_text,
    title: m.mail_verifyByAdministrator_title,
    lead: m.mail_verifyByAdministrator_lead,
    action: m.mail_verifyByAdministrator_action,
    note: m.mail_verifyByAdministrator_note,
    footer: m.mail_verifyByAdministrator_footer,
  },
  verify: {
    subject: m.mail_verify_subject,
    text: m.mail_verify_text,
    title: m.mail_verify_title,
    lead: m.mail_verify_lead,
    action: m.mail_verify_action,
    note: m.mail_verify_note,
    footer: m.mail_verify_footer,
  },
  reset: {
    subject: m.mail_reset_subject,
    text: m.mail_reset_text,
    title: m.mail_reset_title,
    lead: m.mail_reset_lead,
    action: m.mail_reset_action,
    note: m.mail_reset_note,
    footer: m.mail_reset_footer,
  },
  change: {
    subject: m.mail_change_subject,
    text: m.mail_change_text,
    title: m.mail_change_title,
    lead: m.mail_change_lead,
    action: m.mail_change_action,
    note: m.mail_change_note,
    footer: m.mail_change_footer,
  },
} satisfies Record<MailCopy, unknown>

const written = (purpose: MailCopy, locale: SupportedLocale): Written => {
  const refs = LINKS[purpose]
  return {
    subject: said(refs.subject, locale),
    text: (link) => render(text(refs.text, { link }), { locale }),
    title: said(refs.title, locale),
    lead: said(refs.lead, locale),
    action: said(refs.action, locale),
    note: said(refs.note, locale),
    footer: said(refs.footer, locale),
  }
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
  shared: { readonly sentTo: string; readonly fallback: string },
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
  purpose: MailCopy,
  locale: SupportedLocale,
  link: string,
  // who it is going to, and from which workspace, for the html alone
  context: { readonly to: string; readonly workspace: string | null } = { to: '', workspace: null },
) => {
  const words = written(purpose, locale)
  return {
    subject: words.subject,
    // the plain part stays as it was, for every client that shows no html
    text: words.text(link),
    html: htmlOf(words, shared(locale), { link, ...context }),
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

const NOTICES = {
  'reauthentication-code': {
    subject: m.mail_reauthenticationCode_subject,
    title: m.mail_reauthenticationCode_title,
    lead: m.mail_reauthenticationCode_lead,
    note: m.mail_reauthenticationCode_note,
    footer: m.mail_reauthenticationCode_footer,
  },
  'email-changed': {
    subject: m.mail_emailChanged_subject,
    title: m.mail_emailChanged_title,
    lead: m.mail_emailChanged_lead,
    note: m.mail_emailChanged_note,
    footer: m.mail_emailChanged_footer,
  },
  'email-changed-by-administrator': {
    subject: m.mail_emailChangedByAdministrator_subject,
    title: m.mail_emailChangedByAdministrator_title,
    lead: m.mail_emailChangedByAdministrator_lead,
    note: m.mail_emailChangedByAdministrator_note,
    footer: m.mail_emailChangedByAdministrator_footer,
  },
} satisfies Record<NoticePurpose, unknown>

const writtenNotice = (purpose: NoticePurpose, locale: SupportedLocale): WrittenNotice => {
  const refs = NOTICES[purpose]
  return {
    subject: said(refs.subject, locale),
    title: said(refs.title, locale),
    lead: said(refs.lead, locale),
    note: said(refs.note, locale),
    footer: said(refs.footer, locale),
  }
}

export const noticeFor = (
  purpose: NoticePurpose,
  locale: SupportedLocale,
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
  const chosen = writtenNotice(purpose, locale)
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
      sentTo: shared(locale).sentTo,
      to: context.to,
      workspace: context.workspace,
      origin: context.origin,
    }),
  }
}
