import { customType } from 'drizzle-orm/pg-core'

// postgres ltree paths as plain strings; labels are node uuids with hyphens
// stripped, joined by dots (see the org repo for path construction)
export const ltree = customType<{ data: string }>({
  dataType() {
    return 'ltree'
  },
})
