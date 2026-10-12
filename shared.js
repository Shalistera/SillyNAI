import { UC_PRESETS } from './uc-presets.js';
export { UC_PRESETS, UC_SOURCE } from './uc-presets.js';
export const ID = 'novelai-story-illustrator';
export const VERSION = '0.4.0';
export const STATE_KEY = 'nai_story_illustrator';
export const MODELS = ['nai-diffusion-5-full', 'nai-diffusion-5-curated'];
export const SIZES = { portrait: [832, 1216], landscape: [1216, 832], square: [1024, 1024] };
export const DEFAULTS = {
    enabled: true,
    inject: true,
    automatic: false,
    maxImages: 1,
    model: MODELS[0],
    sizeMode: 'auto',
    size: 'portrait',
    steps: 23,
    scale: 7,
    seed: -1,
    quality: 'light',
    basePrompt: '',
    descriptionLanguage: 'en',
    actionMode: 'tags',
    promptGuidance: '',
    ucPreset: 'light',
    negative: '',
    allowSceneNegative: false,
    allowAnlas: false,
    characterNotes: '',
};

export class InputError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(`${label} 必须是 JSON 对象。`);
    return value;
}

function string(value, label, max, required = false) {
    if (value == null && !required) return '';
    if (typeof value !== 'string') throw new InputError(`${label} 必须是文本。`);
    const result = value.trim();
    if (result.length > max || (required && !result)) throw new InputError(`${label} 不能为空且不能超过 ${max} 个字符。`);
    return result;
}

function number(value, label, min, max, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        throw new InputError(`${label} 应在 ${min} 到 ${max} 之间${integer ? '，且为整数' : ''}。`);
    }
    return value;
}

export function normalizeScene(value) {
    object(value, '绘图指令');
    const characters = value.characters ?? [];
    if (!Array.isArray(characters) || characters.length > 22) throw new InputError('characters 必须是数组，V5 最多支持 22 个人物。');
    const result = {
        title: string(value.title, '标题', 160),
        scene: string(value.scene ?? value.prompt, '场景提示词', 12000, true),
        negative: string(value.negative, '场景负面提示词', 8000),
        characters: characters.map((item, index) => {
            object(item, `人物 ${index + 1}`);
            const person = {
                name: string(item.name, '人物名', 160),
                negative: string(item.negative, '人物负面提示词', 4000),
            };
            if (item.gender != null || item.description != null) {
                const gender = string(item.gender, 'gender', 20, true).toLowerCase();
                if (!['girl', 'boy', 'other'].includes(gender)) throw new InputError('gender 只能是 girl、boy 或 other。');
                person.gender = gender;
                person.description = string(item.description, '人物外貌描述', 8000, true);
            } else {
                // Keep existing chats and user presets written for 0.1 compatible.
                person.prompt = string(item.prompt, '人物提示词', 8000, true);
            }
            // Actions belong only to this character; older chats can omit them.
            if (item.actions != null) person.actions = string(item.actions, '人物动作', 4000);
            if (item.position != null) {
                object(item.position, '人物位置');
                person.position = {
                    x: number(item.position.x, 'x', 0, 1),
                    y: number(item.position.y, 'y', 0, 1),
                };
            }
            return person;
        }),
    };
    if (value.size != null) {
        if (!Object.hasOwn(SIZES, value.size)) throw new InputError('size 只支持 portrait、landscape、square。');
        result.size = value.size;
    }
    const positioned = result.characters.filter(person => person.position).length;
    if (positioned && positioned !== characters.length) throw new InputError('手动构图时，请为每个人物都提供 position；或全部省略让模型决定。');
    return result;
}

