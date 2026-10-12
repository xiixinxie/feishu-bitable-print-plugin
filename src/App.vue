<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import {
  ArrowLeft, ArrowRight, Back, Bottom, Check, Delete, Download, EditPen, Grid,
  Menu, Picture, Plus, Printer, Refresh, Search, Tickets, Upload,
} from '@element-plus/icons-vue';
import usePrint from './hooks/usePrint';
import type { FieldMetaLite } from './types';

const {
  tableName, fieldList, linkedGroups, rows, templates, templateName, editorHtml, orientation, outputMode,
  imageWidthMm, imageHeightMm, imageFit,
  printScope, loading, connectionReady, errorMessage, previewPages, init, loadRows, loadLinkedFields,
  isLinkField, isMultiLink, createTemplate, openTemplate, saveTemplate, deleteTemplate,
  exportTemplates, importTemplates,
} = usePrint();

const page = ref<'home' | 'editor'>('home');
const previewMode = ref(false);
const fieldPanelOpen = ref(true);
const fieldSearch = ref('');
const saveDialog = ref(false);
const saveName = ref('');
const autoTableDialog = ref(false);
const autoTableTitle = ref('');
const autoTableFields = ref<string[]>([]);
const autoIncludeIndex = ref(true);
const editorRef = ref<HTMLElement>();
const importInput = ref<HTMLInputElement>();
const imageInput = ref<HTMLInputElement>();
const expandedLinks = ref(new Set<string>());
const selectedCell = ref<HTMLTableCellElement | null>(null);
const editorHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const hasPendingHistory = ref(false);
let savedRange: Range | null = null;
let historyTimer: number | undefined;

onMounted(init);

const shownFields = computed(() => fieldList.value.filter(field => field.name.toLowerCase().includes(fieldSearch.value.toLowerCase())));

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN', { hour12: false });

const getCleanEditorHtml = () => {
  if (!editorRef.value) return editorHtml.value;
  const clone = editorRef.value.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.selected-table-cell').forEach(cell => cell.classList.remove('selected-table-cell'));
  return clone.innerHTML;
};

const resetHistory = (html: string) => {
  if (historyTimer) window.clearTimeout(historyTimer);
  historyTimer = undefined;
  editorHistory.value = [html];
  historyIndex.value = 0;
  hasPendingHistory.value = false;
};

const pushHistory = (html: string) => {
  if (historyTimer) window.clearTimeout(historyTimer);
  historyTimer = undefined;
  const current = editorHistory.value[historyIndex.value];
  hasPendingHistory.value = false;
  if (html === current) return;
  editorHistory.value = [...editorHistory.value.slice(0, historyIndex.value + 1), html].slice(-80);
  historyIndex.value = editorHistory.value.length - 1;
};

const scheduleHistory = (html: string) => {
  hasPendingHistory.value = html !== editorHistory.value[historyIndex.value];
  if (historyTimer) window.clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => {
    pushHistory(getCleanEditorHtml() || html);
    historyTimer = undefined;
  }, 250);
};

const flushHistory = () => {
  if (historyTimer) window.clearTimeout(historyTimer);
  historyTimer = undefined;
  pushHistory(getCleanEditorHtml());
};

const canUndo = computed(() => hasPendingHistory.value || historyIndex.value > 0);
const canRedo = computed(() => !hasPendingHistory.value && historyIndex.value >= 0 && historyIndex.value < editorHistory.value.length - 1);

const restoreHistory = async (direction: -1 | 1) => {
  if (hasPendingHistory.value) flushHistory();
  const target = historyIndex.value + direction;
  if (target < 0 || target >= editorHistory.value.length) return;
  historyIndex.value = target;
  editorHtml.value = editorHistory.value[target];
  selectedCell.value = null;
  savedRange = null;
  await nextTick();
  if (editorRef.value) editorRef.value.innerHTML = editorHtml.value;
  editorRef.value?.focus();
};

