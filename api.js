import { ID } from './shared.js';

// Bound service discovery and CSRF requests as well as image generation.
export async function fetchJson(url, init = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) abort();
    try {
        const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!response.ok) {
            throw new Error(typeof data?.error === 'string' ? data.error
                : response.status === 404 ? '未找到服务端插件。请打开“安装修复说明”；酒馆的扩展更新仅更新前端。'
                    : `请求失败（HTTP ${response.status}），请检查酒馆登录状态和服务器连接。`);
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('酒馆返回了非 JSON 响应，请检查登录状态和反向代理设置。');
        return data;
    } catch (error) {
        if (timedOut) throw new Error('请求超时，请检查酒馆服务器连接后重试。图片请求超时后，请先检查图库再决定是否重新生成。');
        throw error;
    } finally {
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', abort);
    }
}

export function requestApi(route, body, headers, signal) {
    return fetchJson(`/api/plugins/${ID}/${route}`, {
        method: body === undefined ? 'GET' : 'POST', headers,
        body: body === undefined ? undefined : JSON.stringify(body), signal,
    }, route === 'generate' ? 210000 : route === 'check' ? 45000 : 15000);
}
