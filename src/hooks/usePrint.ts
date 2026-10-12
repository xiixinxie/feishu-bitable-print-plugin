import { computed, ref } from 'vue';
import type { FieldMetaLite, LinkedFieldGroup, Orientation, PrintCell, PrintRow, PrintTemplate } from '../types';

const TEMPLATE_KEY = 'xii_print_templates_v1';
const LEGACY_TEMPLATE_KEY = 'easy_print_templates_v4';
const FIELD_ATTACHMENT = 17;
const FIELD_SINGLE_LINK = 18;
const FIELD_DUPLEX_LINK = 21;
type SdkModule = typeof import('@lark-base-open/js-sdk');

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const defaultDocument = () => '<h2 style="text-align:center">在这里开始设计你的模板</h2><p style="text-align:center;color:#8a94a6">从左侧点击字段，把它插入到页面中</p><p><br></p>';

const usePrint = () => {
  const sdk = ref<SdkModule | null>(null);
  const tableId = ref('');
  const tableName = ref('当前数据表');
  const fieldList = ref<FieldMetaLite[]>([]);
  const linkedGroups = ref<Record<string, LinkedFieldGroup>>({});
  const rows = ref<PrintRow[]>([]);
  const templates = ref<PrintTemplate[]>([]);
  const selectedTemplateId = ref('');
  const templateName = ref('未命名模板');
  const editorHtml = ref(defaultDocument());
  const orientation = ref<Orientation>('portrait');
  const printScope = ref<'visible' | 'selected'>('visible');
  const loading = ref(false);
  const connectionReady = ref(false);
  const errorMessage = ref('');

  const isLinkField = (field: FieldMetaLite) => field.type === FIELD_SINGLE_LINK || field.type === FIELD_DUPLEX_LINK;
  const isMultiLink = (field: FieldMetaLite) => isLinkField(field) && Boolean(field.property?.multiple);

  const notify = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    const toastType = sdk.value?.ToastType?.[type] ?? sdk.value?.ToastType?.success;
    try { sdk.value?.bitable.ui.showToast({ toastType, message }); } catch { /* outside Feishu */ }
  };

  const readSavedTemplates = async () => {
    let saved: unknown;
    try { saved = await sdk.value?.bitable.bridge.getData<PrintTemplate[]>(TEMPLATE_KEY); } catch { /* fallback */ }
    if (!Array.isArray(saved)) {
      try { saved = await sdk.value?.bitable.bridge.getData<PrintTemplate[]>(LEGACY_TEMPLATE_KEY); } catch { /* migration fallback */ }
    }
    if (!Array.isArray(saved)) {
      try { saved = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || localStorage.getItem(LEGACY_TEMPLATE_KEY) || '[]'); } catch { saved = []; }
    }
    templates.value = Array.isArray(saved) ? saved.filter(item => item && typeof item === 'object') as PrintTemplate[] : [];
  };

  const persistTemplates = async () => {
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates.value));
    try { await sdk.value?.bitable.bridge.setData(TEMPLATE_KEY, templates.value); } catch { /* local copy remains */ }
  };

  const getCell = async (table: any, field: FieldMetaLite, recordId: string): Promise<PrintCell> => {
    try {
      if (field.type === FIELD_ATTACHMENT) {
        const raw = await table.getCellValue(field.id, recordId);
        const tokens = Array.isArray(raw) ? raw.map((item: { token?: string }) => item?.token).filter(Boolean) as string[] : [];
        const images = tokens.length ? await table.getCellAttachmentUrls(tokens, field.id, recordId) : [];
        return { text: '', images };
      }
      if (isLinkField(field)) {
        const raw = await table.getCellValue(field.id, recordId) as { recordIds?: string[]; record_ids?: string[] } | null;
        return { text: await table.getCellString(field.id, recordId), recordIds: raw?.recordIds || raw?.record_ids || [] };
      }
      return { text: await table.getCellString(field.id, recordId) };
    } catch { return { text: '' }; }
  };

  const loadLinkedFields = async (field: FieldMetaLite) => {
    if (!isLinkField(field) || linkedGroups.value[field.id]?.fields.length) return;
    const targetId = field.property?.tableId;
    if (!targetId || !sdk.value) return;
    linkedGroups.value = { ...linkedGroups.value, [field.id]: { parent: field, fields: [], tableName: '关联数据表', loading: true } };
    try {
      const table = await sdk.value.bitable.base.getTableById(targetId);
      const [name, fields] = await Promise.all([table.getName(), table.getFieldMetaList()]);
      linkedGroups.value = { ...linkedGroups.value, [field.id]: { parent: field, fields: fields as FieldMetaLite[], tableName: name } };
      if (rows.value.length) await loadRows();
    } catch {
      linkedGroups.value = { ...linkedGroups.value, [field.id]: { parent: field, fields: [], tableName: '无权读取关联表' } };
    }
  };

  const loadRows = async () => {
    if (!sdk.value || !connectionReady.value) return;
    loading.value = true;
    errorMessage.value = '';
    try {
      const table = await sdk.value.bitable.base.getActiveTable();
      const view = await table.getActiveView();
      let recordIds: string[] = [];
      if (printScope.value === 'selected') {
        try { recordIds = await (view as typeof view & { getSelectedRecordIdList: () => Promise<string[]> }).getSelectedRecordIdList(); } catch { recordIds = []; }
        if (!recordIds.length) {
          try {
            const selection = await sdk.value.bitable.base.getSelection();
            if (selection.recordId) recordIds = [selection.recordId];
          } catch { /* no selection */ }
        }
        if (!recordIds.length) notify('请先在多维表格里选中要打印的记录', 'warning');
      } else {
        recordIds = (await view.getVisibleRecordIdList()).filter(Boolean) as string[];
      }

      rows.value = await Promise.all(recordIds.slice(0, 200).map(async recordId => {
        const values: Record<string, PrintCell> = {};
        const linkedValues: Record<string, Record<string, PrintCell>> = {};
        await Promise.all(fieldList.value.map(async field => { values[field.id] = await getCell(table, field, recordId); }));
        await Promise.all(Object.values(linkedGroups.value).map(async group => {
          const linkedIds = values[group.parent.id]?.recordIds || [];
          if (!linkedIds.length || !group.parent.property?.tableId) return;
          const linkedTable = await sdk.value!.bitable.base.getTableById(group.parent.property.tableId);
          const childValues: Record<string, PrintCell> = {};
          await Promise.all(group.fields.map(async child => {
            const cells = await Promise.all(linkedIds.map(id => getCell(linkedTable, child, id)));
            childValues[child.id] = { text: cells.map(cell => cell.text).filter(Boolean).join('、'), images: cells.flatMap(cell => cell.images || []) };
          }));
          linkedValues[group.parent.id] = childValues;
        }));
        return { recordId, values, linkedValues };
      }));
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '暂时无法读取当前多维表格';
      rows.value = [];
    } finally { loading.value = false; }
  };

  const init = async () => {
    loading.value = true;
    errorMessage.value = '';
    try {
      sdk.value = await import('@lark-base-open/js-sdk');
      const table = await sdk.value.bitable.base.getActiveTable();
      const view = await table.getActiveView();
      const [selection, name, metas, visibleIds] = await Promise.all([
        sdk.value.bitable.base.getSelection().catch(() => null), table.getName(), table.getFieldMetaList(), view.getVisibleFieldIdList(),
      ]);
      tableId.value = selection?.tableId || table.id || '';
      tableName.value = name;
      const metaMap = new Map((metas as FieldMetaLite[]).map(field => [field.id, field]));
      fieldList.value = visibleIds.map(id => metaMap.get(id)).filter(Boolean) as FieldMetaLite[];
      connectionReady.value = true;
      await readSavedTemplates();
      await loadRows();
    } catch (error) {
      connectionReady.value = false;
      errorMessage.value = error instanceof Error ? error.message : '未连接到飞书多维表格';
      await readSavedTemplates();
    } finally { loading.value = false; }
  };

  const createTemplate = () => {
    selectedTemplateId.value = `template_${Date.now()}`;
    templateName.value = '未命名模板';
    orientation.value = 'portrait';
    editorHtml.value = defaultDocument();
  };

  const openTemplate = (id: string) => {
    const template = templates.value.find(item => item.id === id);
    if (!template) return false;
    selectedTemplateId.value = template.id;
    templateName.value = template.name;
    orientation.value = template.orientation;
    editorHtml.value = template.html;
    return true;
  };

  const saveTemplate = async (name?: string) => {
    const cleanName = (name || templateName.value || '未命名模板').trim();
    const existingIndex = templates.value.findIndex(item => item.id === selectedTemplateId.value);
    const template: PrintTemplate = {
      id: existingIndex >= 0 ? templates.value[existingIndex].id : (selectedTemplateId.value || `template_${Date.now()}`),
      name: cleanName, tableId: tableId.value, tableName: tableName.value, html: editorHtml.value,
      orientation: orientation.value, updatedAt: Date.now(),
    };
    templates.value = existingIndex >= 0 ? templates.value.map((item, index) => index === existingIndex ? template : item) : [...templates.value, template];
    selectedTemplateId.value = template.id;
    templateName.value = cleanName;
    await persistTemplates();
    notify('模板已保存');
  };

  const deleteTemplate = async (id: string) => {
    templates.value = templates.value.filter(item => item.id !== id);
    await persistTemplates();
    notify('模板已删除');
  };

  const exportTemplates = () => {
    const blob = new Blob([JSON.stringify(templates.value, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `xii打印模板-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const importTemplates = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('模板文件格式不正确');
      const imported = parsed.filter(item => item?.id && item?.html).map(item => ({ ...item, id: `template_${Date.now()}_${Math.random().toString(16).slice(2)}` }));
      templates.value = [...templates.value, ...imported];
      await persistTemplates();
      notify(`已导入 ${imported.length} 个模板`);
    } catch (error) { notify(error instanceof Error ? error.message : '导入失败', 'error'); }
  };

  const renderHtml = (row: PrintRow, index: number) => {
    const root = document.createElement('div');
    root.innerHTML = editorHtml.value;
    root.querySelectorAll<HTMLElement>('[data-token-kind]').forEach(token => {
      const kind = token.dataset.tokenKind;
      if (kind === 'index') { token.replaceWith(String(index + 1)); return; }
      if (kind === 'date') { token.replaceWith(new Date().toLocaleDateString('zh-CN')); return; }
      if (kind === 'count') { token.replaceWith(String(rows.value.length)); return; }
      const fieldId = token.dataset.fieldId || '';
      const parentId = token.dataset.parentId;
      const cell = parentId ? row.linkedValues[parentId]?.[fieldId] : row.values[fieldId];
      if (cell?.images?.length) {
        const box = document.createElement('span');
        box.className = 'rendered-images';
        box.innerHTML = cell.images.map(url => `<img src="${escapeHtml(url)}" alt="" />`).join('');
        token.replaceWith(box);
      } else { token.replaceWith(cell?.text || ''); }
    });
    return root.innerHTML;
  };

  const previewPages = computed(() => rows.value.length ? rows.value.map((row, index) => renderHtml(row, index)) : [editorHtml.value]);

  return {
    tableName, fieldList, linkedGroups, rows, templates, selectedTemplateId, templateName, editorHtml,
    orientation, printScope, loading, connectionReady, errorMessage, previewPages,
    init, loadRows, loadLinkedFields, isLinkField, isMultiLink, createTemplate, openTemplate,
    saveTemplate, deleteTemplate, exportTemplates, importTemplates, notify,
  };
};

export default usePrint;
