// ========================================
// 吃货遗愿清单 - 应用逻辑
// ========================================

// ---- 内置美食数据库 ----
let BUILTIN_FOODS = [];
let CATEGORY_EMOJI = {};

// ---- 懒人数据库：加载外部JSON ----
async function loadBuiltinFoods() {
  try {
    const response = await fetch('foods.json');
    if (!response.ok) throw new Error('Failed to load foods.json');
    const data = await response.json();

    // 加载分类emoji映射
    CATEGORY_EMOJI = data.categories;

    // 添加默认emoji防止未分类项出错
    const defaultEmoji = { '其他': '🍴' };
    CATEGORY_EMOJI = { ...defaultEmoji, ...CATEGORY_EMOJI };

    // 加载美食列表
    BUILTIN_FOODS = data.foods;

    console.log(`已加载 ${BUILTIN_FOODS.length} 个内置美食`);
  } catch (err) {
    console.warn('加载内置美食失败，使用默认数据:', err);
    // 回退到默认数据
    CATEGORY_EMOJI = {
      '日料': '🍣', '面食': '🍜', '火锅': '🍲', '点心': '🥮',
      '烤肉': '🥩', '西餐': '🍕', '饮品': '🍺', '小吃': '📍',
      '甜品': '🍰', '其他': '🍴'
    };
    BUILTIN_FOODS = [];
  }
}

// ---- 分类 emoji 映射 ----
// 注意：CATEGORY_EMOJI 通过 loadBuiltinFoods() 动态加载

const PRIORITY_TEXT = { 3: '🏆 此生必吃', 2: '💛 很想吃', 1: '🌱 有机会就吃', 'undefined': '' };

// ---- IndexedDB 操作 ----
const DB_NAME = 'EatItemDB';
const DB_VERSION = 1;
const STORE_NAME = 'items';

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('category', 'category', { unique: false });
      }
    };
  });
}

