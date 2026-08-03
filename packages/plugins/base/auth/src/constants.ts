// Identities the platform provisions and then protects. They are declared
// here, in a module with no dependencies, because the seed creates these rows
// and the runtime enforces rules about them: two copies of "which type is the
// recovery account's" is two things that can drift apart.
// The account a tenant recovers itself with. It is not "the administrator
// identity": administrator power comes from the tenant-admin role, and an
// ordinary teacher may hold that role without changing what kind of person
// they are. This type only says "this is the platform's own account", which
// is why it must keep password sign-in and is provisioned rather than
// assigned.
export const SYSTEM_ACCOUNT_USER_TYPE = 'system-account'
export const LOCAL_PROVIDER_CODE = 'local'
