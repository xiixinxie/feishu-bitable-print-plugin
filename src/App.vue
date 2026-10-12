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
  printScope, loading, connectionReady, errorMessage, previewPages, isDetailTemplate, init, refreshFields, loadRows, loadLinkedFields,
  isLinkField, isMultiLink, createTemplate, openTemplate, saveTemplate, deleteTemplate,
  exportTemplates, importTemplates, notify,
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
const autoLayoutMode = ref<'auto' | 'list' | 'detail'>('auto');
const pdfExporting = ref(false);
const editorRef = ref<HTMLElement>();
const importInput = ref<HTMLInputElement>();
const imageInput = ref<HTMLInputElement>();
const expandedLinks = ref(new Set<string>());
const selectedCell = ref<HTMLTableCellElement | null>(null);
const selectedImage = ref<HTMLImageElement | null>(null);
const localImageWidthMm = ref(60);
const fontSizePt = ref(12);
const editorHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const hasPendingHistory = ref(false);
let savedRange: Range | null = null;
let historyTimer: number | undefined;
let resizingCell = false;

onMounted(init);

const shownFields = computed(() => fieldList.value.filter(field => field.name.toLowerCase().includes(fieldSearch.value.toLowerCase())));

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN', { hour12: false });

const getCleanEditorHtml = () => {
  if (!editorRef.value) return editorHtml.value;
  const clone = editorRef.value.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.selected-table-cell').forEach(cell => cell.classList.remove('selected-table-cell'));
  clone.querySelectorAll('.selected-template-image').forEach(image => image.classList.remove('selected-template-image'));
  clone.querySelectorAll('td[contenteditable], th[contenteditable]').forEach(cell => cell.removeAttribute('contenteditable'));
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
  selectedImage.value = null;
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

const setAutoTableDefaults = () => {
  autoTableTitle.value = `${tableName.value || '当前表'}清单`;
  autoTableFields.value = fieldList.value.slice(0, 8).map(field => field.id);
  autoIncludeIndex.value = true;
  autoLayoutMode.value = 'auto';
};

const openAutoTable = async () => {
  autoTableDialog.value = true;
  setAutoTableDefaults();
  if (!fieldList.value.length && await refreshFields()) setAutoTableDefaults();
};

const retryAutoTableFields = async () => {
  if (await refreshFields()) setAutoTableDefaults();
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
  const layout = autoLayoutMode.value === 'auto'
    ? (fields.length > 8 ? 'detail' : 'list')
    : autoLayoutMode.value;

  if (layout === 'detail') {
    outputMode.value = 'one-per-record';
    orientation.value = 'portrait';
    const entries = [
      ...(autoIncludeIndex.value ? [{ label: '序号', token: tokenHtml('自增序号', 'index') }] : []),
      ...fields.map(field => ({ label: escapeEditorHtml(field.name), token: tokenHtml(field.name, 'field', field.id) })),
    ];
    const detailRows: string[] = [];
    for (let index = 0; index < entries.length; index += 2) {
      const pair = entries.slice(index, index + 2);
      detailRows.push(`<tr>${pair.map(item => `<th class="detail-label">${item.label}</th><td class="detail-value">${item.token}</td>`).join('')}${pair.length < 2 ? '<th class="detail-label"></th><td class="detail-value"></td>' : ''}</tr>`);
    }
    editorHtml.value = `<h2 style="text-align:center">${escapeEditorHtml(title)}</h2><table class="template-table detail-table" data-record-layout="detail"><tbody>${detailRows.join('')}</tbody></table><p><br></p>`;
  } else {
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
    editorHtml.value = `<h2 style="text-align:center">${escapeEditorHtml(title)}</h2><table class="template-table" data-record-layout="list"><thead><tr>${headers}</tr></thead><tbody><tr>${cells}</tr></tbody></table><p><br></p>`;
  }
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

const setFontSize = (value: number) => {
  fontSizePt.value = value;
  const editor = editorRef.value;
  if (!editor) return;
  editor.focus();
  const selection = window.getSelection();
  const range = savedRange?.cloneRange();
  const isEditorRange = Boolean(range && editor.contains(range.commonAncestorContainer));

  if (range && isEditorRange && !range.collapsed) {
    selection?.removeAllRanges();
    selection?.addRange(range);
    try {
      const wrapper = document.createElement('span');
      wrapper.style.fontSize = `${value}pt`;
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
      selection?.removeAllRanges();
      selection?.addRange(range);
      savedRange = range.cloneRange();
    } catch {
      document.execCommand('fontSize', false, '7');
      editor.querySelectorAll<HTMLElement>('font[size="7"]').forEach(node => {
        node.removeAttribute('size');
        node.style.fontSize = `${value}pt`;
      });
    }
  } else {
    const rangeElement = range
      ? (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)
      : null;
    const target = selectedCell.value || rangeElement?.closest<HTMLElement>('h1, h2, h3, p, td, th, li');
    if (target && editor.contains(target)) target.style.fontSize = `${value}pt`;
  }
  syncEditor(true);
};

const getResizeMode = (event: MouseEvent, cell: HTMLTableCellElement) => {
  const rect = cell.getBoundingClientRect();
  if (Math.abs(event.clientX - rect.right) <= 7) return 'column' as const;
  if (Math.abs(event.clientY - rect.bottom) <= 7) return 'row' as const;
  return null;
};

const updateCellResizeCursor = (event: MouseEvent) => {
  if (resizingCell || !editorRef.value) return;
  const cell = (event.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null;
  if (!cell || cell !== selectedCell.value) {
    editorRef.value.style.cursor = '';
    return;
  }
  const mode = getResizeMode(event, cell);
  editorRef.value.style.cursor = mode === 'column' ? 'col-resize' : mode === 'row' ? 'row-resize' : '';
};

const startCellResize = (event: MouseEvent) => {
  const cell = (event.target as HTMLElement).closest('td, th') as HTMLTableCellElement | null;
  if (!cell || cell !== selectedCell.value) return;
  const mode = getResizeMode(event, cell);
  if (!mode) return;
  const row = cell.parentElement as HTMLTableRowElement | null;
  const table = cell.closest('table');
  if (!row || !table) return;

  event.preventDefault();
  event.stopPropagation();
  resizingCell = true;
  document.body.style.userSelect = 'none';
  const startX = event.clientX;
  const startY = event.clientY;
  const startHeight = row.getBoundingClientRect().height;
  const columnCount = Math.max(...Array.from(table.rows).map(item => item.cells.length), 1);
  let colgroup = table.querySelector('colgroup');
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    const referenceRow = Array.from(table.rows).find(item => item.cells.length === columnCount);
    const fallbackWidth = table.getBoundingClientRect().width / columnCount;
    for (let index = 0; index < columnCount; index += 1) {
      const col = document.createElement('col');
      col.style.width = `${referenceRow?.cells[index]?.getBoundingClientRect().width || fallbackWidth}px`;
      colgroup.appendChild(col);
    }
    table.insertBefore(colgroup, table.firstChild);
  }
  const columns = Array.from(colgroup.querySelectorAll('col')) as HTMLTableColElement[];
  const widths = columns.map(column => Number.parseFloat(column.style.width) || table.getBoundingClientRect().width / columnCount);
  const currentIndex = Math.min(cell.cellIndex, columns.length - 1);
  const neighborIndex = currentIndex < columns.length - 1 ? currentIndex + 1 : currentIndex - 1;

  const onMove = (moveEvent: MouseEvent) => {
    if (mode === 'row') {
      row.style.height = `${Math.max(28, startHeight + moveEvent.clientY - startY)}px`;
      return;
    }
    if (neighborIndex < 0) return;
    const delta = (moveEvent.clientX - startX) * (neighborIndex > currentIndex ? 1 : -1);
    const combined = widths[currentIndex] + widths[neighborIndex];
    const nextWidth = Math.max(36, Math.min(combined - 36, widths[currentIndex] + delta));
    columns[currentIndex].style.width = `${nextWidth}px`;
    columns[neighborIndex].style.width = `${combined - nextWidth}px`;
  };
  const onUp = () => {
    resizingCell = false;
    document.body.style.userSelect = '';
    if (editorRef.value) editorRef.value.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    syncEditor(true);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
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
  editorRef.value?.querySelectorAll('.selected-template-image').forEach(image => image.classList.remove('selected-template-image'));
  const image = target.closest('img.template-image') as HTMLImageElement | null;
  selectedImage.value = image;
  if (image) {
    selectedCell.value = null;
    image.classList.add('selected-template-image');
    const styledWidth = Number.parseFloat(image.style.width);
    localImageWidthMm.value = Number.isFinite(styledWidth) && image.style.width.endsWith('mm')
      ? styledWidth
      : Math.max(10, Math.min(180, Math.round(image.getBoundingClientRect().width / 3.7795)));
    rememberSelection();
    return;
  }
  const cell = target.closest('td, th') as HTMLTableCellElement | null;
  selectedCell.value = cell;
  if (!cell) {
    rememberSelection();
    return;
  }
  cell.classList.add('selected-table-cell');
  cell.setAttribute('contenteditable', 'true');
  const isEmpty = !cell.textContent?.trim() && !cell.querySelector('img, .field-token');
  window.requestAnimationFrame(() => {
    const selection = window.getSelection();
    if (isEmpty || !selection?.rangeCount || !cell.contains(selection.anchorNode)) placeCaretInCell(cell);
    else savedRange = selection.getRangeAt(0).cloneRange();
  });
};

const makeCell = (tagName: 'td' | 'th') => {
  const cell = document.createElement(tagName);
  cell.innerHTML = '<br>';
  return cell;
};

const placeCaretInCell = (cell: HTMLTableCellElement | null) => {
  if (!cell || !editorRef.value) return;
  cell.setAttribute('contenteditable', 'true');
  editorRef.value.focus();
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  savedRange = range.cloneRange();
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
  placeCaretInCell(selectedCell.value);
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

const logicalColumnIndex = (cell: HTMLTableCellElement) => {
  let index = 0;
  let previous = cell.previousElementSibling as HTMLTableCellElement | null;
  while (previous) {
    index += previous.colSpan || 1;
    previous = previous.previousElementSibling as HTMLTableCellElement | null;
  }
  return index;
};

const cellAtLogicalColumn = (row: HTMLTableRowElement, column: number) => {
  let index = 0;
  for (const cell of Array.from(row.cells)) {
    const width = cell.colSpan || 1;
    if (column >= index && column < index + width) return cell;
    index += width;
  }
  return null;
};

const joinCellContents = (target: HTMLTableCellElement, source: HTMLTableCellElement) => {
  const targetIsEmpty = !target.textContent?.trim() && !target.querySelector('img, .field-token');
  const sourceIsEmpty = !source.textContent?.trim() && !source.querySelector('img, .field-token');
  if (targetIsEmpty) target.innerHTML = source.innerHTML;
  else if (!sourceIsEmpty) target.insertAdjacentHTML('beforeend', `<br>${source.innerHTML}`);
};

const mergeCellRight = async () => {
  const cell = selectedCell.value;
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const table = cell?.closest('table');
  const next = cell?.nextElementSibling as HTMLTableCellElement | null;
  if (!cell || !row || !table || !next || cell.rowSpan !== next.rowSpan) return;
  joinCellContents(cell, next);
  cell.colSpan += next.colSpan || 1;
  next.remove();
  await finishTableEdit(table, row.rowIndex, cell.cellIndex);
};

const mergeCellDown = async () => {
  const cell = selectedCell.value;
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const table = cell?.closest('table');
  if (!cell || !row || !table) return;
  const targetRow = table.rows[row.rowIndex + (cell.rowSpan || 1)];
  if (!targetRow || targetRow.parentElement !== row.parentElement) return;
  const target = cellAtLogicalColumn(targetRow, logicalColumnIndex(cell));
  if (!target || target.colSpan !== cell.colSpan) return;
  joinCellContents(cell, target);
  cell.rowSpan += target.rowSpan || 1;
  target.remove();
  await finishTableEdit(table, row.rowIndex, cell.cellIndex);
};

const splitCell = async () => {
  const cell = selectedCell.value;
  const row = cell?.parentElement as HTMLTableRowElement | null;
  const table = cell?.closest('table');
  if (!cell || !row || !table || (cell.colSpan <= 1 && cell.rowSpan <= 1)) return;
  const originalColumnIndex = cell.cellIndex;
  const columnSpan = cell.colSpan || 1;
  const rowSpan = cell.rowSpan || 1;
  const tagName = cell.tagName === 'TH' ? 'th' : 'td';
  cell.colSpan = 1;
  cell.rowSpan = 1;

  let insertionPoint = cell.nextSibling;
  for (let column = 1; column < columnSpan; column += 1) {
    const newCell = makeCell(tagName);
    row.insertBefore(newCell, insertionPoint);
  }
  for (let offset = 1; offset < rowSpan; offset += 1) {
    const targetRow = table.rows[row.rowIndex + offset];
    if (!targetRow) continue;
    const reference = targetRow.cells[Math.min(originalColumnIndex, targetRow.cells.length)] || null;
    for (let column = 0; column < columnSpan; column += 1) targetRow.insertBefore(makeCell(tagName), reference);
  }
  await finishTableEdit(table, row.rowIndex, cell.cellIndex);
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

const setLocalImageWidth = (width: number) => {
  const image = selectedImage.value;
  if (!image) return;
  const nextWidth = Math.max(10, Math.min(180, Number(width) || 60));
  localImageWidthMm.value = nextWidth;
  image.style.width = `${nextWidth}mm`;
  image.style.height = 'auto';
  image.style.maxWidth = '100%';
  syncEditor(true);
  image.classList.add('selected-template-image');
  selectedImage.value = image;
};

const resetLocalImageSize = () => {
  const image = selectedImage.value;
  if (!image) return;
  image.style.width = 'auto';
  image.style.height = 'auto';
  image.style.maxWidth = '100%';
  localImageWidthMm.value = Math.max(10, Math.min(180, Math.round(image.naturalWidth / 3.7795) || 60));
  syncEditor(true);
  image.classList.add('selected-template-image');
  selectedImage.value = image;
};

const deleteSelectedImage = () => {
  selectedImage.value?.remove();
  selectedImage.value = null;
  syncEditor(true);
};

const addImage = (file?: File) => {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => insertHtml(`<img class="template-image" src="${String(reader.result)}" alt="图片" style="width:60mm;height:auto;max-width:100%">`);
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

const waitForImages = async (root: HTMLElement) => {
  await Promise.all(Array.from(root.querySelectorAll('img')).map(async image => {
    if (image.complete) {
      try { await image.decode(); } catch { /* keep rendering other content */ }
      return;
    }
    await new Promise<void>(resolve => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }));
};

const exportPdf = async () => {
  if (pdfExporting.value) return;
  pdfExporting.value = true;
  let stage: HTMLDivElement | null = null;
  try {
    syncEditor(true);
    // When the plugin is temporarily disconnected, export the data already loaded
    // instead of leaving the button spinning forever.
    if (connectionReady.value) await loadRows();
    await nextTick();
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const landscape = orientation.value === 'landscape';
    const pageWidth = landscape ? 297 : 210;
    const pageHeight = landscape ? 210 : 297;
    const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });

    stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-20000px;top:0;background:#fff;z-index:-1;';
    previewPages.value.forEach(html => {
      const sheet = document.createElement('section');
      sheet.className = `print-sheet preview-sheet ${orientation.value}`;
      sheet.style.margin = '0';
      const content = document.createElement('div');
      content.className = 'rendered-document';
      content.innerHTML = html;
      sheet.appendChild(content);
      stage!.appendChild(sheet);
    });
    document.body.appendChild(stage);
    await waitForImages(stage);

    const sheets = Array.from(stage.querySelectorAll<HTMLElement>('.print-sheet'));
    for (let index = 0; index < sheets.length; index += 1) {
      const canvas = await html2canvas(sheets[index], {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
      });
      if (index > 0) pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
      const fitScale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
      const renderWidth = canvas.width * fitScale;
      const renderHeight = canvas.height * fitScale;
      const offsetX = (pageWidth - renderWidth) / 2;
      const offsetY = (pageHeight - renderHeight) / 2;
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.95),
        'JPEG',
        offsetX,
        offsetY,
        renderWidth,
        renderHeight,
        undefined,
        'FAST',
      );
    }
    const safeName = (templateName.value || tableName.value || 'xii打印').replace(/[\\/:*?"<>|]/g, '-');
    pdf.save(`${safeName}.pdf`);
    notify(`PDF 已导出，共 ${sheets.length} 页`);
  } catch (error) {
    notify(error instanceof Error ? `PDF 导出失败：${error.message}` : 'PDF 导出失败，请重试', 'error');
  } finally {
    stage?.remove();
    pdfExporting.value = false;
  }
};

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
        