function dbAdd(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbPut(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGet(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ---- 应用状态 ----
let currentFilter = 'all';
let currentItemId = null;
let deleteTargetId = null;
let checkinItemId = null;
let photoData = null;

// ---- 工具函数 ----
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// ---- 渲染函数 ----
async function renderList() {
  const list = await dbGetAll();
  const pending = list.filter(item => item.status === 'pending');
  const completed = list.filter(item => item.status === 'completed');

  document.getElementById('completedCount').textContent = completed.length;
  document.getElementById('pendingCount').textContent = pending.length;

  // 更新年度进度
  const total = list.length;
  const done = completed.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('progressPercent').textContent = percent + '%';
  document.getElementById('progressFill').style.width = percent + '%';

  // 更新倒计时显示
  loadCountdown();

  // 筛选显示
  let filtered = list;
  if (currentFilter === 'pending') filtered = pending;
  else if (currentFilter === 'completed') filtered = completed;

  // 按状态和创建时间排序（新添加的在前）
  filtered.sort((a, b) => {
    // 待完成优先
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    // 按创建时间倒序（最新的在前）
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const container = document.getElementById('bucketList');
  const emptyState = document.getElementById('emptyState');

  if (filtered.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    container.innerHTML = filtered.map(item => `
      <div class="bucket-item ${item.status}" data-id="${item.id}">
        <div class="item-main">
          <div class="item-icon">${CATEGORY_EMOJI[item.category] || '🍴'}</div>
          <div class="item-info">
            <div class="item-header">
              <span class="item-name">${item.name}</span>
              ${item.priority ? `<span class="item-priority priority-${item.priority}">${PRIORITY_TEXT[item.priority]}</span>` : ''}
            </div>
            ${item.note ? `<div class="item-reason">💭 ${item.note}</div>` : ''}
            <div class="item-meta">
              ${item.location ? `<span class="item-location">📍 ${item.location}</span>` : ''}
              ${item.completedAt ? `<span class="item-date">✅ ${formatDate(item.completedAt)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="item-actions">
          ${item.status === 'pending'
            ? `<button class="btn-action btn-eat" onclick="openCheckin('${item.id}')">吃到了！</button>`
            : ''}
          <button class="btn-action" onclick="openDetail('${item.id}')">详情</button>
          <button class="btn-action" onclick="confirmDelete('${item.id}')">删除</button>
        </div>
      </div>
    `).join('');
  }

  // 更新倒计时
  loadCountdown();
}

// ---- 内置数据库渲染 ----
function renderBuiltinList() {
  const container = document.getElementById('builtinList');
  const categories = {};

  BUILTIN_FOODS.forEach((food, idx) => {
    if (!categories[food.category]) categories[food.category] = [];
    categories[food.category].push({ ...food, idx });
  });

  container.innerHTML = Object.entries(categories).map(([cat, items]) => `
    <div class="builtin-category">
      <div class="category-header">
        <input type="checkbox" data-category="${cat}">
        <span>${CATEGORY_EMOJI[cat] || '🍴'} ${cat}（${items.length}道）</span>
      </div>
      <div class="category-items">
        ${items.map(food => `
          <label class="builtin-item">
            <input type="checkbox" data-builtin-idx="${food.idx}" data-name="${food.name}" data-category="${food.category}">
            <span>${food.name}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');

  // 全选/取消分类
  container.querySelectorAll('.category-header input').forEach(input => {
    input.addEventListener('change', (e) => {
      const cat = e.target.dataset.category;
      container.querySelectorAll(`input[data-category="${cat}"]`).forEach(cb => {
        if (cb !== e.target) cb.checked = e.target.checked;
      });
      updateImportInfo();
    });
  });

  // 单个选择
  container.querySelectorAll('.builtin-item input').forEach(input => {
    input.addEventListener('change', () => {
      const cat = input.dataset.category;
      const catItems = container.querySelectorAll(`.builtin-item input[data-category="${cat}"]`);
      const catChecked = container.querySelectorAll(`.builtin-item input[data-category="${cat}"]:checked`);
      const headerCheckbox = container.querySelector(`.category-header input[data-category="${cat}"]`);
      headerCheckbox.checked = catItems.length === catChecked.length;
      updateImportInfo();
    });
  });
}

function updateImportInfo() {
  const checked = document.querySelectorAll('#builtinList .builtin-item input:checked').length;
  document.getElementById('importInfo').textContent = `已选择 ${checked} 道美食`;
}

// ---- 弹窗控制 ----
function openModal(modalId) {
  document.getElementById(modalId).classList.remove('hidden');
  // 禁止底层页面滚动，防止滚动穿透
  // 使用 position fixed 保持页面位置，避免跳动
  document.body.classList.add('modal-open');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
  // 恢复底层页面滚动
  document.body.classList.remove('modal-open');
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  photoData = null;
  document.getElementById('photoPreview').classList.add('hidden');
  document.getElementById('photoUpload').classList.remove('hidden');
}

// ---- 添加心愿 ----
function openAddForm() {
  currentItemId = null;
  document.getElementById('modalTitle').textContent = '添加心愿';
  document.getElementById('itemForm').reset();
  openModal('modal');
}

async function submitItem(e) {
  e.preventDefault();
  const item = {
    id: currentItemId || generateId(),
    name: document.getElementById('foodName').value.trim(),
    category: document.getElementById('foodCategory').value,
    location: document.getElementById('foodLocation').value.trim(),
    note: document.getElementById('foodNote').value.trim(),
    priority: parseInt(document.querySelector('input[name="priority"]:checked').value),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  if (!item.name) return;

  await dbPut(item);
  closeModal('modal');
  renderList();
}

// ---- 打卡 ----
async function openCheckin(id) {
  checkinItemId = id;
  const item = await dbGet(id);
  const checkinItemInfo = document.getElementById('checkinItemInfo');
  if (checkinItemInfo) {
    checkinItemInfo.innerHTML = `
      <div class="item-icon">${CATEGORY_EMOJI[item.category] || '🍴'}</div>
      <div class="item-name">${item.name}</div>
    `;
  }
  const checkinForm = document.getElementById('checkinForm');
  if (checkinForm) checkinForm.reset();
  photoData = null;
  
  const photoPreview = document.getElementById('photoPreview');
  if (photoPreview) photoPreview.classList.add('hidden');
  
  const photoPlaceholder = document.querySelector('.photo-placeholder');
  if (photoPlaceholder) photoPlaceholder.classList.remove('hidden');
  
  openModal('checkinModal');
}

async function submitCheckin(e) {
  e.preventDefault();
  const item = await dbGet(checkinItemId);
  item.status = 'completed';
  item.completedAt = new Date().toISOString();
  item.checkinNote = document.getElementById('checkinNote').value.trim();
  if (photoData) item.photo = photoData;
  await dbPut(item);
  closeModal('checkinModal');
  renderList();
  // 显示分享弹窗
  showShareModal(item);
}

// ---- 详情 ----
async function openDetail(id) {
  const item = await dbGet(id);
  const html = `
    <div class="detail-item">
      <div class="detail-icon">${CATEGORY_EMOJI[item.category] || '🍴'}</div>
      <div class="detail-name">${item.name}</div>
      ${item.location ? `<div class="detail-location">${item.location}</div>` : ''}
      ${item.note ? `<div class="detail-note">${item.note}</div>` : ''}
      <div class="detail-meta">
        ${item.priority ? `<span class="priority-${item.priority}">${PRIORITY_TEXT[item.priority]}</span>` : ''}
        <span>${item.status === 'completed' ? '✅ 已打卡' : '⬜ 待完成'}</span>
      </div>
    </div>
    ${item.status === 'completed' && (item.photo || item.checkinNote) ? `
      <div class="checkin-record">
        <h4>📝 打卡记录</h4>
        ${item.photo ? `<img src="${item.photo}" alt="打卡照片">` : ''}
        ${item.checkinNote ? `<p>${item.checkinNote}</p>` : ''}
        <p class="item-date">打卡于 ${formatDate(item.completedAt)}</p>
      </div>
    ` : ''}
    <div class="detail-actions">
      ${item.status === 'pending' ? `<button class="btn-primary" onclick="closeDetail();openCheckin('${item.id}')">吃到了！</button>` : ''}
      <button class="btn-secondary" onclick="closeDetail();openEditForm('${item.id}')">编辑</button>
    </div>
  `;
  document.getElementById('detailContent').innerHTML = html;
  openModal('detailModal');
}

function closeDetail() {
  closeModal('detailModal');
}

// ---- 编辑 ----
async function openEditForm(id) {
  const item = await dbGet(id);
  currentItemId = id;
  document.getElementById('modalTitle').textContent = '编辑心愿';
  document.getElementById('foodName').value = item.name;
  document.getElementById('foodCategory').value = item.category;
  document.getElementById('foodLocation').value = item.location || '';
  document.getElementById('foodNote').value = item.note || '';
  
  // 设置优先级，处理可能的 null/undefined 情况
  const priorityValue = String(item.priority || '2'); // 默认值为 2
  const priorityRadio = document.querySelector(`input[name="priority"][value="${priorityValue}"]`);
  if (priorityRadio) {
    priorityRadio.checked = true;
  }
  
  openModal('modal');
}

// ---- 删除 ----
function confirmDelete(id) {
  deleteTargetId = id;
  openModal('deleteModal');
}

async function executeDelete() {
  if (deleteTargetId) {
    await dbDelete(deleteTargetId);
    deleteTargetId = null;
    closeModal('deleteModal');
    renderList();
  }
}

// ---- 懒人导入 ----
async function importBuiltin() {
  const checkboxes = document.querySelectorAll('#builtinList .builtin-item input:checked');
  const existingItems = await dbGetAll();
  const existingNames = new Set(existingItems.map(i => i.name));

  let imported = 0;
  for (const cb of checkboxes) {
    const idx = parseInt(cb.dataset.builtinIdx);
    const food = BUILTIN_FOODS[idx];
    if (!existingNames.has(food.name)) {
      const item = {
        id: generateId(),
        name: food.name,
        category: food.category,
        location: food.location,
        note: food.note,
        priority: food.priority,
        status: 'pending',
        createdAt: new Date().toISOString(),
        source: 'builtin',
      };
      await dbPut(item);
      imported++;
    }
  }
  closeModal('quickAddModal');
  renderList();
  alert(`成功导入 ${imported} 道美食！`);
}

// ---- 图片压缩 ----
function compressPhoto(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 400;
        let w = img.width, h = img.height;
        if (w > h && w > maxSize) {
          h = h * maxSize / w;
          w = maxSize;
        } else if (h > maxSize) {
          w = w * maxSize / h;
          h = maxSize;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- 数据导出 ----
async function exportData() {
  const items = await dbGetAll();
  const backup = {
    version: 1,
    exportDate: new Date().toISOString(),
    items: items
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `吃货清单备份_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- 数据导入 ----
async function importData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        if (!backup.items || !Array.isArray(backup.items)) {
          alert('文件格式不正确');
          reject(new Error('Invalid format'));
          return;
        }
        let imported = 0;
        let skipped = 0;
        const existingItems = await dbGetAll();
        const existingIds = new Set(existingItems.map(i => i.id));

        for (const item of backup.items) {
          if (existingIds.has(item.id)) {
            skipped++;
          } else {
            await dbPut(item);
            imported++;
          }
        }
        alert(`导入完成：新增 ${imported} 条，跳过 ${skipped} 条重复数据`);
        renderList();
        resolve({ imported, skipped });
      } catch (err) {
        alert('导入失败：' + err.message);
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ---- 事件绑定 ----
function bindEvents() {
  // 启动画面
  const splash = document.getElementById('splash');
  const app = document.getElementById('app');
  if (splash && app) {
    setTimeout(() => {
      splash.classList.add('fade-out');
      app.classList.remove('hidden');
    }, 1500);
  }

  // 添加按钮
  const btnAdd = document.getElementById('btnAdd');
  if (btnAdd) btnAdd.addEventListener('click', openAddForm);

  // 关闭弹窗
  const btnCloseModal = document.getElementById('btnCloseModal');
  if (btnCloseModal) btnCloseModal.addEventListener('click', () => closeModal('modal'));
  
  const btnCloseCheckin = document.getElementById('btnCloseCheckin');
  if (btnCloseCheckin) btnCloseCheckin.addEventListener('click', () => closeModal('checkinModal'));
  
  const btnCloseQuickAdd = document.getElementById('btnCloseQuickAdd');
  if (btnCloseQuickAdd) btnCloseQuickAdd.addEventListener('click', () => closeModal('quickAddModal'));
  
  const btnCloseDetail = document.getElementById('btnCloseDetail');
  if (btnCloseDetail) btnCloseDetail.addEventListener('click', closeDetail);

  // 点击背景关闭
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAllModals();
    });
  });

  // 表单提交
  const itemForm = document.getElementById('itemForm');
  if (itemForm) itemForm.addEventListener('submit', submitItem);
  
  const checkinForm = document.getElementById('checkinForm');
  if (checkinForm) checkinForm.addEventListener('submit', submitCheckin);

  // 筛选
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderList();
    });
  });

  // 懒人添加
  const quickAddCard = document.getElementById('quickAddCard');
  if (quickAddCard) {
    quickAddCard.addEventListener('click', () => {
      renderBuiltinList();
      openModal('quickAddModal');
    });
  }
  
  const btnSelectAll = document.getElementById('btnSelectAll');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      document.querySelectorAll('#builtinList input').forEach(cb => cb.checked = true);
      updateImportInfo();
    });
  }
  
  const btnSelectNone = document.getElementById('btnSelectNone');
  if (btnSelectNone) {
    btnSelectNone.addEventListener('click', () => {
      document.querySelectorAll('#builtinList input').forEach(cb => cb.checked = false);
      updateImportInfo();
    });
  }
  
  const btnImportBuiltin = document.getElementById('btnImportBuiltin');
  if (btnImportBuiltin) btnImportBuiltin.addEventListener('click', importBuiltin);

  // 数据备份/恢复
  const btnExport = document.getElementById('btnExport');
  if (btnExport) btnExport.addEventListener('click', exportData);
  
  const btnImport = document.getElementById('btnImport');
  const importFile = document.getElementById('importFile');
  if (btnImport && importFile) {
    btnImport.addEventListener('click', () => {
      importFile.click();
    });
    importFile.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        importData(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  // 照片上传
  const checkinPhoto = document.getElementById('checkinPhoto');
  if (checkinPhoto) {
    checkinPhoto.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        photoData = await compressPhoto(file);
        const photoPreview = document.getElementById('photoPreview');
        const photoPlaceholder = document.querySelector('.photo-placeholder');
        if (photoPreview) {
          photoPreview.src = photoData;
          photoPreview.classList.remove('hidden');
        }
        if (photoPlaceholder) {
          photoPlaceholder.classList.add('hidden');
        }
      }
    });
  }

  // 删除确认
  const btnCancelDelete = document.getElementById('btnCancelDelete');
  if (btnCancelDelete) btnCancelDelete.addEventListener('click', () => closeModal('deleteModal'));
  
  const btnConfirmDelete = document.getElementById('btnConfirmDelete');
  if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', executeDelete);

  // iOS Banner 关闭
  const btnCloseIOSBanner = document.getElementById('btnCloseIOSBanner');
  if (btnCloseIOSBanner) {
    btnCloseIOSBanner.addEventListener('click', () => {
      const iosBanner = document.getElementById('iosBanner');
      if (iosBanner) iosBanner.classList.add('hidden');
      localStorage.setItem('iosBannerDismissed', 'true');
    });
  }

  // 倒计时
  const btnEditCountdown = document.getElementById('btnEditCountdown');
  if (btnEditCountdown) {
    btnEditCountdown.addEventListener('click', openCountdownModal);
  }
  
  const countdownForm = document.getElementById('countdownForm');
  if (countdownForm) countdownForm.addEventListener('submit', saveCountdown);
  
  const btnClearCountdown = document.getElementById('btnClearCountdown');
  if (btnClearCountdown) btnClearCountdown.addEventListener('click', clearCountdown);
  
  const btnCloseCountdown = document.getElementById('btnCloseCountdown');
  if (btnCloseCountdown) btnCloseCountdown.addEventListener('click', () => closeModal('countdownModal'));

  // 倒计时预设
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days);
      const target = new Date();
      target.setDate(target.getDate() + days);
      const targetDate = document.getElementById('targetDate');
      if (targetDate) targetDate.value = target.toISOString().slice(0, 10);
    });
  });

  // 随机推荐
  const btnRandom = document.getElementById('btnRandom');
  if (btnRandom) btnRandom.addEventListener('click', showRandomItem);
  
  const btnCloseRandom = document.getElementById('btnCloseRandom');
  if (btnCloseRandom) btnCloseRandom.addEventListener('click', closeRandomCard);
  
  const btnRandomEat = document.getElementById('btnRandomEat');
  if (btnRandomEat) btnRandomEat.addEventListener('click', randomItemCheckin);
  
  const btnRandomAdd = document.getElementById('btnRandomAdd');
  if (btnRandomAdd) btnRandomAdd.addEventListener('click', randomItemAddToList);

  // 年度总结
  const btnSummary = document.getElementById('btnSummary');
  if (btnSummary) {
    btnSummary.addEventListener('click', showYearSummary);
  }
  
  const countdownMini = document.getElementById('countdownMini');
  if (countdownMini) countdownMini.addEventListener('click', openCountdownModal);
  
  const btnCloseSummary = document.getElementById('btnCloseSummary');
  if (btnCloseSummary) btnCloseSummary.addEventListener('click', () => closeModal('summaryModal'));
  
  const btnCloseSummaryBtn = document.getElementById('btnCloseSummaryBtn');
  if (btnCloseSummaryBtn) btnCloseSummaryBtn.addEventListener('click', () => closeModal('summaryModal'));
  
  const btnShareSummary = document.getElementById('btnShareSummary');
  if (btnShareSummary) btnShareSummary.addEventListener('click', shareSummary);

  // 打卡分享
  const btnCloseShare = document.getElementById('btnCloseShare');
  if (btnCloseShare) btnCloseShare.addEventListener('click', closeShareModal);
  
  const btnSaveCard = document.getElementById('btnSaveCard');
  if (btnSaveCard) btnSaveCard.addEventListener('click', saveShareCard);
  
  const btnShareIt = document.getElementById('btnShareIt');
  if (btnShareIt) btnShareIt.addEventListener('click', shareCheckin);

  // 地图视图
  const btnMapView = document.getElementById('btnMapView');
  if (btnMapView) btnMapView.addEventListener('click', openMapView);
  
  const btnBackToList = document.getElementById('btnBackToList');
  if (btnBackToList) btnBackToList.addEventListener('click', closeMapView);
}

