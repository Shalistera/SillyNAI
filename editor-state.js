import { composePrompts, resolveImageSize, normalizeScene, normalizeImageOverrides, InputError } from './shared.js';

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
