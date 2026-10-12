import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createService } from '../service.mjs';
import { DEFAULTS, EXAMPLE_SCENE } from '../shared.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9e8AAAAASUVORK5CYII=', 'base64');
const account = { active: true, tier: 3, usage: { percent: 95, isNegative: false }, trainingStepsLeft: { fixedTrainingStepsLeft: 10000, purchasedTrainingSteps: 0 }, privateAccountData: 'not for client' };
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' }, status: 200 });
const input = overrides => ({ user: 'test-user', key: 'private-test-token', requestId: randomUUID(), scene: EXAMPLE_SCENE, options: DEFAULTS, ...overrides });

function fixture(fetchOverride, options = {}) {
    const calls = [];
    const saved = [];
    const service = createService({
        fetch: async (url, init) => {
            calls.push({ url, init });
            return fetchOverride ? fetchOverride(url, init) : url.endsWith('/subscription') ? json(account) : json({ images: [{ image: png.toString('base64'), seed: 12 }] });
        },
        saveImage: async (user, buffer) => { saved.push({ user, buffer }); return 'user/images/novelai-story-illustrator/test-123.png'; },
        extractPng: async () => png,
        seed: () => 12,
        ...options,
    });
    return { service, calls, saved };
}

test('one request authenticates to official API, checks subscription, and persists PNG', async () => {
    const f = fixture();
    const result = await f.service.generate(input());
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[0].url, 'https://image.novelai.net/user/subscription');
    assert.equal(f.calls[1].url, 'https://image.novelai.net/ai/generate-image');
    assert.equal(f.calls[1].init.headers.Authorization, 'Bearer private-test-token');
    const payload = JSON.parse(f.calls[1].init.body);
    const person = EXAMPLE_SCENE.characters[0];
    assert.equal(payload.parameters.v4_prompt.caption.char_captions.length, 1);
    assert.equal(payload.parameters.v4_prompt.caption.char_captions[0].char_caption, `${person.gender}, ${person.description}, ${person.actions}`);
    assert.equal(payload.input.includes(person.actions), false);
    assert.deepEqual(f.saved[0].buffer, png);
    assert.equal(result.seed, 12);
    assert.equal(JSON.stringify(result).includes('private-test-token'), false);
});

test('subscription response reveals only connection, quota and balance information', async () => {
    const data = await fixture().service.subscription('test');
    assert.equal(data.privateAccountData, undefined);
    assert.equal(data.tier, 3);
    assert.equal(data.anlas.subscription, 10000);
});

test('missing credential and invalid options never contact upstream', async () => {
    const f = fixture();
    await assert.rejects(f.service.generate(input({ key: '' })), /API Key/);
    await assert.rejects(f.service.generate(input({ options: { ...DEFAULTS, model: 'evil' } })), /V5/);
    assert.equal(f.calls.length, 0);
});

test('completed request id is idempotent, reuse with other parameters is rejected', async () => {
    const f = fixture();
    const job = input();
    assert.deepEqual(await f.service.generate(job), await f.service.generate(job));
    assert.equal(f.calls.length, 2);
    assert.equal(f.saved.length, 1);
    await assert.rejects(f.service.generate({ ...job, scene: { scene: 'different' } }), /编号/);
});

test('exhausted quota blocks generation until the user explicitly allows Anlas', async () => {
    const f = fixture(url => url.endsWith('/subscription') ? json({ ...account, usage: { percent: -1, isNegative: true } }) : json({ images: [{ image: png.toString('base64') }] }));
    await assert.rejects(f.service.generate(input()), /已停止出图/);
    assert.equal(f.calls.length, 1);
    await f.service.generate(input({ options: { ...DEFAULTS, allowAnlas: true } }));
    assert.equal(f.saved.length, 1);
});

test('upstream errors are specific, redact bodies and never retry generation', async () => {
    const f = fixture(() => new Response('private-test-token', { status: 429 }));
    await assert.rejects(f.service.generate(input({ options: { ...DEFAULTS, allowAnlas: true } })), error => error.status === 429 && /稍后/.test(error.message) && !error.message.includes('private-test-token'));
    assert.equal(f.calls.length, 1);
});

test('ZIP responses remain compatible and invalid PNG data is refused', async () => {
    const f = fixture(() => new Response(new Uint8Array([80, 75]), { headers: { 'Content-Type': 'application/zip' } }));
    await f.service.generate(input({ options: { ...DEFAULTS, allowAnlas: true } }));
    assert.equal(f.saved.length, 1);
    const bad = fixture(() => json({ images: [{ image: Buffer.from('<script>evil</script>').toString('base64') }] }));
    await assert.rejects(bad.service.generate(input({ options: { ...DEFAULTS, allowAnlas: true } })), /PNG/);
    assert.equal(bad.saved.length, 0);
});

test('per-user concurrent generation is refused; cancellation releases the lock', async () => {
    let started;
    const waiting = new Promise(resolve => { started = resolve; });
    const f = fixture((url, init) => new Promise((resolve, reject) => {
        started();
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const controller = new AbortController();
    const promise = f.service.generate(input({ options: { ...DEFAULTS, allowAnlas: true }, signal: controller.signal }));
    await waiting;
    await assert.rejects(f.service.generate(input()), error => error.status === 409);
    controller.abort();
    await assert.rejects(promise, error => error.status === 408);
    assert.equal(f.saved.length, 0);
});

test('timeout is surfaced without an automatic paid retry', async () => {
    const f = fixture((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')))), { timeoutMs: 10 });
    await assert.rejects(f.service.generate(input({ options: { ...DEFAULTS, allowAnlas: true } })), error => error.status === 408);
    assert.equal(f.calls.length, 1);
});
