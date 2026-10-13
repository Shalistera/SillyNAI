import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import fetch from 'node-fetch';
import { createService } from './service.mjs';
import { ID, VERSION, InputError } from './shared.js';

export const info = { id: ID, name: 'NovelAI Story Illustrator', description: 'NovelAI V5 illustrations with server-side SillyTavern credentials.' };

export async function init(router) {
    // Installed at <SillyTavern>/plugins/novelai-story-illustrator/.
    const secretModule = new URL('../../src/endpoints/secrets.js', import.meta.url);
    const { readSecret, writeSecret, SECRET_KEYS } = await import(secretModule.href);
    const { clientRelativePath, extractFileFromZipBuffer } = await import(new URL('../../src/util.js', import.meta.url).href);
    const users = new Map();
    const service = createService({
        fetch,
        extractPng: data => extractFileFromZipBuffer(data, '.png'),
        saveImage: async (user, buffer) => {
            const directories = users.get(user);
            const folder = path.join(directories.userImages, ID);
            await fs.mkdir(folder, { recursive: true });
            const file = path.join(folder, `${Date.now()}-${randomUUID()}.png`);
            await fs.writeFile(file, buffer, { flag: 'wx' });
            return clientRelativePath(directories.root, file);
        },
    });

    router.use((req, res, next) => {
        if (!req.user?.directories?.root) return res.status(401).json({ error: '请先登录酒馆。' });
        res.setHeader('Cache-Control', 'no-store');
        next();
    });
    const wrap = handler => async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            if (res.destroyed || res.headersSent) return;
            const status = error instanceof InputError ? error.status : 502;
            // Do not log raw fetch exceptions, tokens or story prompts.
            res.status(status).json({ error: error instanceof InputError ? error.message : '连接 NovelAI 失败，请检查网络或酒馆代理设置。' });
        }
    };
    router.get('/status', wrap(async (req, res) => {
        res.json({ version: VERSION, promptSchema: 3, generationPolicy: 5, keySaved: Boolean(readSecret(req.user.directories, SECRET_KEYS.NOVEL)) });
    }));
    router.post('/key', wrap(async (req, res) => {
        const key = req.body?.key;
        if (typeof key !== 'string' || key.trim().length < 20 || key.length > 8192 || /\s/.test(key.trim())) throw new InputError('请粘贴完整的 Persistent API Token。');
        writeSecret(req.user.directories, SECRET_KEYS.NOVEL, key.trim());
        res.json({ keySaved: true });
    }));
    router.post('/check', wrap(async (req, res) => {
        const key = readSecret(req.user.directories, SECRET_KEYS.NOVEL);
        if (!key) throw new InputError('尚未保存 NovelAI API Key。', 401);
        res.json(await service.subscription(key));
    }));
    router.post('/generate', wrap(async (req, res) => {
        const user = req.user.directories.root;
        users.set(user, req.user.directories);
        const controller = new AbortController();
        const onClose = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', onClose);
        try {
            const result = await service.generate({
                user, key: readSecret(req.user.directories, SECRET_KEYS.NOVEL),
                requestId: req.body?.requestId, scene: req.body?.scene,
                options: req.body?.options, imageOverrides: req.body?.imageOverrides, signal: controller.signal,
            });
            if (!res.destroyed) res.json(result);
        } finally {
            res.off('close', onClose);
        }
    }));
    // An account-free page for one image test; settings and credentials stay local.
    router.get('/setup', wrap(async (req, res) => {
        res.type('html').send(await fs.readFile(fileURLToPath(new URL('./setup.html', import.meta.url)), 'utf8'));
    }));
    // Keep the server's standalone page independent of frontend install paths.
    for (const asset of ['setup.js', 'shared.js', 'uc-presets.js', 'api.js', 'compatibility.js']) {
        router.get(`/${asset}`, wrap(async (req, res) => {
            res.type('js').send(await fs.readFile(fileURLToPath(new URL(`./${asset}`, import.meta.url)), 'utf8'));
        }));
    }
}
