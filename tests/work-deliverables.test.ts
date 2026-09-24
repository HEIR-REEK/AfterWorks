import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeWorkLinks } from '@/lib/firestore-admin'

test('keeps well-formed http(s) links and trims their labels', () => {
  const links = sanitizeWorkLinks([
    { label: '  Transcription doc  ', url: '  https://drive.google.com/file/d/abc/view  ' },
    { label: '', url: 'http://example.com/sheet' },
  ])
  assert.deepEqual(links, [
    { label: 'Transcription doc', url: 'https://drive.google.com/file/d/abc/view' },
    { label: 'example.com', url: 'http://example.com/sheet' },
  ])
})

test('drops javascript: and other non-http schemes (stored-link XSS vector)', () => {
  const links = sanitizeWorkLinks([
    { label: 'evil', url: 'javascript:alert(1)' },
    { label: 'data', url: 'data:text/html,<script>alert(1)</script>' },
    { label: 'ftp', url: 'ftp://example.com/file' },
    { label: 'ok', url: 'https://example.com/ok' },
  ])
  assert.deepEqual(links, [{ label: 'ok', url: 'https://example.com/ok' }])
})

test('rejects malformed URLs and duplicates, and sanitises label length', () => {
  const links = sanitizeWorkLinks([
    'not-an-object',
    { label: 'x'.repeat(500), url: 'not a url' },
    { url: 'https://example.com/a' },
    { url: 'https://example.com/a' },
    { url: 'https://example.com/b' },
    { label: null, url: null },
  ])
  assert.deepEqual(links.map((l) => l.url), ['https://example.com/a', 'https://example.com/b'])
  assert.ok(links.every((l) => l.label.length <= 60))
})

test('caps the list at five links', () => {
  const links = sanitizeWorkLinks(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((suffix) => ({ url: `https://example.com/${suffix}` })),
  )
  assert.equal(links.length, 5)
  assert.deepEqual(links.map((l) => l.url), [
    'https://example.com/a',
    'https://example.com/b',
    'https://example.com/c',
    'https://example.com/d',
    'https://example.com/e',
  ])
})

test('returns an empty list for non-array input', () => {
  assert.deepEqual(sanitizeWorkLinks(undefined), [])
  assert.deepEqual(sanitizeWorkLinks('nope'), [])
  assert.deepEqual(sanitizeWorkLinks({}), [])
})
