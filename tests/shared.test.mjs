import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload, composePrompts, resolveImageSize, UC_PRESETS, parseBlocks, normalizeScene, normalizeOptions, DEFAULTS, EXAMPLE_SCENE, makeExampleScene, freeGenerationBlockReason, promptInstruction } from '../shared.js';

test('multiple inline scenes retain punctuation, placement and distinct identities', () => {
    const scene = { scene: 'rain, wind. She says “好久不见，朋友。”', characters: [] };
    const raw = `<nai_image>${JSON.stringify(scene)}</nai_image>`;
    const text = `第一段。\n${raw}\n第二段。\n${raw}`;
    const blocks = parseBlocks(text);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].scene.scene, scene.scene);
    assert.equal(text.slice(blocks[0].start, blocks[0].end), raw);
    assert.notEqual(blocks[0].key, blocks[1].key);
    assert.deepEqual(parseBlocks(text), blocks);
});

test('streaming partial blocks and malformed JSON never become generation requests', () => {
    assert.match(parseBlocks('<nai_image>{"scene":"rain"}')[0].error, /闭合/);
    assert.match(parseBlocks('<nai_image>javascript:alert(1)</nai_image>')[0].error, /JSON/);
    assert.match(parseBlocks('<nai_image>[]</nai_image>')[0].error, /对象/);
    assert.equal(parseBlocks('普通小说，不含绘图指令。').length, 0);
});

test('a fenced JSON body is accepted but code is not evaluated', () => {
    const block = parseBlocks('<nai_image>```json\n{"scene":"forest"}\n```</nai_image>')[0];
    assert.equal(block.scene.scene, 'forest');
    assert.equal(parseBlocks('<nai_image>{"scene": (()=>"forest")()}</nai_image>')[0].scene, undefined);
});

test('V5 payload separates each character and aligns character negative prompts', () => {
    const scene = { scene: '2girls, forest', characters: [
        { prompt: 'girl, black hair', negative: 'blonde hair', position: { x: 0.283, y: 0.5 } },
        { prompt: 'girl, blonde hair', negative: 'black hair', position: { x: 0.817, y: 0.52 } },
    ] };
    const p = buildPayload(scene, { style: 'watercolor', quality: 'none' }, 42);
    assert.equal(p.model, 'nai-diffusion-5-full');
    assert.equal(p.parameters.params_version, 4);
    assert.equal(p.input, 'watercolor, 2girls, forest');
    assert.equal(p.parameters.v4_prompt.use_coords, true);
    assert.equal(p.parameters.v4_prompt.caption.char_captions[0].centers[0].x, 0.283);
    assert.equal(p.parameters.v4_prompt.caption.char_captions[1].char_caption, 'girl, blonde hair');
    assert.equal(p.parameters.v4_negative_prompt.caption.char_captions[1].char_caption, 'black hair');
    assert.equal(p.parameters.n_samples, 1);
    assert.equal(p.parameters.seed, 42);
    assert.equal(p.parameters.qualityToggle, false);
    assert.equal(p.parameters.v5_prompt, undefined);
});

test('scene cannot change backend, model, billing consent or sampling settings', () => {
    const p = buildPayload({ ...EXAMPLE_SCENE, model: 'other', url: 'https://invalid', steps: 500, allowAnlas: true }, DEFAULTS, 1);
    assert.equal(p.url, undefined);
    assert.equal(p.parameters.steps, 23);
    assert.equal(p.model, DEFAULTS.model);
    assert.equal(p.parameters.allowAnlas, undefined);
});

test('scene size overrides global orientation, seed remains reproducible', () => {
    const p = buildPayload({ scene: 'landscape', size: 'landscape' }, { ...DEFAULTS, seed: 123 }, 77);
    assert.equal(p.parameters.width, 1216);
    assert.equal(p.parameters.height, 832);
    assert.equal(p.parameters.seed, 123);
    assert.equal(p.parameters.v4_prompt.use_coords, false);
});

