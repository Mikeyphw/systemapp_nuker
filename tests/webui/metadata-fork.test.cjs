'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { root, load } = require('../helpers/runtime.cjs')
const { importAdl, validatePackageId, run } = require(path.join(root, 'scripts/fetch-adl.cjs'))

function fixture() {
  return {
    aosp: [{ id: 'android', removal: 'unsafe', description: 'Core Android' }],
    carrier: [], google: [], misc: [],
    oem: [
      { id: 'com.safe', removal: 'delete', description: 'Safe', warning: 'ROM-specific' },
      { id: 'com.risk', removal: 'unsafe', description: 'Risk', suggestions: 'browsers' },
    ],
    suggestions: [{ _id: 'browsers', id: 'org.browser', label: 'Browser', repo: 'https://example.com' }],
  }
}
test('ADL converter keeps provenance and enrichments, rejects duplicates', () => {
  const db = importAdl(fixture(), { adl: 'fixtureA', suggestions: 'fixtureB' })
  assert.equal(db.entries['com.risk'].removal, 'unsafe')
  assert.equal(db.entries['com.safe'].warning, 'ROM-specific')
  assert.equal(db.suggestions.browsers[0].id, 'org.browser')
  assert.equal(db.stats.entries, 3)
  assert.equal(db.sources.adl.license, 'AGPL-3.0-or-later')
  assert.equal(validatePackageId('android'), true)
  assert.equal(validatePackageId('com.a/b'), false)
  const duplicate = fixture()
  duplicate.misc = [{ id: 'com.safe', removal: 'delete' }]
  assert.throws(() => importAdl(duplicate, { adl: '', suggestions: '' }), /duplicate/)
})

test('offline metadata build and --check produce deterministic bytes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'san-adl-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const data = fixture()
  for (const [file, content] of Object.entries(data)) fs.writeFileSync(path.join(dir, `${file}.json`), JSON.stringify(content))
  const out = path.join(dir, 'adl.json')
  await run(['--fixture', dir, '--out', out])
  await run(['--fixture', dir, '--out', out, '--check'])
  const db = JSON.parse(fs.readFileSync(out))
  assert.equal(db.stats.entries, 3)
  db.entries['com.safe'].removal = 'unsafe'
  fs.writeFileSync(out, JSON.stringify(db))
  await assert.rejects(run(['--fixture', dir, '--out', out, '--check']), /stale/)
})

test('combined policy is conservative and protects critical packages', async () => {
  const fake = {
    schema_version: 1, entries: { 'com.risk': { removal: 'unsafe', type: 'oem' }, 'com.safe': { removal: 'delete', type: 'oem' } },
    suggestions: {}, sources: { adl: { revision: 'abcdef', repository: 'example', license: 'AGPL-3.0-or-later' } },
  }
  // Runtime helper transpiles TS using repository's configured TypeScript.
  const module = load('src/lib/metadata.ts', {
    './uad': { getUad: id => ({ removal: id === 'com.risk' ? 'advanced' : 'recommended', description: 'from UAD' }) },
  }, { fetch: async () => ({ ok: true, json: async () => ({ ...fake, entries: { ...fake.entries, ...Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`pkg.${i}`, { removal: 'delete' }])) } }) }) })
  assert.equal(await module.loadMetadata(), true)
  assert.equal(module.assessPackage('com.risk').effective, 'unsafe')
  assert.equal(module.assessPackage('com.risk').disagreement, true)
  assert.equal(module.assessPackage('com.safe').effective, 'recommended')
  assert.equal(module.assessPackage('com.android.systemui').protected, true)
  assert.equal(module.isRemovalBlocked('com.android.systemui'), true)
})
