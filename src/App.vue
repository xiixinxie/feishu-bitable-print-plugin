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
  printScope, loading, connectionReady, errorMessage, previewPages, init, refreshFields, loadRows, loadLinkedFields,
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

const applyPrintPageStyle = () => {
  let style = document.querySelector<HTMLStyleElement>('#xii-print-page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'xii-print-page-style';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: A4 ${orientation.value}; margin: 0; }`;
};

const openSystemPrint = async () => {
  applyPrintPageStyle();
  await nextTick();
  // Let the browser finish applying the dynamic @page direction before it
  // takes the print snapshot.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  window.print();
};

const printNow = async () => {
  await showPreview();
  await openSystemPrint();
};

const printPreview = () => openSystemPrint();

const waitForImages = async (root: HTMLElement) => {
  const timeout = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
  await Promise.all(Array.from(root.querySelectorAll('img')).map(async image => {
    if (image.complete) {
      try { await Promise.race([image.decode(), timeout(2000)]); } catch { /* keep rendering other content */ }
      return;
    }
    await Promise.race([
      new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      }),
      timeout(5000),
    ]);
  }));
};

const exportPdf = async () => {
  if (pdfExporting.value) return;
  pdfExporting.value = true;
  let stage: HTMLDivElement | null = null;
  try {
    syncEditor(true);
    // Export the exact rows already visible in preview. Re-reading Feishu here can
    // hang on a slow SDK call and can make the PDF differ from the preview.
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
    let pdfPageCount = 0;
    for (let index = 0; index < sheets.length; index += 1) {
      const canvas = await html2canvas(sheets[index], {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: false,
        imageTimeout: 5000,
        logging: false,
      });
      // Keep the preview width at the full paper width. If a merged table grows
      // taller than one A4 page, slice it vertically across multiple PDF pages
      // instead of shrinking the entire long canvas into a narrow portrait strip.
      const pageSliceHeight = Math.max(1, Math.floor(canvas.width * pageHeight / pageWidth));
      const sheetRect = sheets[index].getBoundingClientRect();
      const canvasScale = canvas.width / Math.max(1, sheetRect.width);
      const detailBlocks = Array.from(sheets[index].querySelectorAll<HTMLElement>('.merged-detail-record'));
      const breakElements = detailBlocks.length
        ? detailBlocks
        : Array.from(sheets[index].querySelectorAll<HTMLElement>('tr'));
      const safeBreaks = breakElements
        .map(element => Math.round((element.getBoundingClientRect().bottom - sheetRect.top) * canvasScale))
        .filter(position => position > 0 && position < canvas.height)
        .sort((left, right) => left - right);

      for (let sourceY = 0; sourceY < canvas.height;) {
        const idealEnd = Math.min(sourceY + pageSliceHeight, canvas.height);
        let pageEnd = idealEnd;
        if (idealEnd < canvas.height) {
          const minimumUsefulEnd = sourceY + pageSliceHeight * 0.35;
          const safeEnd = [...safeBreaks].reverse().find(position => position <= idealEnd && position >= minimumUsefulEnd);
          if (safeEnd) pageEnd = safeEnd;
        }
        const sliceHeight = Math.max(1, pageEnd - sourceY);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceHeight;
        const context = slice.getContext('2d');
        if (!context) throw new Error('无法创建 PDF 页面画布');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, slice.width, slice.height);
        context.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
        if (pdfPageCount > 0) pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
        const renderedHeight = sliceHeight * pageWidth / canvas.width;
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWidth, renderedHeight, undefined, 'FAST');
        pdfPageCount += 1;
        sourceY = pageEnd;
      }
    }
    const safeName = (templateName.value || tableName.value || 'xii打印').replace(/[\\/:*?"<>|]/g, '-');
    pdf.save(`${safeName}.pdf`);
    notify(`PDF 已导出，共 ${pdfPageCount} 页`);
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
        <el-select class="text-style-select" size="small" model-value="正文" style="width: 106px" @mousedown="rememberSelection" @change="value => command('formatBlock', value === '正文' ? 'p' : value as string)">
          <el-option label="正文" value="正文" /><el-option label="标题 1" value="h1" /><el-option label="标题 2" value="h2" />
        </el-select>
        <el-select v-model="fontSizePt" class="font-size-select" size="small" style="width: 82px" @mousedown="rememberSelection" @change="value => setFontSize(Number(value))">
          <el-option v-for="size in [10, 12, 16, 24, 32, 36, 48, 56, 72]" :key="size" :label="`${size} pt`" :value="size" />
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
        <el-button :loading="pdfExporting" @click="exportPdf"><el-icon><Download /></el-icon>导出 PDF</el-button>
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
            <button @click="insertSpecial('count', '单元格数值合计')"><span class="type-badge green">合计</span><strong>单元格数值合计</strong><el-icon><Plus /></el-icon></button>
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
            <span class="resize-help">拖动蓝色右边调整列宽，拖动底边调整行高</span>
            <el-button size="small" @click="addRow('before')">上方加行</el-button>
            <el-button size="small" @click="addRow('after')">下方加行</el-button>
            <el-button size="small" @click="addColumn('before')">左侧加列</el-button>
            <el-button size="small" @click="addColumn('after')">右侧加列</el-button>
            <span class="table-tool-divider" />
            <el-button size="small" @click="mergeCellRight">向右合并</el-button>
            <el-button size="small" @click="mergeCellDown">向下合并</el-button>
            <el-button size="small" @click="splitCell">拆分单元格</el-button>
            <span class="table-tool-divider" />
            <el-button size="small" @click="deleteRow">删除行</el-button>
            <el-button size="small" @click="deleteColumn">删除列</el-button>
            <el-button size="small" type="danger" plain @click="deleteCurrentTable">删除表格</el-button>
          </div>
          <div v-if="selectedImage" class="image-context-bar">
            <strong>图片大小</strong>
            <el-button size="small" @click="setLocalImageWidth(localImageWidthMm - 10)">缩小</el-button>
            <el-input-number v-model="localImageWidthMm" size="small" :min="10" :max="180" :step="5" controls-position="right" @change="value => setLocalImageWidth(Number(value))" />
            <span>mm</span>
            <el-button size="small" @click="setLocalImageWidth(localImageWidthMm + 10)">放大</el-button>
            <el-button size="small" @click="resetLocalImageSize">原始比例</el-button>
            <el-button size="small" type="danger" plain @click="deleteSelectedImage">删除图片</el-button>
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
              @mousemove="updateCellResizeCursor"
              @mousedown="startCellResize"
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
        <label class="auto-table-title">
          <span>排版方式</span>
          <el-radio-group v-model="autoLayoutMode">
            <el-radio-button value="auto">自动</el-radio-button>
            <el-radio-button value="list">横向清单</el-radio-button>
            <el-radio-button value="detail">分行详情</el-radio-button>
          </el-radio-group>
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
        <div v-else class="auto-table-empty">
          <strong>{{ loading ? '正在连接当前数据表…' : '尚未读取到字段' }}</strong>
          <span>插件会自动重试；也可以点击下面按钮立即重新读取。</span>
          <small v-if="errorMessage">{{ errorMessage }}</small>
          <el-button type="primary" plain :loading="loading" @click="retryAutoTableFields">重新读取字段</el-button>
        </div>
        <el-checkbox v-model="autoIncludeIndex">自动添加序号列</el-checkbox>
        <p class="auto-table-tip">“自动”会在字段超过 8 个时改为分行详情，每行两组字段并继续向下排版；生成后仍可调整表格。</p>
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
        <div>
          <el-button :loading="pdfExporting" @click="exportPdf"><el-icon><Download /></el-icon>导出 PDF</el-button>
          <el-button type="primary" @click="printPreview"><el-icon><Printer /></el-icon>打印</el-button>
        </div>
      </div>
      <div v-loading="loading" class="preview-stage">
        <section v-for="(html, index) in previewPages" :key="index" class="print-sheet preview-sheet" :class="orientation">
          <div class="rendered-document" v-html="html" />
        </section>
      </div>
    </el-dialog>
  </div>
</template>
