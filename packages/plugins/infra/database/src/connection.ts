// How a database url reaches the driver, for every MikroORM this plugin opens.
//
// MikroORM reads `clientUrl` for what it needs itself - the database name and
// a `schema` parameter - and builds the pg pool from the host, port, user,
// password and name it took apart, dropping every other parameter the url
// carried (@mikro-orm/core 7.2.0 Connection.getConnectionOptions,
// @mikro-orm/postgresql PostgreSqlConnection.mapOptions). `sslmode`,
// `sslrootcert`, `application_name`, `options=-c ...` all went nowhere: a url
// that asked for TLS got a plaintext pool, while the sessions this plugin
// opens with pg directly - the migration lock, the listener - parsed the same
// url and did encrypt.
//
// So pg is handed the url itself as `connectionString`, which it parses the
// way any libpq client would and which overrides the pieces MikroORM passed
// (pg 8.23.0 lib/connection-parameters.js). `clientUrl` stays: MikroORM still
// reads the database name from it.

/** the MikroORM options that connect to `url`, with the driver options a caller already has merged in */
export const driverConnection = (
  url: string,
  driverOptions: Readonly<Record<string, unknown>> = {},
): { readonly clientUrl: string; readonly driverOptions: Record<string, unknown> } => ({
  clientUrl: url,
  driverOptions: { ...driverOptions, connectionString: url },
})
