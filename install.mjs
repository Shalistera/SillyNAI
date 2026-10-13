import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const source = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const positional = args.filter(arg => !arg.startsWith('--'));
const serverOnly = args.includes('--server-only');
if (args.includes('--help') || !positional.length) {
    console.log('用法：node install.mjs "/完整路径/SillyTavern" [--server-only]\nGit 安装的前端请加 --server-only，仅更新服务端，避免另装一份离线前端。\n请先在目标酒馆运行 npm ci，完成后重启酒馆。');
    process.exit(args.includes('--help') ? 0 : 1);
}
if (positional.length !== 1 || args.some(arg => arg.startsWith('--') && arg !== '--server-only')) throw new Error('不支持的参数，请使用 --help 查看用法。');
const target = path.resolve(positional[0]);
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
    ...(serverOnly ? [] : [{ dir: path.join(target, 'public/scripts/extensions/third-party/novelai-story-illustrator'), files: ['package.json', 'manifest.json', 'index.js', 'editor.js', 'editor-state.js', 'shared.js', 'uc-presets.js', 'queue.js', 'settings.html', 'style.css', 'setup.html', 'setup.js', 'api.js', 'compatibility.js', 'migration.js'] }]),
    { dir: path.join(target, 'plugins/novelai-story-illustrator'), files: ['package.json', 'server.mjs', 'service.mjs', 'shared.js', 'uc-presets.js', 'setup.html', 'setup.js', 'api.js', 'compatibility.js'] },
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
    for (const file of destination.files) {
        const from = path.join(source, file);
        const to = path.join(destination.dir, file);
        if (from !== to) await fs.copyFile(from, to);
    }
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
console.log('安装完成。重启酒馆并刷新浏览器，从扩展设置打开“连接账号 / 测试出图”。');
