/** what a question's composition can choose from, as the round offers it */
export interface ItemOptions {
  readonly orgTypes: readonly { id: string; code: string; name: string }[]
  readonly roles: readonly { id: string; name: string }[]
}