// ---- 倒计时功能 ----
function loadCountdown() {
  const countdown = JSON.parse(localStorage.getItem('countdown') || 'null');
  const miniText = document.getElementById('countdownMiniText');

  if (!countdown) {
    miniText.textContent = '⏳ 设定目标日期';
    return;
  }

  const target = new Date(countdown.targetDate);
  const now = new Date();
  const diff = target - now;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days < 0) {
    miniText.textContent = '⏰ 已过期 · 时间不等人';
    return;
  }

  const pending = parseInt(document.getElementById('pendingCount').textContent) || 0;
  const namePart = countdown.name ? countdown.name + ' · ' : '';
  miniText.textContent = `⏳ ${namePart}${days}天 · 剩余${pending}个心愿`;
}

function openCountdownModal() {
  const countdown = JSON.parse(localStorage.getItem('countdown') || 'null');
  if (countdown) {
    document.getElementById('targetDate').value = countdown.targetDate;
    document.getElementById('targetName').value = countdown.name || '';
  } else {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    document.getElementById('targetDate').value = nextYear.toISOString().slice(0, 10);
    document.getElementById('targetName').value = '';
  }
  openModal('countdownModal');
}

function saveCountdown(e) {
  e.preventDefault();
  const countdown = {
    targetDate: document.getElementById('targetDate').value,
    name: document.getElementById('targetName').value.trim()
  };
  localStorage.setItem('countdown', JSON.stringify(countdown));
  closeModal('countdownModal');
  loadCountdown();
}