const beginTemplate = () => {
  createTemplate();
  page.value = 'editor';
  nextTick(() => {
    if (editorRef.value) editorRef.value.innerHTML = editorHtml.value;
    resetHistory(editorHtml.value);
    editorRef.value?.focus();
  });
};

const openAutoTable = () => {
  autoTableTitle.value = `${tableName.value || '当前表'}清单`;
  autoTableFields.value = fieldList.value.slice(0, 8).map(field => field.id);
  autoIncludeIndex.value = true;
  autoTableDialog.value = true;
};

const editTemplate = (id: string) => {
  if (openTemplate(id)) {
    page.value = 'editor';
    nextTick(() => {
      if (editorRef.value) editorRef.value.innerHTML = editorHtml.value;
      resetHistory(editorHtml.value);
    });
  }
};

const rememberSelection = () => {
  const selection = window.getSelection();
  if (selection?.rangeCount && editorRef.value?.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
};

const syncEditor = (immediate?: boolean | Event) => {
  editorHtml.value = getCleanEditorHtml();
  if (immediate === true) pushHistory(editorHtml.value);
  else scheduleHistory(editorHtml.value);
  rememberSelection();
};

const insertHtml = (html: string) => {
  const editor = editorRef.value;
  if (!editor) return;
  editor.focus();
  const selection = window.getSelection();
  const rangeIsInsideEditor = Boolean(savedRange && editor.contains(savedRange.commonAncestorContainer));
  if (savedRange && selection && rangeIsInsideEditor) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
    const range = savedRange.cloneRange();
    range.deleteContents();
    const fragment = range.createContextualFragment(html);
    const lastNode = fragment.lastChild;
    range.insertNode(fragment);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      savedRange = range.cloneRange();
    }
  } else {
    editor.insertAdjacentHTML('beforeend', html);
  }
  syncEditor(true);
};

const escapeEditorHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const tokenHtml = (label: string, kind = 'field', fieldId = '', parentId = '') => {
  const parent = parentId ? ` data-parent-id="${escapeEditorHtml(parentId)}"` : '';
  return `<span class="field-token" contenteditable="false" data-token-kind="${escapeEditorHtml(kind)}" data-field-id="${escapeEditorHtml(fieldId)}"${parent}>${escapeEditorHtml(label)}</span>&nbsp;`;
};

const generateAutoTable = () => {
  const fields = fieldList.value.filter(field => autoTableFields.value.includes(field.id));
  if (!fields.length) return;

  createTemplate();
  const title = autoTableTitle.value.trim() || `${tableName.value || '当前表'}清单`;
  templateName.value = title;
  outputMode.value = 'merge-records';
  orientation.value = fields.length + (autoIncludeIndex.value ? 1 : 0) >= 6 ? 'landscape' : 'portrait';

  const headers = [
    ...(autoIncludeIndex.value ? ['序号'] : []),
    ...fields.map(field => escapeEditorHtml(field.name)),
  ].map(label => `<th>${label}</th>`).join('');
  const cells = [
    ...(autoIncludeIndex.value ? [tokenHtml('自增序号', 'index')] : []),
    ...fields.map(field => tokenHtml(field.name, 'field', field.id)),
  ].map(token => `<td>${token}</td>`).join('');

  editorHtml.value = `<h2 style="text-align:center">${escapeEditorHtml(title)}</h2><table class="template-table"><thead><tr>${headers}</tr></thead><tbody><tr>${cells}</tr></tbody></table><p><br></p>`;
  autoTableDialog.value = false;
  page.value = 'editor';
  nextTick(() => {
    if (editorRef.value) editorRef.value.innerHTML = editorHtml.value;
    resetHistory(editorHtml.value);
    editorRef.value?.focus();
  });
};

const insertSpecial = (kind: 'index' | 'count' | 'date', label: string) => insertHtml(tokenHtml(label, kind));
const insertField = (field: FieldMetaLite, parentId = '') => insertHtml(tokenHtml(field.name, 'field', field.id, parentId));

