// Unit tests for filterEntries + toHar (Plan #6).
//
// Run: node --experimental-strip-types --test src/main/mcp/har-export.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filterEntries, toHar } from './har-export.ts';
import type { NetworkEntry } from '../recorder.ts';

const T0 = 1_700_000_000_000;

function mk(partial: Partial<NetworkEntry> & Pick<NetworkEntry, 'id' | 'url' | 'method'>): NetworkEntry {
  return {
    id: partial.id,
    url: partial.url,
    method: partial.method,
    resourceType: partial.resourceType ?? 'xhr',
    startedAt: partial.startedAt ?? T0,
    endedAt: partial.endedAt ?? T0 + 100,
    status: partial.status,
    fromCache: partial.fromCache,
    error: partial.error,
    requestHeaders: partial.requestHeaders,
    responseHeaders: partial.responseHeaders,
    statusLine: partial.statusLine,
    httpVersion: partial.httpVersion,
    mimeType: partial.mimeType,
  };
}

const ENTRIES: NetworkEntry[] = [
  mk({ id: '1', url: 'https://example.com/a', method: 'GET', status: 200, mimeType: 'text/html' }),
  mk({ id: '2', url: 'https://graph.facebook.com/me', method: 'POST', status: 500 }),
  mk({ id: '3', url: 'https://graph.facebook.com/feed', method: 'POST', status: 200, mimeType: 'application/json' }),
  mk({ id: '4', url: 'https://example.com/b', method: 'GET', status: 404 }),
  mk({ id: '5', url: 'https://api.line.me/v2/bot', method: 'POST', status: 502, startedAt: T0 + 1000, endedAt: T0 + 1100 }),
  mk({ id: '6', url: 'https://cdn.example.com/img.png', method: 'GET', status: undefined, error: 'net::ERR_NETWORK_CHANGED' }),
];

test('filterEntries — no opts returns input verbatim', () => {
  assert.equal(filterEntries(ENTRIES, {}).length, ENTRIES.length);
});

test('filterEntries({method:["POST"]}) keeps POSTs only', () => {
  const out = filterEntries(ENTRIES, { method: ['POST'] });
  assert.deepEqual(out.map((e) => e.id).sort(), ['2', '3', '5']);
});

test('filterEntries({method:"post"}) is case-insensitive', () => {
  const out = filterEntries(ENTRIES, { method: 'post' });
  assert.deepEqual(out.map((e) => e.id).sort(), ['2', '3', '5']);
});

test('filterEntries({status:[500,502]}) keeps either', () => {
  const out = filterEntries(ENTRIES, { status: [500, 502] });
  assert.deepEqual(out.map((e) => e.id).sort(), ['2', '5']);
});

test('filterEntries({urlPattern:"graph"}) substring (case-insensitive)', () => {
  const out = filterEntries(ENTRIES, { urlPattern: 'graph' });
  assert.deepEqual(out.map((e) => e.id).sort(), ['2', '3']);
});

test('filterEntries({urlPattern:"/^https://graph\\\\.facebook/i"}) regex', () => {
  const out = filterEntries(ENTRIES, { urlPattern: '/^https://graph\\.facebook/i' });
  assert.deepEqual(out.map((e) => e.id).sort(), ['2', '3']);
});

test('filterEntries falls back to substring on invalid regex', () => {
  // /[unclosed/ is a malformed regex; fall through to substring.
  const out = filterEntries(ENTRIES, { urlPattern: '/[unclosed/' });
  assert.equal(out.length, 0); // no urls contain "/[unclosed/" literally
});

test('filterEntries({since:<later>}) drops earlier entries', () => {
  const out = filterEntries(ENTRIES, { since: T0 + 500 });
  assert.deepEqual(out.map((e) => e.id).sort(), ['5']);
});

test('filterEntries({since:"ISO"}) parses ISO timestamps', () => {
  const iso = new Date(T0 + 500).toISOString();
  const out = filterEntries(ENTRIES, { since: iso });
  assert.deepEqual(out.map((e) => e.id).sort(), ['5']);
});

test('filterEntries({mimeType:"json"}) substring of Content-Type', () => {
  const out = filterEntries(ENTRIES, { mimeType: 'json' });
  assert.deepEqual(out.map((e) => e.id).sort(), ['3']);
});

test('filterEntries({failedOnly:true}) keeps status>=400 or error', () => {
  const out = filterEntries(ENTRIES, { failedOnly: true });
  assert.deepEqual(out.map((e) => e.id).sort(), ['2', '4', '5', '6']);
});

test('filterEntries AND semantics — method+status intersection', () => {
  const out = filterEntries(ENTRIES, { method: ['POST'], status: [500] });
  assert.deepEqual(out.map((e) => e.id), ['2']);
});

test('toHar emits log.version="1.2" + creator + browser + entries', () => {
  const har = toHar(ENTRIES, { creatorName: 'Test', creatorVersion: '9.9' });
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.creator.name, 'Test');
  assert.equal(har.log.creator.version, '9.9');
  assert.ok(har.log.browser.name);
  assert.equal(har.log.entries.length, ENTRIES.length);
});

test('toHar empty input yields valid HAR with entries:[]', () => {
  const har = toHar([], {});
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.entries.length, 0);
});

test('toHar entry shape — method/url/headers/queryString/timings are populated', () => {
  const e = mk({
    id: 'x',
    url: 'https://example.com/path?a=1&b=2',
    method: 'GET',
    status: 200,
    requestHeaders: { 'Accept': 'text/html' },
    responseHeaders: { 'Content-Type': 'text/html; charset=utf-8' },
    statusLine: 'HTTP/1.1 200 OK',
    httpVersion: 'HTTP/1.1',
  });
  const har = toHar([e], {});
  const entry = har.log.entries[0];
  assert.equal(entry.request.method, 'GET');
  assert.equal(entry.request.url, 'https://example.com/path?a=1&b=2');
  assert.equal(entry.request.httpVersion, 'HTTP/1.1');
  assert.deepEqual(entry.request.queryString.sort((x, y) => x.name.localeCompare(y.name)), [
    { name: 'a', value: '1' },
    { name: 'b', value: '2' },
  ]);
  assert.deepEqual(entry.request.headers, [{ name: 'Accept', value: 'text/html' }]);
  assert.equal(entry.response.status, 200);
  assert.equal(entry.response.statusText, 'OK');
  assert.equal(entry.timings.wait, 100); // T0+100 - T0
});

test('toHar handles array-valued headers (cookies / set-cookie)', () => {
  const e = mk({
    id: 'y',
    url: 'https://x.test/',
    method: 'GET',
    responseHeaders: { 'Set-Cookie': ['a=1; HttpOnly', 'b=2'] },
  });
  const har = toHar([e], {});
  const setCookies = har.log.entries[0].response.headers.filter((h) => h.name === 'Set-Cookie');
  assert.equal(setCookies.length, 2);
});
