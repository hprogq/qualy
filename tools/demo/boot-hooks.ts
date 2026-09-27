// Which of the product's boot hooks a seeding run runs.

/**
 * The boot hooks, each named for what it does to a seeding run.
 *
 * Most of them complete a registry the services read - rbac's permission
 * catalog above all, without which every authorization refuses. The rest
 * start loops that write on their own clock (the phase scheduler, the review
 * patrol, the upload sweeper) or listen for browsers nobody has open; a
 * seeding run must be the only writer, so those stay off. A hook this list
 * does not know stops the run: it has to be sorted before it is trusted.
 */
export const BOOT_HOOKS: Readonly<Record<string, 'run' | 'skip'>> = {
  'mail/backends': 'run',
  'rum/provider': 'run',
  'web/shell-policy': 'run',
  'storage/backends': 'run',
  'captcha/provider': 'run',
  'rbac/permission-catalog': 'run',
  'auth/recovery-channel': 'run',
  // reads the tenants: the one this run seeds is the one the sign-in page opens
  'auth/default-tenant': 'run',
  'auth/public-origin': 'run',
  // reads stored entrance secrets and only logs what does not decrypt
  'auth/entrance-secrets': 'skip',
  'assessment/scoring-plans': 'run',
  'storage/cleanup-scheduler': 'skip',
  // a loop that removes staging files; the seeder places objects directly
  'storage-local/staging-sweep': 'skip',
  'assessment/live-listener': 'skip',
  'assessment/phase-scheduler': 'skip',
}
