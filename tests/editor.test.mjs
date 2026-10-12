import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDraft, editorDraftToRequest, createLargeRedraw, largeSizeForImage } from '../editor-state.js';
import { DEFAULTS, EXAMPLE_SCENE, composePrompts, buildPayload, normalizeImageOverrides, freeGenerationBlockReason } from '../shared.js';

test('visual editing round-trips structured and legacy character prompts including positions', () => {
    const scene = { scene: '1girl, 1boy, indoors', characters: [
        { gender: 'girl', description: 'black hair', actions: 'holding cup, smile', negative: 'blue hair', position: { x: 0.271, y: 0.52 } },
        { name: '乙', prompt: 'boy, blonde hair, reading', negative: 'black hair', position: { x: 0.781, y: 0.61 } },
    ] };
    const options = { ...DEFAULTS, basePrompt: 'watercolor, {{scene}}', sizeMode: 'fixed', size: 'square' };
    const before = structuredClone({ scene, options });
    const draft = createEditorDraft(scene, options);
    const edited = editorDraftToRequest(draft, scene);
    const original = buildPayload(scene, options, 42);
    const payload = buildPayload(edited.scene, options, 42, edited.imageOverrides);
    assert.deepEqual(payload.parameters.v4_prompt, original.parameters.v4_prompt);
    assert.deepEqual(payload.parameters.v4_negative_prompt, original.parameters.v4_negative_prompt);
    assert.equal(payload.parameters.width, original.parameters.width);
    assert.equal(edited.scene.characters[0].prompt, 'girl, black hair, holding cup, smile');
    assert.deepEqual({ scene, options }, before);
});

test('per-image main prompts replace all automatic additions and survive save/reload and global changes', () => {
    const draft = createEditorDraft(EXAMPLE_SCENE, DEFAULTS);
    draft.base = '  1girl, outdoors, {{watercolor}}, 1.2::sunlight::\n$& {{scene}}  ';
    draft.negative = '';
    const saved = JSON.parse(JSON.stringify(editorDraftToRequest(draft, EXAMPLE_SCENE)));
    const laterOptions = { ...DEFAULTS, basePrompt: 'new global style', negative: 'extra global UC', ucPreset: 'heavy', quality: 'standard' };
    const reopened = createEditorDraft(saved.scene, laterOptions, saved.imageOverrides);
    assert.equal(reopened.base, draft.base);
    assert.equal(reopened.negative, '');
    const payload = buildPayload(saved.scene, laterOptions, 1, saved.imageOverrides);
    assert.equal(payload.input, draft.base);
    assert.equal(payload.parameters.v4_prompt.caption.base_caption, draft.base);
    assert.equal(payload.parameters.negative_prompt, '');
    assert.equal(payload.parameters.v4_negative_prompt.caption.base_caption, '');
    assert.equal(payload.parameters.tag_hint_uc_preset, 0);
    assert.ok(composePrompts(EXAMPLE_SCENE, laterOptions).base.includes('new global style'));
    assert.ok(composePrompts(EXAMPLE_SCENE, laterOptions).negative.includes('extra global UC'));
});

test('character additions, deletions and reordering retain prompt/negative/coordinate pairing', () => {
    const draft = createEditorDraft(EXAMPLE_SCENE, DEFAULTS);
    draft.characters.push({ name: '乙', prompt: 'boy, reading', negative: 'cup', x: 0.8, y: 0.6 });
    draft.characters.reverse();
    draft.manualPositions = true;
    let edited = editorDraftToRequest(draft, EXAMPLE_SCENE);
    let caption = buildPayload(edited.scene, DEFAULTS, 1, edited.imageOverrides).parameters;
    assert.equal(caption.v4_prompt.caption.char_captions[0].char_caption, 'boy, reading');
    assert.equal(caption.v4_negative_prompt.caption.char_captions[0].char_caption, 'cup');
    assert.deepEqual(caption.v4_prompt.caption.char_captions[0].centers, [{ x: 0.8, y: 0.6 }]);
    draft.characters.splice(1, 1);
    draft.manualPositions = false;
    edited = editorDraftToRequest(draft, EXAMPLE_SCENE);
    caption = buildPayload(edited.scene, DEFAULTS, 1, edited.imageOverrides).parameters;
    assert.equal(caption.v4_prompt.use_coords, false);
    assert.equal(caption.v4_prompt.caption.char_captions.length, 1);
    assert.equal(edited.scene.characters[0].position, undefined);
    draft.characters = [];
    draft.base = 'forest, sunlight';
    assert.equal(editorDraftToRequest(draft, EXAMPLE_SCENE).scene.characters.length, 0);
    draft.base = '';
    assert.throws(() => editorDraftToRequest(draft, EXAMPLE_SCENE), /主提示词或/);
});