export function normalizeOptions(value = {}) {
    object(value, '绘图设置');
    const result = { ...DEFAULTS, ...value };
    if (!MODELS.includes(result.model)) throw new InputError('请选择 NovelAI V5 Full 或 Curated。');
    if (!Object.hasOwn(SIZES, result.size)) throw new InputError('不支持的图片尺寸。');
    if (!['auto', 'fixed'].includes(result.sizeMode)) throw new InputError('比例模式只支持 auto 或 fixed。');
    number(result.steps, '步数', 1, 50, true);
    number(result.scale, '提示词引导', 0.1, 10);
    number(result.seed, '种子', -1, 4294967295, true);
    number(result.maxImages, '每条回复图片上限', 1, 4, true);
    if (!['none', 'light', 'standard'].includes(result.quality)) throw new InputError('不支持的质量预设。');
    result.basePrompt = string(value.basePrompt ?? value.style ?? '', '固定 Base Prompt', 12000);
    if (result.basePrompt.split('{{scene}}').length > 2) throw new InputError('固定 Base Prompt 中最多使用一个 {{scene}} 场景占位符。');
    delete result.style;
    if (!['en', 'zh'].includes(result.descriptionLanguage)) throw new InputError('描述语言只支持英文或中文。');
    if (!['tags', 'natural'].includes(result.actionMode)) throw new InputError('人物动作写法只支持 tags 或 natural。');
    result.promptGuidance = string(result.promptGuidance, '附加绘图要求', 16000);
    result.negative = string(result.negative, '自定义 UC', 8000);
    // Older versions had one custom-only field. Keep intentional user text intact;
    // replace only the exact old stock default with the current official Light.
    if (value.ucPreset === undefined && Object.hasOwn(value, 'negative')) {
        const oldDefault = 'lowres, bad hands, bad anatomy, artistic error, worst quality, jpeg artifacts';
        result.ucPreset = result.negative === oldDefault ? 'light' : 'custom';
        if (result.negative === oldDefault) result.negative = '';
        if (value.allowSceneNegative === undefined) result.allowSceneNegative = true;
    }
    if (!Object.hasOwn(UC_PRESETS, result.ucPreset)) throw new InputError('请选择有效的 V5 UC 预设。');
    result.characterNotes = string(result.characterNotes, '人物外貌备忘', 16000);
    for (const key of ['enabled', 'inject', 'automatic', 'allowAnlas', 'allowSceneNegative']) {
        if (typeof result[key] !== 'boolean') throw new InputError(`${key} 必须是布尔值。`);
    }
    return result;
}

// Synchronous, deterministic identity for one inline block; includes its ordinal.
// This is an identity aid, not a cryptographic authentication mechanism.
export function blockKey(raw, index) {
    let first = 2166136261;
    let second = 5381;
    for (let i = 0; i < raw.length; i++) {
        first = Math.imul(first ^ raw.charCodeAt(i), 16777619);
        second = Math.imul(second, 33) ^ raw.charCodeAt(i);
    }
    return `${index}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}

export function parseBlocks(text) {
    if (typeof text !== 'string') return [];
    const result = [];
    const pattern = /<nai_image\s*>([\s\S]*?)(?:<\/nai_image\s*>|$)/gi;
    for (const match of text.matchAll(pattern)) {
        if (result.length >= 32) break;
        const raw = match[1].trim();
        const block = { start: match.index, end: match.index + match[0].length, raw, key: blockKey(raw, result.length), index: result.length };
        try {
            if (!/<\/nai_image\s*>$/i.test(match[0])) throw new InputError('绘图指令尚未闭合。');
            if (raw.length > 64000) throw new InputError('绘图指令过长。');
            block.scene = normalizeScene(JSON.parse(raw.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')));
        } catch (error) {
            block.error = error instanceof InputError ? error.message : '绘图指令不是有效的 JSON，可点击编辑修正。';
        }
        result.push(block);
    }
    return result;
}

export function composePrompts(sceneInput, optionInput) {
    const scene = normalizeScene(sceneInput);
    const options = normalizeOptions(optionInput);
    const quality = { none: '', light: 'very aesthetic, amazing quality, no text', standard: 'very aesthetic, masterpiece, no text' }[options.quality];
    // Use a replacement function so $&, $`, and $' in story text remain literal.
    const base = options.basePrompt.includes('{{scene}}')
        ? options.basePrompt.replace('{{scene}}', () => scene.scene)
        : [options.basePrompt, scene.scene].filter(Boolean).join(', ');
    const prompt = [base, quality].filter(Boolean).join(', ');
    const negative = [UC_PRESETS[options.ucPreset].text, options.negative, options.allowSceneNegative ? scene.negative : ''].filter(Boolean).join(', ');
    const characters = scene.characters.map(person => ({
        name: person.name,
        prompt: [person.description != null ? `${person.gender}, ${person.description}` : person.prompt, person.actions].filter(Boolean).join(', '),
        negative: person.negative,
        position: person.position,
    }));
    return { base: prompt, negative, characters };
}

