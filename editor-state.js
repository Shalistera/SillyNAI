import { composePrompts, resolveImageSize, normalizeScene, normalizeOptions, normalizeImageOverrides, InputError } from './shared.js';

export function largeSizeForImage(record) {
    if (!record || !Number.isFinite(record.width) || !Number.isFinite(record.height) || record.width <= 0 || record.height <= 0) {
        throw new InputError('请先生成一张图片，再进行高清重画。');
    }
    return record.width === record.height ? 'square' : record.width > record.height ? 'landscape' : 'portrait';
}

export function createLargeRedraw(record, options, imageOverrides = {}, { keepSeed = true, size = largeSizeForImage(record) } = {}) {
    if (typeof keepSeed !== 'boolean') throw new InputError('沿用 Seed 必须是布尔值。');
    if (keepSeed && (!Number.isInteger(record?.seed) || record.seed < 0 || record.seed > 4294967295)) {
        throw new InputError('当前图片没有有效 Seed，请取消“沿用当前 Seed”。');
    }
    return {
        options: normalizeOptions({ ...options, seed: keepSeed ? record.seed : -1, allowAnlas: true }),
        imageOverrides: normalizeImageOverrides({ ...imageOverrides, size, resolution: 'large' }),
    };
}

export function createEditorDraft(sceneInput, options, imageOverrides = {}) {
    const scene = normalizeScene(sceneInput);
    const prompts = composePrompts(scene, options, imageOverrides);
    return {
        title: scene.title,
        base: prompts.base,
        negative: prompts.negative,
        size: resolveImageSize(scene, options, imageOverrides).preset,
        manualPositions: scene.characters.some(person => person.position),
        characters: prompts.characters.map((person, index) => ({
            name: person.name, prompt: person.prompt, negative: person.negative,
            x: person.position?.x ?? (index + 0.5) / prompts.characters.length,
            y: person.position?.y ?? 0.5,
        })),
    };
}

export function editorDraftToRequest(draft, originalScene) {
    if (!draft.base.trim() && !draft.characters.length) throw new InputError('请填写主提示词或添加一个角色。');
    const imageOverrides = normalizeImageOverrides({ base: draft.base, negative: draft.negative, size: draft.size });
    const scene = normalizeScene({
        ...originalScene,
        title: draft.title,
        size: draft.size,
        characters: draft.characters.map(person => ({
            name: person.name, prompt: person.prompt, negative: person.negative,
            ...(draft.manualPositions ? { position: { x: person.x, y: person.y } } : {}),
        })),
    });
    return { scene, imageOverrides };
}
