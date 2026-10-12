// NovelAI V5 Full and Curated use the same published UC presets.
// Verified 2026-09-22 against the official docs and public image client.
export const UC_SOURCE = 'https://docs.novelai.net/en/image/undesiredcontent/';
export const UC_PRESETS = Object.freeze({
    light: {
        label: '官方 Light（默认）', hint: 3,
        description: '适合作为日常起点；保留更多画风空间。可在下方追加需要排除的内容。',
        text: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
    },
    heavy: {
        label: '官方 Heavy', hint: 2,
        description: '排除更多画面表现，如网点、颗粒和多视图。想保留这些风格时可改用 Light 或自定义。',
        text: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
    },
    humanFocus: {
        label: '官方 Human Focus', hint: 4,
        description: '增加人物眼睛与解剖相关排除词。其中含 glowing eyes，想画发光眼睛时请调整。',
        text: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
    },
    furryFocus: {
        label: '官方 Furry Focus', hint: 5,
        description: '兽人画面导向的排除词；包含 widescreen、sketch、comic 等，按目标画面选择。',
        text: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic',
    },
    custom: {
        label: '完全自定义（不加官方预设）', hint: 0,
        description: '主 UC 只使用你填写的文本。留空则不添加固定主 UC。',
        text: '',
    },
});
