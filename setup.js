import { VERSION, EXAMPLE_SCENE, DEFAULTS, UC_PRESETS, normalizeScene, composePrompts, resolveImageSize } from './shared.js';
import { fetchJson, requestApi } from './api.js';
import { serverCapabilities, serverSummary, prepareGeneration } from './compatibility.js';
const $ = selector => document.querySelector(selector);
let tokenPromise;
let controller;
let capabilities = serverCapabilities();

function csrfToken() {
    tokenPromise ??= fetchJson('/csrf-token').then(data => {
        if (typeof data.token !== 'string') throw new Error('无法获取酒馆 CSRF 令牌，请登录酒馆后重试。');
        return data.token;
    }).catch(error => { tokenPromise = null; throw error; });
    return tokenPromise;
}

async function request(route, body, signal) {
    const csrf = body === undefined ? undefined : await csrfToken();
    return requestApi(route, body, { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, signal);
}

function status(selector, text, error = false) {
    $(selector).textContent = text;
    $(selector).classList.toggle('error', error);
}

$('#scene').value = JSON.stringify(EXAMPLE_SCENE, null, 2);
for (const [id, preset] of Object.entries(UC_PRESETS)) $('#uc-preset').add(new Option(preset.label, id));
function testOptions() {
    return {
        ...DEFAULTS, model: $('#model').value, basePrompt: $('#base-prompt').value,
        quality: $('#quality').value, allowAnlas: $('#allow-anlas').checked,
        sizeMode: $('#size-mode').value, size: $('#size').value,
        ucPreset: $('#uc-preset').value, negative: $('#negative').value,
        allowSceneNegative: $('#allow-scene-negative').checked,
    };
}
function updatePreview() {
    $('#size-label').textContent = $('#size-mode').value === 'fixed' ? '固定比例' : '备用比例';
    $('#negative-label').textContent = $('#uc-preset').value === 'custom' ? '自定义主 UC' : '自定义追加 UC';
    $('#uc-hint').textContent = UC_PRESETS[$('#uc-preset').value].description;
    try {
        const scene = JSON.parse($('#scene').value);
        const prompts = composePrompts(scene, testOptions());
        const size = resolveImageSize(scene, testOptions());
        const source = { fixed: '用户固定', model: '场景选择', fallback: '备用比例' }[size.source];
        $('#prompt-preview').textContent = [`实际尺寸: ${size.width} × ${size.height}（${source}）`, `Base:\n${prompts.base}`, ...prompts.characters.map((person, index) => `Char ${index + 1}${person.name ? ` · ${person.name}` : ''}:\n${person.prompt}`), `主 UC:\n${prompts.negative || '（空）'}`].join('\n\n');
    } catch (error) { $('#prompt-preview').textContent = `无法预览：${error.message}`; }
}
for (const selector of ['#scene', '#base-prompt', '#quality', '#size-mode', '#size', '#uc-preset', '#negative', '#allow-scene-negative']) $(selector).addEventListener('input', updatePreview);
updatePreview();
$('#save-key').addEventListener('click', async () => {
    const key = $('#token').value.trim();
    $('#token').value = '';
    try {
        await request('key', { key });
        await checkService();
        status('#account-status', '密钥已保存。点击“检查连接与额度”验证账号。');
    } catch (error) { status('#account-status', error.message, true); }
});
$('#check').addEventListener('click', async () => {
    $('#check').disabled = true;
    status('#account-status', '正在向 NovelAI 检查订阅…');
    try {
        const data = await request('check', {});
        const tier = { 1: 'Tablet', 2: 'Scroll', 3: 'Opus' }[data.tier] ?? `等级 ${data.tier}`;
        const usage = data.usage ? `V5 额度：${data.usage.percent}%${data.usage.isNegative ? '（已用尽）' : ''}` : 'API 暂未返回 V5 额度';
        status('#account-status', `连接成功 · ${tier} · ${data.active ? '订阅有效' : '订阅未激活'}\n${usage}\nAnlas：订阅 ${data.anlas?.subscription ?? '未知'} / 购买 ${data.anlas?.purchased ?? '未知'}`);
    } catch (error) { status('#account-status', error.message, true); }
    finally { $('#check').disabled = false; }
});
$('#generate').addEventListener('click', async () => {
    $('#generate').disabled = true;
    $('#cancel').disabled = false;
    controller = new AbortController();
    try {
        await checkService();
        $('#generate').disabled = true;
        if (!capabilities.standard || !capabilities.keySaved) throw new Error(serverSummary(capabilities));
        const scene = normalizeScene(JSON.parse($('#scene').value));
        status('#image-status', '正在生成图片，请稍候…');
        const result = await request('generate', prepareGeneration({
            requestId: crypto.randomUUID(), scene,
            options: testOptions(),
        }, capabilities), controller.signal);
        if (!/^\/?user\/images\/novelai-story-illustrator\/[a-zA-Z0-9-]+\.png$/.test(result.url)) throw new Error('图片路径无效。');
        const img = document.createElement('img');
        img.src = `/${result.url.replace(/^\//, '')}`;
        img.alt = scene.title || 'NovelAI 测试图片';
        $('#preview').replaceChildren(img);
        status('#image-status', `出图成功 · ${result.width} × ${result.height} · 种子 ${result.seed}`);
    } catch (error) {
        status('#image-status', error.name === 'AbortError' ? '已取消等待；若 NovelAI 已开始生成，额度可能已使用。请先检查图库。' : error.message, true);
    } finally {
        controller = null;
        $('#generate').disabled = !capabilities.standard || !capabilities.keySaved;
        $('#cancel').disabled = true;
    }
});
$('#cancel').addEventListener('click', () => controller?.abort());
async function checkService() {
    try {
        capabilities = serverCapabilities(await request('status'));
        status('#service-status', `前端 ${VERSION} · ${serverSummary(capabilities)}`, !capabilities.standard);
        status('#account-status', capabilities.keySaved ? '已保存密钥。可检查 NovelAI 连接与额度。' : '请先粘贴并保存 API Key。');
    } catch (error) {
        capabilities = serverCapabilities();
        status('#service-status', `前端 ${VERSION} · ${error.message}`, true);
        status('#account-status', '服务端检查失败。请参阅本页安装修复说明，然后重新检查。', true);
    } finally {
        $('#generate').disabled = Boolean(controller) || !capabilities.standard || !capabilities.keySaved;
    }
}
$('#recheck-service').addEventListener('click', () => { void checkService(); });
await checkService();
