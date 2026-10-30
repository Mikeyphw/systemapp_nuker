// SPDX-License-Identifier: GPL-3.0-or-later
// Source data in adl.json retains its original AGPL-3.0-or-later license.
import { getUad, type Removal } from './uad'

export interface AdlEntry {
  removal: 'delete' | 'replace' | 'caution' | 'unsafe'
  type: string
  label?: string
  description?: string
  warning?: string
  suggestions?: string
  web?: string[]
  dependencies?: string[]
  required_by?: string[]
}
export interface Alternative {
  id: string
  label: string
  repo: string
  reason?: string
  source?: string
}
interface AdlDatabase {
  schema_version: number
  entries: Record<string, AdlEntry>
  suggestions: Record<string, Alternative[]>
  uad_extras?: Record<string, { dependencies: string[]; required_by: string[] }>
  sources: Record<string, { repository: string, revision: string, license: string }>
}
const criticalPackages = new Set([
  'android', 'com.android.systemui', 'com.android.settings',
  'com.android.packageinstaller', 'com.google.android.packageinstaller',
  'com.android.permissioncontroller', 'com.google.android.permissioncontroller',
  'com.android.providers.settings', 'com.android.providers.media',
  'com.google.android.providers.media.module', 'com.android.externalstorage',
  'com.android.phone', 'com.android.server.telecom',
  'com.android.networkstack', 'com.google.android.networkstack',
  'com.android.inputdevices',
])
const adlLevels: Record<AdlEntry['removal'], Removal> = {
  delete: 'recommended', replace: 'advanced', caution: 'expert', unsafe: 'unsafe',
}
const priority: Record<Removal, number> = {
  recommended: 0, advanced: 1, unknown: 2, expert: 3, unsafe: 4,
}
let database: AdlDatabase | null = null
let pending: Promise<boolean> | null = null

export async function loadMetadata(): Promise<boolean> {
  if (pending) return pending
  pending = (async () => {
    try {
      const result = await fetch('adl.json')
      if (!result.ok) return false
      const json: unknown = await result.json()
      if (!json || typeof json !== 'object') return false
      const candidate = json as AdlDatabase
      if (candidate.schema_version !== 1 || !candidate.entries ||
          typeof candidate.entries !== 'object' || Array.isArray(candidate.entries) ||
          Object.keys(candidate.entries).length < 4000 || !candidate.suggestions) return false
      database = candidate
      return true
    } catch { return false }
  })()
  return pending
}

export interface PackageAssessment {
  effective: Removal
  uad: Removal
  adl: AdlEntry | null
  adlLevel: Removal | null
  protected: boolean
  disagreement: boolean
  description: string | null
  alternatives: Alternative[]
  sourceRevision: string | null
  dependencies: string[]
  requiredBy: string[]
}
export function assessPackage(packageName: string): PackageAssessment {
  const uad = getUad(packageName)
  const adl = database && Object.hasOwn(database.entries, packageName)
    ? database.entries[packageName] : null
  const adlLevel = adl ? adlLevels[adl.removal] : null
  // An unlisted package in the current UAD should not be silently presented as
  // 'recommended' solely because it appears in an older ADL snapshot.
  let effective: Removal = uad.removal
  if (adlLevel && priority[adlLevel] > priority[effective]) effective = adlLevel
  const protectedPackage = criticalPackages.has(packageName)
  if (protectedPackage) effective = 'unsafe'
  const uadExtra = database?.uad_extras?.[packageName]
  const dependencies = [...new Set([...(adl?.dependencies ?? []), ...(uadExtra?.dependencies ?? [])])]
  const requiredBy = [...new Set([...(adl?.required_by ?? []), ...(uadExtra?.required_by ?? [])])]
  return {
    effective, uad: uad.removal, adl, adlLevel, protected: protectedPackage,
    disagreement: adlLevel !== null && uad.removal !== 'unknown' && adlLevel !== uad.removal,
    description: uad.description ?? adl?.description ?? null,
    alternatives: adl?.suggestions ? database?.suggestions[adl.suggestions] ?? [] : [],
    sourceRevision: database?.sources?.adl?.revision ?? null,
    dependencies, requiredBy,
  }
}
export function removalCountsCombined(apps: { packageName: string }[]): Partial<Record<Removal, number>> {
  const counts: Partial<Record<Removal, number>> = {}
  for (const app of apps) {
    const level = assessPackage(app.packageName).effective
    counts[level] = (counts[level] ?? 0) + 1
  }
  return counts
}
export function isRemovalBlocked(packageName: string): boolean {
  return assessPackage(packageName).protected
}
