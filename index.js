import { ID, VERSION, STATE_KEY, UC_PRESETS, normalizeOptions, parseBlocks, composePrompts, resolveImageSize, promptInstruction, makeExampleScene } from './shared.js';
import { ImageQueue, sameTarget, GenerationTracker } from './queue.js';
import { openImageEditor, openLargeRedraw } from './editor.js';
import { createLargeRedraw } from './editor-state.js';
import { requestApi } from './api.js';
import { serverCapabilities, serverSummary, prepareGeneration, LARGE_UPGRADE_MESSAGE } from './compatibility.js';
import { findLegacyFrontend } from './migration.js';

const context = () => SillyTavern.getContext();
const queue = new ImageQueue();
const statuses = new Map();
let capabilities = serverCapabilities();
let ready = false;
let readinessError = '请先在扩展设置中连接 NovelAI 账号，成功后刷新酒馆页面。';
const generation = new GenerationTracker();
let panel;

const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const settings = () => context().extensionSettings[STATE_KEY];
const sceneState = message => message.extra?.[STATE_KEY];
function ensureState(message) {
    message.extra ??= {};
    const state = message.extra[STATE_KEY] ??= {};
    for (const key of ['images', 'overrides', 'attempts', 'imageOverrides']) state[key] ??= {};
    return state;
}

async function api(route, body, signal) {
    return requestApi(route, body, context().getRequestHeaders(), signal);
}

function refresh(index) {
    const ctx = context();
    if (ctx.chat[index]) ctx.updateMessageBlock(index, ctx.chat[index]);
}

async function save(message) {
    if (Array.isArray(message.swipe_info) && message.swipe_info[message.swipe_id ?? 0]) {
        message.swipe_info[message.swipe_id ?? 0].extra = structuredClone(message.extra);
    }
    await context().saveChat();
}

function currentTarget(index) {
    const ctx = context();
    const message = ctx.chat[index];
    return { index, message, text: message.mes, swipe: message.swipe_id ?? 0, chatId: ctx.getCurrentChatId(), characterId: ctx.characterId, groupId: ctx.groupId };
}

function localUrl(value) {
    return typeof value === 'string' && /^\/?user\/images\/novelai-story-illustrator\/[a-zA-Z0-9-]+\.png$/.test(value) ? value : '';
}

function statusId(index, blockKey) {
    const ctx = context();
    return `${String(ctx.characterId)}:${String(ctx.groupId)}:${ctx.getCurrentChatId()}:${index}:${ctx.chat[index]?.swipe_id ?? 0}:${blockKey}`;
}

function renderCard(block, message, index) {
    const state = sceneState(message);
    const record = state?.images?.[block.key];
    const scene = state?.overrides?.[block.key] ?? block.scene;
    const label = scene?.title || `插图 ${block.index + 1}`;
    const status = statuses.get(statusId(index, block.key));
    const busy = status === 'queued' || status === 'running';
    const imageUrl = localUrl(record?.url);
    const error = state?.attempts?.[block.key]?.error;
    const size = scene ? resolveImageSize(scene, settings(), state?.imageOverrides?.[block.key]) : null;
    const messageText = status === 'running' ? '正在生成…' : status === 'queued' ? '等待出图…'
        : error || (!scene ? block.error : (imageUrl ? `${record.model.replace('nai-diffusion-', 'V')} · ${record.width} × ${record.height} · 种子 ${record.seed}` : `画面已准备好 · ${size.width} × ${size.height}`));
    return `\n\n<div class="nai-story-card" data-nai-key="${escape(block.key)}" data-nai-index="${index}">
<div class="nai-story-caption">${escape(label)}</div>
${imageUrl ? `<a href="/${escape(imageUrl.replace(/^\//, ''))}" target="_blank" rel="noopener"><img src="/${escape(imageUrl.replace(/^\//, ''))}" alt="${escape(label)}" loading="lazy"></a>` : ''}
<div class="nai-story-note">${escape(messageText)}</div>
<div class="nai-story-actions"><button type="button" class="menu_button" data-nai-action="generate" ${busy || !scene ? 'disabled' : ''}>${imageUrl ? '常规重画' : '生成'}</button>${imageUrl ? `<button type="button" class="menu_button" data-nai-action="large" ${busy || !scene ? 'disabled' : ''}>高清重画</button>` : ''}<button type="button" class="menu_button" data-nai-action="edit" ${busy ? 'disabled' : ''}>编辑图片</button>${busy ? '<button type="button" class="menu_button" data-nai-action="cancel">取消</button>' : ''}</div></div>\n\n`;
}

