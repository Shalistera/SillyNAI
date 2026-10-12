import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const source = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] && path.resolve(process.argv[2]);
if (!target || process.argv.includes('--help')) {
    console.log('用法：node install.mjs "/完整路径/SillyTavern"\n请先在目标酒馆运行 npm ci，然后关闭酒馆再安装。');
    process.exit(target ? 0 : 1);
}
const pkg = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
if (pkg.name !== 'sillytavern') throw new Error('目标目录不是 SillyTavern 根目录。');
const [major, minor] = pkg.version.split('.').map(Number);
if (major < 1 || (major === 1 && minor < 19)) throw new Error('此版本需要 SillyTavern 1.19.0 或更新版本。');
const require = createRequire(path.join(target, 'package.json'));
const YAML = require('yaml');
const configFile = path.join(target, 'config.yaml');
let original;
try { original = await fs.readFile(configFile, 'utf8'); }
catch (error) {
    if (error.code !== 'ENOENT') throw error;
    original = await fs.readFile(path.join(target, 'default/config.yaml'), 'utf8');
}
const config = YAML.parseDocument(original);
if (config.errors.length) throw new Error('config.yaml 解析失败，请先修复配置。');
const targets = [
    { dir: path.join(target, 'public/scripts/extensions/third-party/novelai-story-illustrator'), files: ['package.json', 'manifest.json', 'index.js', 'shared.js', 'uc-presets.js', 'queue.js', 'settings.html', 'style.css', 'setup.js'] },
    { dir: path.join(target, 'plugins/novelai-story-illustrator'), files: ['package.json', 'server.mjs', 'service.mjs', 'shared.js', 'uc-presets.js', 'setup.html'] },
];
for (const destination of targets) {
    const exists = await fs.stat(destination.dir).catch(() => null);
    if (exists) {
        const previous = JSON.parse(await fs.readFile(path.join(destination.dir, 'package.json'), 'utf8'));
        if (previous.name !== 'novelai-story-illustrator') throw new Error(`已有同名目录，停止覆盖：${destination.dir}`);
    }
}
for (const destination of targets) {
    await fs.mkdir(destination.dir, { recursive: true });
    for (const file of destination.files) await fs.copyFile(path.join(source, file), path.join(destination.dir, file));
    console.log(`已安装：${destination.dir}`);
}
if (config.get('enableServerPlugins') !== true) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(target, 'backups', `config.yaml.nai-backup-${stamp}`);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.writeFile(backup, original, { flag: 'wx', mode: 0o600 });
    config.set('enableServerPlugins', true);
    await fs.writeFile(configFile, config.toString());
    console.log(`已启用服务端插件；原配置备份：${backup}`);
} else {
    await fs.access(configFile).catch(() => fs.writeFile(configFile, original));
}
console.log('安装完成。启动酒馆后打开 /api/plugins/novelai-story-illustrator/setup 连接账号。');
