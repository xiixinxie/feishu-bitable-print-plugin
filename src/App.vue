<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import {
  ArrowLeft, ArrowRight, Back, Bottom, Check, Delete, Download, EditPen, Grid,
  Menu, Picture, Plus, Printer, Refresh, Search, Setting, Tickets, Upload,
} from '@element-plus/icons-vue';
import usePrint from './hooks/usePrint';
import type { FieldMetaLite } from './types';

const {
  tableName, fieldList, linkedGroups, rows, templates, templateName, editorHtml, orientation,
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
const editorRef = ref<HTMLElement>();
const importInput = ref<HTMLInputElement>();
const imageInput = ref<HTMLInputElement>();
const expandedLinks = ref(new Set<string>());
let savedRange: Range | null = null;

onMounted(init);

const shownFields = computed(() => fieldList.value.filter(field => field.name.toLowerCase().includes(fieldSearch.value.toLowerCase())));

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN', { hour12: false });

const beginTemplate = () => {
  createTemplate();
  page.value = 'editor';
  nextTick(() => editorRef.value?.focus());
};

const editTemplate = (id: string) => {
  if (openTemplate(id)) page.value = 'editor';
};

const rememberSelection = () => {
  const selection = window.getSelection();
  if (selection?.rangeCount && editorRef.value?.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
};

const syncEditor = () => {
  editorHtml.value = editorRef.value?.innerHTML || '';
  rememberSelection();
};

const insertHtml = (html: string) => {
  editorRef.value?.focus();
  const selection = window.getSelection();
  if (savedRange && selection) {
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }
  document.execCommand('insertHTML', false, html);
  syncEditor();
};

const tokenHtml = (label: string, kind = 'field', fieldId = '', parentId = '') => {
  const parent = parentId ? ` data-parent-id="${parentId}"` : '';
  return `<span class="field-token" contenteditable="false" data-token-kind="${kind}" data-field-id="${fieldId}"${parent}>${label}</span>&nbsp;`;
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
  syncEditor();
};

const addTable = () => insertHtml('<table class="template-table"><thead><tr><th>标题</th><th>标题</th><th>标题</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>');
const addDivider = () => insertHtml('<hr><p><br></p>');

const addImage = (file?: File) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => insertHtml(`<img class="template-image" src="${String(reader.result)}" alt="图片">`);
  reader.readAsDataURL(file);
};

const openSave = () => {
  syncEditor();
  saveName.value = templateName.value;
  saveDialog.value = true;
};

const confirmSave = async () => {
  await saveTemplate(saveName.value);
  saveDialog.value = false;
};

const showPreview = async () => {
  syncEditor();
  await loadRows();
  previewMode.value = true;
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
        <el-button text title="页面设置"><el-icon><Setting /></el-icon></el-button>
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
        </div>
      </section>
    </section>

    <section v-else class="editor-page">
      <div class="editor-toolbar">
        <el-button class="primary-add" type="primary" @click="fieldPanelOpen = !fieldPanelOpen"><el-icon><Plus /></el-icon></el-button>
        <el-button text @click="command('undo')">↶</el-button>
        <el-button text @click="command('redo')">↷</el-button>
        <span class="tool-divider" />
        <el-select size="small" model-value="正文" style="width: 106px" @change="value => command('formatBlock', value === '正文' ? 'p' : value as string)">
          <el-option label="正文" value="正文" /><el-option label="标题 1" value="h1" /><el-option label="标题 2" value="h2" />
        </el-select>
        <el-select size="small" model-value="12" style="width: 76px" @change="value => command('fontSize', String(value))">
          <el-option label="10 pt" value="2" /><el-option label="12 pt" value="3" /><el-option label="16 pt" value="4" /><el-option label="24 pt" value="5" />
        </el-select>
        <el-button text title="加粗" @click="command('bold')"><strong>B</strong></el-button>
        <el-button text title="斜体" @click="command('italic')"><em>I</em></el-button>
        <el-button text title="下划线" @click="command('underline')"><u>U</u></el-button>
        <el-button text title="居左" @click="command('justifyLeft')">≡</el-button>
        <el-button text title="居中" @click="command('justifyCenter')">≡</el-button>
        <span class="tool-divider" />
        <el-button text title="表格" @click="addTable"><el-icon><Grid /></el-icon></el-button>
        <input ref="imageInput" hidden type="file" accept="image/*" @change="addImage(($event.target as HTMLInputElement).files?.[0])">
        <el-button text title="图片" @click="imageInput?.click()"><el-icon><Picture /></el-icon></el-button>
        <el-button text title="分割线" @click="addDivider">—</el-button>
        <div class="toolbar-spacer" />
        <el-select v-model="printScope" size="small" style="width: 132px" @change="loadRows">
          <el-option label="当前筛选视图" value="visible" /><el-option label="当前选中记录" value="selected" />
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
          <section class="print-sheet" :class="orientation">
            <div
              ref="editorRef"
              class="document-editor"
              contenteditable="true"
              spellcheck="false"
              :innerHTML="editorHtml"
              @input="syncEditor"
              @keyup="rememberSelection"
              @mouseup="rememberSelection"
              @focus="rememberSelection"
            />
          </section>
        </main>
      </div>
    </section>

    <el-dialog v-model="saveDialog" title="保存打印模板" width="420px">
      <el-input v-model="saveName" placeholder="例如：生产排期、采购清单" @keyup.enter="confirmSave" />
      <template #footer><el-button @click="saveDialog = false">取消</el-button><el-button type="primary" @click="confirmSave">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="previewMode" class="preview-dialog" title="打印预览" width="94%" top="3vh" destroy-on-close>
      <div class="preview-actions">
        <span>{{ previewPages.length }} 页 · {{ orientation === 'portrait' ? 'A4 纵向' : 'A4 横向' }}</span>
        <el-button type="primary" @click="printPreview"><el-icon><Printer /></el-icon>打印</el-button>
      </div>
      <div class="preview-stage">
        <section v-for="(html, index) in previewPages" :key="index" class="print-sheet preview-sheet" :class="orientation">
          <div class="rendered-document" v-html="html" />
        </section>
      </div>
    </el-dialog>
  </div>
</template>
