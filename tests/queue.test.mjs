import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageQueue, sameTarget, GenerationTracker } from '../queue.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('image requests run serially and duplicate events do not bill twice', async () => {
    const queue = new ImageQueue();
    const log = [];
    let release;
    const job = { id: '1', valid: () => true, run: () => new Promise(resolve => { release = resolve; log.push('start1'); }), complete: () => log.push('done1') };
    assert.equal(queue.enqueue(job), true);
    assert.equal(queue.enqueue(job), false);
    queue.enqueue({ id: '2', valid: () => true, run: async () => { log.push('start2'); }, complete: () => log.push('done2') });
    assert.deepEqual(log, ['start1']);
    release();
    await tick();
    assert.deepEqual(log, ['start1', 'done1', 'start2', 'done2']);
});

test('chat changes discard stale results even when the request cannot be cancelled', async () => {
    const queue = new ImageQueue();
    let release;
    let valid = true;
    let committed = false;
    queue.enqueue({ id: '1', valid: () => valid, run: () => new Promise(resolve => { release = resolve; }), complete: () => { committed = true; } });
    valid = false;
    release('old image');
    await tick();
    assert.equal(committed, false);
    assert.equal(queue.active, null);
});

test('cancelling aborts active work and removes queued work', async () => {
    const queue = new ImageQueue();
    let signal;
    let secondStarted = false;
    queue.enqueue({ id: '1', valid: () => true, run: async value => { signal = value; await new Promise(resolve => value.addEventListener('abort', resolve)); }, complete: () => assert.fail('cancelled image attached') });
    queue.enqueue({ id: '2', valid: () => true, run: async () => { secondStarted = true; }, complete: () => {} });
    queue.cancel();
    await tick();
    assert.equal(signal.aborted, true);
    assert.equal(secondStarted, false);
    assert.equal(queue.ids.size, 0);
});

test('target identity tracks edits, branch changes, deletions and separate chats', () => {
    const message = { mes: 'novel', swipe_id: 0 };
    const context = { getCurrentChatId: () => 'chat', characterId: 4, groupId: null, chat: [message] };
    const target = { chatId: 'chat', characterId: 4, groupId: null, index: 0, message, text: 'novel', swipe: 0 };
    assert.equal(sameTarget(context, target), true);
    message.swipe_id = 1;
    assert.equal(sameTarget(context, target), false);
    message.swipe_id = 0;
    message.mes = 'edited';
    assert.equal(sameTarget(context, target), false);
    message.mes = 'novel';
    assert.equal(sameTarget({ ...context, characterId: 5 }, target), false);
    assert.equal(sameTarget({ ...context, chat: [{ ...message }] }, target), false);
    assert.equal(sameTarget({ ...context, getCurrentChatId: () => 'elsewhere' }, target), false);
});

test('streaming: end-before-render still produces exactly one image task', () => {
    const tracker = new GenerationTracker();
    tracker.start('chat');
    assert.deepEqual(tracker.ended('chat'), []);
    assert.deepEqual(tracker.rendered('chat', 3), [3]);
    assert.deepEqual(tracker.rendered('chat', 3), []);
    assert.deepEqual(tracker.ended('chat'), []);
    assert.deepEqual(tracker.rendered('chat', 4), []);
});

test('non-streaming: render-before-end waits for completion and ignores stopped/other chats', () => {
    const tracker = new GenerationTracker();
    tracker.start('chat');
    assert.deepEqual(tracker.rendered('chat', 3), []);
    assert.deepEqual(tracker.ended('other'), []);
    assert.deepEqual(tracker.ended('chat'), [3]);
    tracker.start('chat');
    tracker.rendered('chat', 4);
    tracker.clear();
    assert.deepEqual(tracker.ended('chat'), []);
});
