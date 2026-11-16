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
const purchaseOperatorName = ref(localStorage.getItem('xii_purchase_operator_name') || '');
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

const normalizeFieldName = (value: string) => value.toLowerCase().replace(/[\s/\\（）()·_-]/g, '');

const findPurchaseField = (fields: FieldMetaLite[], aliases: string[]) => {
  const normalizedAliases = aliases.map(normalizeFieldName);
  const exact = normalizedAliases
    .map(alias => fields.find(field => normalizeFieldName(field.name) === alias))
    .find(Boolean);
  if (exact) return exact;
  return normalizedAliases
    .slice()
    .sort((left, right) => right.length - left.length)
    .map(alias => fields.find(field => normalizeFieldName(field.name).includes(alias)))
    .find(Boolean);
};

const purchaseField = (...aliases: string[]) => findPurchaseField(fieldList.value, aliases);

const purchaseToken = (label: string, aliases: string[], fallbackKind = '') => {
  const field = purchaseField(...aliases);
  if (field) return tokenHtml(field.name, 'field', field.id);
  return fallbackKind ? tokenHtml(label, fallbackKind) : '';
};

const purchaseVariableCell = (label: string, aliases: string[], className = '') =>
  `<td class="purchase-variable ${className}" data-variable-label="${escapeEditorHtml(label)}">${purchaseToken(label, aliases)}</td>`;

const isPurchaseTemplate = computed(() => editorHtml.value.includes('purchase-order-template'));

const linkedSupplierToken = (aliases: string[], supplierField?: FieldMetaLite) => {
  if (!supplierField) return '';
  const child = findPurchaseField(linkedGroups.value[supplierField.id]?.fields || [], aliases);
  return child ? tokenHtml(child.name, 'field', child.id, supplierField.id) : '';
};

const ensurePurchaseTemplateDefaults = async () => {
  if (!isPurchaseTemplate.value || !editorRef.value) return;
  const supplierField = purchaseField('供应商名称', '供应商', '厂商名称', '厂商');
  if (supplierField && isLinkField(supplierField)) await loadLinkedFields(supplierField);
  const defaults: Array<[string, string]> = [
    ['订购单号', tokenHtml('订购单号', 'order-number')],
    ['联系人', purchaseToken('联系人', ['供应商联系人', '联系人']) || linkedSupplierToken(['联系人', '联络人', '业务联系人'], supplierField)],
    ['联系电话', purchaseToken('联系电话', ['联系电话', '手机号', '电话']) || linkedSupplierToken(['联系电话', '手机号码', '手机号', '电话'], supplierField)],
    ['数量', purchaseToken('采购数量', ['采购数量', '订购数量', '数量'])],
    ['人民币大写金额', tokenHtml('人民币大写金额', 'uppercase-amount')],
  ];
  let changed = false;
  defaults.forEach(([label, html]) => {
    if (!html) return;
    const cell = editorRef.value?.querySelector<HTMLElement>(`[data-variable-label="${label}"]`);
    if (!cell || cell.querySelector('[data-token-kind]') || cell.textContent?.trim()) return;
    cell.innerHTML = html;
    changed = true;
  });
  editorRef.value.querySelectorAll<HTMLTableCellElement>('.purchase-detail-table thead th').forEach(cell => {
    if (cell.textContent?.replace(/\s+/g, '') === '金额（RMB）') {
      cell.innerHTML = '总价<br>（RMB）';
      changed = true;
    }
  });
  const purchaserCell = editorRef.value.querySelector<HTMLElement>('[data-variable-label="采购员"]');
  if (purchaserCell && !purchaserCell.querySelector('[data-token-kind="field"]') && purchaseOperatorName.value.trim()) {
    purchaserCell.textContent = purchaseOperatorName.value.trim();
    changed = true;
  }
  if (changed) syncEditor(true);
};

const applyPurchaseOperatorName = () => {
  localStorage.setItem('xii_purchase_operator_name', purchaseOperatorName.value.trim());
  void ensurePurchaseTemplateDefaults();
};

const isOutsourcingTemplate = computed(() => editorHtml.value.includes('outsourcing-order-template'));