function formatMessage(text, metadata) {
    if (!settings()?.enabled || metadata.isUser || metadata.isSystem || metadata.isReasoning) return text;
    const message = context().chat[metadata.messageId];
    if (!message) return text;
    const blocks = parseBlocks(text);
    for (const block of blocks.reverse()) {
        text = text.slice(0, block.start) + renderCard(block, message, metadata.messageId) + text.slice(block.end);
    }
    return text;
}

function enqueueImage(index, block, automatic = false, largeRedraw = null) {
    if (!settings().enabled) return;
    const target = currentTarget(index);
    if (target.message.is_user || target.message.is_system || !target.chatId) return;
    const state = ensureState(target.message);
    const scene = state.overrides[block.key] ?? block.scene;
    if (!scene || (automatic && (state.images[block.key] || state.attempts[block.key]))) return;
    let options = structuredClone(settings());
    let imageOverrides = structuredClone(state.imageOverrides[block.key] ?? {});
    if (largeRedraw) ({ options, imageOverrides } = createLargeRedraw(state.images[block.key], options, imageOverrides, largeRedraw));
    const sceneSnapshot = structuredClone(scene);
    const id = `${String(target.characterId)}:${String(target.groupId)}:${target.chatId}:${index}:${target.swipe}:${block.key}`;
    const statusKey = id;
    const valid = () => settings().enabled && sameTarget(context(), target);
    return queue.enqueue({
        id, index,
        valid,
        onState(status) {
            if (status === 'idle' || status === 'cancelled') statuses.delete(statusKey);
            else statuses.set(statusKey, status);
            if (sameTarget(context(), target)) refresh(index);
        },
        async run(signal) {
            await checkStatus();
            if (!ready) throw new Error(readinessError);
            const request = prepareGeneration({ requestId: crypto.randomUUID(), scene: sceneSnapshot, options, imageOverrides }, capabilities);
            state.attempts[block.key] = { started: Date.now() };
            await save(target.message);
            if (!valid() || signal.aborted) throw new Error('原消息已变化，取消出图。');
            return api('generate', request, signal);
        },
        async complete(result) {
            if (!localUrl(result.url)) throw new Error('返回的图片路径无效。');
            state.images[block.key] = { ...result, scene: sceneSnapshot, imageOverrides, prompts: composePrompts(sceneSnapshot, options, imageOverrides), created: Date.now() };
            state.attempts[block.key] = { done: true };
            await save(target.message);
            if (valid()) refresh(index);
        },
        async failed(error) {
            state.attempts[block.key] = { error: error.message };
            try { await save(target.message); }
            finally {
                if (valid()) refresh(index);
                toastr.error(error.message, 'NovelAI 配图');
            }
        },
    });
}

function syncPrompt(type) {
    const cfg = settings();
    const skip = ['quiet', 'impersonate'].includes(type);
    // IN_CHAT=1, SYSTEM=0. Excluded from world-info scans.
    context().setExtensionPrompt(ID, cfg.enabled && cfg.inject && !skip ? promptInstruction(cfg) : '', 1, 0, false, 0);
}

