import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const host = path.resolve(process.argv[2] ?? '../SillyTavern-app');
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = await fs.mkdtemp(path.join(os.tmpdir(), 'nai-install-test-'));
const original = '# keep this comment\nlisten: false\nport: 8123\nenableServerPlugins: false\ncustomSetting: keep-me\n';
try {
    await fs.mkdir(path.join(target, 'node_modules'), { recursive: true });
    await fs.symlink(path.join(host, 'node_modules/yaml'), path.join(target, 'node_modules/yaml'), 'dir');
    await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'sillytavern', version: '1.19.0' }));
    await fs.writeFile(path.join(target, 'config.yaml'), original);
    await fs.mkdir(path.join(target, 'data'), { recursive: true });
    await fs.writeFile(path.join(target, 'data/do-not-touch.txt'), 'user data');
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, [path.join(source, 'install.mjs'), target], { stdio: 'pipe' });
    const updated = await fs.readFile(path.join(target, 'config.yaml'), 'utf8');
    assert.match(updated, /enableServerPlugins: true/);
    assert.match(updated, /port: 8123/);
    assert.match(updated, /listen: false/);
    assert.match(updated, /# keep this comment/);
    assert.match(updated, /customSetting: keep-me/);
    assert.equal(await fs.readFile(path.join(target, 'data/do-not-touch.txt'), 'utf8'), 'user data');
    const backups = await fs.readdir(path.join(target, 'backups'));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(target, 'backups', backups[0]), 'utf8'), original);
    for (const file of ['plugins/novelai-story-illustrator/server.mjs', 'plugins/novelai-story-illustrator/service.mjs', 'plugins/novelai-story-illustrator/uc-presets.js', 'public/scripts/extensions/third-party/novelai-story-illustrator/index.js', 'public/scripts/extensions/third-party/novelai-story-illustrator/uc-presets.js']) {
        assert.equal(await fs.readFile(path.join(target, file), 'utf8'), await fs.readFile(path.join(source, path.basename(file)), 'utf8'));
    }
    console.log('Installer smoke test passed: both components copied, repeated install safe, config preserved, backup correct, user data untouched.');
} finally {
    await fs.rm(target, { recursive: true, force: true });
}