test('malformed positions, excess characters and invalid settings are rejected', () => {
    assert.throws(() => normalizeScene({ scene: 'scene', characters: [{ prompt: 'girl', position: { x: 3, y: 0 } }] }));
    assert.throws(() => normalizeScene({ scene: 'scene', characters: [{ prompt: 'girl', position: { x: 0, y: 0 } }, { prompt: 'boy' }] }));
    assert.throws(() => normalizeScene({ scene: 'scene', characters: Array(23).fill({ prompt: 'girl' }) }));
    assert.throws(() => normalizeOptions({ ...DEFAULTS, allowAnlas: 'false' }));
    assert.throws(() => normalizeOptions({ ...DEFAULTS, steps: NaN }));
    assert.throws(() => normalizeOptions({ ...DEFAULTS, size: '__proto__' }));
});

const opus = { active: true, tier: 3, usage: { percent: 98, isNegative: false } };
test('Opus protection blocks unknown/exhausted quota and paid parameter ranges', () => {
    const p = buildPayload(EXAMPLE_SCENE, DEFAULTS, 0);
    assert.equal(freeGenerationBlockReason(opus, p), '');
    assert.match(freeGenerationBlockReason({ ...opus, usage: null }, p), /未能确认/);
    assert.match(freeGenerationBlockReason({ ...opus, usage: { percent: 0, isNegative: false } }, p), /不足/);
    assert.match(freeGenerationBlockReason({ ...opus, tier: 2 }, p), /Opus/);
    assert.match(freeGenerationBlockReason(opus, buildPayload(EXAMPLE_SCENE, { ...DEFAULTS, steps: 50 }, 0)), /范围/);
});

test('preset instruction contains story-specific appearance notes and count limit', () => {
    const value = promptInstruction({ ...DEFAULTS, maxImages: 3, characterNotes: 'Anna: black hair, scar on left cheek' });
    assert.match(value, /最多 3 个块/);
    assert.match(value, /scar on left cheek/);
    assert.match(value, /<nai_image>/);
});

test('fixed Base inserts the scene verbatim without altering weights or replacement symbols', () => {
    const options = { ...DEFAULTS, basePrompt: 'fur dataset, 1.2::watercolor::, {{scene}}, {{soft edges}}', quality: 'none' };
    const scene = { scene: "2girls. A sign reads $& and $'.", basePrompt: 'overwrite user style', characters: [] };
    const expected = "fur dataset, 1.2::watercolor::, 2girls. A sign reads $& and $'., {{soft edges}}";
    const preview = composePrompts(scene, options);
    const payload = buildPayload(scene, options, 42);
    assert.equal(preview.base, expected);
    assert.equal(payload.input, expected);
    assert.equal(payload.parameters.v4_prompt.caption.base_caption, expected);
});

test('no placeholder appends scene and optional quality only once', () => {
    const fixed = 'watercolor, delicate lines';
    const scene = { scene: '1girl. A quiet room.' };
    assert.equal(composePrompts(scene, { ...DEFAULTS, basePrompt: fixed, quality: 'none' }).base, `${fixed}, ${scene.scene}`);
    assert.equal(composePrompts(scene, { ...DEFAULTS, basePrompt: fixed }).base, `${fixed}, ${scene.scene}, very aesthetic, amazing quality, no text`);
    assert.throws(() => normalizeOptions({ basePrompt: '{{scene}}, {{scene}}' }), /最多使用一个/);
});

test('legacy style settings migrate while explicit empty Base clears the old value', () => {
    const migrated = normalizeOptions({ style: '{{watercolor}}, detailed' });
    assert.equal(migrated.basePrompt, '{{watercolor}}, detailed');
    assert.equal(migrated.style, undefined);
    assert.equal(normalizeOptions({ style: 'old', basePrompt: '' }).basePrompt, '');
});

