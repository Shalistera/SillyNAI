import { ID } from './shared.js';

// Only recognize the original offline install, and only when running a second
// copy from a different directory. Preserve its files and shared user settings.
export async function findLegacyFrontend(moduleUrl) {
    const name = `third-party/${ID}`;
    const legacyPath = `/scripts/extensions/${name}/`;
    if (new URL(moduleUrl).pathname.startsWith(legacyPath)) return null;
    const extensions = await import('/scripts/extensions.js');
    if (!extensions.extensionNames.includes(name) || extensions.extension_settings.disabledExtensions.includes(name)) return null;
    const response = await fetch(`${legacyPath}package.json`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const pkg = await response.json();
    if (pkg.name !== ID) return null;
    return { name, disable: () => extensions.disableExtension(name, true) };
}