const toggleLink = async (field: FieldMetaLite) => {
  const next = new Set(expandedLinks.value);
  if (next.has(field.id)) next.delete(field.id);
  else {
    next.add(field.id);
    await loadLinkedFields(field);
  }
  expandedLinks.value = next;
};

const command = (name: string, value?: string) => {
  editorRef.value?.focus();
  if (savedRange) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange);
  }
  document.execCommand(name, false, value);
  syncEditor(true);
};

const addTable = async () => {
  if (selectedCell.value) return;
  insertHtml('<table class="template-table"><thead><tr><th>标题</th><th>标题</th><th>标题</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>');
  await nextTick();
  const tables = editorRef.value?.querySelectorAll('table');
  const table = tables?.[tables.length - 1] as HTMLTableElement | undefined;
  const firstCell = table?.rows[0]?.cells[0] || null;
  selectedCell.value = firstCell;
  firstCell?.classList.add('selected-table-cell');
};
const addDivider = () => insertHtml('<hr><p><br></p>');

const selectEditorElement = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  editorRef.value?.querySelectorAll('.selected-table-cell').forEach(cell => cell.classList.remove('selected-table-cell'));
  const cell = target.closest('td, th') as HTMLTableCellElement | null;
  selectedCell.value = cell;
  cell?.classList.add('selected-table-cell');
  rememberSelection();
};

const makeCell = (tagName: 'td' | 'th') => {
  const cell = document.createElement(tagName);
  cell.innerHTML = '<br>';
  return cell;
};

const finishTableEdit = async (table: HTMLTableElement, rowIndex: number, cellIndex: number) => {
  const tableIndex = Array.from(editorRef.value?.querySelectorAll('table') || []).indexOf(table);
  editorHtml.value = getCleanEditorHtml();
  pushHistory(editorHtml.value);
  selectedCell.value = null;
  await nextTick();
  const liveTable = editorRef.value?.querySelectorAll('table')[tableIndex] as HTMLTableElement | undefined;
  selectedCell.value = liveTable?.rows[rowIndex]?.cells[cellIndex] || null;
  selectedCell.value?.classList.add('selected-table-cell');
};

const addRow = async (where: 'before' | 'after') => {
  const cell = selectedCell.value;
  const row = cell?.parentElement as HTMLTableRowElement | null;
  if (!cell || !row) return;
  const table = row.closest('table');
  if (!table) return;
  const newRow = document.createElement('tr');
  const columnCount = (table.rows[0]?.cells.length || row.cells.length || 1);
  for (let index = 0; index < columnCount; index += 1) newRow.appendChild(makeCell('td'));
  row.parentElement?.insertBefore(newRow, where === 'before' ? row : row.nextSibling);
  selectedCell.value = newRow.cells[Math.min(cell.cellIndex, newRow.cells.length - 1)] || newRow.cells[0] || null;
  editorRef.value?.querySelectorAll('.selected-table-cell').forEach(item => item.classList.remove('selected-table-cell'));
  selectedCell.value?.classList.add('selected-table-cell');
  await finishTableEdit(table, newRow.rowIndex, selectedCell.value?.cellIndex || 0);
};

const addColumn = async (where: 'before' | 'after') => {
  const cell = selectedCell.value;
  const table = cell?.closest('table');
  if (!cell || !table) return;
  const selectedRowIndex = (cell.parentElement as HTMLTableRowElement | null)?.rowIndex || 0;
  const index = cell.cellIndex + (where === 'after' ? 1 : 0);
  Array.from(table.rows).forEach(row => {
    const reference = row.cells[index] || null;
    const sample = row.cells[Math.min(cell.cellIndex, row.cells.length - 1)];
    const tagName = sample?.tagName === 'TH' ? 'th' : 'td';
    row.insertBefore(makeCell(tagName), reference);
  });
  selectedCell.value = table.rows[selectedRowIndex]?.cells[index] || cell;
  editorRef.value?.querySelectorAll('.selected-table-cell').forEach(item => item.classList.remove('selected-table-cell'));
  selectedCell.value?.classList.add('selected-table-cell');
  await finishTableEdit(table, selectedRowIndex, index);
};