test('each natural-language character gets its own gender prefix and matching negative', () => {
    const scene = { scene: '1girl, 1boy. A room.', characters: [
        { name: '甲', gender: 'girl', description: 'An adult woman in a red coat. She holds a cup, smiling at the man.', negative: 'blue coat', position: { x: 0.23, y: 0.6 } },
        { name: '乙', gender: 'boy', description: '一名成年男子，短黑发。他穿着蓝色外套，伸手接过杯子。', negative: 'red coat', position: { x: 0.78, y: 0.5 } },
    ] };
    const payload = buildPayload(scene, { ...DEFAULTS, basePrompt: 'watercolor', quality: 'none' }, 1);
    const preview = composePrompts(scene, { ...DEFAULTS, basePrompt: 'watercolor', quality: 'none' });
    for (let index = 0; index < 2; index++) {
        const person = scene.characters[index];
        const expected = `${person.gender}, ${person.description}`;
        assert.equal(payload.parameters.v4_prompt.caption.char_captions[index].char_caption, expected);
        assert.equal(preview.characters[index].prompt, expected);
        assert.equal(payload.parameters.v4_negative_prompt.caption.char_captions[index].char_caption, person.negative);
    }
    assert.equal(payload.input.includes('red coat'), false);
    assert.equal(preview.characters[0].prompt.includes('watercolor'), false);
    assert.deepEqual(normalizeScene(normalizeScene(scene)), normalizeScene(scene));
});

test('structured character gender is explicit and not guessed from clothing', () => {
    assert.throws(() => normalizeScene({ scene: 'scene', characters: [{ description: 'Long hair and a dress.' }] }), /gender/);
    assert.throws(() => normalizeScene({ scene: 'scene', characters: [{ gender: 'girl', description: '' }] }), /描述/);
    assert.throws(() => normalizeScene({ scene: 'scene', characters: [{ gender: 'female', description: 'A woman.' }] }), /gender/);
    assert.equal(composePrompts({ scene: 'scene', characters: [{ gender: 'other', description: 'A clockwork automaton.' }] }, DEFAULTS).characters[0].prompt, 'other, A clockwork automaton.');
});

test('injected instructions include custom guidance and selected language, never the fixed Base', () => {
    const value = promptInstruction({ ...DEFAULTS, basePrompt: 'MY_PRIVATE_STYLE_PREFIX', descriptionLanguage: 'zh', promptGuidance: '优先表现角色手部动作。' });
    assert.match(value, /中文自然语言/);
    assert.match(value, /优先表现角色手部动作/);
    assert.match(value, /"gender":"girl"/);
    assert.match(value, /"description":/);
    assert.equal(value.includes('MY_PRIVATE_STYLE_PREFIX'), false);
});

test('fixed proportions always override a conflicting model choice for all three sizes', () => {
    const sizes = { portrait: [832, 1216], landscape: [1216, 832], square: [1024, 1024] };
    for (const [choice, expected] of Object.entries(sizes)) {
        for (const proposed of Object.keys(sizes)) {
            const scene = { scene: 'A room.', size: proposed, width: 8192, height: 8192 };
            const options = { ...DEFAULTS, sizeMode: 'fixed', size: choice };
            const preview = resolveImageSize(scene, options);
            const payload = buildPayload(scene, options, 1);
            assert.equal(preview.source, 'fixed');
            assert.deepEqual([preview.width, preview.height], expected);
            assert.deepEqual([payload.parameters.width, payload.parameters.height], expected);
            assert.equal(freeGenerationBlockReason(opus, payload), '');
        }
    }
});

test('auto proportions respect model choice and fall back only when size is missing', () => {
    for (const size of ['portrait', 'landscape', 'square']) {
        assert.equal(resolveImageSize({ scene: 'scene', size }, { ...DEFAULTS, size: 'square' }).preset, size);
        assert.equal(resolveImageSize({ scene: 'scene', size }, DEFAULTS).source, 'model');
    }
    assert.deepEqual(resolveImageSize({ scene: 'scene' }, { ...DEFAULTS, size: 'square' }), { preset: 'square', width: 1024, height: 1024, source: 'fallback' });
    assert.throws(() => resolveImageSize({ scene: 'scene', size: '4k' }, DEFAULTS));
    assert.throws(() => normalizeOptions({ sizeMode: 'random' }));
});

