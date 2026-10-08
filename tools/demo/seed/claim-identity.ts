import type { Claim } from './claims.ts'

/** The same activity may be counted once per question for each participant. */
export const activityIdentityOf = (claim: Pick<Claim, 'item' | 'payload'>): string | null => {
  const name = claim.payload['activity'] ?? claim.payload['name'] ?? claim.payload['title']
  if (typeof name !== 'string') return null
  // A project and its resulting software copyright are different achievements;
  // changing an article's outlet or a research participant's role is not a new work.
  return JSON.stringify(
    claim.item === 'research' ? [claim.item, name, claim.payload['kind']] : [claim.item, name],
  )
}

/** Reserve scripted activities first, then keep at most one random claim for each other activity. */
export const unreservedClaims = (claims: readonly Claim[], reserved: readonly Claim[]): Claim[] => {
  const used = new Set(reserved.map(activityIdentityOf).filter((key) => key !== null))
  return claims.filter((claim) => {
    const key = activityIdentityOf(claim)
    if (key === null) return true
    if (used.has(key)) return false
    used.add(key)
    return true
  })
}