const deleteRow = () => {
  const cell = selectedCell.value;
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const table = cell?.closest('table');
  if (!row || !table) return;
  if (table.rows.length <= 1) table.remove();
  else row.remove();
  selectedCell.value = null;
  syncEditor(true);
};

const deleteColumn = () => {
  const cell = selectedCell.value;
  const table = cell?.closest('table');
  if (!cell || !table) return;
  const index = cell.cellIndex;
  if ((table.rows[0]?.cells.length || 0) <= 1) table.remove();
  else Array.from(table.rows).forEach(row => row.cells[index]?.remove());
  selectedCell.value = null;
  syncEditor(true);
};

const deleteCurrentTable = () => {
  selectedCell.value?.closest('table')?.remove();
  selectedCell.value = null;
  syncEditor(true);
};

const addImage = (file?: File) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => insertHtml(`<img class="template-image" src="${String(reader.result)}" alt="图片">`);
  reader.readAsDataURL(file);
};

const openSave = () => {
  syncEditor(true);
  flushHistory();
  saveName.value = templateName.value;
  saveDialog.value = true;
};

const confirmSave = async () => {
  await saveTemplate(saveName.value);
  saveDialog.value = false;
};

const showPreview = async () => {
  syncEditor(true);
  previewMode.value = true;
  await nextTick();
  await loadRows();
};

const printNow = async () => {
  await showPreview();
  await nextTick();
  window.print();
};

const printPreview = () => window.print();

const handleImport = async (file?: File) => {
  if (file) await importTemplates(file);
  if (importInput.value) importInput.value.value = '';
};
</script>