test('per-image size wins over global size without allowing model, cost or arbitrary dimension overrides', () => {
    const options = { ...DEFAULTS, sizeMode: 'fixed', size: 'portrait' };
    const payload = buildPayload({ ...EXAMPLE_SCENE, imageOverrides: { base: 'model overwrite' } }, options, 1,
        { size: 'square', width: 4096, height: 4096, model: 'evil', allowAnlas: true, steps: 50 });
    assert.equal(payload.parameters.width, 1024);
    assert.equal(payload.parameters.height, 1024);
    assert.equal(payload.model, DEFAULTS.model);
    assert.equal(payload.parameters.steps, 23);
    assert.ok(!payload.input.includes('model overwrite'));
    assert.equal(freeGenerationBlockReason({ active: true, tier: 3, usage: { percent: 100, isNegative: false } }, payload), '');
    for (const value of [{ size: '4k' }, { base: null }, { negative: [] }, { base: 'x'.repeat(32001) }]) assert.throws(() => normalizeImageOverrides(value));
});

test('invalid editor character values are rejected before saving', () => {
    const draft = createEditorDraft(EXAMPLE_SCENE, DEFAULTS);
    draft.manualPositions = true;
    draft.characters[0].x = NaN;
    assert.throws(() => editorDraftToRequest(draft, EXAMPLE_SCENE), /x/);
    draft.characters[0].x = 0.5;
    draft.characters[0].prompt = ' ';
    assert.throws(() => editorDraftToRequest(draft, EXAMPLE_SCENE), /人物提示词/);
    draft.characters[0].prompt = 'girl';
    draft.characters = Array.from({ length: 23 }, () => ({ ...draft.characters[0] }));
    assert.throws(() => editorDraftToRequest(draft, EXAMPLE_SCENE), /22/);
});

test('Large redraw uses all three dimensions and the current image seed without changing regular settings', () => {
    const options = { ...DEFAULTS, seed: 99, sizeMode: 'fixed', size: 'portrait', allowAnlas: false };
    const imageOverrides = { base: '1girl, garden, watercolor', negative: 'text' };
    const before = structuredClone({ options, imageOverrides });
    for (const [width, height, size, largeWidth, largeHeight] of [[1216, 832, 'landscape', 1536, 1024], [832, 1216, 'portrait', 1024, 1536], [1024, 1024, 'square', 1472, 1472]]) {
        const record = { width, height, seed: 0 };
        assert.equal(largeSizeForImage(record), size);
        const redraw = createLargeRedraw(record, options, imageOverrides);
        assert.equal(redraw.options.allowAnlas, true);
        const payload = buildPayload(EXAMPLE_SCENE, redraw.options, 456, redraw.imageOverrides);
        assert.equal(payload.parameters.width, largeWidth);
        assert.equal(payload.parameters.height, largeHeight);
        assert.equal(payload.parameters.seed, 0);
        assert.equal(payload.parameters.n_samples, 1);
        assert.equal(payload.input, imageOverrides.base);
        assert.equal(payload.parameters.negative_prompt, imageOverrides.negative);
    }
    assert.deepEqual({ options, imageOverrides }, before);
    const regular = buildPayload(EXAMPLE_SCENE, options, 456, imageOverrides);
    assert.equal(regular.parameters.width, 832);
    assert.equal(regular.parameters.height, 1216);
    assert.equal(regular.parameters.seed, 99);
});

test('unchecking seed retention randomizes even when global seed is fixed and preserves edited prompts', () => {
    const redraw = createLargeRedraw({ width: 1536, height: 1024, seed: 123 }, { ...DEFAULTS, seed: 99 }, { base: 'custom', negative: '' }, { keepSeed: false, size: 'square' });
    const payload = buildPayload(EXAMPLE_SCENE, redraw.options, 456, redraw.imageOverrides);
    assert.equal(payload.parameters.seed, 456);
    assert.equal(payload.parameters.width, 1472);
    assert.equal(payload.parameters.height, 1472);
    assert.equal(payload.input, 'custom');
    assert.equal(payload.parameters.negative_prompt, '');
    assert.throws(() => createLargeRedraw({ width: 1024, height: 1024 }, DEFAULTS), /Seed/);
    assert.equal(createLargeRedraw({ width: 1024, height: 1024 }, DEFAULTS, {}, { keepSeed: false }).options.seed, -1);
    assert.throws(() => createLargeRedraw({ width: 1024, height: 1024, seed: 1 }, DEFAULTS, {}, { keepSeed: 'false' }), /布尔/);
    assert.throws(() => normalizeImageOverrides({ resolution: 'huge' }), /分辨率/);
    assert.throws(() => largeSizeForImage({ width: 0, height: 10 }), /先生成/);
});