const linkedFactoryToken = (aliases: string[], factoryField?: FieldMetaLite) => {
  if (!factoryField) return '';
  const child = findPurchaseField(linkedGroups.value[factoryField.id]?.fields || [], aliases);
  return child ? tokenHtml(child.name, 'field', child.id, factoryField.id) : '';
};

const ensureOutsourcingTemplateDefaults = async () => {
  if (!isOutsourcingTemplate.value || !editorRef.value) return;
  const factoryField = purchaseField('受托方加工厂', '受托方', '加工厂', '外发厂', '供应商');
  if (factoryField && isLinkField(factoryField)) await loadLinkedFields(factoryField);
  const defaults: Array<[string, string]> = [
    ['加工单号', purchaseToken('加工单号', ['加工单号', '合同编号', '委外单号'])],
    ['受托方名称', purchaseToken('受托方名称', ['受托方加工厂', '受托方', '加工厂', '外发厂', '供应商'])],
    ['联系人', purchaseToken('联系人', ['受托方联系人', '加工厂联系人', '联系人']) || linkedFactoryToken(['联系人', '联络人', '业务联系人'], factoryField)],
    ['联系电话', purchaseToken('联系电话', ['受托方电话', '加工厂电话', '联系电话', '手机号', '电话']) || linkedFactoryToken(['联系电话', '手机号码', '手机号', '电话'], factoryField)],
    ['数量', purchaseToken('数量', ['加工数量', '委外数量', '数量'])],
    ['人民币大写金额', tokenHtml('人民币大写金额', 'uppercase-amount')],
  ];
  let changed = false;
  defaults.forEach(([label, html]) => {
    if (!html) return;
    const cell = editorRef.value?.querySelector<HTMLElement>(`[data-variable-label="${label}"]`);
    if (!cell || cell.querySelector('[data-token-kind]') || cell.textContent?.trim()) return;
    cell.innerHTML = html;
    changed = true;
  });
  if (changed) syncEditor(true);
};

