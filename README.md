# SillyNAI — NovelAI Story Illustrator

English | [简体中文](README.zh-CN.md)

An inline illustration extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern). Your existing text model writes the story and image descriptions; NovelAI V5 generates the illustrations. Images appear next to the passages they illustrate and are saved in the current SillyTavern user's image directory.

**Version: 0.6.0** · Node.js 20+ · SillyTavern 1.19.0+

The extension currently has a Chinese interface. This README includes the relevant Chinese control labels.

## Features

- Automatic illustration instructions, or a protocol you can include in your own writing preset.
- **Fixed image counts**: request exactly 1–4 illustration blocks per reply, or let the model choose within a limit.
- Illustrations placed immediately after their corresponding story passages.
- A user-defined Base Prompt for stable style, short scene tags, and separate character prompts with appearance and actions.
- Danbooru action tags or short natural-language actions; English or Chinese character descriptions.
- A visual per-image editor for the full Base Prompt, main Undesired Content, character prompts, positions, and orientation.
- **Large redraw** with an optional, initially checked “keep current seed” setting.
- Official V5 UC presets, custom UC, and separate negative prompts for each character.
- Serial image requests, saved chat metadata, and checks against attaching images to the wrong chat or response variant.

NovelAI V5 Full is the default image model. V5 Curated is also available. The extension uses text-to-image generation; image references, Vibe Transfer, inpainting, image-to-image, and upscaling are outside the current feature set.

## Installation

This repository contains a **frontend extension and a server plugin**. Run the installer on the machine that hosts SillyTavern.

1. Install or update SillyTavern, run `npm ci` in its root directory, and confirm that it starts normally.
2. Stop SillyTavern.
3. Clone this repository using an SSH key with access to it:

   ```sh
   git clone git@github.com:Shalistera/SillyNAI.git
   cd SillyNAI
   ```

4. Install both components:

   macOS / Linux:

   ```sh
   node install.mjs "/absolute/path/to/SillyTavern"
   ```

   Windows PowerShell:

   ```powershell
   node .\install.mjs "D:\SillyTavern"
   ```