test('official Light UC is the complete V5 preset with its matching API hint', () => {
    const expected = 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::';
    const p = buildPayload(EXAMPLE_SCENE, DEFAULTS, 1).parameters;
    assert.equal(p.negative_prompt, expected);
    assert.equal(p.v4_negative_prompt.caption.base_caption, expected);
    assert.equal(p.tag_hint_uc_preset, 3);
    assert.equal(p.v4_negative_prompt.caption.char_captions[0].char_caption, '');
});

test('official UC and user additions retain punctuation; model main UC requires opt-in', () => {
    const scene = { scene: 'scene', negative: 'unwanted rain', characters: [{ gender: 'girl', description: 'A woman.', negative: 'blue coat, striped sleeves' }] };
    const options = { ...DEFAULTS, ucPreset: 'humanFocus', negative: '1.2::tattoo, scars::' };
    const base = `${UC_PRESETS.humanFocus.text}, 1.2::tattoo, scars::`;
    assert.equal(composePrompts(scene, options).negative, base);
    assert.equal(composePrompts(scene, { ...options, allowSceneNegative: true }).negative, `${base}, unwanted rain`);
    assert.equal(composePrompts(scene, options).characters[0].negative, 'blue coat, striped sleeves');
    assert.equal(buildPayload(scene, options, 1).parameters.tag_hint_uc_preset, 4);
});

test('custom UC can replace all defaults or remain empty without model overrides', () => {
    const scene = { scene: 'scene', negative: 'model-added', ucPreset: 'heavy' };
    for (const negative of ['text, watermark', '']) {
        const options = { ...DEFAULTS, ucPreset: 'custom', negative };
        const payload = buildPayload(scene, options, 1);
        assert.equal(payload.parameters.negative_prompt, negative);
        assert.equal(payload.parameters.v4_negative_prompt.caption.base_caption, negative);
        assert.equal(payload.parameters.tag_hint_uc_preset, 0);
    }
    assert.throws(() => normalizeOptions({ ucPreset: '__proto__' }));
    assert.throws(() => normalizeOptions({ allowSceneNegative: 'false' }));
});

test('old user UC is preserved and only the untouched stock preset is upgraded', () => {
    const stock = normalizeOptions({ negative: 'lowres, bad hands, bad anatomy, artistic error, worst quality, jpeg artifacts' });
    assert.equal(stock.ucPreset, 'light');
    assert.equal(stock.negative, '');
    for (const negative of ['', '{{text}}, 0.7::tattoo::']) {
        const migrated = normalizeOptions({ negative });
        assert.equal(migrated.ucPreset, 'custom');
        assert.equal(migrated.negative, negative);
        assert.equal(migrated.allowSceneNegative, true);
        assert.deepEqual(normalizeOptions(migrated), migrated);
    }
});

test('preset instructions match size policy and user control of main UC', () => {
    const auto = promptInstruction(DEFAULTS);
    for (const size of ['832×1216', '1216×832', '1024×1024']) assert.ok(auto.includes(size));
    assert.match(auto, /不要输出顶层 negative/);
    const fixed = promptInstruction({ ...DEFAULTS, sizeMode: 'fixed', size: 'square', allowSceneNegative: true });
    assert.match(fixed, /"size":"square"/);
    assert.match(fixed, /用户固定了图片比例/);
    assert.match(fixed, /可在顶层 negative 补充/);
});