const createOutsourcingTemplate = async () => {
  if (!fieldList.value.length) await refreshFields();
  const factoryField = purchaseField('受托方加工厂', '受托方', '加工厂', '外发厂', '供应商');
  if (factoryField && isLinkField(factoryField)) await loadLinkedFields(factoryField);
  createTemplate();
  templateName.value = 'HUATOP 委托外加工单';
  orientation.value = 'portrait';
  outputMode.value = 'merge-records';
  imageWidthMm.value = 18;
  imageHeightMm.value = 16;
  imageFit.value = 'contain';

  const process = purchaseToken('加工工序', ['加工项目', '加工工序', '工序', '加工内容']);
  const productionOrder = purchaseToken('生产单号', ['生产单号', '主单号', '单号']);
  const specification = purchaseToken('尺寸/规格', ['尺寸规格', '规格', '尺寸']);
  const color = purchaseToken('颜色', ['颜色', '色号']);
  const product = purchaseToken('产品/材料名称', ['产品名称', '产品', '材料名称', '物料名称', '材料']);
  const quantity = purchaseToken('数量', ['加工数量', '委外数量', '数量']);
  const unit = purchaseToken('单位', ['计量单位', '单位']);
  const unitPrice = purchaseToken('加工单价', ['加工单价', '委外单价', '单价元', '单价']);
  const amount = purchaseToken('加工金额', ['加工金额', '委外金额', '订单总金额', '金额元', '金额', '总价']);
  const orderDate = purchaseToken('下单日期', ['下单日期', '委托日期', '加工日期']);
  const deliveryDate = purchaseToken('要求交期', ['要求交期', '交货日期', '交期']);
  const remark = purchaseToken('备注', ['加工备注', '备注', '要求']);
  const picture = purchaseToken('产品图片', ['产品图片', '图片', '附件']);
  const labels = ['加工工序','生产单号','尺寸/规格','颜色','产品/材料名称','数量','单位','加工单价','加工金额','下单日期','要求交期','备注/图片'];
  const detailCells = [process, productionOrder, specification, color, product, quantity, unit, unitPrice, amount, orderDate, deliveryDate, `${remark}${picture}`]
    .map((token, index) => `<td class="purchase-detail-cell" data-variable-label="${labels[index]}">${token}</td>`)
    .join('');
  const factoryName = purchaseToken('受托方名称', ['受托方加工厂', '受托方', '加工厂', '外发厂', '供应商']);
  const contact = purchaseToken('联系人', ['受托方联系人', '加工厂联系人', '联系人']) || linkedFactoryToken(['联系人', '联络人', '业务联系人'], factoryField);
  const phone = purchaseToken('联系电话', ['受托方电话', '加工厂电话', '联系电话', '手机号', '电话']) || linkedFactoryToken(['联系电话', '手机号码', '手机号', '电话'], factoryField);

  editorHtml.value = `
    <div class="outsourcing-order-template">
      <div class="purchase-company-header">
        <img class="purchase-logo" src="./assets/huatop-logo.png" alt="HUATOP">
        <div><h1>Dongguan Huatop Sporting Goods Co., Ltd.</h1><h2>东 莞 市 桦 拓 运 动 用 品 有 限 公 司</h2><p>地址：广东省东莞市寮步镇塘唇金富西路9号3栋2楼 ｜ TEL：0769 88996850 ｜ E-MAIL：contact@dg-neoprene.com</p></div>
      </div>
      <div class="purchase-order-title">委 托 外 加 工 单</div>
      <table class="purchase-meta-table"><tbody>
        <tr><th>加工单号：</th><td class="purchase-variable" data-variable-label="加工单号">${purchaseToken('加工单号', ['加工单号','合同编号','委外单号'])}</td><th>委托日期：</th><td class="purchase-variable" data-variable-label="委托日期">${purchaseToken('委托日期', ['委托日期','下单日期','加工日期'], 'date')}</td></tr>
        <tr><th>受托方名称：</th><td class="purchase-variable" data-variable-label="受托方名称">${factoryName}</td><th>交货地点：</th><td>桦拓</td></tr>
        <tr><th>联系人：</th><td class="purchase-variable" data-variable-label="联系人">${contact}</td><th>付款方式：</th><td class="purchase-variable" data-variable-label="付款方式">${purchaseToken('付款方式', ['付款方式','结算方式']) || '月结30天'}</td></tr>
        <tr><th>联系电话：</th><td class="purchase-variable" data-variable-label="联系电话">${phone}</td><th>税费 / 运费：</th><td class="purchase-variable" data-variable-label="税费 / 运费">${purchaseToken('税费 / 运费', ['税费运费','税费','运费'])}</td></tr>
      </tbody></table>
      <div class="purchase-section-title">外 加 工 明 细</div>
      <table class="template-table purchase-detail-table" data-record-layout="list">
        <colgroup><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:7%"><col style="width:14%"><col style="width:6%"><col style="width:5%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:7%"></colgroup>
        <thead><tr><th>加工工序</th><th>生产单号</th><th>尺寸/规格</th><th>颜色</th><th>产品／材料名称</th><th>数量</th><th>单位</th><th>加工单价<br>（RMB）</th><th>加工金额<br>（RMB）</th><th>下单日期</th><th>要求交期</th><th>备注/图片</th></tr></thead>
        <tbody><tr data-record-repeat="true">${detailCells}</tr></tbody>
        <tfoot><tr><th colspan="8">合计加工金额（人民币）</th><td>${tokenHtml('单元格数值合计', 'count')}</td><td colspan="2" class="purchase-total-unit">RMB</td><td></td></tr></tfoot>
      </table>
      <div class="purchase-uppercase-row"><strong>人民币大写：</strong><span class="purchase-variable" data-variable-label="人民币大写金额">${tokenHtml('人民币大写金额', 'uppercase-amount')}</span></div>
      <table class="purchase-confirm-table"><tbody><tr><th>加工备注 / 要求</th><td class="purchase-variable" data-variable-label="加工备注">${purchaseToken('加工备注', ['加工备注','加工要求','备注','要求'])}</td></tr><tr><th>受托方确认交期</th><td class="purchase-variable" data-variable-label="受托方确认交期">${purchaseToken('受托方确认交期', ['受托方确认交期','确认交期'])}</td><th>回复日期</th><td class="purchase-variable" data-variable-label="回复日期">${purchaseToken('回复日期', ['回复日期','确认日期'])}</td></tr></tbody></table>
      <table class="purchase-terms-table"><tbody>
        <tr><th>订单确认</th><td>甲方（委托方）：东莞市桦拓运动用品有限公司；乙方（受托方）：本单受托方。乙方应在收到本单后1个工作日内签章回传，确认加工内容及交期；调整须经双方书面确认。</td></tr>
        <tr><th>制作要求</th><td>乙方应严格按照甲方确认的样板、产品制作说明书及生产制造单加工制作。大货制作前须提供产前板，经甲方确认后方可量产；未经甲方书面同意，不得转包。</td></tr>
        <tr><th>供料及交付</th><td>供料方式及双方供料范围以本单备注、生产制造单及供料清单的书面约定为准。甲供材料须清点交接并妥善保管，损耗按双方书面约定执行；余料返还，因乙方原因造成的材料损失由乙方赔偿。交货地点为甲方仓库，交货前运费及相关费用由乙方承担。</td></tr>
        <tr><th>质量验收</th><td>仓库签收仅代表收货，不代表质量验收合格；付款及初次验收不免除乙方对隐蔽缺陷的责任。因乙方原因产生质量问题，甲方可要求返工、换货、退货退款或委托第三方处理，合理费用由乙方承担。乙方应在收到通知后48小时内答复，并在双方约定期限内完成处理。</td></tr>
        <tr><th>交付违约</th><td>乙方须按约定交期交货，每迟延一天按本次加工费的10%向甲方支付违约金，累计不超过加工费的50%。因迟延交付导致甲方损失的，乙方应全额赔偿。交付逾期5天，甲方有权解除合同；乙方除承担前述违约责任外，另按加工费总额的80%支付违约金。</td></tr>
        <tr><th>质量责任</th><td>乙方交付货物不符合甲方确认的样板、产品制作说明书及生产制造单要求的，甲方有权扣除加工费总额的50%作为违约金；造成甲方损失的，包括甲供材料损失、客户扣款或甲方向客户赔偿等，乙方应全额赔偿。付款金额以甲方验收合格数量为准。</td></tr>
        <tr><th>保密及尾货</th><td>乙方不得泄露甲方客户信息、图纸、样板及相关资料，不得擅自用于其他订单，不得私售带客户标识的尾货和次品。</td></tr>
        <tr><th>廉洁合作</th><td>供应商及其人员不得向我司员工、经办人或其关联方提供、承诺或变相输送回扣、现金、红包、礼品礼券、旅游招待、个人借款、虚假佣金或其他不正当利益。公司折扣、返利须书面约定、对公结算并如实入账，严禁转入个人账户。遇员工索要回扣或要求私下交易，应拒绝并向15362651491或者contact@dg-neoprene.com举报。经核实存在商业贿赂的，我司可依法依约停止合作、解除相关合同并追偿损失；涉嫌违法犯罪的，移交有关机关。举报线索应保密，禁止报复。</td></tr>
        <tr><th>付款约定</th><td>付款方式按本单约定执行，乙方须提供发票。加工单价所含税费、辅料及其他费用由双方书面确认；未经甲方书面确认的额外费用不予另付。款项仅支付至经核实的乙方对公账户，账户变更须正式书面通知并经甲方独立核验。</td></tr>
        <tr><th>争议解决</th><td>因本单产生的争议，双方应协商解决；协商不成，任何一方均可向甲方所在地有管辖权的人民法院提起诉讼。本单经双方签字或盖章确认后生效。</td></tr>
      </tbody></table>
      <table class="purchase-sign-table"><tbody><tr><th>批示：</th><td></td><th>审核：</th><td></td><th>制表人：</th><td class="purchase-variable" data-variable-label="制表人">${purchaseToken('制表人', ['制表人','经办人','负责人'])}</td></tr><tr><th>受托方签字 / 盖章：</th><td colspan="3"></td><th>签回日期：</th><td></td></tr></tbody></table>
    </div><p><br></p>`;

  page.value = 'editor';
  await nextTick();
  if (editorRef.value) editorRef.value.innerHTML = editorHtml.value;
  resetHistory(editorHtml.value);
  editorRef.value?.focus();
};