function onGenerationStarted(type, options = {}, dryRun = false) {
    syncPrompt(type);
    if (dryRun || ['quiet', 'impersonate'].includes(type) || options.automatic_trigger) {
        generation.clear();
        return;
    }
    generation.start(context().getCurrentChatId());
}

function onRendered(index, type) {
    if (['first_message', 'quiet', 'impersonate', 'command'].includes(type)) return;
    if (context().streamingProcessor?.isStopped || context().streamingProcessor?.abortController?.signal.aborted) return;
    dispatchGeneratedImages(generation.rendered(context().getCurrentChatId(), Number(index)));
}

function onGenerationEnded() {
    if (context().streamingProcessor?.isStopped || context().streamingProcessor?.abortController?.signal.aborted) {
        generation.clear();
        return;
    }
    dispatchGeneratedImages(generation.ended(context().getCurrentChatId()));
}

function dispatchGeneratedImages(indices) {
    const cfg = settings();
    if (!cfg.enabled) return;
    for (const index of indices) {
        const message = context().chat[index];
        if (!message || message.is_user || message.is_system) continue;
        const blocks = parseBlocks(message.mes).filter(block => block.scene);
        if (cfg.countMode === 'fixed' && blocks.length !== cfg.maxImages) {
            toastr.warning(`本条回复要求 ${cfg.maxImages} 张，实际识别到 ${blocks.length} 个有效绘图块。请检查回复是否完整、绘图块格式及预设中的数量要求。`, 'NovelAI 配图数量');
        }
        if (cfg.automatic) {
            for (const block of blocks.slice(0, cfg.maxImages)) enqueueImage(index, block, true);
        }
    }
}

function previewExample() {
    openImageEditor({ scene: makeExampleScene(settings()), options: settings(), previewOnly: true });
}

async function redrawLarge(index, block) {
    const target = currentTarget(index);
    const record = sceneState(target.message)?.images?.[block.key];
    if (!record) return;
    await checkStatus();
    if (!ready) return toastr.error(readinessError, 'NovelAI 配图');
    if (!capabilities.large) return toastr.warning(LARGE_UPGRADE_MESSAGE, 'NovelAI 高清重画');
    if (!sameTarget(context(), target)) return;
    openLargeRedraw({
        record,
        onGenerate(parameters) {
            if (!sameTarget(context(), target)) throw new Error('聊天或原消息已变化，请关闭窗口后重试。');
            if (sceneState(target.message)?.images?.[block.key] !== record) throw new Error('当前图片已变化，请重新打开高清重画。');
            if (!enqueueImage(index, block, false, parameters)) throw new Error('未加入队列，请确认扩展已启用且这张图没有正在生成的任务。');
        },
    });
}

function editScene(index, block) {
    const target = currentTarget(index);
    const state = ensureState(target.message);
    openImageEditor({
        scene: state.overrides[block.key] ?? block.scene ?? makeExampleScene(settings()),
        options: settings(), imageOverrides: state.imageOverrides[block.key],
        async onSave({ scene, imageOverrides, generate }) {
            if (!sameTarget(context(), target)) throw new Error('聊天或原消息已变化，请关闭编辑器后重新打开。');
            if (['queued', 'running'].includes(statuses.get(statusId(index, block.key)))) throw new Error('这张图正在生成，请完成后再保存编辑。');
            const previous = { scene: state.overrides[block.key], image: state.imageOverrides[block.key], attempt: state.attempts[block.key] };
            state.overrides[block.key] = scene;
            state.imageOverrides[block.key] = imageOverrides;
            delete state.attempts[block.key];
            try { await save(target.message); }
            catch (error) {
                for (const [map, value] of [[state.overrides, previous.scene], [state.imageOverrides, previous.image], [state.attempts, previous.attempt]]) {
                    if (value === undefined) delete map[block.key];
                    else map[block.key] = value;
                }
                const swipe = target.message.swipe_info?.[target.swipe];
                if (swipe) swipe.extra = structuredClone(target.message.extra);
                throw error;
            }
            if (sameTarget(context(), target)) {
                refresh(index);
                if (generate) enqueueImage(index, block);
            }
        },
    });
}