function clearCountdown() {
  localStorage.removeItem('countdown');
  closeModal('countdownModal');
  loadCountdown();
}

// ---- 随机推荐功能 ----
let randomItemData = null; // 存储随机推荐的内置美食数据

function showRandomItem() {
  // 从内置美食库随机选一个
  const randomIdx = Math.floor(Math.random() * BUILTIN_FOODS.length);
  randomItemData = BUILTIN_FOODS[randomIdx];

  const content = document.getElementById('randomContent');
  content.innerHTML = `
    <div class="random-icon">${CATEGORY_EMOJI[randomItemData.category] || '🍴'}</div>
    <div class="random-name">${randomItemData.name}</div>
    ${randomItemData.location ? `<div class="random-location">${randomItemData.location}</div>` : ''}
    ${randomItemData.note ? `<div class="random-note">"${randomItemData.note}"</div>` : ''}
  `;
  document.getElementById('randomCard').classList.remove('hidden');
  // 禁止底层页面滚动，防止滚动穿透
  document.body.classList.add('modal-open');
}

function closeRandomCard() {
  document.getElementById('randomCard').classList.add('hidden');
  randomItemData = null;
  randomItemId = null;
  // 恢复底层页面滚动
  document.body.classList.remove('modal-open');
}

function randomItemCheckin() {
  if (randomItemData) {
    // 添加到列表并打开打卡
    const item = {
      ...randomItemData,
      id: generateId(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      photos: []
    };
    dbPut(item).then(() => {
      closeRandomCard();
      renderList();
      setTimeout(() => openCheckin(item.id), 100);
    });
  } else if (randomItemId) {
    closeRandomCard();
    openCheckin(randomItemId);
  }
}

function randomItemAddToList() {
  if (randomItemData) {
    // 仅添加到列表，不打卡
    const item = {
      ...randomItemData,
      id: generateId(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      photos: []
    };
    dbPut(item).then(() => {
      closeRandomCard();
      renderList();
    });
  }
}

// ---- 年度总结功能 ----
async function showYearSummary() {
  const year = new Date().getFullYear();
  const items = await dbGetAll();
  const yearItems = items.filter(item => {
    if (!item.completedAt) return false;
    const itemYear = new Date(item.completedAt).getFullYear();
    return itemYear === year;
  });

  const content = document.getElementById('summaryContent');
  if (yearItems.length === 0) {
    content.innerHTML = `
      <div class="summary-header">
        <div class="summary-year">${year}</div>
        <div class="summary-title">年度报告</div>
      </div>
      <p style="color:var(--text-secondary);padding:24px;text-align:center">这一年还没有打卡记录，快去完成你的心愿吧！</p>
    `;
  } else {
    // 按打卡时间排序，取前5
    yearItems.sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
    const topItems = yearItems.slice(0, 5);

    const quotes = [
      '"美食是最好的治愈。"',
      '"吃过的每一口，都算数。"',
      '"人生苦短，先吃甜品。"',
      '"唯有美食不可辜负。"',
      '"活着就是为了这一口。"'
    ];

    content.innerHTML = `
      <div class="summary-header">
        <div class="summary-year">${year}</div>
        <div class="summary-title">年度美食报告</div>
      </div>
      <div class="summary-stats">
        <div class="summary-stat">
          <span class="summary-stat-num">${yearItems.length}</span>
          <span class="summary-stat-label">打卡美食</span>
        </div>
      </div>
      <div class="summary-quote">${quotes[Math.floor(Math.random() * quotes.length)]}</div>
      <div class="summary-top-items">
        <h4>🍽️ 这一年吃过的</h4>
        ${topItems.map((item, idx) => `
          <div class="summary-item">
            <span class="summary-rank">${idx + 1}</span>
            <div>
              <div class="summary-item-name">${item.name}</div>
              ${item.location ? `<div class="summary-item-location">${item.location}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
  openModal('summaryModal');
}

function shareSummary() {
  const year = new Date().getFullYear();
  const items = document.querySelectorAll('.summary-item');
  let text = `🍽️ 我的 ${year} 年度美食报告\n\n`;
  items.forEach((item, idx) => {
    text += `${idx + 1}. ${item.querySelector('.summary-item-name').textContent}\n`;
  });
  text += '\n#吃货遗愿清单';

  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => alert('已复制到剪贴板！'));
  }
}

// ---- 打卡分享 ----
let shareItemData = null;

function showShareModal(item) {
  shareItemData = item;
  const card = document.getElementById('shareCard');
  const date = new Date(item.completedAt).toLocaleDateString('zh-CN');

  card.innerHTML = `
    <div class="share-card-content">
      <div class="share-badge">✅ 已打卡</div>
      <div class="share-icon">${CATEGORY_EMOJI[item.category] || '🍴'}</div>
      <div class="share-title">${item.name}</div>
      ${item.location ? `<div class="share-location">${item.location}</div>` : ''}
      <div class="share-qr">🍽️</div>
      <div class="share-tag">吃完再说 · ${date}</div>
    </div>
  `;
  openModal('shareModal');
}

function closeShareModal() {
  closeModal('shareModal');
  shareItemData = null;
}

async function saveShareCard() {
  // 创建 Canvas 来生成图片
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 600;
  canvas.height = 800;

  // 背景
  const gradient = ctx.createLinearGradient(0, 0, 600, 800);
  gradient.addColorStop(0, '#1A1A2E');
  gradient.addColorStop(1, '#2A2A4A');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 600, 800);

  // 发光效果
  const glowGradient = ctx.createRadialGradient(450, 200, 0, 450, 200, 400);
  glowGradient.addColorStop(0, 'rgba(255, 71, 87, 0.15)');
  glowGradient.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGradient;
  ctx.fillRect(0, 0, 600, 800);

  // 徽章
  ctx.fillStyle = '#FF4757';
  roundRect(ctx, 200, 80, 200, 40, 20);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✅ 已打卡', 300, 107);

  // Emoji
  ctx.font = '120px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🍽️', 300, 320);

  // 标题
  ctx.fillStyle = '#FF4757';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText(shareItemData.name, 300, 420);

  // 地点
  if (shareItemData.location) {
    ctx.fillStyle = '#A0A0B8';
    ctx.font = '24px sans-serif';
    ctx.fillText(shareItemData.location, 300, 470);
  }

  // 二维码占位
  ctx.fillStyle = 'white';
  roundRect(ctx, 240, 520, 120, 120, 16);
  ctx.fill();
  ctx.font = '60px sans-serif';
  ctx.fillText('🍽️', 300, 605);

  // 底部
  ctx.fillStyle = '#6B6B8A';
  ctx.font = '18px sans-serif';
  const date = new Date(shareItemData.completedAt).toLocaleDateString('zh-CN');
  ctx.fillText('吃完再说 · ' + date, 300, 720);

  // 下载
  const link = document.createElement('a');
  link.download = `吃货打卡_${shareItemData.name}_${date}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function shareCheckin() {
  const text = `🍽️ 我刚完成了「${shareItemData.name}」的打卡！\n${shareItemData.location ? shareItemData.location + '\n' : ''}#吃货遗愿清单`;

  if (navigator.share) {
    navigator.share({
      text,
      title: '吃货遗愿清单'
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => alert('已复制到剪贴板！'));
  }
}

// 圆角矩形辅助函数
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ---- 地图视图 ----
function openMapView() {
  document.getElementById('bucketList').classList.add('hidden');
  document.getElementById('filterBar').classList.add('hidden');
  document.getElementById('mapView').classList.remove('hidden');
  document.getElementById('btnMapView').classList.add('hidden');
  renderMapView();
}

function closeMapView() {
  document.getElementById('bucketList').classList.remove('hidden');
  document.getElementById('filterBar').classList.remove('hidden');
  document.getElementById('mapView').classList.add('hidden');
  document.getElementById('btnMapView').classList.remove('hidden');
}

async function renderMapView() {
  const items = await dbGetAll();
  const withLocation = items.filter(item => item.location && item.location.trim());

  const content = document.getElementById('mapContent');

  if (withLocation.length === 0) {
    content.innerHTML = `
      <div class="map-empty">
        <div class="map-empty-icon">🗺️</div>
        <p>还没有添加地点的心愿</p>
        <p style="font-size:12px;margin-top:8px">快去添加一些地点吧！</p>
      </div>
    `;
    return;
  }

  // 按地点分组
  const groups = {};
  withLocation.forEach(item => {
    const loc = item.location.trim();
    if (!groups[loc]) groups[loc] = [];
    groups[loc].push(item);
  });

  const locationEmojis = ['📍', '🏙️', '🌆', '🏯', '🎡', '🗼', '🏰', '⛩️', '🕌', '🛕'];
  let emojiIdx = 0;

  let html = '';
  for (const [location, items] of Object.entries(groups)) {
    const emoji = locationEmojis[emojiIdx % locationEmojis.length];
    emojiIdx++;

    html += `
      <div class="map-location-group">
        <div class="location-header">
          <div class="location-icon">${emoji}</div>
          <span class="location-name">${location}</span>
          <span class="location-count">${items.length} 个心愿</span>
        </div>
        <div class="location-items">
          ${items.map(item => `
            <div class="map-item ${item.status}" onclick="openDetail('${item.id}')">
              <span class="map-item-icon">${CATEGORY_EMOJI[item.category] || '🍴'}</span>
              <div class="map-item-info">
                <div class="map-item-name">${item.name}</div>
                ${item.note ? `<div class="map-item-note">${item.note}</div>` : ''}
              </div>
              <span class="status-tag ${item.status}">${item.status === 'completed' ? '✅' : '⬜'}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  content.innerHTML = html;
}

// ---- 初始化 ----
async function init() {
  try {
    // 先加载内置美食数据
    await loadBuiltinFoods();

    await openDB();
    bindEvents();
    renderList();
    renderBuiltinList();

    // iOS 检测 - 显示安装提示
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone;
    if (isIOS && !isStandalone) {
      const banner = document.getElementById('iosBanner');
      const dismissed = localStorage.getItem('iosBannerDismissed');
      if (!dismissed) {
        banner.classList.remove('hidden');
      }
    }

    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  } catch (err) {
    console.error('初始化失败:', err);
  }
}

document.addEventListener('DOMContentLoaded', init);