const createPurchaseTemplate = async () => {
  if (!fieldList.value.length) await refreshFields();
  const supplierField = purchaseField('供应商名称', '供应商', '厂商名称', '厂商');
  if (supplierField && isLinkField(supplierField)) await loadLinkedFields(supplierField);
  createTemplate();
  templateName.value = 'HUATOP 采购订购单';
  orientation.value = 'portrait';
  outputMode.value = 'merge-records';
  imageWidthMm.value = 18;
  imageHeightMm.value = 16;
  imageFit.value = 'contain';

  const orderType = purchaseToken('订单类型', ['订单类型', '采购类型']);
  const productionOrder = purchaseToken('生产单号', ['生产单号', '主单号', '单号']);
  const specification = purchaseToken('尺寸/规格', ['尺寸规格', '规格', '尺寸']);
  const color = purchaseToken('颜色', ['颜色', '色号']);
  const material = purchaseToken('材料名称', ['材料名称', '物料名称', '产品名称', '产品', '材料']);
  const quantity = purchaseToken('数量', ['采购数量', '订购数量', '数量']);
  const unit = purchaseToken('单位', ['计量单位', '单位']);
  const unitPrice = purchaseToken('单价', ['采购单价', '含税单价', '单价']);
  const amount = purchaseToken('总价', ['采购总价', '采购金额', '总价', '总金额', '金额']);
  const orderDate = purchaseToken('下单日期', ['下单日期', '采购日期', '订购日期']);
  const deliveryDate = purchaseToken('要求交期', ['要求交期', '交货日期', '交期']);
  const remark = purchaseToken('备注', ['费用备注', '采购备注', '备注']);
  const picture = purchaseToken('图片', ['产品图片', '材料图片', '图片', '附件']);
  const detailCells = [orderType, productionOrder, specification, color, material, quantity, unit, unitPrice, amount, orderDate, deliveryDate, `${remark}${picture}`]
    .map((token, index) => `<td class="purchase-detail-cell" data-variable-label="${['订单类型','生产单号','尺寸/规格','颜色','材料名称','数量','单位','单价','金额','下单日期','要求交期','备注/图片'][index]}">${token}</td>`)
    .join('');

  editorHtml.value = `
    <div class="purchase-order-template">
      <div class="purchase-company-header">
        <img class="purchase-logo" src="./assets/huatop-logo.png" alt="HUATOP">
        <div>
          <h1>Dongguan Huatop Sporting Goods Co., Ltd.</h1>
          <h2>东 莞 市 桦 拓 运 动 用 品 有 限 公 司</h2>
          <p>地址：广东省东莞市寮步镇塘唇金富西路9号3栋2楼 ｜ TEL：0769 88996850 ｜ E-MAIL：contact@dg-neoprene.com</p>
        </div>
      </div>
      <div class="purchase-order-title">订 购 单</div>
      <table class="purchase-meta-table">
        <tbody>
          <tr><th>订购单号：</th><td class="purchase-variable" data-variable-label="订购单号">${tokenHtml('订购单号', 'order-number')}</td><th>订购日期：</th><td class="purchase-variable" data-variable-label="订购日期">${purchaseToken('订购日期', ['订购日期','采购日期','下单日期'], 'date')}</td></tr>
          <tr><th>厂商名称：</th>${purchaseVariableCell('厂商名称', ['厂商名称','供应商名称','供应商','厂商'])}<th>交货地点：</th>${purchaseVariableCell('交货地点', ['交货地点','送货地址','收货地址','交货地址'])}</tr>
          <tr><th>联系人：</th><td class="purchase-variable" data-variable-label="联系人">${purchaseToken('联系人', ['供应商联系人','联系人']) || linkedSupplierToken(['联系人','联络人','业务联系人'], supplierField)}</td><th>付款方式：</th>${purchaseVariableCell('付款方式', ['付款方式','结算方式'])}</tr>
          <tr><th>联系电话：</th><td class="purchase-variable" data-variable-label="联系电话">${purchaseToken('联系电话', ['联系电话','手机号','电话']) || linkedSupplierToken(['联系电话','手机号码','手机号','电话'], supplierField)}</td><th>税费 / 运费：</th>${purchaseVariableCell('税费 / 运费', ['税费运费','税费','运费'])}</tr>
        </tbody>
      </table>
      <div class="purchase-section-title">订 单 明 细</div>
      <table class="template-table purchase-detail-table" data-record-layout="list">
        <colgroup><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:7%"><col style="width:14%"><col style="width:6%"><col style="width:5%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:7%"></colgroup>
        <thead><tr><th>订单类型</th><th>生产单号</th><th>尺寸/规格</th><th>颜色</th><th>材料名称</th><th>数量</th><th>单位</th><th>单价<br>（RMB）</th><th>总价<br>（RMB）</th><th>下单日期</th><th>要求交期</th><th>备注/图片</th></tr></thead>
        <tbody><tr data-record-repeat="true">${detailCells}</tr></tbody>
        <tfoot><tr><th colspan="8">合计总金额（人民币）</th><td>${tokenHtml('单元格数值合计', 'count')}</td><td colspan="2" class="purchase-total-unit">RMB</td><td></td></tr></tfoot>
      </table>
      <div class="purchase-uppercase-row"><strong>人民币大写：</strong><span class="purchase-variable" data-variable-label="人民币大写金额">${tokenHtml('人民币大写金额', 'uppercase-amount')}</span></div>
      <table class="purchase-confirm-table"><tbody><tr><th>订单备注 / 要求</th><td class="purchase-variable" data-variable-label="订单备注">${purchaseToken('订单备注', ['订单备注','采购要求','订单要求'])}</td></tr><tr><th>供应商确认交期</th><td class="purchase-variable" data-variable-label="供应商确认交期">${purchaseToken('供应商确认交期', ['供应商确认交期','确认交期'])}</td><th>回复日期</th><td class="purchase-variable" data-variable-label="回复日期">${purchaseToken('回复日期', ['回复日期','确认日期'])}</td></tr></tbody></table>
      <table class="purchase-terms-table"><tbody>
        <tr><th>订单确认</th><td>贵司在收到本订单后，须在1个工作日内盖章确认并回传我司。逾期未回传且未以书面形式提出异议的，视为贵司已充分理解并同意本订单的全部条款内容，并据此履行。回传须逐项明确可承诺交期；不能满足要求的，应在上述时限内书面说明并提出可行交期，调整须经双方书面确认。</td></tr>
        <tr><th>送货规范</th><td>随货送货单须清晰注明我司订单号、材料名称、规格型号及数量。如未按要求提供完整有效文件，我司有权拒绝收货或暂缓验收入库，由此产生的费用及风险由贵司自行承担。</td></tr>
        <tr><th>物流费用</th><td>运输方式及运费承担以本订单正文约定为准。如约定为运费到付或双方分担，贵司须在发运前提供合理、明确的费用预估清单，并经我司书面确认后方可安排发运。</td></tr>
        <tr><th>质量验收</th><td>我司对货物的签收仅代表对外观、包装及数量的初步确认，不视为对货物质量的最终认可。原材料入库后如检测不符合本订单或相关标准要求，贵司须负责退换货并承担相关费用。未经我司书面同意，不得擅自换材、改变规格、颜色或工艺、降级或转包。</td></tr>
        <tr><th>交付违约</th><td>贵司须严格按照订单约定的交期完成交付。每逾期一日，贵司应按订单总金额的0.5%支付违约金；逾期超过7日，我司有权取消订单并追究违约责任。发现可能延期时，须在24小时内书面预警。</td></tr>
        <tr><th>溢短装约定</th><td>交付数量原则上应严格以订单约定为准。如因行业特性确需允许合理误差，误差范围不得超过±3%。结算数量以我司实际过磅或清点数量为准。</td></tr>
        <tr><th>环保及合规</th><td>所交货物须符合欧盟最新环保标准（RoHS、REACH等）及国家相关安全、环保法规要求。</td></tr>
        <tr><th>廉洁采购</th><td>供应商及其人员不得向我司员工、经办人或其关联方提供或变相输送任何不正当利益。举报电话：15362651491；邮箱：contact@dg-neoprene.com。</td></tr>
        <tr><th>付款及保密</th><td>价格、税费、运费及付款方式以本单双方确认内容为准；货款仅付至经核实的供应商对公账户。供应商应对我司价格、图纸、样品、客户及订单资料保密。</td></tr>
        <tr><th>争议解决</th><td>因履行本订单产生的争议，双方应首先协商解决；协商不成的，任何一方均可向我司所在地有管辖权的人民法院提起诉讼。</td></tr>
      </tbody></table>
      <table class="purchase-sign-table"><tbody><tr><th>批示：</th><td></td><th>审核：</th><td></td><th>采购：</th><td class="purchase-variable" data-variable-label="采购员">${purchaseToken('采购员', ['采购员','采购人','采购姓名','采购负责人','采购']) || escapeEditorHtml(purchaseOperatorName.value.trim())}</td></tr><tr><th>供应商签字 / 盖章：</th><td colspan="3"></td><th>签回日期：</th><td></td></tr></tbody></table>
    </div><p><br></p>`;

  page.value = 'editor';
  await nextTick();
  if (editorRef.value) editorRef.value.innerHTML = editorHtml.value;
  resetHistory(editorHtml.value);
  editorRef.value?.focus();
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
  await ensurePurchaseTemplateDefaults();
  await ensureOutsourcingTemplateDefaults();
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
      const canvasContext = canvas.getContext('2d');
      let effectiveHeight = canvas.height;
      if (canvasContext) {
        const pixels = canvasContext.getImageData(0, 0, canvas.width, canvas.height).data;
        let renderedBottom = 0;
        outer: for (let y = canvas.height - 1; y >= 0; y -= 1) {
          for (let x = 0; x < canvas.width; x += 2) {
            const offset = (y * canvas.width + x) * 4;
            if (pixels[offset + 3] > 0 && (pixels[offset] < 248 || pixels[offset + 1] < 248 || pixels[offset + 2] < 248)) {
              renderedBottom = y + 1;
              break outer;
            }
          }
        }
        if (renderedBottom) effectiveHeight = Math.min(canvas.height, renderedBottom + Math.round(24 * canvasScale));
      }
      const detailBlocks = Array.from(sheets[index].querySelectorAll<HTMLElement>('.merged-detail-record'));
      const breakElements = detailBlocks.length
        ? detailBlocks
        : Array.from(sheets[index].querySelectorAll<HTMLElement>('tr'));
      const safeBreaks = breakElements
        .map(element => Math.round((element.getBoundingClientRect().bottom - sheetRect.top) * canvasScale))
        .filter(position => position > 0 && position < effectiveHeight)
        .sort((left, right) => left - right);

      for (let sourceY = 0; sourceY < effectiveHeight;) {
        // html2canvas can leave a few white pixels after an exact A4 sheet.
        // Ignore that rounding tail so exports do not gain a blank final page.
        if (sourceY > 0 && effectiveHeight - sourceY <= Math.ceil(canvasScale * 4)) break;
        const idealEnd = Math.min(sourceY + pageSliceHeight, effectiveHeight);
        let pageEnd = idealEnd;
        if (idealEnd < effectiveHeight) {
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
          <button class="create-card purchase-create-card" @click="createPurchaseTemplate">
            <span class="create-icon"><el-icon><Tickets /></el-icon></span>
            <strong>采购订购单</strong>
            <span>按 HUATOP 格式创建，飞书字段可选择插入</span>
          </button>
          <button class="create-card outsourcing-create-card" @click="createOutsourcingTemplate">
            <span class="create-icon"><el-icon><Tickets /></el-icon></span>
            <strong>委托外加工单</strong>
            <span>按橙色版格式创建，关联加工厂信息并汇总金额</span>
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
          <div v-if="isPurchaseTemplate" class="purchase-operator-setting">
            <strong>采购姓名</strong>
            <el-input v-model="purchaseOperatorName" placeholder="输入本单采购姓名" clearable @change="applyPurchaseOperatorName" @blur="applyPurchaseOperatorName" />
            <small>如果飞书中有“采购员/采购人”字段，会优先读取字段值。</small>
          </div>
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
