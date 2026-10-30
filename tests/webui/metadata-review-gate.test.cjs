'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { verifyAdl, verifyUad } = require('../../webui/scripts/verify-databases.cjs')
const sha = 'a'.repeat(40)
const entries = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [`pkg.${i}`, { removal: 'delete', type: 'oem' }]))
const uad = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [`pkg.${i}`, ['Recommended', 'description']]))
const adl = count => ({ schema_version: 1, entries: entries(count), suggestions: { browsers: [{ id: 'org.browser', repo: 'https://example.invalid/' }] }, sources: Object.fromEntries(['adl','uad','suggestions'].map(k => [k, { revision: sha, repository: 'example/repo', license: 'GPL-3.0' }])) })
test('snapshot validator accepts valid reviewed metadata and rejects missing source', () => {
  assert.equal(verifyAdl(adl(4000)).entries, 4000)
  assert.equal(verifyUad(uad(5000)).entries, 5000)
  const broken = adl(4000)
  delete broken.sources.adl
  assert.throws(() => verifyAdl(broken), /provenance/)
})
test('snapshot validator rejects truncated or malformed UAD/ADL inputs', () => {
  assert.throws(() => verifyAdl(adl(10)), /suspicious/)
  assert.throws(() => verifyUad(uad(20)), /suspicious/)
  const broken = uad(5000)
  broken['pkg.0'] = ['Unknown', 'invalid']
  assert.throws(() => verifyUad(broken), /invalid entry/)
})