5. Start SillyTavern again and refresh your browser.
6. Open `/api/plugins/novelai-story-illustrator/setup` on your SillyTavern server. With the default local port, this is [http://127.0.0.1:8000/api/plugins/novelai-story-illustrator/setup](http://127.0.0.1:8000/api/plugins/novelai-story-illustrator/setup).

A downloaded archive can be extracted instead of cloning. Run the same installer from the extracted directory.

The installer copies both components, enables `enableServerPlugins`, and backs up the configuration before changing that setting. Existing chats, characters, credentials, and other configuration values are preserved. No SillyTavern core source changes or additional npm dependencies are required by this extension.

SillyTavern's built-in Git extension installer installs the frontend only. Use the provided script for a complete deployment, including the server component. For a private repository, SSH authentication must work on the **server**, even when you open SillyTavern in a browser on another machine.

### Updates

In the cloned source directory:

```sh
git pull --ff-only
```

Stop SillyTavern, rerun `node install.mjs "/absolute/path/to/SillyTavern"`, restart the server, and refresh the browser. Version 0.6.0 checks server capability `generationPolicy >= 5` so an older backend cannot silently ignore Large dimensions.

## Connect NovelAI

1. In NovelAI, open **Settings → Account → Get Persistent API Token**. An existing valid token can be reused; replacing it invalidates the previous token.
2. Paste it into the extension's setup page and save it.
3. Click **检查连接与额度** (Check connection and quota).
4. Optionally use **生成一张测试图片** (Generate a test image). This does not call your text model.

The server stores the token in the current SillyTavern user's NovelAI secret entry. It uses SillyTavern's authentication and CSRF protection. Keep credentials in the setup page and protect your server's `data/` directory; presets, world books, and story messages should contain only story and image instructions.

For remote deployments, replace the local host and port with your own SillyTavern address. If accounts are enabled, sign into the account that will use the extension. Image API requests originate from the SillyTavern server.

## Story generation and image counts

Open **Extensions → NovelAI 小说配图**.

- **自动向文字模型加入绘图要求** (Automatically inject image instructions): enabled by default. The extension adds a system instruction in the chat context, at depth 0, so the same text-model reply contains prose and image descriptions.
- **回复完成后自动出图** (Generate images when the reply finishes): disabled by default. With this off, image blocks appear as cards with a manual Generate button. Enabling it queues images from newly completed replies.
- **图片数量模式** (Image count mode): choose an upper limit or a fixed count. The count ranges from 1 to 4.

### Exactly two illustrations, placed with the story

Choose **每条回复固定数量** (Fixed count per reply), then set **每条回复固定几张** to **2**. The injected instruction requests exactly two complete, independent `<nai_image>` blocks.

The placement follows the story:

1. A passage describes the first moment.
2. Its illustration block immediately follows that passage.
3. The story continues to another moment.
4. A second illustration block immediately follows that passage.

Each block describes its own moment. The instruction explicitly discourages collecting all images at the end, consecutive image blocks, duplicate scenes, JSON arrays, and multi-panel compositions used as substitutes for separate images.

**按剧情决定，设定上限** (Let the model decide within a limit) retains the previous behavior: zero to N blocks. A requested count in your message is honored by the instruction when it fits within that limit. Set the limit to at least 2 before asking for two images in a particular reply; the default limit is 1.

Fixed mode also checks the number of valid blocks after the reply completes and reports a mismatch. The text model may still omit a block, run out of output tokens, or produce invalid JSON. The extension preserves the response and does not send additional text-model requests to fill missing blocks.

In both modes, automatic generation processes at most N valid blocks in sequence. Extra blocks remain available for manual generation. Existing settings retain their previous limit and the optional-count mode after an upgrade.

### Using your own writing preset

Click **复制预设指令** (Copy preset instructions) to copy instructions reflecting the current count, placement rules, character notes, action style, and other writing settings. Add them to your preset and turn off automatic injection if the preset already supplies the protocol.

After changing these settings, copy and replace the old preset instructions. The bundled [预设指令.txt](预设指令.txt) is a default example with an upper limit of one; it is not a live copy of your configuration.

## Prompt composition

### Base Prompt and scene tags

Use **固定 Base Prompt（画风）** for style, artist, medium, or other stable preferences. Insert `{{scene}}` where the current scene should go:

```text
watercolor illustration, delicate ink linework, soft muted colors,
{{scene}}, textured watercolor paper
```

The text model provides a compact scene, such as:

```text
1girl, 1boy, indoors, tavern, table, night, candlelight
```

The extension inserts those tags into the Base Prompt. Without a placeholder, it appends the scene. Other double-brace weighting syntax is preserved. Optional quality tags are added separately; choose **不添加** (None) if you already provide your own.

The generated `scene` should contain the subject count and roughly 3–6 environment, time, and lighting tags. Character appearance, clothing, actions, expressions, and gaze belong in the corresponding character entry. These are instructions for the text model; existing or manually edited prompts are not truncated to a tag count.

Your fixed Base text is composed on the image side and is not included in the text-model instructions.

### Character prompts

Each visible character has separate `gender`, `description`, and `actions` fields. The extension combines them into that character's prompt:

```text
girl, An adult woman with long black hair and blue eyes, wearing a red cloak., sitting, holding cup, smile, looking at another
```

- `description` contains known appearance and current clothing.
- `actions` contains that person's posture, gestures, held objects, expression, and gaze.
- `gender` is `girl`, `boy`, or `other`. These are category tags; known age is described separately.
- `negative` is sent only for the corresponding character.

**人物动作写法** selects Danbooru-style action tags by default, or short natural-language actions. Tags use spaces between words, for example `leaning forward, holding cup`. The writing instruction requests only the relevant actions, usually 3–8 tags. A short natural-language clarification can describe an interaction when necessary.

**人物描述语言** selects English or Chinese for appearance and natural-language actions. Environment tags and Danbooru action tags remain in English.

**人物外貌备忘** adds optional appearance notes for the text model. **给文字模型的附加绘图要求** adds your own composition or writing preferences. These settings are global; review them when switching stories.

### Undesired Content

The built-in V5 presets are Light (default), Heavy, Human Focus, and Furry Focus, based on the [official UC documentation](https://docs.novelai.net/en/image/undesiredcontent/) checked on 2026-09-22. Their contents should be reviewed against your intended style; for example, a preset may exclude effects that you want to keep.

With an official preset selected, custom UC text is appended. **以当前内容创建自定义 UC** copies the combined text into a fully editable custom preset. Custom mode can also use an empty main UC.

**允许模型追加本图主 UC** controls whether the text model may append a scene-level negative prompt; it is off for new installations. Character negatives remain independent. Existing custom UC from older versions is preserved during migration.

## Visual per-image editing

Click **编辑图片** on an illustration card. The editor provides:

- The complete positive **Base Prompt**, including style, scene, subject count, and quality tags.
- The complete main **Undesired Content**, including the ability to remove every negative tag.
- Complete positive and negative prompts for each character, with add, remove, and reorder controls.
- Optional manual X/Y positions in the range 0–1; otherwise NovelAI determines placement.
- A title and one of the three standard image sizes.

**保存** saves edits. **保存并出图** saves and generates immediately. **取消** discards the current edit session.

On first opening, the editor composes the scene using your current global settings. Once saved, that image uses its own complete Base and UC exactly as entered, with no further global style, quality, or UC additions. The reset button can refill the main prompts from current global settings and the original scene.

Edits are saved in the current message and response variant's metadata and survive a reload. Other images and global settings keep their own values. When adding or removing characters, update the subject-count tags in Base as appropriate.

The editor shows the prompts for the next generation. Original generation parameters remain available in the saved PNG metadata.

## Standard sizes and Large redraw

| Orientation | Standard generation | Large redraw |
| --- | --- | --- |
| Landscape | 1216 × 832 | 1536 × 1024 |
| Portrait | 832 × 1216 | 1024 × 1536 |
| Square | 1024 × 1024 | 1472 × 1472 |

Standard generation can follow the text model's `size`, use a fallback when omitted, or use your global fixed orientation. A size saved in the image editor overrides the global setting for that image.

After an image exists, click **高清重画** (Large redraw):

1. The dialog selects the orientation of the current image; you can choose any of the three Large sizes.
2. **沿用当前 Seed** (Keep current seed) is **checked by default** and uses the seed of the image currently on the card.
3. Uncheck it to use a random seed, even if your global seed is fixed.
4. Click **高清重画（消耗 Anlas）** to queue this paid generation.

Large redraw uses the current edited prompts and sampling settings. Its Anlas permission, dimensions, and seed choice apply to that request only. Global cost permission and seed settings are preserved. **常规重画** continues to use standard sizes and the usual settings, even after a Large image is displayed.

This regenerates an image from text at a larger resolution. Reusing a seed at a different resolution can change the composition. A successful result replaces the card's image; earlier files remain in the user's image directory.

## Image block protocol

The model writes these blocks directly between story passages:

```text
She settles beside the window, holding a cup and watching the rain.

<nai_image>
{
  "title": "The traveler by the window",
  "scene": "1girl, indoors, bedroom, window, night, backlighting",
  "size": "portrait",
  "characters": [
    {
      "name": "Traveler",
      "gender": "girl",
      "description": "An adult woman with long black hair and blue eyes, wearing a loose white shirt.",
      "actions": "sitting, holding cup, looking away, smile",
      "negative": "",
      "position": { "x": 0.5, "y": 0.5 }
    }
  ]
}
</nai_image>

The conversation continues.
```

- `scene` is required. `prompt` is accepted as an alias.
- `characters` is optional, with at most 22 entries. Structured entries use `gender` and `description`; the generated instructions also request `actions`.
- Existing complete `characters[].prompt` strings remain supported. Older descriptions without `actions` also continue to work.
- `position` may be omitted for every character. When using manual positions, provide both coordinates for every character. The top-left corner is `(0, 0)`.
- `size` is `portrait`, `landscape`, or `square`. It selects orientation for standard generation, subject to user overrides.
- `title`, character negatives, and the optional scene-level `negative` may be omitted.
- Model output cannot select Large resolution, change billing permission, set arbitrary dimensions, or replace the user's model, seed, or sampling settings.

The original blocks remain in chat text for reloads and export; the extension changes their displayed representation. They may therefore appear in message editing, searches, recent-chat excerpts, and history sent to the text model. The visual editor stores its overrides separately in message metadata.

## Costs and queue behavior

Defaults are V5 Full, one image per request, 23 steps, guidance 7, and a random seed. Standard sizes are at most 1,048,576 pixels.

**允许消耗 Anlas** (Allow Anlas spending) is off by default. For standard requests without this permission, the server checks active Opus, available V5 quota, and the free parameter range before generation. Large requests exceed that range and require the explicit paid redraw action or an authorized API request. See the [official subscription rules](https://docs.novelai.net/en/subscription/) for billing terms.

Quota checks and generation are separate operations, so NovelAI determines the actual charge if quota or account state changes between them.

Images are queued one at a time. Concurrent requests for the same SillyTavern user are rejected; failed requests are not retried automatically. Reloading a page, opening history, or switching response variants does not automatically generate missing illustrations.

Changing chats, editing or deleting messages, switching variants, or cancelling the queue cancels affected work. Before attaching a result, the extension checks the originating chat, message, text, and variant. A request already received by NovelAI may still finish and use quota; a completed file can remain in the user's image directory even when it is no longer attached to the chat.

## Manual installation and Docker

Install into the SillyTavern server directory or the equivalent persistent container mounts.

Frontend directory: `public/scripts/extensions/third-party/novelai-story-illustrator/`

```text
package.json manifest.json index.js editor.js editor-state.js shared.js
uc-presets.js queue.js settings.html style.css setup.js
```

Server directory: `plugins/novelai-story-illustrator/`

```text
package.json server.mjs service.mjs shared.js uc-presets.js setup.html
```

Set `enableServerPlugins: true` in `config.yaml`, restart SillyTavern, and refresh the browser. The plugin runs inside SillyTavern's Node.js process using its existing fetch, secret storage, image path, and ZIP extraction support.

To remove it, stop SillyTavern, remove these two component directories, and restart. Saved chats and images remain. Leave server plugins enabled if other installed plugins need them.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Setup page returns 404 | Install the server component, enable server plugins, and restart. |
| New controls are missing | Reinstall the frontend files and refresh the browser. |
| Backend upgrade message | Update both components to 0.6.0 and restart the server. |
| The model writes only one image | Select fixed count 2, or raise the optional limit; replace stale rules in your own preset. |
| Images appear only at the end | Ensure the updated placement instructions reach the text model and remove conflicting preset rules. |
| Image count mismatch | Check output length, block closure, valid JSON, and conflicting count instructions. |
| 401 | Update the saved Persistent API Token. |
| 402 | Check NovelAI quota or Anlas balance and the request's cost permission. |
| 429 | Wait and retry manually; avoid concurrent clients. |
| 400 | Check prompt length, character count, coordinates, and block format. |
| Network failure | Check that the server can reach `https://image.novelai.net`; configure SillyTavern's `requestProxy` if needed. |

## Development and validation

```sh
npm test
```

The test suite uses mocked network responses and does not require a real NovelAI token. It covers block parsing, prompt composition, settings migration, fixed counts and inline-placement instructions, per-image edits, all Large sizes, seed selection, cost guards, request deduplication, and queue cancellation.

The separately runnable installer smoke test requires a local SillyTavern installation:

```sh
node tests/install-smoke.mjs /path/to/SillyTavern
```

It installs into a temporary directory and checks repeated installation, configuration backups, component files, and user-data preservation.

The tested host is macOS with Node.js 26.0.0 and SillyTavern 1.19.0, release commit `06bde939f`. Earlier releases were tested with real V5 Full images at standard sizes. The latest real API attempt reported an invalid token; Large output has not yet been validated with a live account. Fixed-count and placement instructions are tested as generated text, not as a guarantee of a particular writing model's adherence. Windows, Linux, and Docker installation have not been run on those platforms.

Detailed historical results are in [验证记录.md](验证记录.md) (Chinese).

## License

[AGPL-3.0-only](LICENSE).
