import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, requestApi } from '../api.js';

test('API surfaces missing plugins, expired login pages and invalid JSON', async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response('Not found', { status: 404 }));
    await assert.rejects(fetchJson('/status'), /未找到服务端/);
    globalThis.fetch = async () => new Response('<html>Login</html>');
    await assert.rejects(fetchJson('/status'), /非 JSON/);
    globalThis.fetch = async () => Response.json({ error: 'key expired' }, { status: 401 });
    await assert.rejects(fetchJson('/check'), /key expired/);
});

test('status checks and generation keep CSRF headers, disable stale caching and never retry', async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        calls.push({ url, init });
        return Response.json({ ok: true });
    });
    await requestApi('generate', { requestId: 'test' }, { 'X-CSRF-Token': 'csrf-test' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/plugins/novelai-story-illustrator/generate');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.headers['X-CSRF-Token'], 'csrf-test');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { requestId: 'test' });
});

test('hanging requests time out, while user cancellation stays AbortError', async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
        calls++;
        return new Promise((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
    });
    await assert.rejects(fetchJson('/status', {}, 5), /请求超时/);
    const controller = new AbortController();
    const pending = fetchJson('/generate', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls, 2);
});