export function resolveImageSize(sceneInput, optionInput) {
    const scene = normalizeScene(sceneInput);
    const options = normalizeOptions(optionInput);
    const source = options.sizeMode === 'fixed' ? 'fixed' : scene.size ? 'model' : 'fallback';
    const preset = options.sizeMode === 'fixed' ? options.size : scene.size ?? options.size;
    const [width, height] = SIZES[preset];
    return { preset, width, height, source };
}

export function buildPayload(sceneInput, optionInput, randomSeed) {
    const scene = normalizeScene(sceneInput);
    const options = normalizeOptions(optionInput);
    const { width, height } = resolveImageSize(scene, options);
    const prompts = composePrompts(scene, options);
    const caption = field => prompts.characters.map(person => ({ char_caption: person[field], centers: [person.position ?? { x: 0.5, y: 0.5 }] }));
    const seed = options.seed === -1 ? number(randomSeed, '随机种子', 0, 4294967295, true) : options.seed;
    return {
        action: 'generate',
        model: options.model,
        input: prompts.base,
        parameters: {
            params_version: 4,
            width, height, steps: options.steps, scale: options.scale, seed,
            n_samples: 1,
            sampler: 'k_euler_ancestral',
            noise_schedule: 'karras',
            negative_prompt: prompts.negative,
            v4_prompt: {
                caption: { base_caption: prompts.base, char_captions: caption('prompt') },
                use_coords: scene.characters.some(person => person.position),
                use_order: true,
            },
            v4_negative_prompt: {
                caption: { base_caption: prompts.negative, char_captions: caption('negative') },
                legacy_uc: false,
            },
            qualityToggle: false,
            ucPreset: 0,
            tag_hint_uc_preset: UC_PRESETS[options.ucPreset].hint,
            cfg_rescale: 0,
            sm: false,
            sm_dyn: false,
            dynamic_thresholding: false,
            deliberate_euler_ancestral_bug: false,
            prefer_brownian: true,
            legacy: false,
            legacy_v3_extend: false,
            add_original_image: false,
            image_format: 'png',
        },
    };
}

export function freeGenerationBlockReason(subscription, payload) {
    if (subscription?.active !== true || subscription.tier !== 3) return '当前账号未确认有有效的 Opus 订阅。';
    const p = payload.parameters;
    if (p.steps > 28 || p.width * p.height > 1048576 || p.n_samples !== 1) return '当前尺寸或步数超出 Opus 常规免费参数范围。';
    if (!subscription.usage || subscription.usage.isNegative !== false || !Number.isFinite(subscription.usage.percent)) return '未能确认 V5 免费额度，请先在 NovelAI 官网检查。';
    if (subscription.usage.percent <= 0) return 'V5 免费额度不足。';
    return '';
}

