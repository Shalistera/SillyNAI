import { InputError, normalizeScene, normalizeOptions, normalizeImageOverrides } from './shared.js';

export function serverCapabilities(status = {}) {
    const standard = status.promptSchema >= 3 && status.generationPolicy >= 3;
    return {
        version: typeof status.version === 'string' ? status.version : '未知',
        standard,
        imageOverrides: standard && status.generationPolicy >= 4,
        large: standard && status.generationPolicy >= 5,
        keySaved: status.keySaved === true,
    };
}

export function serverSummary(capabilities) {
    const prefix = `服务端 ${capabilities.version}`;
    if (!capabilities.standard) return `${prefix}：请更新服务端到 0.4.0 或更新版本并重启酒馆。`;
    const features = capabilities.large ? '常规出图、可视化编辑、Large 高清重画可用。'
        : `常规出图和可视化编辑可用${capabilities.imageOverrides ? '' : '（旧服务端兼容模式）'}；Large 需要服务端 0.6.0+。`;
    return `${prefix} · ${features} ${capabilities.keySaved ? 'API Key 已保存。' : '请先保存 API Key。'}`;
}

export const LARGE_UPGRADE_MESSAGE = 'Large 高清重画需要服务端 0.6.0 或更新版本。常规出图仍可使用；请在扩展设置的“安装修复说明”中查看服务端更新步骤。';

// Older backends already support V5 character captions, but ignore imageOverrides.
// Translate only the edited fields into their supported request format.
export function prepareGeneration(body, capabilities) {
    if (!capabilities.standard) throw new InputError(serverSummary(capabilities));
    const scene = normalizeScene(body.scene);
    const options = normalizeOptions(body.options);
    const imageOverrides = normalizeImageOverrides(body.imageOverrides ?? {});
    if (imageOverrides.resolution === 'large' && !capabilities.large) throw new InputError(LARGE_UPGRADE_MESSAGE);
    if (capabilities.imageOverrides) return { ...body, scene, options, imageOverrides };

    const legacyText = (text, max, label) => {
        if (text.length > max) throw new InputError(`旧服务端的${label}上限为 ${max} 字符，请缩短或更新服务端到 0.5.0+。`);
        return text.trim();
    };
    for (const person of scene.characters) {
        if (person.prompt != null) legacyText(person.prompt, 8000, '人物提示词');
    }
    if (Object.hasOwn(imageOverrides, 'base')) {
        scene.scene = legacyText(imageOverrides.base, 12000, '完整 Base Prompt');
        if (!scene.scene) throw new InputError('旧服务端要求 Base Prompt 非空。使用空 Base 需要更新服务端到 0.5.0+。');
        options.basePrompt = '';
        options.quality = 'none';
    }
    if (Object.hasOwn(imageOverrides, 'negative')) {
        options.negative = legacyText(imageOverrides.negative, 8000, '完整主 UC');
        options.ucPreset = 'custom';
        options.allowSceneNegative = false;
        scene.negative = '';
    }
    if (imageOverrides.size) {
        options.sizeMode = 'fixed';
        options.size = imageOverrides.size;
    }
    const result = { ...body, scene, options };
    delete result.imageOverrides;
    return result;
}
