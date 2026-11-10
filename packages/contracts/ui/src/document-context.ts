/** Plugins augment this contract from their browser-safe context modules. */
export interface DocumentContextTypes {}

export type DocumentContextKey = Extract<keyof DocumentContextTypes, string>
