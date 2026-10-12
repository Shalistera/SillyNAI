import { createEditorDraft, editorDraftToRequest } from './editor-state.js';

export function openImageEditor({ scene, options, imageOverrides = {}, onSave, previewOnly = false }) {
    let draft = createEditorDraft(scene, options, imageOverrides);
    let saving = false;
    const dialog = document.createElement('dialog');
    dialog.className = 'nai-story-editor nai-visual-editor';
    dialog.setAttribute('aria-label', previewOnly ? '提示词表单预览' : '编辑这一张插图');
    dialog.innerHTML = `<form class="nai-editor-form">
      <header><h3>${previewOnly ? '提示词表单预览' : '编辑这一张插图'}</h3>
      <p>${previewOnly ? '使用当前设置和示例画面，可在这里试改提示词。' : '修改保存到这张图，重画时使用这里填写的完整提示词。'}</p></header>
      <div class="nai-story-grid">
        <label>图片标题<input name="title" maxlength="160" autocomplete="off"></label>
        <label>本图比例<select name="size"><option value="portrait">竖图 · 832 × 1216</option><option value="landscape">横图 · 1216 × 832</option><option value="square">方图 · 1024 × 1024</option></select></label>
      </div>
      <section class="nai-editor-section">
        <h4>主提示词</h4>
        <label>Base Prompt · 完整正向提示词<textarea name="base" rows="5" maxlength="32000" spellcheck="false"></textarea></label>
        <small>包含画风、场景、人数和质量词，按这里的完整内容发送。</small>
        <label>主 Undesired Content · 完整负面提示词<textarea name="negative" rows="3" maxlength="24000" spellcheck="false"></textarea></label>
        <small>可直接增删官方负面词，留空即使用空主负面词。</small>
        <button type="button" data-editor-action="reset-main">从全局设置重新填入主提示词与 UC</button>
      </section>
      <section class="nai-editor-section">
        <div class="nai-editor-section-heading"><h4>角色提示词</h4><span data-role="count"></span></div>
        <label class="nai-editor-checkbox"><input type="checkbox" name="manualPositions">手动设置人物位置</label>
        <div class="nai-editor-characters"></div>
        <button type="button" data-editor-action="add">＋ 添加角色</button>
        <small>每个角色的正向提示词可完整编辑，包括 girl / boy / other、外貌、衣着和动作。增删角色后，可同步修改 Base 中的人数标签。</small>
      </section>
      <footer>
        <div class="nai-story-editor-error" role="alert"></div>
        <div class="nai-story-actions">
          ${previewOnly ? '' : '<button type="submit" data-editor-action="save">保存</button><button type="submit" class="nai-editor-primary" data-editor-action="generate">保存并出图</button>'}
          <button type="button" data-editor-action="close">${previewOnly ? '关闭预览' : '取消'}</button>
        </div>
      </footer>
    </form>`;
    const form = dialog.querySelector('form');
    const list = dialog.querySelector('.nai-editor-characters');
    const field = name => form.elements.namedItem(name);
    const errorBox = dialog.querySelector('[role="alert"]');

    function readDraft() {
        return {
            title: field('title').value, base: field('base').value,
            negative: field('negative').value, size: field('size').value,
            manualPositions: field('manualPositions').checked,
            characters: [...list.children].map(card => {
                const value = key => card.querySelector(`[data-person-field="${key}"]`).value;
                const coordinate = key => value(key).trim() ? Number(value(key)) : NaN;
                return { name: value('name'), prompt: value('prompt'), negative: value('negative'), x: coordinate('x'), y: coordinate('y') };
            }),
        };
    }

    function renderCharacters() {
        list.replaceChildren();
        draft.characters.forEach((person, index) => {
            const card = document.createElement('fieldset');
            card.className = 'nai-editor-character';
            card.dataset.index = String(index);
            card.innerHTML = `<legend>角色 ${index + 1}</legend>
              <div class="nai-editor-character-toolbar">
                <label>名称<input data-person-field="name" maxlength="160" autocomplete="off"></label>
                <div class="nai-story-actions"><button type="button" data-editor-action="up" aria-label="上移角色 ${index + 1}" ${index === 0 ? 'disabled' : ''}>上移</button><button type="button" data-editor-action="down" aria-label="下移角色 ${index + 1}" ${index === draft.characters.length - 1 ? 'disabled' : ''}>下移</button><button type="button" data-editor-action="remove" aria-label="删除角色 ${index + 1}">删除</button></div>
              </div>
              <label>角色 ${index + 1} 正向提示词<textarea data-person-field="prompt" rows="4" maxlength="16000" required spellcheck="false"></textarea></label>
              <label>角色 ${index + 1} 负面提示词<textarea data-person-field="negative" rows="2" maxlength="4000" spellcheck="false"></textarea></label>
              <div class="nai-position-controls nai-story-grid">
                <label>水平位置 · 0 左 / 1 右<input data-person-field="x" type="number" min="0" max="1" step="any" required></label>
                <label>垂直位置 · 0 上 / 1 下<input data-person-field="y" type="number" min="0" max="1" step="any" required></label>
              </div>`;
            for (const input of card.querySelectorAll('[data-person-field]')) input.value = person[input.dataset.personField] ?? '';
            list.append(card);
        });
        dialog.querySelector('[data-role="count"]').textContent = `${draft.characters.length} / 22`;
        dialog.querySelector('[data-editor-action="add"]').disabled = draft.characters.length >= 22;
        updatePositionControls();
    }

    function updatePositionControls() {
        const manual = field('manualPositions').checked;
        for (const group of list.querySelectorAll('.nai-position-controls')) {
            group.hidden = !manual;
            for (const input of group.querySelectorAll('input')) input.disabled = !manual;
        }
    }

    function fillDraft() {
        for (const key of ['title', 'base', 'negative', 'size']) field(key).value = draft[key];
        field('manualPositions').checked = draft.manualPositions;
        renderCharacters();
    }

    field('manualPositions').addEventListener('change', updatePositionControls);
    form.addEventListener('click', event => {
        const button = event.target.closest('button[data-editor-action]');
        if (!button || saving) return;
        const action = button.dataset.editorAction;
        if (action === 'close') return dialog.close();
        if (action === 'save' || action === 'generate') return;
        errorBox.textContent = '';
        draft = readDraft();
        if (action === 'reset-main') {
            const defaults = createEditorDraft(scene, options);
            field('base').value = defaults.base;
            field('negative').value = defaults.negative;
            return;
        }
        if (action === 'add') {
            if (draft.characters.length >= 22) return;
            draft.characters.push({ name: '', prompt: 'girl, ', negative: '', x: 0.5, y: 0.5 });
        } else {
            const index = Number(button.closest('[data-index]').dataset.index);
            if (action === 'remove') draft.characters.splice(index, 1);
            if (action === 'up' && index > 0) [draft.characters[index - 1], draft.characters[index]] = [draft.characters[index], draft.characters[index - 1]];
            if (action === 'down' && index < draft.characters.length - 1) [draft.characters[index + 1], draft.characters[index]] = [draft.characters[index], draft.characters[index + 1]];
        }
        renderCharacters();
        if (action === 'add') list.lastElementChild.querySelector('[data-person-field="prompt"]').focus();
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving || previewOnly) return;
        try {
            const edited = editorDraftToRequest(readDraft(), scene);
            saving = true;
            errorBox.textContent = '正在保存…';
            const controls = [...form.elements].map(input => [input, input.disabled]);
            controls.forEach(([input]) => { input.disabled = true; });
            try {
                await onSave({ ...edited, generate: event.submitter?.dataset.editorAction === 'generate' });
                dialog.close();
            } finally {
                controls.forEach(([input, disabled]) => { input.disabled = disabled; });
                saving = false;
            }
        } catch (error) { errorBox.textContent = error.message; }
    });
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    fillDraft();
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
}