async function checkStatus() {
    const statusElement = panel.querySelector('#nai-story-status');
    try {
        const status = await api('status');
        capabilities = serverCapabilities(status);
        if (!capabilities.standard) throw new Error(serverSummary(capabilities));
        ready = capabilities.keySaved;
        readinessError = '请先在“连接账号 / 测试出图”页面保存 NovelAI API Key。';
        statusElement.textContent = `前端 ${VERSION} · ${serverSummary(capabilities)}`;
    } catch (error) {
        ready = false;
        capabilities = serverCapabilities();
        readinessError = error.message;
        statusElement.textContent = error.message;
    }
}

function refreshPolicyControls() {
    const cfg = settings();
    panel.querySelector('#nai-count-label').textContent = cfg.countMode === 'fixed' ? '每条回复固定几张' : '每条回复最多几张';
    panel.querySelector('#nai-count-hint').textContent = cfg.countMode === 'fixed'
        ? `要求模型每条回复输出恰好 ${cfg.maxImages} 个独立绘图块。数量不符时会提示；开启自动出图后，最多依次生成 ${cfg.maxImages} 张。`
        : `模型按剧情输出 0–${cfg.maxImages} 个绘图块；用户指定数量时需在此上限内。希望稳定要求两张，可选择固定数量并填 2。`;
    panel.querySelector('#nai-size-label').textContent = cfg.sizeMode === 'fixed' ? '固定图片比例' : '模型遗漏时的备用比例';
    panel.querySelector('#nai-negative-label').textContent = cfg.ucPreset === 'custom' ? '自定义主 UC（可留空）' : '自定义追加 UC（可留空）';
    panel.querySelector('#nai-uc-hint').textContent = UC_PRESETS[cfg.ucPreset].description;
    panel.querySelector('#nai-uc-text').textContent = UC_PRESETS[cfg.ucPreset].text || '未使用官方预设。';
    panel.querySelector('#nai-uc-customize').disabled = cfg.ucPreset === 'custom';
}