test('inline actions reach only their own character caption with weights and interaction prefixes intact', () => {
    const scene = { scene: '1girl, 1boy, indoors, bedroom, backlighting', characters: [
        { gender: 'girl', description: 'An adult woman with black hair.', actions: 'standing, 1.2::source#hug, smile::, eyes closed', negative: 'blonde hair' },
        { gender: 'boy', description: 'An adult man with blonde hair.', actions: 'standing, target#hug, surprised, looking at another', negative: 'black hair' },
    ] };
    const parsed = parseBlocks(`<nai_image>${JSON.stringify(scene)}</nai_image>`)[0].scene;
    assert.deepEqual(normalizeScene(parsed), parsed);
    for (const actionMode of ['tags', 'natural']) {
        const options = { ...DEFAULTS, actionMode, basePrompt: 'watercolor, {{scene}}', quality: 'none' };
        const preview = composePrompts(parsed, options);
        const payload = buildPayload(parsed, options, 42);
        assert.equal(payload.input, 'watercolor, ' + scene.scene);
        assert.equal(payload.parameters.v4_prompt.caption.base_caption, preview.base);
        scene.characters.forEach((person, index) => {
            const expected = `${person.gender}, ${person.description}, ${person.actions}`;
            assert.equal(preview.characters[index].prompt, expected);
            assert.equal(payload.parameters.v4_prompt.caption.char_captions[index].char_caption, expected);
            assert.equal(payload.parameters.v4_negative_prompt.caption.char_captions[index].char_caption, person.negative);
        });
    }
});

test('optional actions preserve older prompts and natural-language punctuation without rewriting', () => {
    for (const actions of [undefined, null, '']) {
        const scene = { scene: 'indoors', characters: [{ gender: 'girl', description: 'An adult woman sitting.', actions }] };
        assert.equal(composePrompts(scene, DEFAULTS).characters[0].prompt, 'girl, An adult woman sitting.');
    }
    const actions = '她举起杯子，向右侧的同伴示意；微笑。';
    const scene = { scene: 'indoors', characters: [{ prompt: 'girl, black hair', actions }] };
    assert.equal(composePrompts(scene, DEFAULTS).characters[0].prompt, `girl, black hair, ${actions}`);
    for (const invalid of [42, ['sitting'], {}, 'x'.repeat(4001)]) {
        assert.throws(() => normalizeScene({ ...scene, characters: [{ prompt: 'girl', actions: invalid }] }), /人物动作/);
    }
});

test('older settings get tag actions by default while a saved natural mode remains selected', () => {
    assert.equal(normalizeOptions({ basePrompt: 'kept', ucPreset: 'custom' }).actionMode, 'tags');
    const custom = normalizeOptions({ actionMode: 'natural', descriptionLanguage: 'zh', promptGuidance: 'keep my rule' });
    assert.deepEqual(normalizeOptions(custom), custom);
    assert.throws(() => normalizeOptions({ actionMode: 'invented' }), /人物动作写法/);
});

test('copied instructions and UI examples use the selected action mode with compact environment tags', () => {
    for (const actionMode of ['tags', 'natural']) {
        for (const descriptionLanguage of ['en', 'zh']) {
            const options = { ...DEFAULTS, actionMode, descriptionLanguage, sizeMode: 'fixed', size: 'square' };
            const example = makeExampleScene(options);
            const prompt = promptInstruction(options);
            const parsed = parseBlocks(prompt).find(block => block.scene)?.scene;
            assert.deepEqual(parsed, normalizeScene(example));
            assert.equal(example.size, 'square');
            assert.equal(example.scene, EXAMPLE_SCENE.scene);
            assert.ok(example.scene.split(',').length <= 7);
            assert.ok(!example.scene.includes('sitting') && !example.scene.includes('holding'));
            assert.ok(prompt.includes('actions 专门写这个人此刻可见的姿势'));
            if (actionMode === 'tags') {
                assert.equal(example.characters[0].actions, 'sitting, holding cup, looking away, smile');
                assert.match(prompt, /actions 使用 Danbooru/);
            } else {
                assert.match(example.characters[0].actions, descriptionLanguage === 'zh' ? /她坐在/ : /She sits/);
                assert.ok(!prompt.includes('source#hug'));
            }
        }
    }
    assert.equal(EXAMPLE_SCENE.size, 'portrait');
    assert.match(EXAMPLE_SCENE.characters[0].description, /^An adult woman/);
});
