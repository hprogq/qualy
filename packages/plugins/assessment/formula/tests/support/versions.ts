// One published version, as a fixture: the smallest lawful publication row
// its author could have minted. Shared by the suites that care about what a
// version IS to somebody else - its audience, its discoverability - rather
// than about how it was compiled.

import { Effect } from 'effect'
import { sql } from 'kysely'
import { runSql } from '@qualy/plugin-database/testkit'
import {
  normalizeAtomicSchema,
  normalizeInputSchema,
  VALUE_SCHEMA_PROFILE_VERSION,
} from '@qualy/value-schema'
import { contractIdentityOf, sha256Hex } from '../../src/server/contract-identity.ts'

export { sha256Hex }
import { one } from './stack.ts'

const CONTRACT = {
  input: normalizeInputSchema({
    type: 'object',
    properties: { level: { type: 'string', enum: ['national', 'provincial'] } },
    required: ['level'],
    additionalProperties: false,
  }),
  output: normalizeAtomicSchema({
    type: 'string',
    format: 'qualy-decimal',
    'x-qualy-maxScale': 2,
    'x-qualy-minimum': '-99999999.99',
    'x-qualy-maximum': '99999999.99',
  }),
}

const IDENTITY = contractIdentityOf(CONTRACT.input, CONTRACT.output)
export const ARTIFACT = '/*artifact*/'

export const addVersion = (
  tenantId: string,
  functionId: string,
  author: string,
  versionNo: number,
) =>
  Effect.map(
    runSql(sql`
      insert into assessment_formula_versions
        (tenant_id, function_id, version_no, source_ts, runtime_js,
         input_schema, output_schema, source_sha256, runtime_sha256, contract_sha256,
         typescript_version, esbuild_version, formula_abi_version, formula_runtime_sha256,
         quickjs_engine_version, tests, test_report, published_by,
         value_schema_profile_version)
      values (${tenantId}, ${functionId}, ${versionNo}, 'export {}', ${ARTIFACT},
              ${JSON.stringify(CONTRACT.input)}::jsonb, ${JSON.stringify(CONTRACT.output)}::jsonb,
              ${sha256Hex('export {}')}, ${sha256Hex(ARTIFACT)}, ${IDENTITY.contractSha256},
              '7.0.0', '0.28.0', 1, ${sha256Hex('runtime')},
              'quickjs-test', '[]'::jsonb, '[]'::jsonb, ${author},
              ${VALUE_SCHEMA_PROFILE_VERSION})
      returning id`),
    (result) => one<{ id: string }>(result).id,
  )

/** one published version of a fresh function, by a named author */
export const publishedVersion = (tenantId: string, author: string, name: string, versionNo = 1) =>
  Effect.gen(function* () {
    const functionId = one<{ id: string }>(
      yield* runSql(sql`
        insert into assessment_formula_functions
          (tenant_id, name, draft_source_ts, draft_tests, created_by, updated_by)
        values (${tenantId}, ${name}, 'export {}', '[]'::jsonb, ${author}, ${author})
        returning id`),
    ).id
    const versionId = yield* addVersion(tenantId, functionId, author, versionNo)
    return { functionId, versionId }
  })
