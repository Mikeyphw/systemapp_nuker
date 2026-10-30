#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-or-later
 * Data obtained from MuntashirAkon/android-debloat-list is AGPL-3.0-or-later.
 * Keep attribution and corresponding-source links in distribution.
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const fileNames = ['aosp', 'carrier', 'google', 'misc', 'oem']
const allowedRemoval = new Set(['delete', 'replace', 'caution', 'unsafe'])
const outDefault = path.join(root, 'public', 'adl.json')

function need(cond, message) { if (!cond) throw new Error(message) }
function isRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
function sha256(v) { return createHash('sha256').update(v).digest('hex') }
function validatePackageId(v) { return typeof v === 'string' && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(v) && v.length <= 240 }
function texts(v, name) {
  if (v === undefined) return undefined
  need(Array.isArray(v) && v.every(e => typeof e === 'string' && e.length <= 4096), `bad ${name}`)
  return [...new Set(v)]
}
function importAdl(data, refs) {
  const entries = Object.create(null)
  const stats = { category_counts: {}, entries: 0, warnings: 0, suggestions: 0 }
  for (const type of fileNames) {
    const rows = data[type]
    need(Array.isArray(rows), `expected ADL array: ${type}`)
    stats.category_counts[type] = rows.length
    for (const item of rows) {
      need(isRecord(item), `invalid ${type} entry`)
      const { id, removal } = item
      need(validatePackageId(id), `invalid package ID in ${type}: ${String(id)}`)
      need(!Object.hasOwn(entries, id), `duplicate package ID: ${id}`)
      need(allowedRemoval.has(removal), `invalid ADL removal for ${id}`)
      const value = { removal, type }
      for (const field of ['label','description','warning','suggestions']) {
        if (item[field] !== undefined) {
          need(typeof item[field] === 'string' && item[field].length <= 25000, `invalid ${field} for ${id}`)
          value[field] = item[field]
        }
      }
      for (const field of ['dependencies','required_by','web']) {
        const v = texts(item[field], `${field} for ${id}`)
        if (v && v.length) value[field] = v
      }
      if (value.warning) stats.warnings++
      if (value.suggestions) stats.suggestions++
      entries[id] = value
      stats.entries++
    }
  }
  const suggestions = Object.create(null)
  for (const item of data.suggestions) {
    need(isRecord(item) && typeof item._id === 'string' && validatePackageId(item.id), 'invalid suggestion entry')
    const candidate = { id: item.id, label: String(item.label || item.id), repo: String(item.repo || '') }
    if (typeof item.reason === 'string') candidate.reason = item.reason
    if (typeof item.source === 'string') candidate.source = item.source
    if (!suggestions[item._id]) suggestions[item._id] = []
    suggestions[item._id].push(candidate)
  }
  const sorted = Object.fromEntries(Object.keys(entries).sort().map(k => [k, entries[k]]))
  // Preserve the dependency data that upstream Nuker's trimUad currently drops.
  const uadExtras = Object.create(null)
  for (const [id, value] of Object.entries(data.uad || {})) {
    if (!validatePackageId(id) || !isRecord(value)) continue
    const dependsOn = texts(value.dependencies, `UAD dependencies for ${id}`) || []
    const neededBy = texts(value.neededBy, `UAD neededBy for ${id}`) || []
    if (dependsOn.length || neededBy.length) uadExtras[id] = { dependencies: dependsOn, required_by: neededBy }
  }
  return { schema_version: 1, sources: {
    adl: { repository: 'MuntashirAkon/android-debloat-list', revision: refs.adl, license: 'AGPL-3.0-or-later' },
    suggestions: { repository: 'MuntashirAkon/AppManager', revision: refs.suggestions, license: 'GPL-3.0-or-later' },
    uad: { repository: 'Universal-Debloater-Alliance/universal-android-debloater-next-generation', revision: refs.uad || 'fixture', license: 'GPL-3.0' },
  }, stats, entries: sorted, uad_extras: uadExtras, suggestions }
}
async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'san-fork-metadata/1.0', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) }, signal: AbortSignal.timeout(45000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
      return await response.json()
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise(resolve => setTimeout(resolve, attempt * 1000))
    }
  }
}
async function run(argv = process.argv.slice(2)) {
  const idx = argv.indexOf('--out')
  const out = idx >= 0 ? path.resolve(argv[idx + 1]) : outDefault
  need(idx < 0 || argv[idx + 1], 'missing --out value')
  const fixtureIndex = argv.indexOf('--fixture')
  const fixture = fixtureIndex >= 0 ? path.resolve(argv[fixtureIndex + 1]) : null
  need(fixtureIndex < 0 || argv[fixtureIndex + 1], 'missing --fixture value')
  const check = argv.includes('--check')
  let data, refs
  if (fixture) {
    data = Object.fromEntries([...fileNames, 'suggestions'].map(k => [k, JSON.parse(fs.readFileSync(path.join(fixture, `${k}.json`), 'utf8'))]))
    if (fs.existsSync(path.join(fixture, 'uad.json'))) data.uad = JSON.parse(fs.readFileSync(path.join(fixture, 'uad.json'), 'utf8'))
    refs = { adl: 'fixture', suggestions: 'fixture', uad: 'fixture' }
  } else {
    const repoAdl = 'MuntashirAkon/android-debloat-list'
    const repoApp = 'MuntashirAkon/AppManager'
    const repoUad = 'Universal-Debloater-Alliance/universal-android-debloater-next-generation'
    const [adlCommit, appCommit, uadCommit] = await Promise.all([
      getJson(`https://api.github.com/repos/${repoAdl}/commits/master`),
      getJson(`https://api.github.com/repos/${repoApp}/commits/master`),
      getJson(`https://api.github.com/repos/${repoUad}/commits/main`),
    ])
    refs = { adl: adlCommit.sha, suggestions: appCommit.sha, uad: uadCommit.sha }
    need(/^[a-f0-9]{40}$/.test(refs.adl) && /^[a-f0-9]{40}$/.test(refs.suggestions) && /^[a-f0-9]{40}$/.test(refs.uad), 'invalid source revision')
    const urls = fileNames.map(k => `https://raw.githubusercontent.com/${repoAdl}/${refs.adl}/${k}.json`)
    urls.push(`https://raw.githubusercontent.com/${repoApp}/${refs.suggestions}/app/src/main/assets/suggestions.json`)
    urls.push(`https://raw.githubusercontent.com/${repoUad}/${refs.uad}/resources/assets/uad_lists.json`)
    const rows = await Promise.all(urls.map(getJson))
    data = Object.fromEntries([...fileNames, 'suggestions', 'uad'].map((k, i) => [k, rows[i]]))
  }
  need(Array.isArray(data.suggestions), 'invalid suggestions array')
  const built = importAdl(data, refs)
  if (!fixture) {
    need(built.stats.entries >= 4000, `suspiciously small ADL source: ${built.stats.entries}`)
    need(data.suggestions.length >= 10, 'suspiciously small suggestions source')
    need(data.uad && typeof data.uad === 'object' && !Array.isArray(data.uad) && Object.keys(data.uad).length >= 5000, 'suspiciously small UAD source')
  }
  const encoded = JSON.stringify(built) + '\n'
  if (check) {
    need(fs.existsSync(out) && fs.readFileSync(out, 'utf8') === encoded, `metadata stale: ${out}`)
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    // fully build and validate before replacing the previous version
    const staged = `${out}.new-${process.pid}`
    try { fs.writeFileSync(staged, encoded); fs.renameSync(staged, out) } finally { try { fs.unlinkSync(staged) } catch {} }
  }
  console.log(JSON.stringify({ file: out, entries: built.stats.entries, revision: refs.adl, sha256: sha256(encoded), mode: check ? 'checked' : 'generated' }))
}
if (require.main === module) run().catch(error => { console.error(`fetch-adl: ${error.message}`); process.exitCode = 1 })
module.exports = { importAdl, validatePackageId, run }
