// Development-only deterministic text API. Never installed by install.mjs.
// This is a simulated writer, not an LLM; image requests still use the real NAI plugin.
import http from 'node:http';
import { makeExampleScene } from '../shared.js';

const port = Number(process.argv[2] || 8021);
const model = 'local-illustration-test';
const results = [];
const solo = makeExampleScene();
const duo = {
    title: '喝茶与阅读 · 动作标签测试',
    scene: '1girl, 1boy, indoors, tavern, table, night, candlelight',
    size: 'landscape',
    characters: [
        { name: '女子', gender: 'girl', description: 'An adult woman with long black hair and blue eyes, wearing a red cloak over a white blouse.', actions: 'sitting, holding cup, smile, looking at another', position: { x: 0.25, y: 0.5 } },
        { name: '男子', gender: 'boy', description: 'An adult man with short blonde hair and green eyes, wearing a blue coat over a gray shirt.', actions: 'sitting, reading, holding book, looking down', position: { x: 0.75, y: 0.5 } },
    ],
};
const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model', owned_by: 'local-test' }] }));
    }
    if (req.url === '/test-results') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(results));
    }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end();
        return;
    }
    try {
        let raw = '';
        for await (const part of req) {
            raw += part;
            if (raw.length > 2_000_000) { res.writeHead(413).end(); return; }
        }
        const input = JSON.parse(raw);
        const messages = input.messages ?? [];
        const userText = String(messages.filter(item => item.role === 'user').at(-1)?.content ?? '');
        const combined = messages.map(item => typeof item.content === 'string' ? item.content : '').join('\n');
        const scene = /双人/.test(userText) ? duo : solo;
        const report = { test: scene === duo ? 'duo' : 'solo', stream: Boolean(input.stream), hasCharInstruction: combined.includes('gender') && combined.includes('description'), hasActionInstruction: combined.includes('actions 使用 Danbooru'), hasSceneInstruction: combined.includes('<nai_image>'), hasPrivateBase: combined.includes('watercolor illustration, delicate ink linework'), time: new Date().toISOString() };
        results.push(report);
        console.log(JSON.stringify(report));
        const text = scene === duo
            ? `【本地模拟文字回复，用于验证自动配图】\n\n她捧着热茶，微笑着望向对面的旅人。他低着头翻看手里的书，烛光落在蓝色外套上。\n\n<nai_image>${JSON.stringify(scene)}</nai_image>\n\n窗外的雨声渐渐轻了。`
            : `【本地模拟文字回复，用于验证自动配图】\n\n她坐在窗边，捧着杯子望向窗外，脸上浮起浅浅的笑意。\n\n<nai_image>${JSON.stringify(scene)}</nai_image>\n\n屋里的灯依旧温暖。`;
        if (!input.stream) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ id: 'local-test', object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        for (let offset = 0; offset < text.length && !res.destroyed; offset += 80) {
            res.write(`data: ${JSON.stringify({ id: 'local-test', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: text.slice(offset, offset + 80) }, finish_reason: null }] })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (!res.destroyed) {
            res.write(`data: ${JSON.stringify({ id: 'local-test', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            res.end('data: [DONE]\n\n');
        }
    } catch {
        if (!res.headersSent) res.writeHead(400);
        res.end();
    }
});
server.listen(port, '127.0.0.1', () => console.log(`Simulated writer listening at http://127.0.0.1:${server.address().port}/v1`));
