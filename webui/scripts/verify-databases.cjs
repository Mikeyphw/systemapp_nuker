#!/usr/bin/env node
'use strict'
// Validate *reviewed and committed* ADL + UAD snapshots, never fetch network here.
// ADL source data is AGPL-3.0-or-later; see metadata source provenance in adl.json.
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const sha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v)
const removals = new Set(['delete', 'replace', 'caution', 'unsafe'])
const uadRemovals = new Set(['Recommended', 'Advanced', 'Expert', 'Unsafe'])
const packageId = v => typeof v === 'string' && v.length <= 240 && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(v)
function requireValid(value, message) { if (!value) throw new Error(message) }

function verifyAdl(data) {
  requireValid(isRecord(data) && data.schema_version === 1, 'ADL: unsupported schema')
  requireValid(isRecord(data.entries) && isRecord(data.suggestions), 'ADL: missing entries/suggestions')
  requireValid(isRecord(data.sources), 'ADL: missing provenance')
  for (const name of ['adl', 'suggestions', 'uad']) {
    const source = data.sources[name]
    requireValid(isRecord(source) && sha(source.revision) &&
      typeof source.repository === 'string' && typeof source.license === 'string', `ADL: invalid ${name} provenance`)
  }
  const items = Object.entries(data.entries)
  requireValid(items.length >= 4000 && items.length <= 30000, `ADL: suspicious count ${items.length}`)
  for (const [pkg, entry] of items) {
    requireValid(packageId(pkg) && isRecord(entry) && removals.has(entry.removal) &&
      typeof entry.type === 'string', `ADL: invalid entry ${pkg}`)
    for (const key of ['dependencies', 'required_by', 'web']) {
      if (entry[key] !== undefined) requireValid(Array.isArray(entry[key]) && entry[key].every(v => typeof v === 'string'), `ADL: invalid ${key} ${pkg}`)
    }
  }
  requireValid(Object.keys(data.suggestions).length > 0, 'ADL: suggestions absent')
  for (const [name, rows] of Object.entries(data.suggestions)) {
    requireValid(Array.isArray(rows) && rows.every(v => isRecord(v) && packageId(v.id) && typeof v.repo === 'string'), `ADL: invalid suggestions ${name}`)
  }
  if (data.uad_extras !== undefined) {
    requireValid(isRecord(data.uad_extras), 'ADL: invalid UAD extras')
    for (const [pkg, v] of Object.entries(data.uad_extras)) {
      requireValid(packageId(pkg) && isRecord(v) &&
        ['dependencies','required_by'].every(k => Array.isArray(v[k]) && v[k].every(x => typeof x === 'string')), `ADL: invalid UAD extras ${pkg}`)
    }
  }
  return { entries: items.length, revision: data.sources.adl.revision, uad_revision: data.sources.uad.revision }
}

function verifyUad(data) {
  requireValid(isRecord(data), 'UAD: expected object')
  const items = Object.entries(data)
  requireValid(items.length >= 5000 && items.length <= 30000, `UAD: suspicious count ${items.length}`)
  for (const [pkg, entry] of items) {
    requireValid(packageId(pkg) && Array.isArray(entry) && entry.length === 2 &&
      uadRemovals.has(entry[0]) && typeof entry[1] === 'string', `UAD: invalid entry ${pkg}`)
  }
  return { entries: items.length }
}

function verify(adlPath = path.join(root,'public/adl.json'), uadPath = path.join(root,'public/uad.json')) {
  const adl = verifyAdl(JSON.parse(fs.readFileSync(adlPath, 'utf8')))
  const uad = verifyUad(JSON.parse(fs.readFileSync(uadPath, 'utf8')))
  return { ok: true, adl, uad }
}

if (require.main === module) {
  try {
    const adlIndex = process.argv.indexOf('--adl')
    const uadIndex = process.argv.indexOf('--uad')
    if ((adlIndex >= 0 && !process.argv[adlIndex + 1]) || (uadIndex >= 0 && !process.argv[uadIndex + 1])) throw new Error('missing --adl/--uad argument')
    const result = verify(adlIndex >= 0 ? path.resolve(process.argv[adlIndex + 1]) : undefined,
      uadIndex >= 0 ? path.resolve(process.argv[uadIndex + 1]) : undefined)
    console.log(JSON.stringify(result))
  } catch (err) { console.error(`verify-databases: ${err.message}`); process.exitCode = 1 }
}
module.exports = { verify, verifyAdl, verifyUad }