async function init() {
    const ctx = context();
    ctx.extensionSettings[STATE_KEY] = normalizeOptions(ctx.extensionSettings[STATE_KEY] ?? {});
    const response = await fetch(new URL('./settings.html', import.meta.url));
    if (!response.ok) throw new Error('无法加载 NovelAI 小说配图设置。');
    const container = document.createElement('div');
    container.innerHTML = await response.text();
    panel = container.firstElementChild;
    document.querySelector('#extensions_settings2').append(panel);
    panel.querySelector('#nai-story-setup').href = new URL('./setup.html', import.meta.url).href;
    panel.querySelector('#nai-story-repair').href = new URL('./setup.html#installation', import.meta.url).href;
    panel.querySelector('#nai-story-recheck').addEventListener('click', () => { void checkStatus(); });
    try {
        const legacy = await findLegacyFrontend(import.meta.url);
        if (legacy) {
            panel.querySelector('#nai-story-status').textContent = '检测到旧离线版与 Git 版同时启用。请先停用旧版并刷新，再使用本版本。';
            const repair = panel.querySelector('#nai-story-cleanup');
            repair.hidden = false;
            repair.addEventListener('click', async () => {
                repair.disabled = true;
                try { await legacy.disable(); }
                catch (error) { repair.disabled = false; toastr.error(`停用旧版失败：${error.message}`); }
            });
            return;
        }
    } catch (error) {
        panel.querySelector('#nai-story-status').textContent = `旧版检测未完成：${error.message}。请刷新后重试；如有两份配图扩展，请在扩展管理中停用旧离线版。`;
        return;
    }
    panel.querySelector('#nai-story-controls').hidden = false;
    for (const [id, preset] of Object.entries(UC_PRESETS)) {
        panel.querySelector('[data-option="ucPreset"]').add(new Option(preset.label, id));
    }
    for (const input of panel.querySelectorAll('[data-option]')) {
        const option = input.dataset.option;
        if (input.type === 'checkbox') input.checked = settings()[option];
        else input.value = settings()[option];
        input.addEventListener('change', () => {
            const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
            try {
                ctx.extensionSettings[STATE_KEY] = normalizeOptions({ ...settings(), [option]: value });
                ctx.saveSettingsDebounced();
                syncPrompt();
                refreshPolicyControls();
                if (!settings().enabled || (['automatic', 'allowAnlas'].includes(option) && !value)) queue.cancel();
                if (option === 'enabled') ctx.chat.forEach((_, index) => refresh(index));
            } catch (error) {
                toastr.error(error.message);
                if (input.type === 'checkbox') input.checked = settings()[option];
                else input.value = settings()[option];
            }
        });
    }
    refreshPolicyControls();
    panel.querySelector('#nai-uc-customize').addEventListener('click', () => {
        try {
            const negative = [UC_PRESETS[settings().ucPreset].text, settings().negative].filter(Boolean).join(', ');
            ctx.extensionSettings[STATE_KEY] = normalizeOptions({ ...settings(), ucPreset: 'custom', negative });
            panel.querySelector('[data-option="ucPreset"]').value = 'custom';
            panel.querySelector('[data-option="negative"]').value = negative;
            refreshPolicyControls();
            ctx.saveSettingsDebounced();
        } catch (error) { toastr.error(error.message); }
    });
    panel.querySelector('#nai-story-copy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(promptInstruction(settings())); toastr.success('预设指令已复制。'); }
        catch { toastr.error('剪贴板不可用，请从安装包的预设指令.txt 复制。'); }
    });
    panel.querySelector('#nai-story-cancel').addEventListener('click', () => queue.cancel());
    panel.querySelector('#nai-story-preview').addEventListener('click', previewExample);
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-nai-action]');
        // SillyTavern prefixes CSS classes in messages with "custom-".
        const card = button?.closest('[data-nai-key][data-nai-index]');
        if (!card) return;
        const index = Number(card.dataset.naiIndex);
        const message = context().chat[index];
        if (!message) return;
        const block = parseBlocks(message.mes).find(item => item.key === card.dataset.naiKey);
        if (!block) return;
        if (button.dataset.naiAction === 'generate') enqueueImage(index, block);
        else if (button.dataset.naiAction === 'large') void redrawLarge(index, block);
        else if (button.dataset.naiAction === 'edit') editScene(index, block);
        else queue.cancel(job => job.index === index);
    });
    ctx.messageFormatter.addHook(formatMessage, { stage: ctx.messageFormatter.stage.BEFORE_REGEX });
    const events = ctx.eventTypes;
    ctx.eventSource.on(events.GENERATION_STARTED, onGenerationStarted);
    ctx.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, onRendered);
    ctx.eventSource.on(events.GENERATION_ENDED, onGenerationEnded);
    ctx.eventSource.on(events.GENERATION_STOPPED, () => { generation.clear(); queue.cancel(); });
    ctx.eventSource.on(events.CHAT_CHANGED, () => { queue.cancel(); statuses.clear(); generation.clear(); syncPrompt(); });
    for (const event of [events.MESSAGE_EDITED, events.MESSAGE_DELETED, events.MESSAGE_SWIPED, events.MESSAGE_SWIPE_DELETED]) {
        ctx.eventSource.on(event, () => { queue.cancel(); generation.clear(); });
    }
    window.addEventListener('focus', () => { void checkStatus(); });
    syncPrompt();
    await checkStatus();
}

const instanceKey = Symbol.for(`${ID}:frontend`);
if (!globalThis[instanceKey]) {
    globalThis[instanceKey] = import.meta.url;
    try { await init(); }
    catch (error) { delete globalThis[instanceKey]; throw error; }
}
