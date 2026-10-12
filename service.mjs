import { randomInt } from 'node:crypto';
import { InputError, buildPayload, normalizeOptions, normalizeImageOverrides, freeGenerationBlockReason } from './shared.js';

const API = 'https://image.novelai.net';

async function upstreamError(response) {
    // Never forward an upstream body: it may contain request text or credentials.
    const labels = {
        400: 'NovelAI 拒绝了绘图参数。请检查提示词长度和模型设置。',
        401: 'NovelAI API Key 无效或已被替换。',
        402: 'NovelAI 额度或 Anlas 不足。',
        403: 'NovelAI 拒绝访问，请检查订阅状态。',
        429: 'NovelAI 请求过于频繁，请稍后手动重试。',
    };
    const status = [400, 401, 402, 403, 429].includes(response.status) ? response.status : 502;
    const correlation = response.headers.get('x-correlation-id');
    const suffix = /^[a-zA-Z0-9]{6}$/.test(correlation ?? '') ? ` 请求编号：${correlation}` : '';
    throw new InputError((labels[response.status] ?? `NovelAI 服务暂时失败（HTTP ${response.status}），没有自动重试。`) + suffix, status);
}

export function createService({ fetch, saveImage, extractPng, timeoutMs = 180000, seed = () => randomInt(0, 4294967296) }) {
    const busy = new Set();
    const completed = new Map();
    async function subscription(key, signal) {
        const response = await fetch(`${API}/user/subscription`, {
            headers: { Authorization: `Bearer ${key}` },
            signal: signal ?? AbortSignal.timeout(20000),
            size: 1048576,
        });
        if (!response.ok) await upstreamError(response);
        const data = await response.json();
        return {
            active: data.active === true,
            tier: data.tier,
            anlas: data.trainingStepsLeft ? {
                subscription: data.trainingStepsLeft.fixedTrainingStepsLeft,
                purchased: data.trainingStepsLeft.purchasedTrainingSteps,
            } : null,
            usage: data.usage ? { percent: data.usage.percent, isNegative: data.usage.isNegative, timeUntilNextPercent: data.usage.timeUntilNextPercent } : null,
        };
    }

    async function generate({ user, key, requestId, scene, options, imageOverrides, signal }) {
        if (!key) throw new InputError('请先保存 NovelAI API Key。', 401);
        if (!/^[\da-f-]{36}$/i.test(requestId ?? '')) throw new InputError('缺少有效请求编号。');
        const validated = normalizeOptions(options);
        const overrides = normalizeImageOverrides(imageOverrides);
        const payload = buildPayload(scene, validated, seed(), overrides);
        const jobId = `${user}:${requestId}`;
        const signature = JSON.stringify({ scene, options, imageOverrides: overrides });
        if (completed.has(jobId)) {
            const previous = completed.get(jobId);
            if (previous.signature !== signature) throw new InputError('请求编号已被另一组参数使用。', 409);
            return previous.result;
        }
        if (busy.has(user)) throw new InputError('此账号已有配图任务进行中，请等待完成。', 409);
        busy.add(user);
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(abort, timeoutMs);
        try {
            if (signal?.aborted) controller.abort();
            if (!validated.allowAnlas) {
                const account = await subscription(key, controller.signal);
                const reason = freeGenerationBlockReason(account, payload);
                if (reason) throw new InputError(`${reason} 已停止出图；如要使用 Anlas，请在设置中开启“允许消耗 Anlas”。`, 402);
            }
            controller.signal.throwIfAborted();
            const response = await fetch(`${API}/ai/generate-image`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
                size: 40 * 1024 * 1024,
            });
            if (!response.ok) await upstreamError(response);
            let buffer;
            let imageSeed = payload.parameters.seed;
            if (response.headers.get('content-type')?.includes('application/json')) {
                const data = await response.json();
                const item = data.images?.[0];
                if (!item || typeof item.image !== 'string' || item.image.length > 32 * 1024 * 1024) throw new InputError('NovelAI 返回的图片数据无效。', 502);
                buffer = Buffer.from(item.image, 'base64');
                if (Number.isInteger(item.seed)) imageSeed = item.seed;
            } else {
                buffer = await extractPng(await response.arrayBuffer());
            }
            if (!buffer || buffer.length > 24 * 1024 * 1024 || !Buffer.from(buffer).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
                throw new InputError('NovelAI 没有返回有效的 PNG 图片。', 502);
            }
            // Persist a completed image even when its originating chat has changed.
            const url = await saveImage(user, buffer, payload, imageSeed);
            const result = { url, seed: imageSeed, model: payload.model, width: payload.parameters.width, height: payload.parameters.height };
            completed.set(jobId, { result, signature });
            if (completed.size > 128) completed.delete(completed.keys().next().value);
            return result;
        } catch (error) {
            if (controller.signal.aborted) throw new InputError('配图已取消或超时。服务端可能已开始计算，请检查图库后再决定是否重试。', 408);
            throw error;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
            busy.delete(user);
        }
    }
    return { subscription, generate };
}