export function promptInstruction(options) {
    const cfg = normalizeOptions(options);
    const example = makeExampleScene(cfg);
    const language = cfg.descriptionLanguage === 'zh' ? '中文' : '英文';
    const actionInstruction = cfg.actionMode === 'tags'
        ? 'actions 使用 Danbooru 常用英文动作标签，逗号分隔，多词标签用空格，例如 sitting, leaning forward, holding cup, smile, looking at another。按当前画面选约 3–8 个必要标签，优先写准确的肢体姿势、手部动作或持物、表情和视线，不为凑数新增动作，不同时堆互相矛盾的姿势。多人互动可在各自 actions 中用 NovelAI 的 source#hug / target#hug 区分主动拥抱者与被拥抱者，互相拥抱用 mutual#hug；这些前缀只用于适合的互动标签。不确定现成标签时不要把长句伪装成标签；确需说明对象或方向，最多补一句很短的自然语言，仍留在该人物 actions 中。'
        : `actions 用简短${language}自然语言明确写出此人的姿势、手部动作或持物、表情、视线；多人互动说明动作对象和主被动关系，每人 1–2 个短句，不复制另一人的动作。`;
    const sizeInstruction = cfg.sizeMode === 'fixed'
        ? `用户固定了图片比例：size 统一填写 "${cfg.size}"（${SIZES[cfg.size][0]}×${SIZES[cfg.size][1]}）。按这个画幅安排镜头和人物，扩展始终使用用户选定的尺寸。`
        : `按构图选择 size：portrait（832×1216，竖向人物）、landscape（1216×832，横向互动）或 square（1024×1024，紧凑构图），不只凭人数决定。不要输出任意宽高。遗漏时使用 ${cfg.size}。`;
    return `继续按原预设写小说。在适合插图的段落之后，用独立的 <nai_image>...</nai_image> 块描述该时刻的一个画面。每次回复最多 ${cfg.maxImages} 个块，没有合适画面时可不输出。
固定画风由用户维护，扩展会将 scene 插入固定 Base Prompt。只生成环境和各人物内容，不添加画师、媒介、质量词或额外 Base Prompt 字段。
每个块内必须是有效 JSON，不要 Markdown 代码围栏。格式示例：
<nai_image>${JSON.stringify(example)}</nai_image>
scene 只用简短英文环境标签，逗号分隔：人数标签（如 1girl, 1boy）放最前，之后通常仅 3–6 个标签概括室内/室外、房间或地点类型、必要的时间与光线，关键背景物最多保留一项，不必凑数。不要写环境长句、建筑结构、装饰清单或人物动作；人物外貌、衣着、姿势、表情、视线、互动全部放进各自 characters。不要把正文中的建筑描写逐项搬进 scene。
characters 为每个可见人物单独填写 name、gender、description、actions，最多 22 人。gender 为 girl、boy 或 other（分类不代表年龄，不能判断时用 other）。description 用简短${language}自然语言，只写已知年龄、辨识度高的外貌和当前衣着；不重复动作。actions 专门写这个人此刻可见的姿势、动作、表情与视线，不挪到 scene，也不只写外貌而遗漏核心动作。依据角色卡、世界书和当前正文，不编造未知特征，不写“同上”。
${actionInstruction}
扩展把 gender、description、actions 依次拼成此人的 Char Prompt，无需在 description/actions 重复 girl/boy。JSON 字段名保持示例格式，name、title 可用中文。主 Undesired Content 由用户管理，不重复生成官方负面词。${cfg.allowSceneNegative ? '可在顶层 negative 补充仅针对本图的必要排除内容；没有需要时省略。' : '不要输出顶层 negative，扩展不会采用模型的主 UC 补充。'}各人物可用自己的 negative 避免特征串到另一人，也可省略。
${sizeInstruction}
position 可全部省略让模型布局；指定时必须给每个人都设置 0 到 1 之间的 x、y，左上角是 0,0。只画正文当前真实出现的外貌与事件，不把秘密、内心猜测或未来计划画成已经发生的事实。继续保持正文的叙述风格，不向读者解释这些指令。无需输出 API 地址、密钥、模型、步数或请求代码。
${cfg.characterNotes ? `人物外貌备忘（结合当前剧情中的衣着变化使用）：\n${cfg.characterNotes}\n` : ''}${cfg.promptGuidance ? `用户补充的画面要求（保持上述 JSON 格式）：\n${cfg.promptGuidance}` : ''}`;
}

export const EXAMPLE_SCENE = {
    title: '窗边的旅人',
    scene: '1girl, indoors, bedroom, window, night, backlighting',
    size: 'portrait',
    characters: [{ name: '旅人', gender: 'girl', description: 'An adult woman with long black hair and blue eyes, wearing a loose white shirt.', actions: 'sitting, holding cup, looking away, smile' }],
};

export function makeExampleScene(options = {}) {
    const cfg = normalizeOptions(options);
    const example = structuredClone(EXAMPLE_SCENE);
    if (cfg.sizeMode === 'fixed') example.size = cfg.size;
    if (cfg.descriptionLanguage === 'zh') example.characters[0].description = '一名成年女子，黑色长发、蓝色眼睛，穿宽松白衬衫。';
    if (cfg.actionMode === 'natural') {
        example.characters[0].actions = cfg.descriptionLanguage === 'zh'
            ? '她坐在窗边，手里捧着杯子，带着浅笑望向窗外。'
            : 'She sits by the window, holding a cup and looking outside with a faint smile.';
    }
    return example;
}
