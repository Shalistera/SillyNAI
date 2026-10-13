import test from 'node:test';
import assert from 'node:assert/strict';
import { serverCapabilities, serverSummary, prepareGeneration } from '../compatibility.js';
import { EXAMPLE_SCENE, DEFAULTS, buildPayload } from '../shared.js';

const backend = policy => serverCapabilities({ version: `0.${policy + 1}.0`, promptSchema: 3, generationPolicy: policy, keySaved: true });
const body = () => ({ requestId: 'one-request', scene: structuredClone(EXAMPLE_SCENE), options: { ...DEFAULTS, seed: 123, basePrompt: 'watercolor, {{scene}}' } });

test('0.4 and 0.5 backends support standard generation without claiming Large', () => {
    for (const policy of [3, 4, 5]) {
        const caps = backend(policy);
        assert.equal(caps.standard, true);
        assert.equal(caps.large, policy >= 5);
        assert.equal(caps.imageOverrides, policy >= 4);
        assert.equal(caps.keySaved, true);
        assert.match(serverSummary(caps), new RegExp(`0\\.${policy + 1}\\.0`));
        assert.doesNotThrow(() => prepareGeneration(body(), caps));
    }
    assert.equal(serverCapabilities().standard, false);
    assert.throws(() => prepareGeneration(body(), serverCapabilities({ generationPolicy: 5 })), /更新服务端/);
});

test('legacy translation retains original structured characters, actions, positions and UC hint', () => {
    const input = body();
    input.scene.characters[0].position = { x: 0.25, y: 0.75 };
    input.options.ucPreset = 'heavy';
    const request = prepareGeneration(input, backend(3));
    assert.deepEqual(buildPayload(request.scene, request.options, 0), buildPayload(input.scene, input.options, 0));
    assert.equal(request.options.allowAnlas, false);
    assert.equal(request.requestId, input.requestId);
});

test('0.4 translation applies visual Base, empty UC, complete characters and fixed per-image size', () => {
    const input = body();
    input.imageOverrides = { base: 'watercolor, 1girl, garden, {{weighted}}, $&', negative: '', size: 'square' };
    input.scene.characters = [{ prompt: 'girl, black hair, sitting, holding cup', negative: 'hat', position: { x: 0.2, y: 0.6 } }];
    input.options.allowSceneNegative = true;
    input.scene.negative = 'old-scene-negative';
    const copy = structuredClone(input);
    const request = prepareGeneration(input, backend(3));
    assert.equal(request.imageOverrides, undefined);
    assert.deepEqual(buildPayload(request.scene, request.options, 0), buildPayload(input.scene, input.options, 0, input.imageOverrides));
    assert.deepEqual(input, copy);
});

test('legacy limits fail before generation instead of truncating or silently ignoring overrides', () => {
    for (const overrides of [{ base: '' }, { base: 'x'.repeat(12001) }, { negative: 'x'.repeat(8001) }]) {
        assert.throws(() => prepareGeneration({ ...body(), imageOverrides: overrides }, backend(3)), /旧服务端/);
    }
    const input = body();
    input.scene.characters = [{ prompt: 'x'.repeat(8001) }];
    assert.throws(() => prepareGeneration(input, backend(3)), /旧服务端/);
    assert.doesNotThrow(() => prepareGeneration(input, backend(4)));
});

test('Large is rejected for old backends before a paid request; supported backends retain exact values', () => {
    const input = body();
    input.imageOverrides = { resolution: 'large', size: 'landscape', base: 'edited base', negative: '' };
    input.options.allowAnlas = true;
    for (const policy of [3, 4]) assert.throws(() => prepareGeneration(input, backend(policy)), /Large/);
    const request = prepareGeneration(input, backend(5));
    const payload = buildPayload(request.scene, request.options, 0, request.imageOverrides);
    assert.equal(payload.input, 'edited base');
    assert.equal(payload.parameters.width, 1536);
    assert.equal(payload.parameters.height, 1024);
    assert.equal(payload.parameters.seed, 123);
    assert.equal(payload.parameters.negative_prompt, '');
});