<template>
  <div class="app-shell" :class="{ 'editor-mode': page === 'editor' }">
    <header class="brand-bar">
      <div class="brand-lockup">
        <span class="brand-mark"><el-icon><Menu /></el-icon></span>
        <strong>xii打印</strong>
      </div>
      <div v-if="page === 'editor'" class="header-actions">
        <el-button text title="返回模板首页" @click="page = 'home'"><el-icon><Back /></el-icon></el-button>
        <el-button text title="预览" @click="showPreview"><el-icon><Check /></el-icon></el-button>
        <el-button text title="保存" @click="openSave"><el-icon><Tickets /></el-icon></el-button>
        <el-button text title="打印" @click="printNow"><el-icon><Printer /></el-icon></el-button>
      </div>
    </header>

    <section v-if="page === 'home'" class="home-page">
      <div class="home-hero">
        <p class="eyebrow">多维表格打印工具</p>
        <h1>xii打印 · 排版助手</h1>
        <p>字段来自当前多维表格，模板只负责排版，不会把业务字段写死。</p>
      </div>

      <div v-if="errorMessage" class="connection-card" :class="{ muted: !connectionReady }">
        <span class="connection-dot" />
        <div>
          <strong>{{ connectionReady ? '表格已连接' : '等待飞书连接' }}</strong>
          <p>{{ connectionReady ? `当前表：${tableName}` : '请在飞书多维表格内打开插件；独立浏览器只能编辑本地模板。' }}</p>
        </div>
        <el-button size="small" :loading="loading" @click="init">重新连接</el-button>
      </div>

      <section class="template-section">
        <div class="section-title-row">
          <div><h2>当前表可用模板</h2><p>{{ connectionReady ? `已读取 ${fieldList.length} 个字段` : '模板保存在本机和飞书插件空间' }}</p></div>
          <div class="template-tools">
            <input ref="importInput" hidden type="file" accept="application/json" @change="handleImport(($event.target as HTMLInputElement).files?.[0])">
            <el-button @click="importInput?.click()"><el-icon><Upload /></el-icon>导入</el-button>
            <el-button @click="exportTemplates"><el-icon><Download /></el-icon>导出</el-button>
          </div>
        </div>

        <div class="template-grid">
          <article v-for="template in templates" :key="template.id" class="template-card" @click="editTemplate(template.id)">
            <div class="template-icon"><el-icon><Tickets /></el-icon></div>
            <div class="template-info">
              <h3>{{ template.name }}</h3>
              <p>对应表格：{{ template.tableName || '通用模板' }}</p>
              <p>最近更新：{{ formatTime(template.updatedAt) }}</p>
            </div>
            <el-button text class="delete-template" title="删除" @click.stop="deleteTemplate(template.id)"><el-icon><Delete /></el-icon></el-button>
          </article>
          <button class="create-card" @click="beginTemplate">
            <span class="create-icon"><el-icon><Plus /></el-icon></span>
            <strong>创建新模板</strong>
            <span>从空白 A4 画布开始设计</span>
          </button>
          <button class="create-card auto-create-card" @click="openAutoTable">
            <span class="create-icon"><el-icon><Grid /></el-icon></span>
            <strong>自动生成表格</strong>
            <span>选择字段，自动创建多条记录打印清单</span>
          </button>
        </div>
      </section>
    </section>

    <section v-else class="editor-page">
      <div class="editor-toolbar">
        <el-button class="primary-add" type="primary" @click="fieldPanelOpen = !fieldPanelOpen"><el-icon><Plus /></el-icon></el-button>
        <el-button text title="撤回" :disabled="!canUndo" @click="restoreHistory(-1)">↶</el-button>
        <el-button text title="重做" :disabled="!canRedo" @click="restoreHistory(1)">↷</el-button>
        <span class="tool-divider" />
        <el-select size="small" model-value="正文" style="width: 106px" @change="value => command('formatBlock', value === '正文' ? 'p' : value as string)">
          <el-option label="正文" value="正文" /><el-option label="标题 1" value="h1" /><el-option label="标题 2" value="h2" />
        </el-select>
        <el-select size="small" model-value="12" style="width: 76px" @change="value => command('fontSize', String(value))">
          <el-option label="10 pt" value="2" /><el-option label="12 pt" value="3" /><el-option label="16 pt" value="4" /><el-option label="24 pt" value="5" />
        </el-select>
        <el-button text title="加粗" @mousedown.prevent="command('bold')"><strong>B</strong></el-button>
        <el-button text title="斜体" @mousedown.prevent="command('italic')"><em>I</em></el-button>
        <el-button text title="下划线" @mousedown.prevent="command('underline')"><u>U</u></el-button>
        <el-button text title="居左" @mousedown.prevent="command('justifyLeft')">≡</el-button>
        <el-button text title="居中" @mousedown.prevent="command('justifyCenter')">≡</el-button>
        <span class="tool-divider" />
        <el-button text title="表格" @click="addTable"><el-icon><Grid /></el-icon></el-button>
        <input ref="imageInput" hidden type="file" accept="image/*" @change="addImage(($event.target as HTMLInputElement).files?.[0])">
        <el-button text title="插入本地图片" @click="imageInput?.click()"><el-icon><Picture /></el-icon></el-button>
        <el-popover placement="bottom" :width="292" trigger="click">
          <template #reference>
            <el-button text title="设置附件图片尺寸"><el-icon><Picture /></el-icon><span class="image-size-label">图片 {{ imageWidthMm }}×{{ imageHeightMm }}mm</span></el-button>
          </template>
          <div class="image-settings">
            <strong>附件图片尺寸</strong>
            <p>多维表格中的图片都会按固定尺寸打印。</p>
            <label><span>宽度</span><el-input-number v-model="imageWidthMm" :min="8" :max="80" :step="1" controls-position="right" /><em>mm</em></label>
            <label><span>高度</span><el-input-number v-model="imageHeightMm" :min="8" :max="80" :step="1" controls-position="right" /><em>mm</em></label>
            <label><span>显示方式</span><el-select v-model="imageFit"><el-option label="完整显示（不裁切）" value="contain" /><el-option label="铺满方框（会裁切）" value="cover" /></el-select></label>
          </div>
        </el-popover>
        <el-button text title="分割线" @click="addDivider">—</el-button>
        <div class="toolbar-spacer" />
        <el-select v-model="printScope" size="small" style="width: 132px" @change="loadRows">
          <el-option label="当前筛选视图" value="visible" /><el-option label="当前选中记录" value="selected" />
        </el-select>
        <el-select v-model="outputMode" size="small" style="width: 118px">
          <el-option label="每条一页" value="one-per-record" />
          <el-option label="合并成表" value="merge-records" />
        </el-select>
        <el-select v-model="orientation" size="small" style="width: 104px">
          <el-option label="A4 纵向" value="portrait" /><el-option label="A4 横向" value="landscape" />
        </el-select>
        <el-button :loading="loading" @click="loadRows"><el-icon><Refresh /></el-icon></el-button>
        <el-button @click="showPreview">预览</el-button>
        <el-button type="primary" @click="openSave">保存</el-button>
      </div>

      <div class="workspace">
        <aside v-if="fieldPanelOpen" class="field-panel">
          <div class="panel-heading">
            <div><strong>字段</strong><small>{{ connectionReady ? `来自 ${tableName}` : '等待连接多维表格' }}</small></div>
            <el-button text @click="fieldPanelOpen = false"><el-icon><ArrowLeft /></el-icon></el-button>
          </div>
          <el-input v-model="fieldSearch" class="field-search" placeholder="搜索字段（Alt+/）" clearable>
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <div class="field-help">点击右侧 <b>＋</b> 插入字段；关联字段可展开一层。</div>
          <div v-if="errorMessage" class="field-error">
            <span>{{ errorMessage }}</span>
            <el-button size="small" @click="init">重新读取</el-button>
          </div>
          <div class="special-fields">
            <button @click="insertSpecial('index', '自增序号')"><span class="type-badge blue">#</span><strong>自增序号</strong><el-icon><Plus /></el-icon></button>
            <button @click="insertSpecial('count', '计算总数')"><span class="type-badge green">总数</span><strong>计算总数</strong><el-icon><Plus /></el-icon></button>
            <button @click="insertSpecial('date', '打印日期')"><span class="type-badge amber">日期</span><strong>打印日期</strong><el-icon><Plus /></el-icon></button>
          </div>

          <div v-if="!fieldList.length" class="empty-fields">
            <el-icon><Tickets /></el-icon><p>打开飞书多维表格后，当前表的字段会自动出现在这里。</p>
          </div>
          <div class="field-list">
            <div v-for="field in shownFields" :key="field.id" class="field-group">
              <div class="field-row">
                <button v-if="isLinkField(field)" class="expand-button" @click="toggleLink(field)">
                  <el-icon><component :is="expandedLinks.has(field.id) ? Bottom : ArrowRight" /></el-icon>
                </button>
                <span v-else class="expand-spacer" />
                <span class="field-name">{{ field.name }}</span>
                <span v-if="isMultiLink(field)" class="multi-label">多条</span>
                <button class="insert-button" @click="insertField(field)"><el-icon><Plus /></el-icon></button>
              </div>
              <div v-if="expandedLinks.has(field.id)" class="child-fields">
                <div v-if="linkedGroups[field.id]?.loading" class="child-loading">正在读取关联表…</div>
                <button v-for="child in linkedGroups[field.id]?.fields || []" :key="child.id" @click="insertField(child, field.id)">
                  <span>{{ child.name }}</span><el-icon><Plus /></el-icon>
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main class="canvas-area">
          <div v-if="!fieldPanelOpen" class="reopen-panel"><el-button @click="fieldPanelOpen = true"><el-icon><Tickets /></el-icon>字段</el-button></div>
          <div class="canvas-status">
            <span><el-icon><EditPen /></el-icon>{{ templateName }}</span>
            <span>{{ rows.length ? `已载入 ${rows.length} 条记录` : '设计模式' }}</span>
          </div>
          <div v-if="selectedCell" class="table-context-bar">
            <strong>表格</strong>
            <el-button size="small" @click="addRow('before')">上方加行</el-button>
            <el-button size="small" @click="addRow('after')">下方加行</el-button>
            <el-button size="small" @click="addColumn('before')">左侧加列</el-button>
            <el-button size="small" @click="addColumn('after')">右侧加列</el-button>
            <span class="table-tool-divider" />
            <el-button size="small" @click="deleteRow">删除行</el-button>
            <el-button size="small" @click="deleteColumn">删除列</el-button>
            <el-button size="small" type="danger" plain @click="deleteCurrentTable">删除表格</el-button>
          </div>
          <section class="print-sheet" :class="orientation">
            <div
              ref="editorRef"
              class="document-editor"
              contenteditable="true"
              spellcheck="false"
              @input="syncEditor"
              @keyup="rememberSelection"
              @mouseup="rememberSelection"
              @focus="rememberSelection"
              @click="selectEditorElement"
            />
          </section>
        </main>
      </div>
    </section>

    <el-dialog v-model="autoTableDialog" class="auto-table-dialog" title="自动生成表格排版" width="620px">
      <div class="auto-table-form">
        <label class="auto-table-title">
          <span>模板标题</span>
          <el-input v-model="autoTableTitle" placeholder="例如：生产排期、采购清单" />
        </label>
        <div class="auto-table-field-heading">
          <div><strong>选择要打印的字段</strong><small>已选择 {{ autoTableFields.length }} 个</small></div>
          <div>
            <el-button text size="small" @click="autoTableFields = fieldList.map(field => field.id)">全选</el-button>
            <el-button text size="small" @click="autoTableFields = []">清空</el-button>
          </div>
        </div>
        <el-checkbox-group v-if="fieldList.length" v-model="autoTableFields" class="auto-table-fields">
          <el-checkbox v-for="field in fieldList" :key="field.id" :value="field.id" :label="field.id">
            {{ field.name }}
          </el-checkbox>
        </el-checkbox-group>
        <div v-else class="auto-table-empty">尚未读取到字段，请在飞书多维表格内打开插件后重试。</div>
        <el-checkbox v-model="autoIncludeIndex">自动添加序号列</el-checkbox>
        <p class="auto-table-tip">生成后仍可调整列宽、增删行列和插入图片。字段较多时会自动使用 A4 横向。</p>
      </div>
      <template #footer>
        <el-button @click="autoTableDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!autoTableFields.length" @click="generateAutoTable">生成表格</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="saveDialog" title="保存打印模板" width="420px">
      <el-input v-model="saveName" placeholder="例如：生产排期、采购清单" @keyup.enter="confirmSave" />
      <template #footer><el-button @click="saveDialog = false">取消</el-button><el-button type="primary" @click="confirmSave">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="previewMode" class="preview-dialog" title="打印预览" width="94%" top="3vh" destroy-on-close>
      <div class="preview-actions">
        <span>{{ rows.length }} 条记录 · {{ previewPages.length }} 页 · {{ orientation === 'portrait' ? 'A4 纵向' : 'A4 横向' }}</span>
        <el-button type="primary" @click="printPreview"><el-icon><Printer /></el-icon>打印</el-button>
      </div>
      <div v-loading="loading" class="preview-stage">
        <section v-for="(html, index) in previewPages" :key="index" class="print-sheet preview-sheet" :class="orientation">
          <div class="rendered-document" v-html="html" />
        </section>
      </div>
    </el-dialog>
  </div>
</template>
