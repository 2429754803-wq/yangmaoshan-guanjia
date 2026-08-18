/* ================= 工具函数 ================= */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmt(n) {
  return (Number(n) || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function money(n) {
  return "¥" + fmt(n);
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function isToday(ts) {
  const d = new Date(ts);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function timeStr(ts) {
  const d = new Date(ts);
  return `${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2200);
}

/** 防抖：搜索输入等高频事件用 */
function debounce(fn, ms = 250) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/** 列表项进场动画（交错淡入，提升观感但不卡顿） */
function staggerIn(container) {
  if (!container) return;
  const items = container.children;
  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    if (i > 30) break; // 大量数据只给前 30 个加动画，避免卡顿
    el.style.animation = `itemIn .3s var(--ease) ${Math.min(i * 0.025, 0.4)}s both`;
  }
}

function confirmModal(title, text) {
  return new Promise((resolve) => {
    const mask = $("#modal-mask");
    $("#modal-title").textContent = title;
    $("#modal-text").textContent = text;
    mask.classList.remove("hidden");
    const done = (v) => {
      mask.classList.add("hidden");
      $("#modal-ok").onclick = null;
      $("#modal-cancel").onclick = null;
      resolve(v);
    };
    $("#modal-ok").onclick = () => done(true);
    $("#modal-cancel").onclick = () => done(false);
  });
}

/** 图片分享预览弹层：长按保存 / 系统分享（iOS、微信内都可用） */
function showImagePreview(url, filename, title, tip, blob) {
  const mask = document.createElement("div");
  mask.className = "img-share-mask";
  const file = blob ? new File([blob], filename, { type: "image/png" }) : null;
  const shareBtn = (file && navigator.canShare && navigator.canShare({ files: [file] }))
    ? `<button class="btn primary" id="img-share-sys">📤 系统分享</button>` : "";
  mask.innerHTML = `
    <div class="img-share-box">
      <h3>${escapeHtml(title)}</h3>
      <img src="${url}" alt="分享图">
      <div class="img-share-hint">${tip || "👆 长按图片保存，到微信里发送"}</div>
      <div class="btn-row">
        ${shareBtn}
        <button class="btn img-share-close">完成</button>
      </div>
    </div>`;
  document.body.appendChild(mask);
  const sys = mask.querySelector("#img-share-sys");
  if (sys) sys.onclick = async () => { try { await navigator.share({ files: [file], title }); mask.remove(); } catch {} };
  const close = () => { mask.remove(); URL.revokeObjectURL(url); };
  mask.querySelector(".img-share-close").onclick = close;
  mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
}

/** 生成图片后统一处理：转 blob → 预览弹层（长按保存/系统分享） */
async function finishShareImage(canvas, filename, title, tip) {
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return toast("图片生成失败");
  const url = URL.createObjectURL(blob);
  showImagePreview(url, filename, title, tip, blob);
}

/* ================= 状态 ================= */

let currentAccount = null;
let itemsCache = [];
let ordersCache = [];
let addrCache = [];
let stocktakeCache = [];
let purchaseCache = [];
let salesCache = [];
let customersCache = [];
let factoriesCache = [];
let outsourcesCache = [];
let osFilter = "all";
let editingFactoryId = null;

let itemFilter = "all";
let itemSearch = "";
let orderFilter = "today";  // today=今日 history=历史 all=全部 pending=未完成 done=已完成 unship=待发货 debt=有欠款 custom=定制单
let orderSort = "time";     // time=按时间 amount=按金额
let orderType = "stock";   // stock=现货单 custom=定制单
let editingItemId = null;
let editingOrderId = null;
let editingImages = [];
let editingColors = [];
let editingLines = [];
let stocktakeDraft = {};   // {itemId: {colorName: actualQty}}
let stocktakeOnlyStocked = false;
let batchSelected = new Set();
let isDark = false;
let currentView = "today";

/* ================= 视图导航 ================= */

const VIEW_TITLES = {
  today: "今日概览", items: "款式库存", sales: "销售", orders: "订单", stats: "统计",
  settings: "设置", "item-edit": "编辑款式", "item-detail": "款式详情", "order-edit": "订单",
  stocktake: "盘点", "stocktake-history": "盘点记录", purchase: "送货入库", "batch-price": "批量改价",
  debt: "客户欠款", customers: "客户", "customer-detail": "客户详情", "customer-edit": "编辑客户",
  "quick-order": "快速开单", import: "批量导入",
  outsource: "外发加工", "outsource-edit": "下外发单", "outsource-detail": "外发单详情",
  factories: "加工厂管理", "factory-edit": "编辑加工厂", trends: "爆款推荐",
  addrbook: "地址簿", "addr-edit": "编辑地址",
  report: "经营报表 · 周报/月报"
};

const TAB_VIEWS = ["today", "items", "customers", "orders", "settings"];

function showView(name) {
  currentView = name;
  $$(".view").forEach((v) => v.classList.remove("active"));
  const target = $("#view-" + name);
  if (target) target.classList.add("active");
  $("#page-title").textContent = VIEW_TITLES[name] || "款式库存";
  const sub = $("#header-sub");
  if (sub) {
    const map = {
      today: "今日销售 · 欠款 · 快捷入口",
      items: "款式 · 颜色 · 库存 · 图片",
      "item-edit": "填写款式信息",
      "item-detail": "款式详情与操作",
      sales: "记录销售 · 自动扣库存",
      orders: "客户订单 · 配送 · 收款",
      "order-edit": "创建客户订单",
      stats: "销量 · 利润 · 库存统计",
      stocktake: "账面 vs 实际 · 自动修正",
      "stocktake-history": "历史盘点差异",
      purchase: "加工商送货入库 · 记录工费",
      "batch-price": "多款式统一调价",
      debt: "客户欠款 · 收款管理",
      customers: "网店客户 · 档案 · 历史订单",
      "customer-detail": "客户档案与订单",
      "customer-edit": "编辑客户信息",
      "quick-order": "选客户 → 加商品 → 保存",
      import: "粘贴订单 → 一键导入",
      outsource: "外发单 · 领料 · 回货 · 结算",
      "outsource-edit": "下外发单给加工厂",
      "outsource-detail": "外发单详情与操作",
      factories: "加工厂档案 · 工费标准",
      "factory-edit": "编辑加工厂",
      trends: "畅销款分析 · 行业风向",
      addrbook: "常用地址管理",
      report: "周报/月报 · 经营分析与整改建议",
      settings: "警告线 · 同步 · 备份 · 账号"
    };
    sub.textContent = map[name] || "羊毛衫 · 库存订单管理";
  }
  const headerBtn = $("#header-btn");
  if (name === "items") {
    headerBtn.textContent = "＋ 新增";
    headerBtn.classList.remove("hidden");
  } else if (name === "orders") {
    headerBtn.textContent = "＋ 新订单";
    headerBtn.classList.remove("hidden");
  } else if (name === "customers") {
    headerBtn.textContent = "＋ 新客户";
    headerBtn.classList.remove("hidden");
  } else if (name === "factories") {
    headerBtn.textContent = "＋ 新加工厂";
    headerBtn.classList.remove("hidden");
  } else {
    headerBtn.classList.add("hidden");
  }
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
}

function showMain() {
  $("#view-auth").classList.add("hidden");
  $("#view-main").classList.remove("hidden");
}

/* ================= 主题 ================= */

function applyTheme(dark) {
  isDark = dark;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  $("#theme-toggle").textContent = dark ? "☀️" : "🌙";
  const mt = $("#meta-theme");
  if (mt) mt.content = dark ? "#1c1917" : "#b91c2e";
  try { localStorage.setItem("knit-theme", dark ? "dark" : "light"); } catch {}
}

/* ================= 字体大小 ================= */

const FONT_SIZES = { s: "13px", m: "15px", l: "17px", xl: "19px" };

function applyFontSize(size) {
  const px = FONT_SIZES[size] || FONT_SIZES.m;
  // 修改 --fs 变量：CSS 里所有字号都基于它派生，改一处全局生效
  document.documentElement.style.setProperty("--fs", px);
  document.body.style.fontSize = px;
  try { localStorage.setItem("knit-fontsize", size); } catch {}
  $$(".fontsize-chip").forEach((c) => c.classList.toggle("active", c.dataset.size === size));
}

function initFontSize() {
  let size = "m";
  try { size = localStorage.getItem("knit-fontsize") || "m"; } catch {}
  applyFontSize(size);
  $$(".fontsize-chip").forEach((c) => {
    c.onclick = () => applyFontSize(c.dataset.size);
  });
}

/* ================= 数据刷新 ================= */

let _autoUploadTimer = null;

/** 数据变更后自动上传到云端（防抖 2 秒），实现多设备实时同步 */
function scheduleAutoUpload() {
  if (!currentAccount) return;
  clearTimeout(_autoUploadTimer);
  _autoUploadTimer = setTimeout(async () => {
    try {
      if (await Sync.isConfigured()) {
        await Sync.upload();
      }
    } catch (e) {
      // 上传失败静默（下次变更再试）
    }
  }, 2000);
}

async function reloadAll() {
  const [items, orders, addrs, stocktakes, purchases, sales, customers, factories, outsources] = await Promise.all([
    Store.listItems(), Store.listOrders(), Store.listAddrs(),
    Store.listStocktakes(), Store.listPurchases(), Store.listSales(),
    Store.listCustomers(), Store.listFactories(), Store.listOutsources(),
    Store.refreshGlobalLowStock()
  ]);
  itemsCache = items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  ordersCache = orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  addrCache = addrs;
  stocktakeCache = stocktakes.sort((a, b) => (b.time || 0) - (a.time || 0));
  purchaseCache = purchases.sort((a, b) => (b.time || 0) - (a.time || 0));
  salesCache = sales;
  customersCache = customers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  factoriesCache = factories.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  outsourcesCache = outsources.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // 数据变更后自动上传（登录初始加载不触发）
  if (currentAccount && !window.__initialLoad) {
    scheduleAutoUpload();
  }
}

/* ================= 今日概览 ================= */

function orderTotal(o) {
  return (o.lines || []).reduce((s, l) => s + (l.qty * l.price), 0);
}

function orderDebt(o) {
  const total = orderTotal(o);
  const paid = o.paidAmount || 0;
  return Math.max(0, total - paid);
}

/** 时间显示：今天/明天 + 实时时钟 */
function updateClock() {
  const el = $("#today-date-text");
  const te = $("#today-time-text");
  if (!el) return;
  const d = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  el.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week}`;
  if (te) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    te.textContent = `${hh}:${mm}:${ss}`;
  }
}

let _clockTimer = null;
function startClock() {
  if (_clockTimer) clearInterval(_clockTimer);
  updateClock();
  _clockTimer = setInterval(updateClock, 1000);
}

function renderToday() {
  updateClock();
  const now = Date.now();
  let todaySales = 0, todayProfit = 0, todayOrders = 0;
  // 今日销售额/利润（来自销售记录）
  for (const s of salesCache) {
    if (isToday(s.time)) {
      todaySales += s.qty * s.price;
      todayProfit += (s.profit || 0);
    }
  }
  // 今日新订单数（今日创建的订单）
  for (const o of ordersCache) {
    if (isToday(o.createdAt) && o.status !== "cancelled") {
      todayOrders++;
    }
  }
  // 未收款合计 = 所有未结清订单（不只今日）
  let totalDebt = 0;
  for (const o of ordersCache) {
    if (o.status === "cancelled") continue;
    totalDebt += orderDebt(o);
  }
  // 赊账销售未收款
  for (const s of salesCache) {
    if (s.onCredit) totalDebt += s.qty * s.price;
  }
  $("#today-sales").textContent = fmt(todaySales);
  $("#today-profit").textContent = fmt(todayProfit);
  $("#today-orders").textContent = todayOrders;
  $("#today-debt").textContent = fmt(totalDebt);
  renderTodayReminders();
}

/** 今日概览：交期/逾期/低库存提醒 */
function renderTodayReminders() {
  const box = $("#today-reminders");
  if (!box) return;
  const now = Date.now();
  const todayStrFull = todayStr();
  const reminders = [];
  // 0. 周报/月报入口
  reminders.push({ icon: "📊", text: "查看本周经营周报（含整改建议）", go: "report-week" });
  reminders.push({ icon: "📅", text: "查看本月经营月报（含整改建议）", go: "report-month" });
  // 1. 定制单今天要交货
  const dueOrders = ordersCache.filter((o) =>
    o.type === "custom" && o.status === "pending" && o.due && o.due === todayStrFull
  );
  if (dueOrders.length) reminders.push({ icon: "📦", text: `今天有 ${dueOrders.length} 个定制单要交货`, go: "orders" });
  // 2. 逾期定制单（过了交期还没完成）
  const overdueOrders = ordersCache.filter((o) =>
    o.type === "custom" && o.status === "pending" && o.due && now > new Date(o.due + "T23:59:59").getTime()
  );
  if (overdueOrders.length) reminders.push({ icon: "⏰", text: `${overdueOrders.length} 个定制单已逾期`, go: "orders" });
  // 3. 逾期外发单
  const overdueOs = outsourcesCache.filter((o) =>
    o.status !== "done" && o.status !== "cancelled" && o.due && now > new Date(o.due + "T23:59:59").getTime()
  );
  if (overdueOs.length) reminders.push({ icon: "🏭", text: `${overdueOs.length} 个外发单已逾期`, go: "outsource" });
  // 4. 低库存款式
  const lowItems = itemsCache.filter((it) => Store.isItemLowStock(it));
  if (lowItems.length) reminders.push({ icon: "⚠️", text: `${lowItems.length} 个款式库存不足`, go: "items" });
  // 5. 欠款提醒
  const totalDebt = ordersCache.reduce((s, o) => s + (o.status === "cancelled" ? 0 : orderDebt(o)), 0);
  if (totalDebt > 0) reminders.push({ icon: "💰", text: `客户欠款合计 ${money(totalDebt)}`, go: "debt" });

  if (!reminders.length) {
    box.innerHTML = `<div class="today-ok">✅ 今日无待办，一切正常</div>`;
    return;
  }
  box.innerHTML = reminders.map((r, i) => `
    <div class="today-remind" data-go="${r.go}" style="animation-delay:${i * 0.05}s">
      <span class="tr-icon">${r.icon}</span>
      <span class="tr-text">${r.text}</span>
      <span class="tr-arrow">›</span>
    </div>`).join("");
  $$("#today-reminders .today-remind").forEach((el) => {
    el.onclick = () => {
      const go = el.dataset.go;
      if (go === "outsource") { renderOutsources(); showView("outsource"); }
      else if (go === "debt") { renderDebt(); showView("debt"); }
      else if (go === "report-week") openReport("week");
      else if (go === "report-month") openReport("month");
      else { const tab = $(`.tab[data-view=${go}]`); if (tab) tab.click(); }
    };
  });
}

/* ================= 经营报表（周报/月报） ================= */

let reportPeriod = "week";

function openReport(period) {
  reportPeriod = period;
  $("#rp-week").classList.toggle("active", period === "week");
  $("#rp-month").classList.toggle("active", period === "month");
  renderReport();
  showView("report");
}

function renderReport() {
  const days = reportPeriod === "week" ? 7 : 30;
  const from = Date.now() - days * 86400000;
  const label = reportPeriod === "week" ? "本周" : "本月";
  const el = $("#report-content");
  if (!el) return;
  // 销售统计
  let salesQty = 0, salesAmt = 0, salesProfit = 0;
  const itemSold = {};
  for (const s of salesCache) {
    if (s.time >= from) {
      salesQty += s.qty;
      salesAmt += s.qty * s.price;
      salesProfit += (s.profit || 0);
      const key = s.itemId || s.itemName;
      itemSold[key] = (itemSold[key] || 0) + s.qty;
    }
  }
  const periodOrders = ordersCache.filter((o) => o.createdAt >= from && o.status !== "cancelled");
  const orderAmt = periodOrders.reduce((s, o) => s + orderTotal(o), 0);
  const orderDebtAmt = periodOrders.reduce((s, o) => s + orderDebt(o), 0);
  // 畅销 Top3
  const top = Object.entries(itemSold).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([key, qty]) => {
      const it = itemsCache.find((x) => x.id === key || x.name === key);
      return it ? { name: it.name, qty } : { name: key, qty };
    });
  // 低库存 / 积压
  const lowItems = itemsCache.filter((it) => Store.isItemLowStock(it));
  const soldKeys = new Set(Object.keys(itemSold));
  const slowItems = itemsCache.filter((it) => {
    const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
    return totalStock > 0 && !soldKeys.has(it.id);
  });
  const overdueOrders = ordersCache.filter((o) =>
    o.type === "custom" && o.status === "pending" && o.due && Date.now() > new Date(o.due + "T23:59:59").getTime()
  );
  const overdueOs = outsourcesCache.filter((o) =>
    o.status !== "done" && o.status !== "cancelled" && o.due && Date.now() > new Date(o.due + "T23:59:59").getTime()
  );
  // 整改建议
  const tips = [];
  if (overdueOrders.length) tips.push(`⏰ 有 ${overdueOrders.length} 个定制单已逾期，尽快联系客户确认交期并安排生产。`);
  if (overdueOs.length) tips.push(`🏭 有 ${overdueOs.length} 个外发单已逾期，及时催促加工厂回货。`);
  if (lowItems.length) tips.push(`⚠️ ${lowItems.length} 个款式库存低于警告线，建议尽快安排补货或下外发单。`);
  if (slowItems.length) tips.push(`🐌 ${slowItems.length} 个款式${label}无销量但仍有库存，建议促销或主动联系客户消化。`);
  if (orderDebtAmt > 0) tips.push(`💰 ${label}新订单欠款合计 ${money(orderDebtAmt)}，建议按欠款清单安排催收。`);
  if (salesAmt === 0) tips.push(`📉 ${label}暂无销售记录，建议主动联系老客户或加大推广。`);
  if (!tips.length) tips.push("✅ 经营状况良好，暂无需要整改的事项。");
  el.innerHTML = `
    <div class="card">
      <h3>${label}经营概览</h3>
      <div class="stats-summary" style="margin-top:10px">
        <div class="stat-card"><div class="stat-num">${fmt(salesAmt)}</div><div class="stat-lbl">${label}销售额</div></div>
        <div class="stat-card"><div class="stat-num">${fmt(salesProfit)}</div><div class="stat-lbl">${label}利润</div></div>
        <div class="stat-card"><div class="stat-num">${periodOrders.length}</div><div class="stat-lbl">${label}新订单</div></div>
        <div class="stat-card"><div class="stat-num">${fmt(orderAmt)}</div><div class="stat-lbl">订单金额</div></div>
      </div>
      <div class="detail-color-row"><span>销售件数</span><span class="v">${salesQty} 件</span></div>
      <div class="detail-color-row"><span>${label}新订单欠款</span><span class="v">${money(orderDebtAmt)}</span></div>
    </div>
    <div class="card">
      <h3>🔥 ${label}畅销款</h3>
      ${top.length ? top.map((t, i) => `<div class="detail-color-row"><span>${i + 1}. ${escapeHtml(t.name)}</span><span class="v">${t.qty} 件</span></div>`).join("") : '<div class="hint">暂无销售数据</div>'}
    </div>
    <div class="card">
      <h3>🛠 整改建议</h3>
      ${tips.map((t) => `<div class="tip-line">${t}</div>`).join("")}
    </div>`;
}

/* ================= 款式列表页 ================= */

function filteredItems() {
  let list = itemsCache;
  if (itemSearch) {
    const q = itemSearch.toLowerCase();
    list = list.filter((it) =>
      it.name.toLowerCase().includes(q) ||
      (it.colors || []).some((c) => c.name.toLowerCase().includes(q))
    );
  }
  if (itemFilter === "low") list = list.filter((it) => Store.isItemLowStock(it));
  if (itemFilter === "out") list = list.filter((it) => (it.colors || []).some((c) => c.stock === 0));
  return list;
}

function renderItems() {
  const list = filteredItems();
  const el = $("#item-list");
  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">' + (itemsCache.length ? "🔍" : "🧥") + "</span>" + (itemsCache.length ? "没有匹配的款式<br>换个关键词试试" : "还没有款式<br>点右上角 ＋ 新增第一个款式") + "</div>";
    return;
  }
  el.innerHTML = list.map((it) => {
    const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
    const totalSold = (it.colors || []).reduce((s, c) => s + (c.sold || 0), 0);
    const low = Store.isItemLowStock(it);
    const img = (it.images && it.images[0]) ? `<img src="${it.images[0]}" alt="" loading="lazy" decoding="async">` : "🧥";
    const colors = (it.colors || []).map((c) => {
      const isLow = Store.isLowStock(it, c.name);
      const cls = c.stock === 0 ? "red low-blink" : isLow ? "red low-blink" : "green";
      return `<span class="tag ${cls}">${escapeHtml(c.name)} ${c.stock}</span>`;
    }).join("");
    const sideNumCls = low ? "num low-blink" : "num";
    return `
      <div class="list-card" data-id="${it.id}">
        <div class="thumb">${img}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(it.name)}</div>
          <div class="list-sub">售价 ${money(it.price)} · 成本 ${money(it.cost)}</div>
          <div class="list-tags">${colors}</div>
        </div>
        <div class="list-side">
          <div class="${sideNumCls}">${totalStock}</div>
          <div class="lbl">库存 · 已售 ${totalSold}</div>
        </div>
      </div>`;
  }).join("");
  $$("#item-list .list-card").forEach((card) => {
    card.onclick = () => openDetail(card.dataset.id);
  });
  staggerIn($("#item-list"));
}

/* ================= 款式编辑 ================= */

function renderColorEditor() {
  const el = $("#ie-colors");
  el.innerHTML = editingColors.map((c, i) => `
    <div class="color-row">
      <input class="input c-name" data-i="${i}" placeholder="颜色（如：红色）" value="${escapeHtml(c.name)}">
      <div class="unit-wrap"><input class="input c-qty" data-i="${i}" type="number" inputmode="numeric" min="0" placeholder="库存" value="${c.stock}"><span class="unit">件</span></div>
      <button class="rm" data-i="${i}">✕</button>
    </div>`).join("");
  $$("#ie-colors .c-name").forEach((inp) => {
    inp.oninput = () => { editingColors[Number(inp.dataset.i)].name = inp.value; };
  });
  $$("#ie-colors .c-qty").forEach((inp) => {
    inp.oninput = () => {
      // 去前导0：如 030 -> 30
      const v = inp.value;
      if (v.length > 1 && v.startsWith("0") && !v.startsWith("0.")) {
        inp.value = String(Number(v));
      }
      editingColors[Number(inp.dataset.i)].stock = Number(inp.value) || 0;
    };
  });
  $$("#ie-colors .rm").forEach((btn) => {
    btn.onclick = () => { editingColors.splice(Number(btn.dataset.i), 1); renderColorEditor(); };
  });
}

function renderImageThumbs() {
  const el = $("#ie-images");
  el.innerHTML = editingImages.map((src, i) => `
    <div class="img-thumb"><img src="${src}"><button class="rm" data-i="${i}">✕</button></div>`).join("");
  $$("#ie-images .rm").forEach((btn) => {
    btn.onclick = () => { editingImages.splice(Number(btn.dataset.i), 1); renderImageThumbs(); };
  });
}

function openItemEdit(id) {
  editingItemId = id || null;
  const it = id ? itemsCache.find((x) => x.id === id) : null;
  $("#ie-name").value = it ? it.name : "";
  $("#ie-price").value = it ? it.price : "";
  $("#ie-cost").value = it ? it.cost : "";
  $("#ie-lowstock").value = it && it.lowStock !== undefined && it.lowStock !== null ? it.lowStock : "";
  editingImages = it ? (it.images || []).slice() : [];
  editingColors = it ? (it.colors || []).map((c) => ({ name: c.name, stock: c.stock })) : [];
  renderImageThumbs();
  renderColorEditor();
  showView("item-edit");
}

async function saveItemEdit() {
  const name = $("#ie-name").value.trim();
  const price = Number($("#ie-price").value);
  const cost = Number($("#ie-cost").value);
  const lowStockRaw = $("#ie-lowstock").value.trim();
  if (!name) return toast("请填写款式名称");
  if (!(price >= 0)) return toast("请填写售价");
  if (!(cost >= 0)) return toast("请填写成本");
  if (!editingColors.length) return toast("请至少添加一个颜色");
  const lowStock = lowStockRaw === "" ? null : Number(lowStockRaw);
  const existing = editingItemId ? itemsCache.find((x) => x.id === editingItemId) : null;
  const item = {
    id: editingItemId || undefined,
    name,
    price,
    cost,
    lowStock,
    images: editingImages,
    colors: editingColors.map((c) => {
      const old = existing ? (existing.colors || []).find((oc) => oc.name === c.name) : null;
      return { name: c.name, stock: c.stock, sold: old ? old.sold || 0 : 0 };
    }),
    createdAt: existing ? existing.createdAt : undefined
  };
  await Store.saveItem(item);
  toast("已保存");
  await reloadAll();
  renderItems();
  showView("items");
}

/* ================= 款式详情 ================= */

async function openDetail(id) {
  const it = itemsCache.find((x) => x.id === id);
  if (!it) return;
  const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
  const totalSold = (it.colors || []).reduce((s, c) => s + (c.sold || 0), 0);
  const profit = ((it.price || 0) - (it.cost || 0)) * totalSold;
  const imgs = (it.images || []).length
    ? `<div class="detail-imgs">${it.images.map((s) => `<div class="img-thumb"><img src="${s}"></div>`).join("")}</div>`
    : '<div class="empty" style="padding:16px">暂无图片</div>';
  const colorRows = (it.colors || []).map((c) => {
    const isLow = Store.isLowStock(it, c.name);
    return `<div class="detail-color-row">
      <span>${escapeHtml(c.name)} ${isLow ? "⚠️" : ""}</span>
      <span class="v">库存 ${c.stock} · 已售 ${c.sold || 0}</span>
    </div>`;
  }).join("");
  // 该款入库记录
  const purs = purchaseCache.filter((p) => p.itemId === id).slice(0, 5);
  const purHtml = purs.length
    ? `<div class="card"><h3>最近入库</h3>${purs.map((p) =>
        `<div class="detail-color-row"><span>${escapeHtml(p.color || "")} ${p.qty}件${p.supplier ? " · " + escapeHtml(p.supplier) : ""}</span><span class="v">${p.unitPrice ? money(p.unitPrice) + "/件" : ""} · ${timeStr(p.time)}</span></div>`).join("")}</div>`
    : "";
  $("#detail-body").innerHTML = `
    ${imgs}
    <div class="card">
      <h3>${escapeHtml(it.name)}</h3>
      <div class="detail-color-row"><span>售价</span><span class="v">${money(it.price)}</span></div>
      <div class="detail-color-row"><span>成本</span><span class="v">${money(it.cost)}</span></div>
      <div class="detail-color-row"><span>单件利润</span><span class="v">${money((it.price||0)-(it.cost||0))}</span></div>
      <div class="detail-color-row"><span>总库存</span><span class="v">${totalStock} 件</span></div>
      <div class="detail-color-row"><span>累计已售</span><span class="v">${totalSold} 件</span></div>
      <div class="detail-color-row"><span>累计利润</span><span class="v">${money(profit)}</span></div>
    </div>
    <div class="card">
      <h3>颜色库存</h3>
      ${colorRows || '<div class="hint">未添加颜色</div>'}
    </div>
    ${purHtml}
    <div class="card">
      <h3>款式二维码</h3>
      <div class="qr-row">
        <div id="detail-qr"></div>
        <div class="hint">扫码可快速定位该款式（打印贴在本子上）。</div>
      </div>
    </div>
    <div class="card detail-actions">
      <button class="btn primary" id="detail-edit">编辑款式</button>
      <button class="btn" id="detail-sell">记一笔销售</button>
      <button class="btn" id="detail-purchase">📥 送货入库</button>
      <button class="btn" id="detail-share">💬 分享给微信好友</button>
      <button class="btn" id="detail-ninegrid">📱 生成朋友圈九宫格</button>
      <button class="btn danger" id="detail-delete">删除款式</button>
    </div>`;
  $("#detail-edit").onclick = () => openItemEdit(id);
  $("#detail-sell").onclick = () => openSaleForItem(id);
  $("#detail-purchase").onclick = () => openPurchaseForItem(id);
  $("#detail-share").onclick = () => shareItemCard(it);
  $("#detail-ninegrid").onclick = () => generateNineGrid(it);
  $("#detail-delete").onclick = async () => {
    if (await confirmModal("删除款式", `确定删除「${it.name}」吗？销售记录会保留，但款式信息将丢失。`)) {
      await Store.deleteItem(id);
      toast("已删除");
      await reloadAll();
      renderItems();
      showView("items");
    }
  };
  // 二维码
  const qrBox = $("#detail-qr");
  qrBox.innerHTML = "";
  if (typeof QRCode !== "undefined") {
    new QRCode(qrBox, { text: "KNIT-STOCK:" + it.id, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
  } else {
    qrBox.innerHTML = '<div class="hint">二维码组件不可用</div>';
  }
  showView("item-detail");
}

/* ================= 分享款式卡片 ================= */

async function shareItemCard(it) {
  try {
    const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
    const W = 800, H = 1000;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    // 背景渐变
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#8f1122");
    g.addColorStop(0.6, "#b91c2e");
    g.addColorStop(1, "#7f1020");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 顶部标题
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🧥 " + it.name, W / 2, 80);
    // 图片
    const img = new Image();
    await new Promise((resolve) => {
      if (it.images && it.images[0]) {
        img.onload = resolve;
        img.onerror = resolve;
        img.src = it.images[0];
      } else resolve();
    });
    if (img.width) {
      const iw = W - 80, ih = 460;
      const ratio = Math.min(iw / img.width, ih / img.height);
      const dw = img.width * ratio, dh = img.height * ratio;
      ctx.drawImage(img, (W - dw) / 2, 130, dw, dh);
    } else {
      ctx.fillStyle = "rgba(255,255,255,.2)";
      ctx.fillRect(40, 130, W - 80, 460);
      ctx.fillStyle = "#fff";
      ctx.font = "90px sans-serif";
      ctx.fillText("🧥", W / 2, 400);
    }
    // 价格行
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px sans-serif";
    ctx.fillText("¥" + fmt(it.price), W / 2, 660);
    ctx.font = "28px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillText("库存 " + totalStock + " 件 · 成本 ¥" + fmt(it.cost), W / 2, 710);
    // 颜色标签
    const colors = (it.colors || []).map((c) => `${c.name} ${c.stock}`).join("  ·  ");
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.font = "26px sans-serif";
    ctx.fillText(colors || "暂无颜色", W / 2, 770);
    // 底部
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.font = "24px sans-serif";
    ctx.fillText("羊毛衫管家", W / 2, 940);
    // 转 blob
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const file = new File([blob], it.name + ".png", { type: "image/png" });
    // 尝试 Web Share API（带文件）
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: it.name });
      return;
    }
    // 降级：下载
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = it.name + ".png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast("卡片已保存，去微信长按图片转发给好友");
  } catch (e) {
    toast("分享失败：" + (e.message || "未知错误"));
  }
}

/** 生成朋友圈九宫格：9 张不同设计的卡片图 */
async function generateNineGrid(it) {
  try {
    const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
    const W = 800, H = 800; // 方形，适合朋友圈
    const styles = [
      { bg: ["#8f1122", "#c2253a"], title: it.name, accent: "火爆热销" },
      { bg: ["#1e3a5f", "#2d5a8a"], title: it.name, accent: "现货速发" },
      { bg: ["#3d2a1d", "#6b4a2e"], title: it.name, accent: "品质精选" },
      { bg: ["#0f3d2e", "#1d6b50"], title: it.name, accent: "工厂直供" },
      { bg: ["#5b1e3a", "#8a2d58"], title: it.name, accent: "新款上市" },
      { bg: ["#2e2e2e", "#4d4d4d"], title: it.name, accent: "经典百搭" },
      { bg: ["#7a5a10", "#a87f1d"], title: it.name, accent: "秋冬推荐" },
      { bg: ["#10263f", "#1e4a75"], title: it.name, accent: "保暖首选" },
      { bg: ["#6e1120", "#a4162a"], title: it.name, accent: "限时优惠" }
    ];
    // 预加载主图
    const img = new Image();
    await new Promise((resolve) => {
      if (it.images && it.images[0]) {
        img.onload = resolve;
        img.onerror = resolve;
        img.src = it.images[0];
      } else resolve();
    });

    const blobs = [];
    for (let i = 0; i < styles.length; i++) {
      const s = styles[i];
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, s.bg[0]);
      g.addColorStop(1, s.bg[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // 装饰圆环
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      ctx.lineWidth = 2;
      for (let r = 120; r < 500; r += 60) {
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 顶部标签
      ctx.fillStyle = "#fde8b0";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.accent, W / 2, 55);
      // 标题
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 40px sans-serif";
      ctx.fillText(it.name, W / 2, 100);
      // 图片
      if (img.width) {
        const iw = W - 100, ih = 420;
        const ratio = Math.min(iw / img.width, ih / img.height);
        const dw = img.width * ratio, dh = img.height * ratio;
        ctx.drawImage(img, (W - dw) / 2, 140, dw, dh);
      } else {
        ctx.fillStyle = "rgba(255,255,255,.15)";
        ctx.fillRect(50, 140, W - 100, 420);
        ctx.fillStyle = "#fff";
        ctx.font = "100px sans-serif";
        ctx.fillText("🧥", W / 2, 380);
      }
      // 价格
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 60px sans-serif";
      ctx.fillText("¥" + fmt(it.price), W / 2, 630);
      // 颜色
      ctx.font = "26px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,.85)";
      const colors = (it.colors || []).map((c) => `${c.name} ${c.stock}`).join("  ·  ");
      ctx.fillText(colors || "多色可选", W / 2, 680);
      // 底部
      ctx.fillStyle = "rgba(255,255,255,.6)";
      ctx.font = "20px sans-serif";
      ctx.fillText("羊毛衫管家 · 库存 " + totalStock + " 件", W / 2, 750);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      blobs.push(blob);
    }
    // 尝试分享多图（微信支持多图分享）
    const files = blobs.map((b, i) => new File([b], `九宫格-${it.name}-${i + 1}.png`, { type: "image/png" }));
    if (navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: it.name + " 九宫格" });
      return;
    }
    // 降级：逐张保存到相册（浏览器自动下载 9 张）
    for (let i = 0; i < blobs.length; i++) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blobs[i]);
      a.download = `九宫格-${it.name}-${i + 1}.png`;
      // 逐个触发下载，间隔避免被拦截
      setTimeout(() => a.click(), i * 300);
      setTimeout(() => URL.revokeObjectURL(a.href), 5000 + i * 300);
    }
    toast("已生成 9 张卡片（自动保存），发朋友圈时按顺序选 9 张即可");
  } catch (e) {
    toast("生成失败：" + (e.message || "未知错误"));
  }
}

/* ================= 销售 ================= */

async function renderSaleSelects(selectedItemId) {
  const selItem = $("#sale-item");
  selItem.innerHTML = itemsCache.map((it) => {
    const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
    return `<option value="${it.id}">${escapeHtml(it.name)}（库存 ${totalStock}）</option>`;
  }).join("");
  if (selectedItemId) selItem.value = selectedItemId;
  updateSaleColor();
  const it = itemsCache.find((x) => x.id === selItem.value);
  if (it) $("#sale-price").value = it.price || "";
}

function updateSaleColor() {
  const it = itemsCache.find((x) => x.id === $("#sale-item").value);
  const selColor = $("#sale-color");
  selColor.innerHTML = (it && it.colors ? it.colors : []).map((c) =>
    `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}（库存 ${c.stock}）</option>`).join("");
}

function openSaleForItem(id) {
  showView("sales");
  renderSaleSelects(id);
}

async function confirmSale() {
  const it = itemsCache.find((x) => x.id === $("#sale-item").value);
  if (!it) return toast("请选择款式");
  const colorName = $("#sale-color").value;
  const qty = Number($("#sale-qty").value);
  const price = Number($("#sale-price").value);
  const customer = $("#sale-customer").value.trim();
  const onCredit = $("#sale-on-credit").checked;
  if (!colorName) return toast("该款式还没有颜色，请先编辑添加");
  if (!(qty >= 1)) return toast("请填写正确的销售数量");
  if (!(price >= 0)) return toast("请填写售价");
  const color = (it.colors || []).find((c) => c.name === colorName);
  if (!color) return toast("颜色不存在");
  if (color.stock < qty) return toast(`库存不足（当前 ${color.stock} 件）`);
  color.stock -= qty;
  color.sold = (color.sold || 0) + qty;
  await Store.saveItem(it);
  await Store.addSale({
    itemId: it.id, itemName: it.name, color: colorName, qty, price, customer,
    profit: (price - (it.cost || 0)) * qty,
    onCredit: onCredit || false
  });
  toast(`已销售 ${qty} 件${onCredit ? "（赊账）" : ""}`);
  $("#sale-qty").value = "1";
  $("#sale-customer").value = "";
  $("#sale-on-credit").checked = false;
  await reloadAll();
  renderItems();
  renderSaleSelects();
  renderToday();
}

/* ================= 客户管理 ================= */

let customerSearch = "";
let editingCustomerId = null;

function renderCustomers() {
  const q = customerSearch.toLowerCase();
  const list = customersCache.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || (c.phone || "").includes(q)
  );
  const el = $("#customer-list");
  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">👥</span>' + (customersCache.length ? "没有匹配的客户" : "还没有客户<br>点右上角 ＋ 新客户，或从订单/快速开单中自动创建") + "</div>";
    return;
  }
  el.innerHTML = list.map((c) => {
    // 统计该客户订单
    const cOrders = ordersCache.filter((o) => o.customer === c.name && o.status !== "cancelled");
    const total = cOrders.reduce((s, o) => s + orderTotal(o), 0);
    const count = cOrders.length;
    const debt = cOrders.reduce((s, o) => s + orderDebt(o), 0);
    return `
      <div class="list-card" data-id="${c.id}">
        <div class="list-main">
          <div class="list-title">${escapeHtml(c.name)}</div>
          <div class="list-sub">${escapeHtml(c.phone || "无电话")} · ${count} 单 · 累计 ${money(total)}${debt ? " · 欠 " + money(debt) : ""}</div>
        </div>
        <div class="list-side">
          <div class="num" style="${debt ? "color:var(--danger)" : ""}">${debt ? money(debt) : "✓"}</div>
          <div class="lbl">${debt ? "欠款" : "已结清"}</div>
        </div>
      </div>`;
  }).join("");
  $$("#customer-list .list-card").forEach((card) => {
    card.onclick = () => openCustomerDetail(card.dataset.id);
  });
  staggerIn($("#customer-list"));
}

async function openCustomerDetail(id) {
  const c = customersCache.find((x) => x.id === id);
  if (!c) return;
  const cOrders = ordersCache.filter((o) => o.customer === c.name && o.status !== "cancelled")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const total = cOrders.reduce((s, o) => s + orderTotal(o), 0);
  const debt = cOrders.reduce((s, o) => s + orderDebt(o), 0);
  const ordersHtml = cOrders.length ? cOrders.slice(0, 20).map((o) => {
    const lines = (o.lines || []).map((l) => `${l.qty}×${escapeHtml(l.itemName)}${l.color ? "(" + escapeHtml(l.color) + ")" : ""}`).join("、");
    return `<div class="list-card" data-oid="${o.id}">
      <div style="flex:1;min-width:0">
        <div class="order-head"><span class="order-customer">${timeStr(o.createdAt)}</span>
        <span class="order-status ${o.status}">${o.status === "done" ? "已完成" : o.status === "cancelled" ? "已取消" : "未完成"}</span></div>
        <div class="order-lines-preview">${lines} · ${money(orderTotal(o))}</div>
      </div>
    </div>`;
  }).join("") : '<div class="hint">暂无订单</div>';
  $("#customer-detail-body").innerHTML = `
    <div class="card">
      <h3>${escapeHtml(c.name)}</h3>
      <div class="detail-color-row"><span>电话</span><span class="v">${escapeHtml(c.phone || "—")}</span></div>
      <div class="detail-color-row"><span>地址</span><span class="v">${escapeHtml(c.address || "—")}</span></div>
      <div class="detail-color-row"><span>备注</span><span class="v">${escapeHtml(c.note || "—")}</span></div>
      <div class="detail-color-row"><span>累计订单</span><span class="v">${cOrders.length} 单 · ${money(total)}</span></div>
      <div class="detail-color-row"><span>当前欠款</span><span class="v" style="${debt ? "color:var(--danger)" : ""}">${debt ? money(debt) : "无"}</span></div>
    </div>
    <div class="card">
      <h3>历史订单</h3>
      ${ordersHtml}
    </div>
    <div class="card detail-actions">
      <button class="btn primary" id="cd-statement">🧾 生成月结对账单</button>
      <button class="btn primary" id="cd-quick-order">⚡ 给 TA 快速开单</button>
      <button class="btn" id="cd-edit">编辑客户</button>
      <button class="btn danger" id="cd-delete">删除客户</button>
    </div>`;
  $$("#customer-detail-body [data-oid]").forEach((el2) => {
    el2.onclick = () => openOrderDetail(el2.dataset.oid);
  });
  $("#cd-statement").onclick = () => generateCustomerStatement(c);
  $("#cd-quick-order").onclick = () => openQuickOrder(c.id);
  $("#cd-edit").onclick = () => openCustomerEdit(id);
  $("#cd-delete").onclick = async () => {
    if (await confirmModal("删除客户", "删除客户档案（历史订单保留），确定？")) {
      await Store.deleteCustomer(id);
      toast("已删除");
      await reloadAll();
      renderCustomers();
      showView("customers");
    }
  };
  showView("customer-detail");
}

/** 生成客户月结对账单图片（可分享微信） */
async function generateCustomerStatement(c) {
  try {
    const cOrders = ordersCache.filter((o) => o.customer === c.name && o.status !== "cancelled")
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!cOrders.length) return toast("该客户暂无订单");
    // 按月份分组
    const byMonth = {};
    for (const o of cOrders) {
      const d = new Date(o.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(o);
    }
    // 默认生成最近有订单的月份
    const months = Object.keys(byMonth).sort().reverse();
    let monthKey = months[0];
    // 如果有多个月份，弹窗选择
    if (months.length > 1) {
      const pick = prompt(`选择对账月份（${months.join(" / ")}）：`, months[0]);
      if (pick && byMonth[pick]) monthKey = pick;
    }
    const monthOrders = byMonth[monthKey];
    const total = monthOrders.reduce((s, o) => s + orderTotal(o), 0);
    const paid = monthOrders.reduce((s, o) => s + (o.paidAmount || 0), 0);
    const debt = monthOrders.reduce((s, o) => s + orderDebt(o), 0);

    // 绘制对账单图片
    const W = 750, H = 300 + monthOrders.length * 46 + 120;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    // 背景
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#faf7f3");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 顶部品牌条
    ctx.fillStyle = "#b91c2e";
    ctx.fillRect(0, 0, W, 90);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("羊毛衫管家 · 月结对账单", W / 2, 42);
    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#fde8b0";
    ctx.fillText(`${monthKey} · ${c.name}`, W / 2, 70);
    // 汇总
    ctx.textAlign = "left";
    ctx.fillStyle = "#1c1917";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(`本月合计：¥${fmt(total)}`, 40, 130);
    ctx.fillStyle = "#78716c";
    ctx.font = "16px sans-serif";
    ctx.fillText(`已收款：¥${fmt(paid)}    欠款：¥${fmt(debt)}`, 40, 158);
    // 表头
    ctx.fillStyle = "#f5f2ee";
    ctx.fillRect(40, 185, W - 80, 34);
    ctx.fillStyle = "#78716c";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText("日期", 50, 208);
    ctx.fillText("商品", 170, 208);
    ctx.fillText("金额", W - 160, 208);
    ctx.fillText("状态", W - 90, 208);
    // 明细
    ctx.font = "15px sans-serif";
    let y = 235;
    for (const o of monthOrders) {
      const d = new Date(o.createdAt);
      const dateStr = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const lines = (o.lines || []).map((l) => `${l.qty}×${l.itemName}${l.color ? "(" + l.color + ")" : ""}`).join("、");
      const amt = orderTotal(o);
      ctx.fillStyle = "#1c1917";
      ctx.fillText(dateStr, 50, y);
      ctx.fillText(lines.slice(0, 18), 170, y);
      ctx.fillText("¥" + fmt(amt), W - 175, y);
      ctx.fillStyle = o.payStatus === "paid" ? "#15803d" : "#b45309";
      ctx.fillText(o.payStatus === "paid" ? "已收" : "欠", W - 90, y);
      ctx.fillStyle = "#1c1917";
      y += 46;
      if (y > H - 60) break;
    }
    // 底部
    ctx.fillStyle = "#a8a29e";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`共计 ${monthOrders.length} 单 · 请核对后与我确认，谢谢！`, W / 2, H - 30);
    // 预览分享（长按保存/系统分享，iOS 与微信内通用）
    await finishShareImage(canvas, `对账单-${c.name}-${monthKey}.png`, `对账单 ${monthKey}`, "👆 长按图片保存，发微信给客户核对");
  } catch (e) {
    toast("生成失败：" + (e.message || "未知错误"));
  }
}

function openCustomerEdit(id) {
  editingCustomerId = id || null;
  const c = id ? customersCache.find((x) => x.id === id) : null;
  $("#ce-name").value = c ? c.name : "";
  $("#ce-phone").value = c ? c.phone || "" : "";
  $("#ce-address").value = c ? c.address || "" : "";
  $("#ce-note").value = c ? c.note || "" : "";
  showView("customer-edit");
}

async function saveCustomerEdit() {
  const name = $("#ce-name").value.trim();
  if (!name) return toast("请填写客户名称");
  const existing = editingCustomerId ? customersCache.find((x) => x.id === editingCustomerId) : null;
  const c = {
    id: editingCustomerId || undefined,
    name,
    phone: $("#ce-phone").value.trim(),
    address: $("#ce-address").value.trim(),
    note: $("#ce-note").value.trim(),
    createdAt: existing ? existing.createdAt : undefined
  };
  await Store.saveCustomer(c);
  toast("已保存");
  await reloadAll();
  renderCustomers();
  showView("customers");
}

/* ================= 外发加工（工厂） ================= */

function osStatus(o) {
  const now = Date.now();
  if (o.status === "done") return { label: "已回货", cls: "done" };
  if (o.status === "cancelled") return { label: "已取消", cls: "cancelled" };
  if (o.due && now > new Date(o.due).getTime()) return { label: "已逾期", cls: "pending" };
  return { label: "生产中", cls: "pending" };
}

function osReturned(o) {
  return (o.returns || []).reduce((s, r) => s + (r.qty || 0), 0);
}

function osRemaining(o) {
  return Math.max(0, (o.qty || 0) - osReturned(o));
}

function osCost(o) {
  return osReturned(o) * (o.price || 0);
}

function osFiltered() {
  let list = outsourcesCache;
  if (osFilter === "active") list = list.filter((o) => o.status !== "done" && o.status !== "cancelled");
  if (osFilter === "overdue") {
    const now = Date.now();
    list = list.filter((o) => o.status !== "done" && o.status !== "cancelled" && o.due && now > new Date(o.due).getTime());
  }
  if (osFilter === "settled") list = list.filter((o) => o.status !== "cancelled" && !o.settled);
  return list;
}

function renderOutsources() {
  const list = osFiltered();
  const el = $("#outsource-list");
  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">🏭</span>' + (outsourcesCache.length ? "没有匹配的外发单" : "还没有外发单<br>点下方 ＋ 下外发单，发给加工厂生产") + "</div>";
    return;
  }
  el.innerHTML = list.map((o) => {
    const st = osStatus(o);
    const it = itemsCache.find((x) => x.id === o.itemId);
    const fa = factoriesCache.find((f) => f.id === o.factoryId);
    const name = it ? it.name : o.itemName || "未知款";
    const returned = osReturned(o);
    const remaining = osRemaining(o);
    return `
      <div class="list-card" data-id="${o.id}">
        <div style="flex:1;min-width:0">
          <div class="order-head">
            <span class="order-customer">${escapeHtml(name)}${o.color ? "（" + escapeHtml(o.color) + "）" : ""}</span>
            <span class="order-status ${st.cls}">${st.label}</span>
          </div>
          <div class="order-lines-preview">🏭 ${escapeHtml(fa ? fa.name : "未知加工厂")} · 发出 ${o.qty} 件 · 工费 ${money(o.price)}/件</div>
          <div class="order-addr">📤 已回 ${returned} · 待回 ${remaining}${o.due ? " · 交期 " + o.due.slice(5) : ""}</div>
          <div class="order-addr">${o.settled ? "💰 已结算 " + money(osCost(o)) : "💰 未结算 · 工费 " + money(osCost(o))}</div>
        </div>
      </div>`;
  }).join("");
  $$("#outsource-list .list-card").forEach((card) => {
    card.onclick = () => openOutsourceDetail(card.dataset.id);
  });
  staggerIn($("#outsource-list"));
}

function openOutsourceEdit() {
  // 选工厂（自动带出默认工费）
  const selF = $("#os-factory");
  selF.innerHTML = '<option value="">— 选择加工厂 —</option>' + factoriesCache.map((f) =>
    `<option value="${f.id}">${escapeHtml(f.name)}${f.price ? "（" + money(f.price) + "/件）" : ""}</option>`).join("");
  // 选款式（自动带出）
  const selI = $("#os-item");
  selI.innerHTML = itemsCache.map((it) =>
    `<option value="${it.id}">${escapeHtml(it.name)}</option>`).join("");
  $("#os-color").value = "";
  $("#os-qty").value = "100";
  $("#os-price").value = "";
  $("#os-material").value = "";
  $("#os-due").value = "";
  $("#os-note").value = "";
  showView("outsource-edit");
}

async function saveOutsource() {
  const factoryId = $("#os-factory").value;
  const itemId = $("#os-item").value;
  const color = $("#os-color").value.trim();
  const qty = Number($("#os-qty").value);
  const price = Number($("#os-price").value);
  const material = $("#os-material").value.trim();
  const due = $("#os-due").value;
  const note = $("#os-note").value.trim();
  if (!factoryId) return toast("请选择加工厂");
  if (!itemId) return toast("请选择款式");
  if (!(qty >= 1)) return toast("请填写发出数量");
  if (!(price >= 0)) return toast("请填写工费单价");
  const it = itemsCache.find((x) => x.id === itemId);
  await Store.saveOutsource({
    factoryId,
    itemId,
    itemName: it ? it.name : "",
    color,
    qty,
    price,
    material,
    due: due || null,
    note,
    status: "active",
    returns: [],
    settled: false
  });
  toast("外发单已下达");
  await reloadAll();
  renderOutsources();
  showView("outsource");
}

async function openOutsourceDetail(id) {
  const o = outsourcesCache.find((x) => x.id === id);
  if (!o) return;
  const it = itemsCache.find((x) => x.id === o.itemId);
  const fa = factoriesCache.find((f) => f.id === o.factoryId);
  const st = osStatus(o);
  const returned = osReturned(o);
  const remaining = osRemaining(o);
  const returnsHtml = (o.returns || []).length ? (o.returns || []).map((r) =>
    `<div class="detail-color-row"><span>回货 ${r.qty} 件</span><span class="v">${timeStr(r.time)}</span></div>`).join("") : '<div class="hint">暂无回货记录</div>';
  $("#outsource-detail-body").innerHTML = `
    <div class="card">
      <div class="order-head">
        <span class="order-customer">${escapeHtml(it ? it.name : o.itemName)}${o.color ? "（" + escapeHtml(o.color) + "）" : ""}</span>
        <span class="order-status ${st.cls}">${st.label}</span>
      </div>
      <div class="detail-color-row"><span>加工厂</span><span class="v">${escapeHtml(fa ? fa.name : "—")}</span></div>
      <div class="detail-color-row"><span>发出数量</span><span class="v">${o.qty} 件</span></div>
      <div class="detail-color-row"><span>工费</span><span class="v">${money(o.price)}/件 · 已产生 ${money(osCost(o))}</span></div>
      <div class="detail-color-row"><span>领料</span><span class="v">${escapeHtml(o.material || "—")}</span></div>
      <div class="detail-color-row"><span>交期</span><span class="v">${o.due ? o.due : "—"}</span></div>
      <div class="detail-color-row"><span>备注</span><span class="v">${escapeHtml(o.note || "—")}</span></div>
    </div>
    <div class="card">
      <h3>回货记录（已回 ${returned} / ${o.qty}）</h3>
      ${returnsHtml}
    </div>
    <div class="card detail-actions">
      ${remaining > 0 && o.status !== "cancelled" ? `<button class="btn primary" id="os-return">📥 回货入库（剩 ${remaining} 件）</button>` : ""}
      ${o.status === "active" ? `<button class="btn" id="os-cancel-order">取消外发单</button>` : ""}
      ${!o.settled && returned > 0 ? `<button class="btn" id="os-settle">💰 标记已结算 ${money(osCost(o))}</button>` : ""}
      ${o.settled ? `<div class="hint" style="text-align:center">✅ 已结算 ${money(osCost(o))}</div>` : ""}
      <button class="btn danger" id="os-delete">删除外发单</button>
    </div>`;
  const back = () => { showView("outsource"); renderOutsources(); };
  const retBtn = $("#os-return");
  if (retBtn) retBtn.onclick = async () => {
    const v = prompt(`本次回货数量（件），剩余 ${remaining} 件`, String(remaining));
    const n = Number(v);
    if (!(n >= 1)) return;
    if (n > remaining) return toast(`回货数量不能超过剩余 ${remaining} 件`);
    o.returns = o.returns || [];
    o.returns.push({ qty: n, time: Date.now() });
    if (osRemaining(o) <= 0) o.status = "done";
    // 回货自动入成品库存
    if (o.itemId) {
      const it = itemsCache.find((x) => x.id === o.itemId);
      if (it) {
        let color = (it.colors || []).find((c) => c.name === o.color);
        if (!color) {
          color = { name: o.color || "默认", stock: 0, sold: 0 };
          it.colors = it.colors || [];
          it.colors.push(color);
        }
        color.stock += n;
        await Store.saveItem(it);
      }
    }
    await Store.saveOutsource(o);
    toast(`已回货 ${n} 件并入库`);
    await reloadAll();
    renderItems();
    openOutsourceDetail(id);
  };
  const cancelBtn = $("#os-cancel-order");
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (!await confirmModal("取消外发单", "确定取消这张外发单吗？")) return;
    o.status = "cancelled";
    await Store.saveOutsource(o);
    toast("已取消");
    await reloadAll();
    back();
  };
  const settleBtn = $("#os-settle");
  if (settleBtn) settleBtn.onclick = async () => {
    if (!await confirmModal("标记已结算", `确定这笔工费 ${money(osCost(o))} 已结算给加工厂？`)) return;
    o.settled = true;
    o.settledAt = Date.now();
    await Store.saveOutsource(o);
    toast("已标记结算");
    await reloadAll();
    openOutsourceDetail(id);
  };
  const delBtn = $("#os-delete");
  if (delBtn) delBtn.onclick = async () => {
    if (await confirmModal("删除外发单", "确定删除这条外发单吗？")) {
      await Store.deleteOutsource(id);
      toast("已删除");
      await reloadAll();
      back();
    }
  };
  showView("outsource-detail");
}

/* ================= 加工厂管理 ================= */

function renderFactories() {
  const el = $("#factory-list");
  if (!factoriesCache.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">🏭</span>还没有加工厂<br>点下方 ＋ 新增加工厂</div>';
    return;
  }
  el.innerHTML = factoriesCache.map((f) => {
    const active = outsourcesCache.filter((o) => o.factoryId === f.id && o.status !== "done" && o.status !== "cancelled").length;
    return `
      <div class="list-card" data-id="${f.id}">
        <div class="list-main">
          <div class="list-title">${escapeHtml(f.name)}</div>
          <div class="list-sub">${escapeHtml(f.phone || "无电话")}${f.skill ? " · " + escapeHtml(f.skill) : ""}</div>
          <div class="list-sub">工费 ${f.price ? money(f.price) + "/件" : "未设置"} · 进行中 ${active} 单</div>
        </div>
        <div class="list-side"><div class="num">${active}</div><div class="lbl">生产中</div></div>
      </div>`;
  }).join("");
  $$("#factory-list .list-card").forEach((card) => {
    card.onclick = () => openFactoryDetail(card.dataset.id);
  });
  staggerIn($("#factory-list"));
}

/** 加工厂详情（含月结对账） */
async function openFactoryDetail(id) {
  const f = factoriesCache.find((x) => x.id === id);
  if (!f) return;
  const fOuts = outsourcesCache.filter((o) => o.factoryId === id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const totalCost = fOuts.filter((o) => !o.cancelled).reduce((s, o) => s + osCost(o), 0);
  const unsettled = fOuts.filter((o) => !o.cancelled && !o.settled).reduce((s, o) => s + osCost(o), 0);
  const listHtml = fOuts.length ? fOuts.slice(0, 15).map((o) => {
    const it = itemsCache.find((x) => x.id === o.itemId);
    const st = osStatus(o);
    return `<div class="list-card" data-oid="${o.id}">
      <div style="flex:1;min-width:0">
        <div class="order-head"><span class="order-customer">${escapeHtml(it ? it.name : o.itemName)}${o.color ? "（" + escapeHtml(o.color) + "）" : ""}</span>
        <span class="order-status ${st.cls}">${st.label}</span></div>
        <div class="order-lines-preview">发出 ${o.qty} · 已回 ${osReturned(o)} · 工费 ${money(osCost(o))}${o.settled ? " · 已结算" : ""}</div>
        <div class="order-addr">🕐 ${timeStr(o.createdAt)}</div>
      </div>
    </div>`;
  }).join("") : '<div class="hint">暂无外发单</div>';
  $("#customer-detail-body").innerHTML = `
    <div class="card">
      <h3>${escapeHtml(f.name)}</h3>
      <div class="detail-color-row"><span>电话</span><span class="v">${escapeHtml(f.phone || "—")}</span></div>
      <div class="detail-color-row"><span>擅长</span><span class="v">${escapeHtml(f.skill || "—")}</span></div>
      <div class="detail-color-row"><span>工费标准</span><span class="v">${f.price ? money(f.price) + "/件" : "未设置"}</span></div>
      <div class="detail-color-row"><span>累计工费</span><span class="v">${money(totalCost)}</span></div>
      <div class="detail-color-row"><span>未结算</span><span class="v" style="${unsettled ? "color:var(--danger)" : ""}">${unsettled ? money(unsettled) : "无"}</span></div>
    </div>
    <div class="card">
      <h3>外发记录</h3>
      ${listHtml}
    </div>
    <div class="card detail-actions">
      <button class="btn primary" id="fd-statement">🧾 生成月结对账单</button>
      <button class="btn" id="fd-edit">编辑加工厂</button>
    </div>`;
  $$("#customer-detail-body [data-oid]").forEach((el2) => {
    el2.onclick = () => openOutsourceDetail(el2.dataset.oid);
  });
  $("#fd-statement").onclick = () => generateFactoryStatement(f);
  $("#fd-edit").onclick = () => openFactoryEdit(id);
  showView("customer-detail");
}

/** 生成加工厂月结对账单图片 */
async function generateFactoryStatement(f) {
  try {
    const fOuts = outsourcesCache.filter((o) => o.factoryId === f.id && o.status !== "cancelled")
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!fOuts.length) return toast("该加工厂暂无外发单");
    const byMonth = {};
    for (const o of fOuts) {
      const d = new Date(o.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(o);
    }
    const months = Object.keys(byMonth).sort().reverse();
    let monthKey = months[0];
    if (months.length > 1) {
      const pick = prompt(`选择对账月份（${months.join(" / ")}）：`, months[0]);
      if (pick && byMonth[pick]) monthKey = pick;
    }
    const monthOuts = byMonth[monthKey];
    const totalCost = monthOuts.reduce((s, o) => s + osCost(o), 0);
    const settled = monthOuts.filter((o) => o.settled).reduce((s, o) => s + osCost(o), 0);
    const unsettled = totalCost - settled;

    const W = 750, H = 300 + monthOuts.length * 46 + 120;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#faf7f3");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#b91c2e";
    ctx.fillRect(0, 0, W, 90);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("羊毛衫管家 · 外发工费对账单", W / 2, 42);
    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#fde8b0";
    ctx.fillText(`${monthKey} · ${f.name}`, W / 2, 70);
    ctx.textAlign = "left";
    ctx.fillStyle = "#1c1917";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(`本月工费合计：¥${fmt(totalCost)}`, 40, 130);
    ctx.fillStyle = "#78716c";
    ctx.font = "16px sans-serif";
    ctx.fillText(`已结算：¥${fmt(settled)}    未结算：¥${fmt(unsettled)}`, 40, 158);
    ctx.fillStyle = "#f5f2ee";
    ctx.fillRect(40, 185, W - 80, 34);
    ctx.fillStyle = "#78716c";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText("日期", 50, 208);
    ctx.fillText("款式/颜色", 170, 208);
    ctx.fillText("件数", W - 260, 208);
    ctx.fillText("工费", W - 160, 208);
    ctx.font = "15px sans-serif";
    let y = 235;
    for (const o of monthOuts) {
      const d = new Date(o.createdAt);
      const dateStr = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const it = itemsCache.find((x) => x.id === o.itemId);
      const name = it ? it.name : o.itemName;
      ctx.fillStyle = "#1c1917";
      ctx.fillText(dateStr, 50, y);
      ctx.fillText(`${name}${o.color ? "(" + o.color + ")" : ""}`.slice(0, 12), 170, y);
      ctx.fillText(`${osReturned(o)}件`, W - 265, y);
      ctx.fillText("¥" + fmt(osCost(o)), W - 175, y);
      y += 46;
      if (y > H - 60) break;
    }
    ctx.fillStyle = "#a8a29e";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`共计 ${monthOuts.length} 单 · 请核对工费，确认后安排结算，谢谢！`, W / 2, H - 30);
    // 预览分享（长按保存/系统分享，iOS 与微信内通用）
    await finishShareImage(canvas, `外发对账-${f.name}-${monthKey}.png`, `外发对账 ${monthKey}`, "👆 长按图片保存，发微信给加工厂核对工费");
  } catch (e) {
    toast("生成失败：" + (e.message || "未知错误"));
  }
}

function openFactoryEdit(id) {
  editingFactoryId = id || null;
  const f = id ? factoriesCache.find((x) => x.id === id) : null;
  $("#fa-name").value = f ? f.name : "";
  $("#fa-phone").value = f ? f.phone || "" : "";
  $("#fa-skill").value = f ? f.skill || "" : "";
  $("#fa-price").value = f && f.price ? f.price : "";
  $("#fa-note").value = f ? f.note || "" : "";
  showView("factory-edit");
}

async function saveFactoryEdit() {
  const name = $("#fa-name").value.trim();
  if (!name) return toast("请填写加工厂名称");
  const existing = editingFactoryId ? factoriesCache.find((x) => x.id === editingFactoryId) : null;
  await Store.saveFactory({
    id: editingFactoryId || undefined,
    name,
    phone: $("#fa-phone").value.trim(),
    skill: $("#fa-skill").value.trim(),
    price: $("#fa-price").value === "" ? null : Number($("#fa-price").value),
    note: $("#fa-note").value.trim(),
    createdAt: existing ? existing.createdAt : undefined
  });
  toast("已保存");
  await reloadAll();
  renderFactories();
  showView("factories");
}

/* ================= 快速开单（散单） ================= */

let quickLines = [];
let quickCustomerId = null;

function openQuickOrder(customerId) {
  quickCustomerId = customerId || null;
  quickLines = [];
  renderQuickCustomerSelect();
  renderQuickLines();
  showView("quick-order");
}

async function renderQuickCustomerSelect() {
  const sel = $("#qo-customer");
  sel.innerHTML = '<option value="">— 选择客户 —</option>' + customersCache.map((c) =>
    `<option value="${c.id}" ${c.id === quickCustomerId ? "selected" : ""}>${escapeHtml(c.name)}${c.phone ? " · " + escapeHtml(c.phone) : ""}</option>`).join("");
  updateQuickCustomerInfo();
}

function updateQuickCustomerInfo() {
  const id = $("#qo-customer").value;
  const c = customersCache.find((x) => x.id === id);
  if (c) {
    $("#qo-phone").value = c.phone || "";
    $("#qo-address").value = c.address || "";
  } else {
    $("#qo-phone").value = "";
    $("#qo-address").value = "";
  }
}

function renderQuickLines() {
  const el = $("#qo-lines");
  if (!quickLines.length) {
    el.innerHTML = '<div class="hint">还没有商品，点下方添加</div>';
    return;
  }
  el.innerHTML = quickLines.map((l, i) => `
    <div class="order-line">
      <div class="ol-row">
        <select class="input ol-item" data-i="${i}">
          ${itemsCache.map((it) => `<option value="${it.id}" ${it.id === l.itemId ? "selected" : ""}>${escapeHtml(it.name)}</option>`).join("")}
        </select>
        <input class="input ol-color" data-i="${i}" placeholder="颜色" value="${escapeHtml(l.color)}">
      </div>
      <div class="ol-row">
        <div class="unit-wrap"><input class="input ol-qty" data-i="${i}" type="number" inputmode="numeric" min="1" value="${l.qty}"><span class="unit">件</span></div>
        <div class="unit-wrap"><input class="input ol-price" data-i="${i}" type="number" inputmode="decimal" value="${l.price}" placeholder="单价"><span class="unit">元</span></div>
        <button class="rm" data-i="${i}">✕</button>
      </div>
    </div>`).join("");
  $$("#qo-lines .ol-item").forEach((sel) => {
    sel.onchange = () => {
      quickLines[Number(sel.dataset.i)].itemId = sel.value;
      const it = itemsCache.find((x) => x.id === sel.value);
      if (it) {
        quickLines[Number(sel.dataset.i)].itemName = it.name;
        quickLines[Number(sel.dataset.i)].price = it.price;
        renderQuickLines();
      }
    };
  });
  $$("#qo-lines .ol-color").forEach((inp) => {
    inp.oninput = () => { quickLines[Number(inp.dataset.i)].color = inp.value; };
  });
  $$("#qo-lines .ol-qty").forEach((inp) => {
    inp.oninput = () => { quickLines[Number(inp.dataset.i)].qty = Number(inp.value) || 1; };
  });
  $$("#qo-lines .ol-price").forEach((inp) => {
    inp.oninput = () => { quickLines[Number(inp.dataset.i)].price = Number(inp.value) || 0; };
  });
  $$("#qo-lines .rm").forEach((btn) => {
    btn.onclick = () => { quickLines.splice(Number(btn.dataset.i), 1); renderQuickLines(); };
  });
}

function addQuickLine() {
  const first = itemsCache[0];
  quickLines.push({
    itemId: first ? first.id : "",
    itemName: first ? first.name : "",
    color: "",
    qty: 1,
    price: first ? first.price || 0 : 0
  });
  renderQuickLines();
}

/** 解析「颜色 + 数量件 + 单价元」文本，自动匹配款式并加入清单 */
function parseQuickText(raw) {
  const text = (raw || "").trim();
  if (!text) return toast("请输入或说出内容");
  let qty = 1;
  const qm = text.match(/(\d+(?:\.\d+)?)\s*件/);
  if (qm) qty = Math.max(1, Math.round(Number(qm[1])));
  let price = 0;
  const pm = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块)/);
  if (pm) price = Number(pm[1]);
  // 剩余文字作颜色/款式关键词
  const rest = text
    .replace(/(\d+(?:\.\d+)?)\s*件/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*(?:元|块)/g, "")
    .replace(/[，。！？,\.!?\s]+/g, "").trim();
  if (!rest) return toast("没听清款式/颜色，请带上颜色名再说一次");
  // 匹配：颜色优先，其次款式名
  let hit = null;
  for (const it of itemsCache) {
    for (const c of it.colors || []) {
      if (rest.includes(c.name)) { hit = { it, color: c.name }; break; }
    }
    if (hit) break;
    if (it.name && (it.name.includes(rest) || rest.includes(it.name))) { hit = { it, color: "" }; break; }
  }
  if (!hit) return toast(`没匹配到「${rest}」，请手动添加或改用已有颜色名`);
  const finalPrice = price || hit.it.price || 0;
  quickLines.push({ itemId: hit.it.id, itemName: hit.it.name, color: hit.color, qty, price: finalPrice });
  renderQuickLines();
  toast(`已加入：${hit.it.name}${hit.color ? "(" + hit.color + ")" : ""} ${qty}件 ${money(finalPrice)}`);
  $("#qo-voice-text").value = "";
}

/** 语音识别（Chrome/Edge 可用；不支持的手机用输入法麦克风键说话） */
function startVoiceQuickOrder() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast("此浏览器不支持语音识别，可点输入框长按麦克风键说话");
  try {
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript;
      $("#qo-voice-text").value = t;
      parseQuickText(t);
    };
    rec.onerror = (e) => toast("语音识别失败：" + (e.error || ""));
    toast("🎤 请说话…（颜色 + 数量件 + 单价元）");
    rec.start();
  } catch (e) {
    toast("语音启动失败");
  }
}

async function saveQuickOrder(continueNext) {
  const cid = $("#qo-customer").value;
  const phone = $("#qo-phone").value.trim();
  const address = $("#qo-address").value.trim();
  const paid = $("#qo-paid").checked;
  let customerName = "";
  if (cid) {
    const c = customersCache.find((x) => x.id === cid);
    if (c) {
      customerName = c.name;
      // 更新客户档案（电话/地址可能改了）
      if (phone && phone !== c.phone) { c.phone = phone; await Store.saveCustomer(c); }
      if (address && address !== c.address) { c.address = address; await Store.saveCustomer(c); }
    }
  } else {
    customerName = prompt("请输入客户名称（新建客户）") || "";
    if (!customerName) return toast("请选择或输入客户");
    const existing = customersCache.find((x) => x.name === customerName);
    if (existing) {
      await Store.saveCustomer({ ...existing, phone: phone || existing.phone, address: address || existing.address });
    } else {
      await Store.saveCustomer({ name: customerName, phone, address, note: "快速开单创建" });
    }
  }
  const validLines = quickLines.filter((l) => l.itemId && l.qty >= 1);
  if (!validLines.length) return toast("请至少添加一件商品");
  // 扣库存
  for (const l of validLines) {
    const it = itemsCache.find((x) => x.id === l.itemId);
    if (!it) continue;
    const color = (it.colors || []).find((c) => c.name === l.color);
    if (color && color.stock < l.qty) {
      return toast(`「${it.name}」${l.color ? "(" + l.color + ")" : ""} 库存不足（当前 ${color.stock} 件）`);
    }
  }
  for (const l of validLines) {
    const it = itemsCache.find((x) => x.id === l.itemId);
    if (!it) continue;
    const color = (it.colors || []).find((c) => c.name === l.color);
    if (color) {
      color.stock -= l.qty;
      color.sold = (color.sold || 0) + l.qty;
      await Store.saveItem(it);
    }
  }
  const total = validLines.reduce((s, l) => s + l.qty * l.price, 0);
  await Store.saveOrder({
    customer: customerName,
    phone,
    address,
    lines: validLines.map((l) => ({ ...l })),
    status: "pending",
    payStatus: paid ? "paid" : "unpaid",
    paidAmount: paid ? total : 0
  });
  toast(`已开单 ${customerName} · ${money(total)}`);
  await reloadAll();
  renderOrders();
  renderCustomers();
  renderToday();
  if (continueNext) {
    quickLines = [];
    renderQuickLines();
    $("#qo-phone").value = phone;
    $("#qo-address").value = address;
  } else {
    showView("orders");
    renderOrders();
  }
}

/* ================= 批量导入订单 ================= */

function openImport() {
  $("#import-result").textContent = "";
  $("#import-text").value = "";
  showView("import");
}

function parseImportText() {
  const text = $("#import-text").value.trim();
  if (!text) return { ok: false, error: "请粘贴订单内容" };
  const rows = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    // 支持逗号/制表符/中文逗号分隔
    const parts = t.split(/[,，\t]/).map((s) => s.trim());
    if (parts.length < 4) continue;
    const [cust, phone, addr, itemName, color = "", qtyStr = "1", priceStr = "0"] = parts;
    const qty = Number(qtyStr) || 1;
    const price = Number(priceStr) || 0;
    // 匹配款式
    const it = itemsCache.find((x) => x.name === itemName);
    rows.push({
      customer: cust, phone, address: addr,
      itemId: it ? it.id : null, itemName: itemName, color,
      qty, price: price || (it ? it.price || 0 : 0),
      matched: !!it
    });
  }
  if (!rows.length) return { ok: false, error: "没有解析到有效行（每行至少：客户,电话,地址,商品）" };
  return { ok: true, rows };
}

function previewImport() {
  const res = parseImportText();
  const out = $("#import-result");
  if (!res.ok) { out.textContent = res.error; out.style.color = "var(--danger)"; return; }
  const unmatched = res.rows.filter((r) => !r.matched).length;
  const total = res.rows.reduce((s, r) => s + r.qty * r.price, 0);
  out.style.color = "var(--text2)";
  out.innerHTML = `解析到 <b>${res.rows.length}</b> 单，合计 <b>${money(total)}</b><br>` +
    (unmatched ? `<span style="color:var(--danger)">⚠ ${unmatched} 单商品名未匹配到库存款式（导入后不会扣库存，需手动处理）</span>` : "全部商品已匹配 ✅");
}

async function doImport() {
  const res = parseImportText();
  const out = $("#import-result");
  if (!res.ok) { out.textContent = res.error; out.style.color = "var(--danger)"; return; }
  let imported = 0, createdCustomers = 0;
  for (const r of res.rows) {
    // 自动创建/查找客户
    let cust = customersCache.find((c) => c.name === r.customer);
    if (!cust) {
      cust = { name: r.customer, phone: r.phone, address: r.address, note: "批量导入" };
      await Store.saveCustomer(cust);
      createdCustomers++;
    }
    // 扣库存（匹配到的款式）
    if (r.matched && r.itemId) {
      const it = itemsCache.find((x) => x.id === r.itemId);
      if (it) {
        const color = (it.colors || []).find((c) => c.name === r.color);
        if (color) {
          color.stock = Math.max(0, color.stock - r.qty);
          color.sold = (color.sold || 0) + r.qty;
          await Store.saveItem(it);
        }
      }
    }
    await Store.saveOrder({
      customer: r.customer,
      phone: r.phone,
      address: r.address,
      lines: [{ itemId: r.itemId, itemName: r.itemName, color: r.color, qty: r.qty, price: r.price }],
      status: "pending",
      payStatus: "paid",
      paidAmount: r.qty * r.price
    });
    imported++;
  }
  await reloadAll();
  renderOrders();
  renderCustomers();
  renderToday();
  out.style.color = "var(--ok)";
  out.textContent = `✅ 成功导入 ${imported} 单${createdCustomers ? "，新建客户 " + createdCustomers + " 个" : ""}`;
  $("#import-text").value = "";
}

/* ================= 订单批量操作 ================= */

let orderBatchMode = false;
let orderBatchSelected = new Set();

/** 订单发货数量统计（按行计算已发件数） */
function orderShippedQty(o) {
  return (o.lines || []).reduce((s, l) => s + (l.shipped || 0), 0);
}
function orderTotalQty(o) {
  return (o.lines || []).reduce((s, l) => s + (l.qty || 0), 0);
}

function renderOrders() {
  const todayKey = todayStr();
  let list = ordersCache.filter((o) => {
    if (orderFilter === "today") return o.status !== "cancelled" && isToday(o.createdAt);
    if (orderFilter === "history") return o.status !== "cancelled" && !isToday(o.createdAt);
    if (orderFilter === "pending") return o.status === "pending";
    if (orderFilter === "done") return o.status === "done";
    if (orderFilter === "unship") return o.status === "pending" && !o.shippedAt;
    if (orderFilter === "debt") return o.status !== "cancelled" && orderDebt(o) > 0;
    if (orderFilter === "custom") return o.type === "custom";
    return true;
  });
  // 排序：默认按创建时间倒序，可切换按金额
  if (orderSort === "amount") {
    list = [...list].sort((a, b) => orderTotal(b) - orderTotal(a) || (b.createdAt || 0) - (a.createdAt || 0));
  } else {
    list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  const el = $("#order-list");
  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">' + (ordersCache.length ? "📋" : "📦") + "</span>" + (ordersCache.length ? "没有匹配的订单" : "还没有订单<br>点右上角 ＋ 新订单创建第一单") + "</div>";
    return;
  }
  el.innerHTML = list.map((o) => {
    const lines = (o.lines || []).map((l) => `${l.qty}×${escapeHtml(l.itemName)}${l.color ? "(" + escapeHtml(l.color) + ")" : ""}`).join("、");
    const total = orderTotal(o);
    const debt = orderDebt(o);
    const totalQty = orderTotalQty(o);
    const shippedQty = orderShippedQty(o);
    const isShipped = !!o.shippedAt;
    const typeBadge = o.type === "custom"
      ? `<span class="tag blue">定制</span>${o.due ? `<span class="tag">交期 ${o.due.slice(5)}</span>` : ""}`
      : `<span class="tag">现货</span>`;
    const payBadge = o.payStatus === "paid" ? `<span class="order-status done">已收款</span>`
      : (o.payStatus === "partial" || debt > 0) ? `<span class="order-status pending">欠 ${money(debt)}</span>`
      : "";
    const shipBadge = isShipped
      ? `<span class="tag green">📦 已发货${shippedQty < totalQty ? " " + shippedQty + "/" + totalQty : ""}</span>`
      : (o.status === "pending" ? `<span class="tag warn">未发货</span>` : "");
    const checkBox = orderBatchMode
      ? `<input type="checkbox" class="order-check" data-id="${o.id}" ${orderBatchSelected.has(o.id) ? "checked" : ""}>`
      : "";
    return `
      <div class="list-card order-card" data-id="${o.id}">
        ${checkBox}
        <div style="flex:1;min-width:0">
          <div class="order-head">
            <span class="order-customer">${escapeHtml(o.customer)}</span>
            <span class="order-status ${o.status}">${o.status === "done" ? "已完成" : o.status === "cancelled" ? "已取消" : "未完成"}</span>
          </div>
          <div class="list-tags" style="margin-bottom:4px">${typeBadge}${shipBadge}</div>
          <div class="order-lines-preview">${lines}${payBadge ? " · " + payBadge : ""}</div>
          <div class="order-addr">📮 ${escapeHtml(o.address || "无地址")}</div>
          <div class="order-addr">🕐 ${timeStr(o.createdAt)} · 合计 ${money(total)}${shippedQty && shippedQty < totalQty ? ` · 已发 ${shippedQty}/${totalQty} 件` : ""}</div>
        </div>
      </div>`;
  }).join("");
  $$("#order-list .order-card").forEach((card) => {
    if (orderBatchMode) {
      card.onclick = (e) => {
        const cb = card.querySelector(".order-check");
        if (cb && e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
      };
    } else {
      card.onclick = () => openOrderDetail(card.dataset.id);
    }
  });
  $$("#order-list .order-check").forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) orderBatchSelected.add(cb.dataset.id);
      else orderBatchSelected.delete(cb.dataset.id);
      updateOrderBatchBar();
    };
  });
  updateOrderBatchBar();
  if (!orderBatchMode) staggerIn($("#order-list"));
}

function enterOrderBatchMode() {
  orderBatchMode = true;
  orderBatchSelected = new Set();
  $("#order-batch-bar").classList.remove("hidden");
  renderOrders();
}

function exitOrderBatchMode() {
  orderBatchMode = false;
  orderBatchSelected = new Set();
  $("#order-batch-bar").classList.add("hidden");
  renderOrders();
}

function updateOrderBatchBar() {
  const bar = $("#order-batch-bar");
  if (!bar) return;
  $("#order-batch-count").textContent = `已选 ${orderBatchSelected.size} 单`;
}

async function batchMarkDone() {
  if (!orderBatchSelected.size) return toast("请先勾选订单");
  const ids = [...orderBatchSelected];
  for (const id of ids) {
    const o = ordersCache.find((x) => x.id === id);
    if (o && o.status !== "done") await Store.setOrderStatus(id, "done");
  }
  toast(`已标记 ${ids.length} 单完成`);
  exitOrderBatchMode();
  await reloadAll();
  renderOrders();
  renderToday();
}

async function openOrderDetail(id) {
  const o = ordersCache.find((x) => x.id === id);
  if (!o) return;
  const lines = (o.lines || []).map((l) => `${l.qty}× ${escapeHtml(l.itemName)}${l.color ? "（" + escapeHtml(l.color) + "）" : ""} @ ${money(l.price)}`).join("<br>");
  const total = orderTotal(o);
  const debt = orderDebt(o);
  const payStatusHtml = `
    <div class="card">
      <h3>收款状态</h3>
      <div class="pay-row">
        <span class="pay-info">合计 ${money(total)}${o.paidAmount ? " · 已收 " + money(o.paidAmount) : ""}${debt ? " · 欠 " + money(debt) : ""}</span>
      </div>
      <div class="btn-row">
        ${o.paidAmount > 0
          ? `<button class="btn danger" id="od-pay-reset">↩️ 撤销收款（设为欠款）</button>`
          : `<button class="btn" id="od-pay-full">标记全部收款</button>`}
        ${o.paidAmount > 0 ? "" : `<button class="btn" id="od-pay-partial">部分收款</button>`}
        <button class="btn" id="od-pay-qr">🧾 收款二维码</button>
      </div>
      ${o.paidAmount > 0 && o.paidAmount < total ? `<button class="btn" id="od-pay-more">继续收款</button>` : ""}
    </div>`;
  const typeRow = o.type === "custom"
    ? `<div class="detail-color-row"><span>订单类型</span><span class="v">🎨 定制单${o.due ? " · 交期 " + o.due : ""}</span></div>${o.craft ? `<div class="detail-color-row"><span>定制要求</span><span class="v">${escapeHtml(o.craft)}</span></div>` : ""}`
    : `<div class="detail-color-row"><span>订单类型</span><span class="v">现货单</span></div>`;
  // 发货状态 + 部分发货（可直接输入已发件数）
  const totalQty = orderTotalQty(o);
  const shippedQty = orderShippedQty(o);
  const lineShipRows = (o.lines || []).map((l, i) => {
    const sh = l.shipped || 0;
    return `<div class="ship-line">
      <span class="ship-name">${escapeHtml(l.itemName)}${l.color ? "(" + escapeHtml(l.color) + ")" : ""}</span>
      <div class="unit-wrap ship-input"><input class="input ship-qty-input" data-i="${i}" type="number" inputmode="numeric" min="0" max="${l.qty || 0}" value="${sh}"><span class="unit">件</span></div>
      <span class="ship-qty">/ ${l.qty || 0}</span>
    </div>`;
  }).join("");
  const shipHtml = o.status === "cancelled" ? "" : `
    <div class="card">
      <h3>发货状态 ${o.shippedAt ? `<span class="tag green">已发货</span>` : `<span class="tag warn">未发货</span>`}</h3>
      ${o.shippedAt ? `<div class="detail-color-row"><span>发货时间</span><span class="v">${timeStr(o.shippedAt)}</span></div>` : ""}
      <div id="ship-summary" style="margin:6px 0 8px">已发 <b>${shippedQty}</b> / ${totalQty} 件${!o.shippedAt && shippedQty < totalQty ? `，还欠发 <b class="danger-text">${totalQty - shippedQty}</b> 件` : ""}</div>
      <div class="ship-lines">${lineShipRows}</div>
      <div class="btn-row">
        ${o.shippedAt
          ? `<button class="btn danger" id="od-ship-undo">↩️ 撤销发货</button>`
          : shippedQty > 0
            ? `<button class="btn primary" id="od-ship-confirm">📤 确认发货（已发 ${shippedQty} 件）</button><button class="btn" id="od-ship-all">全部发货</button>`
            : `<button class="btn primary" id="od-ship-all">📦 全部发货</button>`}
      </div>
    </div>`;
  $("#detail-body").innerHTML = `
    <div class="card">
      <div class="order-head">
        <span class="order-customer">${escapeHtml(o.customer)}</span>
        <span class="order-status ${o.status}">${o.status === "done" ? "已完成" : o.status === "cancelled" ? "已取消" : "未完成"}</span>
      </div>
      ${typeRow}
      <div class="detail-color-row"><span>电话</span><span class="v">${escapeHtml(o.phone || "—")}</span></div>
      <div class="detail-color-row"><span>创建时间</span><span class="v">${timeStr(o.createdAt)}</span></div>
      ${o.doneAt ? `<div class="detail-color-row"><span>完成时间</span><span class="v">${timeStr(o.doneAt)}</span></div>` : ""}
      <div class="detail-color-row"><span>地址</span><span class="v">${escapeHtml(o.address || "—")}</span></div>
    </div>
    <div class="card">
      <h3>商品明细（合计 ${money(total)}）</h3>
      <div style="font-size:14px;line-height:1.9">${lines}</div>
    </div>
    ${payStatusHtml}
    ${shipHtml}
    <div class="card detail-actions">
      <button class="btn" id="od-back">← 返回订单列表</button>
      <button class="btn" id="od-delivery-note">📦 发货单图片</button>
      ${o.status === "pending"
        ? `<button class="btn primary" id="od-done">标记为已完成配送</button>
           <button class="btn" id="od-cancel-order">取消订单（库存退回）</button>`
        : o.status === "done"
          ? `<button class="btn" id="od-reopen">重新打开订单</button>`
          : ""}
      <button class="btn danger" id="od-delete">删除订单记录</button>
    </div>`;
  const back = () => { showView("orders"); renderOrders(); };
  const backBtn = $("#od-back");
  if (backBtn) backBtn.onclick = back;
  const doneBtn = $("#od-done");
  if (doneBtn) doneBtn.onclick = async () => {
    await Store.setOrderStatus(id, "done");
    toast("订单已完成配送");
    await reloadAll();
    openOrderDetail(id);
  };
  const cancelBtn = $("#od-cancel-order");
  if (cancelBtn) cancelBtn.onclick = async () => {
    if (!await confirmModal("取消订单", "取消后订单商品将退回库存，确定？")) return;
    await restoreOrderStock(o);
    o.status = "cancelled";
    await Store.saveOrder(o);
    toast("订单已取消，库存已退回");
    await reloadAll();
    back();
  };
  const reopenBtn = $("#od-reopen");
  if (reopenBtn) reopenBtn.onclick = async () => {
    await Store.setOrderStatus(id, "pending");
    toast("已重新打开");
    await reloadAll();
    openOrderDetail(id);
  };
  const delBtn = $("#od-delete");
  if (delBtn) delBtn.onclick = async () => {
    if (await confirmModal("删除订单", "确定删除这条订单记录吗？")) {
      await Store.deleteOrder(id);
      toast("已删除");
      await reloadAll();
      back();
    }
  };
  // 收款
  const payFull = $("#od-pay-full");
  if (payFull) payFull.onclick = async () => {
    await Store.setOrderPay(id, "paid", total);
    toast("已标记全部收款");
    await reloadAll();
    openOrderDetail(id);
  };
  const payPartial = $("#od-pay-partial");
  if (payPartial) payPartial.onclick = async () => {
    const v = prompt("本次收款金额（元），当前欠 " + money(debt), String(debt || ""));
    const n = Number(v);
    if (!(n > 0)) return;
    const newPaid = Math.min(total, (o.paidAmount || 0) + n);
    const status = newPaid >= total ? "paid" : "partial";
    await Store.setOrderPay(id, status, newPaid);
    toast("已记录收款 " + money(n));
    await reloadAll();
    openOrderDetail(id);
  };
  // 撤销收款（点错了可改回）
  const payReset = $("#od-pay-reset");
  if (payReset) payReset.onclick = async () => {
    if (!await confirmModal("撤销收款", `确定把已收 ${money(o.paidAmount || 0)} 撤销为欠款吗？`)) return;
    await Store.setOrderPay(id, "unpaid", 0);
    toast("已撤销收款，订单转为欠款");
    await reloadAll();
    openOrderDetail(id);
  };
  // 继续收款（部分收款后补收）
  const payMore = $("#od-pay-more");
  if (payMore) payMore.onclick = async () => {
    const remain = total - (o.paidAmount || 0);
    const v = prompt("继续收款金额（元），剩余 " + money(remain), String(remain || ""));
    const n = Number(v);
    if (!(n > 0)) return;
    const newPaid = Math.min(total, (o.paidAmount || 0) + n);
    const status = newPaid >= total ? "paid" : "partial";
    await Store.setOrderPay(id, status, newPaid);
    toast("已记录收款 " + money(n));
    await reloadAll();
    openOrderDetail(id);
  };
  // 收款二维码（客户扫码确认应收金额）
  const payQr = $("#od-pay-qr");
  if (payQr) payQr.onclick = () => showOrderPayQr(o);
  // 发货单图片
  const delNote = $("#od-delivery-note");
  if (delNote) delNote.onclick = () => generateDeliveryNote(o);
  // 发货数量：直接输入已发件数，输入即自动保存（防抖，不打断输入）
  $$("#detail-body .ship-qty-input").forEach((inp) => {
    inp.oninput = () => {
      const i = Number(inp.dataset.i);
      const l = (o.lines || [])[i];
      if (!l) return;
      const v = Math.max(0, Math.min(l.qty || 0, Math.round(Number(inp.value) || 0)));
      l.shipped = v;
      const sq = orderShippedQty(o), tq = orderTotalQty(o);
      if (sq >= tq && tq > 0) o.shippedAt = Date.now(); else o.shippedAt = null;
      const sum = $("#ship-summary");
      if (sum) sum.innerHTML = `已发 <b>${sq}</b> / ${tq} 件${!o.shippedAt && sq < tq ? `，还欠发 <b class="danger-text">${tq - sq}</b> 件` : ""}`;
      clearTimeout(inp._saveT);
      inp._saveT = setTimeout(async () => {
        await Store.saveOrder(o);
        await reloadAll();
      }, 600);
    };
  });
  // 全部发货
  const shipAll = $("#od-ship-all");
  if (shipAll) shipAll.onclick = async () => {
    for (const l of o.lines || []) l.shipped = l.qty || 0;
    o.shippedAt = Date.now();
    await Store.saveOrder(o);
    toast("已标记全部发货");
    await reloadAll();
    openOrderDetail(id);
  };
  // 确认发货（部分发货后确认）
  const shipConfirm = $("#od-ship-confirm");
  if (shipConfirm) shipConfirm.onclick = async () => {
    o.shippedAt = Date.now();
    await Store.saveOrder(o);
    toast(`已确认发货 ${orderShippedQty(o)} 件，剩余 ${orderTotalQty(o) - orderShippedQty(o)} 件欠发`);
    await reloadAll();
    openOrderDetail(id);
  };
  // 撤销发货
  const shipUndo = $("#od-ship-undo");
  if (shipUndo) shipUndo.onclick = async () => {
    if (!await confirmModal("撤销发货", "将清空已发数量并恢复为未发货，确定？")) return;
    for (const l of o.lines || []) l.shipped = 0;
    o.shippedAt = null;
    await Store.saveOrder(o);
    toast("已撤销发货");
    await reloadAll();
    openOrderDetail(id);
  };
  showView("item-detail");
}

/** 订单取消时把商品退回库存 */
async function restoreOrderStock(order) {
  for (const l of order.lines || []) {
    const it = itemsCache.find((x) => x.id === l.itemId);
    if (!it) continue;
    const color = (it.colors || []).find((c) => c.name === l.color);
    if (color) {
      color.stock += l.qty;
      if (color.sold !== undefined) color.sold = Math.max(0, (color.sold || 0) - l.qty);
      await Store.saveItem(it);
    }
  }
}

/** 订单收款二维码：客户扫码看到应收金额，用于催款/对账确认 */
function showOrderPayQr(o) {
  const total = orderTotal(o);
  const debt = orderDebt(o);
  const text = "羊毛衫管家 收款单\n客户：" + (o.customer || "") + "\n订单金额：" + money(total) +
    "\n已收：" + money(o.paidAmount || 0) + "\n待收：" + money(debt) +
    "\n单号：" + String(o.id || "").slice(-6) + "\n下单：" + timeStr(o.createdAt);
  const mask = document.createElement("div");
  mask.className = "img-share-mask";
  mask.innerHTML = `
    <div class="img-share-box qr-box">
      <h3>🧾 收款二维码</h3>
      <div id="pay-qr-canvas"></div>
      <div class="img-share-hint">客户扫一扫即可看到应收金额，用于催款/对账确认</div>
      <div class="btn-row"><button class="btn primary img-share-close">完成</button></div>
    </div>`;
  document.body.appendChild(mask);
  const qrBox = mask.querySelector("#pay-qr-canvas");
  try {
    if (typeof QRCode !== "undefined") {
      new QRCode(qrBox, { text, width: 210, height: 210, correctLevel: QRCode.CorrectLevel.M });
    } else {
      qrBox.textContent = "二维码组件加载失败";
    }
  } catch (e) {
    qrBox.textContent = "二维码生成失败：" + (e.message || "");
  }
  const close = () => mask.remove();
  mask.querySelector(".img-share-close").onclick = close;
  mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
}

/** 生成发货单图片（客户/明细/金额/发货状态），可长按保存发客户 */
async function generateDeliveryNote(o) {
  try {
    const total = orderTotal(o);
    const shippedQty = orderShippedQty(o);
    const totalQty = orderTotalQty(o);
    const rows = o.lines || [];
    const W = 750;
    const H = 380 + rows.length * 44 + 140;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#faf7f3");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 顶部品牌条
    ctx.fillStyle = "#b91c2e"; ctx.fillRect(0, 0, W, 90);
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText("羊毛衫管家 · 发货单", W / 2, 42);
    ctx.font = "18px sans-serif"; ctx.fillStyle = "#fde8b0";
    ctx.fillText("Delivery Note", W / 2, 70);
    ctx.textAlign = "left";
    // 客户信息
    ctx.fillStyle = "#1c1917"; ctx.font = "bold 22px sans-serif";
    ctx.fillText("客户：" + (o.customer || ""), 40, 128);
    ctx.font = "16px sans-serif"; ctx.fillStyle = "#57534e";
    ctx.fillText("电话：" + (o.phone || "—"), 40, 156);
    ctx.fillText("地址：" + (o.address || "—"), 40, 182);
    ctx.fillText("日期：" + timeStr(o.createdAt) + "　单号：" + String(o.id || "").slice(-6), 40, 208);
    // 表头
    ctx.fillStyle = "#f5f2ee"; ctx.fillRect(40, 228, W - 80, 34);
    ctx.fillStyle = "#78716c"; ctx.font = "bold 15px sans-serif";
    ctx.fillText("商品", 50, 251);
    ctx.fillText("颜色", 330, 251);
    ctx.fillText("数量", 460, 251);
    ctx.fillText("单价", 545, 251);
    ctx.fillText("金额", W - 130, 251);
    // 明细
    ctx.font = "15px sans-serif";
    let y = 278;
    for (const l of rows) {
      ctx.fillStyle = "#1c1917";
      ctx.fillText(String(l.itemName || "").slice(0, 10), 50, y);
      ctx.fillText(String(l.color || "—"), 330, y);
      ctx.fillText(String(l.qty || 0), 465, y);
      ctx.fillText("¥" + fmt(l.price || 0), 540, y);
      ctx.fillText("¥" + fmt((l.qty || 0) * (l.price || 0)), W - 145, y);
      y += 44;
      if (y > H - 100) break;
    }
    // 合计
    ctx.fillStyle = "#f5f2ee"; ctx.fillRect(40, y + 6, W - 80, 40);
    ctx.fillStyle = "#1c1917"; ctx.font = "bold 18px sans-serif";
    ctx.fillText(`合计 ${totalQty} 件　金额 ¥${fmt(total)}`, 50, y + 33);
    ctx.fillStyle = "#b45309"; ctx.font = "bold 16px sans-serif";
    ctx.fillText(o.shippedAt ? `已发 ${shippedQty} 件` + (shippedQty < totalQty ? `，欠发 ${totalQty - shippedQty} 件` : "") : "未发货", W - 300, y + 33);
    // 底部
    ctx.fillStyle = "#a8a29e"; ctx.font = "14px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("请核对商品数量与金额，如有问题请及时联系！", W / 2, H - 36);
    await finishShareImage(canvas, `发货单-${o.customer}-${String(o.id || "").slice(-6)}.png`, "发货单", "👆 长按图片保存，发微信给客户确认");
  } catch (e) {
    toast("生成失败：" + (e.message || "未知错误"));
  }
}

/* ================= 新建订单 ================= */

function openOrderEdit() {
  editingOrderId = null;
  editingLines = [];
  setOrderType("stock");
  $("#oe-customer").value = "";
  $("#oe-phone").value = "";
  $("#oe-address").value = "";
  $("#oe-due").value = "";
  $("#oe-craft").value = "";
  $("#oe-on-credit").checked = true;
  renderCustomerSelect();
  renderOrderLines();
  renderAddrBook();
  showView("order-edit");
}

/** 填充"选择已有客户"下拉 */
function renderCustomerSelect() {
  const sel = $("#oe-customer-select");
  if (!sel) return;
  sel.innerHTML = '<option value="">— 选择已有客户 —</option>' + customersCache.map((c) =>
    `<option value="${c.id}">${escapeHtml(c.name)}${c.phone ? " · " + escapeHtml(c.phone) : ""}</option>`).join("");
}

function setOrderType(type) {
  orderType = type;
  $("#oe-type-stock").classList.toggle("active", type === "stock");
  $("#oe-type-custom").classList.toggle("active", type === "custom");
  $("#oe-custom-fields").classList.toggle("hidden", type !== "custom");
}

function renderOrderLines() {
  const el = $("#oe-lines");
  if (!editingLines.length) {
    el.innerHTML = '<div class="hint">还没有商品，点下方添加</div>';
    return;
  }
  el.innerHTML = editingLines.map((l, i) => `
    <div class="order-line">
      <div class="ol-row">
        <select class="input ol-item" data-i="${i}">
          ${itemsCache.map((it) => `<option value="${it.id}" ${it.id === l.itemId ? "selected" : ""}>${escapeHtml(it.name)}</option>`).join("")}
        </select>
        <input class="input ol-color" data-i="${i}" placeholder="颜色" value="${escapeHtml(l.color)}">
      </div>
      <div class="ol-row">
        <div class="unit-wrap"><input class="input ol-qty" data-i="${i}" type="number" inputmode="numeric" min="1" value="${l.qty}" placeholder="数量"><span class="unit">件</span></div>
        <div class="unit-wrap"><input class="input ol-price" data-i="${i}" type="number" inputmode="decimal" value="${l.price}" placeholder="单价"><span class="unit">元</span></div>
        <button class="rm" data-i="${i}">✕</button>
      </div>
    </div>`).join("");
  $$("#oe-lines .ol-item").forEach((sel) => {
    sel.onchange = () => {
      editingLines[Number(sel.dataset.i)].itemId = sel.value;
      const it = itemsCache.find((x) => x.id === sel.value);
      if (it) {
        editingLines[Number(sel.dataset.i)].itemName = it.name;
        editingLines[Number(sel.dataset.i)].price = it.price;
        renderOrderLines();
      }
    };
  });
  $$("#oe-lines .ol-color").forEach((inp) => {
    inp.oninput = () => { editingLines[Number(inp.dataset.i)].color = inp.value; };
  });
  $$("#oe-lines .ol-qty").forEach((inp) => {
    inp.oninput = () => { editingLines[Number(inp.dataset.i)].qty = Number(inp.value) || 1; };
  });
  $$("#oe-lines .ol-price").forEach((inp) => {
    inp.oninput = () => { editingLines[Number(inp.dataset.i)].price = Number(inp.value) || 0; };
  });
  $$("#oe-lines .rm").forEach((btn) => {
    btn.onclick = () => { editingLines.splice(Number(btn.dataset.i), 1); renderOrderLines(); };
  });
}

function addOrderLine() {
  const first = itemsCache[0];
  editingLines.push({
    itemId: first ? first.id : "",
    itemName: first ? first.name : "",
    color: "",
    qty: 1,
    price: first ? first.price || 0 : 0
  });
  renderOrderLines();
}

async function renderAddrBook() {
  const sel = $("#oe-addr-book");
  sel.innerHTML = '<option value="">— 从地址簿调用 —</option>' + addrCache.map((a) =>
    `<option value="${a.id}">${escapeHtml(a.name)}${a.phone ? " · " + escapeHtml(a.phone) : ""}</option>`).join("");
}

async function saveOrder() {
  const customer = $("#oe-customer").value.trim();
  const phone = $("#oe-phone").value.trim();
  const address = $("#oe-address").value.trim();
  const onCredit = $("#oe-on-credit").checked;
  if (!customer) return toast("请填写客户姓名");
  const validLines = editingLines.filter((l) => l.itemId && l.qty >= 1);
  if (!validLines.length) return toast("请至少添加一件商品");
  for (const l of validLines) {
    const it = itemsCache.find((x) => x.id === l.itemId);
    if (!it) continue;
    const color = (it.colors || []).find((c) => c.name === l.color);
    if (color && color.stock < l.qty) {
      return toast(`「${it.name}」${l.color ? "(" + l.color + ")" : ""} 库存不足（当前 ${color.stock} 件）`);
    }
  }
  for (const l of validLines) {
    const it = itemsCache.find((x) => x.id === l.itemId);
    if (!it) continue;
    const color = (it.colors || []).find((c) => c.name === l.color);
    if (color) {
      color.stock -= l.qty;
      color.sold = (color.sold || 0) + l.qty;
      await Store.saveItem(it);
    }
  }
  const order = {
    customer,
    phone,
    address,
    lines: validLines.map((l) => ({ ...l })),
    status: "pending",
    type: orderType,
    due: orderType === "custom" ? $("#oe-due").value || null : null,
    craft: orderType === "custom" ? $("#oe-craft").value.trim() : "",
    payStatus: onCredit ? "unpaid" : "paid",
    paidAmount: onCredit ? 0 : validLines.reduce((s, l) => s + l.qty * l.price, 0)
  };
  await Store.saveOrder(order);
  toast("订单已保存，库存已扣减" + (onCredit ? "（赊账）" : ""));
  await reloadAll();
  renderOrders();
  renderItems();
  renderToday();
  showView("orders");
}

/* ================= 盘点 ================= */

function openStocktake() {
  stocktakeDraft = {};
  renderStocktakeList();
  showView("stocktake");
}

function renderStocktakeList() {
  let list = itemsCache;
  if (stocktakeOnlyStocked) {
    list = list.filter((it) => (it.colors || []).some((c) => c.stock > 0));
  }
  const el = $("#stocktake-list");
  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">📋</span>没有可盘点的款式</div>';
    return;
  }
  el.innerHTML = list.map((it) => {
    const colors = (it.colors || []).map((c) => {
      const key = it.id + "::" + c.name;
      const val = stocktakeDraft[key] !== undefined ? stocktakeDraft[key] : "";
      return `<div class="st-row">
        <span class="st-name">${escapeHtml(c.name)}</span>
        <span class="st-book">账面 ${c.stock}</span>
        <input class="input st-input" data-key="${key}" type="number" inputmode="numeric" placeholder="实际数" value="${val}">
      </div>`;
    }).join("");
    return `<div class="card st-card">
      <h3>${escapeHtml(it.name)}</h3>
      ${colors}
    </div>`;
  }).join("");
  $$(".st-input").forEach((inp) => {
    inp.oninput = () => {
      const k = inp.dataset.key;
      const v = inp.value.trim();
      if (v === "") delete stocktakeDraft[k];
      else stocktakeDraft[k] = Number(v);
    };
  });
}

async function finishStocktake() {
  const lines = [];
  let count = 0;
  for (const [key, actual] of Object.entries(stocktakeDraft)) {
    const [itemId, colorName] = key.split("::");
    const it = itemsCache.find((x) => x.id === itemId);
    if (!it) continue;
    const color = (it.colors || []).find((c) => c.name === colorName);
    if (!color) continue;
    const book = color.stock;
    const diff = actual - book;
    lines.push({ itemId, itemName: it.name, color: colorName, book, actual, diff });
    color.stock = actual;
    await Store.saveItem(it);
    count++;
  }
  if (!count) return toast("还没有输入任何实际数量");
  const st = { lines };
  await Store.saveStocktake(st);
  toast(`盘点完成，共修正 ${count} 项`);
  stocktakeDraft = {};
  await reloadAll();
  renderItems();
  renderToday();
  showView("stocktake-history");
  renderStocktakeHistory();
}

function renderStocktakeHistory() {
  const el = $("#stocktake-history-list");
  if (!stocktakeCache.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">📋</span>还没有盘点记录</div>';
    return;
  }
  el.innerHTML = stocktakeCache.map((st) => {
    const diffs = (st.lines || []).filter((l) => l.diff !== 0);
    const totalDiff = diffs.reduce((s, l) => s + l.diff, 0);
    return `<div class="card">
      <div class="order-head">
        <span class="order-customer">盘点 · ${timeStr(st.time)}</span>
        <span class="order-status ${totalDiff === 0 ? "done" : "pending"}">差异 ${totalDiff > 0 ? "+" : ""}${totalDiff}</span>
      </div>
      ${diffs.length ? diffs.map((l) =>
        `<div class="detail-color-row"><span>${escapeHtml(l.itemName)} · ${escapeHtml(l.color)}</span><span class="v">账面 ${l.book} → 实际 ${l.actual}（${l.diff > 0 ? "+" : ""}${l.diff}）</span></div>`).join("")
        : '<div class="hint">本次盘点无差异</div>'}
    </div>`;
  }).join("");
}

/* ================= 送货入库（加工商送货） ================= */

async function renderPurchaseSelects(selectedItemId) {
  const selItem = $("#pu-item");
  selItem.innerHTML = itemsCache.map((it) => {
    const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
    return `<option value="${it.id}">${escapeHtml(it.name)}（库存 ${totalStock}）</option>`;
  }).join("");
  if (selectedItemId) selItem.value = selectedItemId;
  // 加工商下拉（来自加工厂档案）
  const selSup = $("#pu-supplier");
  if (selSup) {
    selSup.innerHTML = `<option value="">— 选择加工商 —</option>` + factoriesCache.map((f) =>
      `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`).join("");
  }
  updatePurchaseColor();
}

function updatePurchaseColor() {
  const it = itemsCache.find((x) => x.id === $("#pu-item").value);
  const selColor = $("#pu-color");
  selColor.innerHTML = (it && it.colors ? it.colors : []).map((c) =>
    `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}（库存 ${c.stock}）</option>`).join("");
}

function openPurchaseForItem(id) {
  showView("purchase");
  renderPurchaseSelects(id);
  renderPurchaseList();
}

function renderPurchaseList() {
  const el = $("#purchase-list");
  if (!purchaseCache.length) {
    el.innerHTML = '<div class="hint">还没有送货入库记录</div>';
    return;
  }
  el.innerHTML = purchaseCache.slice(0, 10).map((p) => {
    const it = itemsCache.find((x) => x.id === p.itemId);
    const name = it ? it.name : p.itemName;
    return `<div class="detail-color-row">
      <span>${escapeHtml(name)}${p.color ? " · " + escapeHtml(p.color) : ""} × ${p.qty}${p.supplier ? " · 加工商 " + escapeHtml(p.supplier) : ""}</span>
      <span class="v">${p.unitPrice ? money(p.unitPrice) + "/件" : ""} ${timeStr(p.time)}</span>
    </div>`;
  }).join("");
}

async function confirmPurchase() {
  const it = itemsCache.find((x) => x.id === $("#pu-item").value);
  if (!it) return toast("请选择款式");
  const colorName = $("#pu-color").value;
  const qty = Number($("#pu-qty").value);
  const unitPriceRaw = $("#pu-price").value.trim();
  const supplier = $("#pu-supplier").value.trim();
  if (!colorName) return toast("该款式还没有颜色，请先编辑添加");
  if (!(qty >= 1)) return toast("请填写正确的送货数量");
  const unitPrice = unitPriceRaw === "" ? null : Number(unitPriceRaw);
  const color = (it.colors || []).find((c) => c.name === colorName);
  if (!color) return toast("颜色不存在");
  color.stock += qty;
  await Store.saveItem(it);
  await Store.savePurchase({ itemId: it.id, itemName: it.name, color: colorName, qty, unitPrice, supplier });
  toast(`${supplier ? "加工商「" + supplier + "」" : ""}已入库 ${qty} 件`);
  $("#pu-qty").value = "1";
  $("#pu-price").value = "";
  await reloadAll();
  renderItems();
  renderPurchaseSelects();
  renderPurchaseList();
  renderToday();
}

/* ================= 批量改价 ================= */

function openBatchPrice() {
  batchSelected = new Set();
  renderBatchList();
  showView("batch-price");
}

function renderBatchList() {
  const el = $("#batch-item-list");
  if (!itemsCache.length) {
    el.innerHTML = '<div class="hint">还没有款式</div>';
    return;
  }
  el.innerHTML = itemsCache.map((it) => {
    const checked = batchSelected.has(it.id);
    return `<label class="batch-item">
      <input type="checkbox" data-id="${it.id}" ${checked ? "checked" : ""}>
      <span class="batch-name">${escapeHtml(it.name)}</span>
      <span class="batch-price">${money(it.price)}</span>
    </label>`;
  }).join("");
  $$("#batch-item-list input[type=checkbox]").forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) batchSelected.add(cb.dataset.id);
      else batchSelected.delete(cb.dataset.id);
      updateBatchCount();
    };
  });
  updateBatchCount();
}

function updateBatchCount() {
  const hint = $("#bp-hint");
  hint.textContent = batchSelected.size ? `已选 ${batchSelected.size} 个款式` : "请先选择款式";
}

async function applyBatchPrice() {
  if (!batchSelected.size) return toast("请先选择款式");
  const mode = $("#bp-mode").value;
  const val = Number($("#bp-value").value);
  if (!(val >= 0)) return toast("请输入有效的数值");
  let changed = 0;
  await Store.batchUpdateItems((it) => {
    if (!batchSelected.has(it.id)) return null;
    let newPrice;
    if (mode === "set") newPrice = val;
    else if (mode === "percent") newPrice = Math.round((it.price || 0) * val / 100 * 100) / 100;
    else newPrice = Math.max(0, (it.price || 0) + val);
    if (newPrice === it.price) return null;
    it.price = newPrice;
    changed++;
    return it;
  });
  toast(`已调整 ${changed} 个款式的售价`);
  await reloadAll();
  renderItems();
  openBatchPrice();
}

/* ================= 客户欠款 ================= */

function renderDebt() {
  const el = $("#debt-list");
  // 汇总：按客户名聚合订单欠款 + 赊账销售
  const debts = new Map();
  for (const o of ordersCache) {
    if (o.status === "cancelled") continue;
    const d = orderDebt(o);
    if (d <= 0) continue;
    const key = o.customer || "未知名客户";
    if (!debts.has(key)) debts.set(key, { name: key, amount: 0, count: 0 });
    const rec = debts.get(key);
    rec.amount += d;
    rec.count++;
  }
  for (const s of salesCache) {
    if (!s.onCredit) continue;
    const key = s.customer || "未知名客户";
    if (!debts.has(key)) debts.set(key, { name: key, amount: 0, count: 0 });
    const rec = debts.get(key);
    rec.amount += s.qty * s.price;
    rec.count++;
  }
  const list = [...debts.values()].sort((a, b) => b.amount - a.amount);
  if (!list.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">✅</span>暂无欠款记录</div>';
    return;
  }
  el.innerHTML = list.map((d) => `
    <div class="list-card">
      <div class="list-main">
        <div class="list-title">${escapeHtml(d.name)}</div>
        <div class="list-sub">${d.count} 笔未结清</div>
      </div>
      <div class="list-side">
        <div class="num" style="color:var(--danger)">${money(d.amount)}</div>
        <div class="lbl">欠款</div>
      </div>
    </div>`).join("");
}

/* ================= 统计 ================= */

function renderStats() {
  const sort = $("#stats-sort").value;
  const rows = itemsCache.map((it) => {
    const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
    const totalSold = (it.colors || []).reduce((s, c) => s + (c.sold || 0), 0);
    const profit = ((it.price || 0) - (it.cost || 0)) * totalSold;
    return { it, totalStock, totalSold, profit };
  });
  rows.sort((a, b) => {
    if (sort === "sold") return b.totalSold - a.totalSold;
    if (sort === "profit") return b.profit - a.profit;
    return b.totalStock - a.totalStock;
  });
  $("#stat-items").textContent = itemsCache.length;
  $("#stat-total-stock").textContent = rows.reduce((s, r) => s + r.totalStock, 0);
  $("#stat-total-sold").textContent = rows.reduce((s, r) => s + r.totalSold, 0);
  $("#stat-profit").textContent = fmt(rows.reduce((s, r) => s + r.profit, 0));
  const el = $("#stats-list");
  if (!rows.length) { el.innerHTML = '<div class="empty"><span class="empty-icon">📊</span>暂无数据<br>添加款式并产生销售后这里会展示统计</div>'; return; }
  el.innerHTML = rows.slice(0, 50).map((r) => `
    <div class="list-card">
      <div class="list-main">
        <div class="list-title">${escapeHtml(r.it.name)}</div>
        <div class="list-sub">库存 ${r.totalStock} · 已售 ${r.totalSold} · 单件利 ${money((r.it.price||0)-(r.it.cost||0))}</div>
      </div>
      <div class="list-side">
        <div class="num">${money(r.profit)}</div>
        <div class="lbl">利润</div>
      </div>
    </div>`).join("");
}

/* ================= 爆款推荐 ================= */

/** 跳转到电商/社区搜索页看爆款（不采集数据，仅打开链接） */
function jumpToSearch(platform) {
  const kw = encodeURIComponent(($("#trend-keyword").value.trim() || "羊毛衫"));
  const url = platform === "tb"
    ? "https://s.taobao.com/search?q=" + kw
    : "https://www.xiaohongshu.com/search_result?keyword=" + kw;
  window.open(url, "_blank");
}

/** 行业风向参考（羊毛衫市场常见热门，可后续联网更新） */
const INDUSTRY_TRENDS = [
  { name: "半高领/堆堆领打底衫", color: "燕麦色、驼色", note: "秋冬内搭刚需，走量快" },
  { name: "粗针织圆领毛衣", color: "米白、焦糖色", note: "外穿+叠穿两用，通用款" },
  { name: "羊毛开衫", color: "黑色、灰色", note: "通勤百搭，线下批发稳定" },
  { name: "高领加厚毛衣", color: "酒红、藏青", note: "保暖款，北方市场畅销" },
  { name: "V领羊绒衫", color: "浅粉、奶油白", note: "精致款，直播/网店热销" },
  { name: "提花/条纹毛衣", color: "红白、蓝白", note: "复古风回潮，年轻客群" }
];

function renderTrends() {
  // 1. 我的畅销款：按销量排序
  const rows = itemsCache.map((it) => {
    const totalSold = (it.colors || []).reduce((s, c) => s + (c.sold || 0), 0);
    const totalStock = (it.colors || []).reduce((s, c) => s + (c.stock || 0), 0);
    const profit = ((it.price || 0) - (it.cost || 0)) * totalSold;
    return { it, totalSold, totalStock, profit };
  }).filter((r) => r.totalSold > 0).sort((a, b) => b.totalSold - a.totalSold);

  const mineEl = $("#trends-mine");
  if (!rows.length) {
    mineEl.innerHTML = '<div class="empty"><span class="empty-icon">🔥</span>还没有销售数据<br>产生销售后自动分析你的畅销款</div>';
  } else {
    mineEl.innerHTML = rows.slice(0, 10).map((r, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "·";
      return `
      <div class="list-card" data-id="${r.it.id}">
        <div class="thumb">${medal}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(r.it.name)}</div>
          <div class="list-sub">已售 ${r.totalSold} 件 · 库存 ${r.totalStock} · 利润 ${money(r.profit)}</div>
          <div class="list-tags">${(r.it.colors || []).slice(0, 4).map((c) => `<span class="tag green">${escapeHtml(c.name)} ${c.stock}</span>`).join("")}</div>
        </div>
        <div class="list-side"><div class="num">#${i + 1}</div><div class="lbl">${r.it.price ? money(r.it.price) : ""}</div></div>
      </div>`;
    }).join("");
    $$("#trends-mine .list-card").forEach((card) => {
      card.onclick = () => openDetail(card.dataset.id);
    });
  }
  staggerIn(mineEl);

  // 2. 行业风向
  const indEl = $("#trends-industry");
  indEl.innerHTML = INDUSTRY_TRENDS.map((t) => `
    <div class="list-card">
      <div class="thumb">📈</div>
      <div class="list-main">
        <div class="list-title">${escapeHtml(t.name)}</div>
        <div class="list-sub">热门颜色：${escapeHtml(t.color)}</div>
        <div class="list-sub">${escapeHtml(t.note)}</div>
      </div>
      <div class="list-side"><div class="num">${t.color.split("、").length}</div><div class="lbl">参考色</div></div>
    </div>`).join("");
  staggerIn(indEl);
}

/* ================= 地址簿 ================= */

let editingAddrId = null;

function openAddrBook() {
  renderAddrBookList();
  showView("addrbook");
}

function renderAddrBookList() {
  const el = $("#addrbook-list");
  if (!addrCache.length) {
    el.innerHTML = '<div class="empty"><span class="empty-icon">📮</span>还没有地址<br>点下方 ＋ 新增地址</div>';
    return;
  }
  el.innerHTML = addrCache.map((a) => `
    <div class="list-card" data-id="${a.id}">
      <div class="list-main">
        <div class="list-title">${escapeHtml(a.name)}</div>
        <div class="list-sub">${escapeHtml(a.phone || "无电话")}</div>
        <div class="list-sub">📮 ${escapeHtml(a.address)}</div>
      </div>
      <div class="list-side"><div class="lbl" style="margin-top:20px">编辑 ›</div></div>
    </div>`).join("");
  $$("#addrbook-list .list-card").forEach((card) => {
    card.onclick = () => openAddrEdit(card.dataset.id);
  });
  staggerIn(el);
}

function openAddrEdit(id) {
  editingAddrId = id || null;
  const a = id ? addrCache.find((x) => x.id === id) : null;
  $("#ab-name").value = a ? a.name : "";
  $("#ab-phone").value = a ? a.phone || "" : "";
  $("#ab-address").value = a ? a.address || "" : "";
  showView("addr-edit");
}

async function saveAddrEdit() {
  const name = $("#ab-name").value.trim();
  const address = $("#ab-address").value.trim();
  if (!name) return toast("请填写地址名称");
  if (!address) return toast("请填写收货地址");
  const existing = editingAddrId ? addrCache.find((x) => x.id === editingAddrId) : null;
  await Store.saveAddr({
    id: editingAddrId || undefined,
    name,
    phone: $("#ab-phone").value.trim(),
    address,
    createdAt: existing ? existing.createdAt : undefined
  });
  toast("已保存");
  await reloadAll();
  renderAddrBookList();
  showView("addrbook");
}

/* ================= 设置 ================= */

async function initSettings() {
  const g = await Store.getGlobalLowStock();
  $("#set-lowstock").value = g || "";
  $("#account-info").textContent = `当前账号：${currentAccount.username}`;
  const sync = await Sync.config();
  $("#set-sync-url").value = sync.url || "";
  $("#set-sync-key").value = sync.key || "";
  $("#set-sync-auto").checked = !!sync.autoPull;
  const st = $("#sync-status");
  if (await Sync.isConfigured()) {
    st.textContent = "云同步已就绪 ✅（内置配置，换网址自动生效）";
    st.style.color = "var(--ok)";
  } else {
    st.textContent = "云同步未配置（可选）";
    st.style.color = "var(--text3)";
  }
  // 授权信息
  const licEl = $("#license-info-setting");
  const active = await License.checkActive();
  if (active.ok) {
    licEl.textContent = "已激活" + (active.name && active.name !== "本地模式" ? " · " + active.name : "") + " · 版本 " + APP_VERSION;
    licEl.style.color = "var(--ok)";
  } else {
    licEl.textContent = "未激活";
    licEl.style.color = "var(--danger)";
  }
  const about = $("#about-text");
  if (about) about.textContent = "羊毛衫管家 " + APP_VERSION + " · 数据保存在本机浏览器 · 支持云同步";
}

async function exportData() {
  const data = await Store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `knit-stock-backup-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast("已导出备份文件");
}

async function importData(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await Store.importAll(data);
    toast("导入成功");
    await reloadAll();
    renderItems();
  } catch (e) {
    toast("导入失败：" + (e.message || "文件格式错误"));
  }
}

/* ================= 登录 ================= */

function initAuth() {
  $("#auth-tab-login").onclick = () => setAuthTab("login");
  $("#auth-tab-register").onclick = () => setAuthTab("register");
  $("#auth-submit").onclick = () => submitAuth();
  $("#auth-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAuth();
  });
}

let authMode = "login";

function setAuthTab(mode) {
  authMode = mode;
  $("#auth-tab-login").classList.toggle("active", mode === "login");
  $("#auth-tab-register").classList.toggle("active", mode === "register");
  $("#auth-submit").textContent = mode === "login" ? "登录" : "注册";
  $("#auth-error").classList.add("hidden");
}

async function submitAuth() {
  const username = $("#auth-username").value.trim();
  const password = $("#auth-password").value;
  const errEl = $("#auth-error");
  errEl.classList.add("hidden");
  const res = authMode === "login"
    ? await Auth.login(username, password)
    : await Auth.register(username, password);
  if (!res.ok) {
    errEl.textContent = res.error;
    errEl.classList.remove("hidden");
    return;
  }
  currentAccount = res.account;
  setCurrentAccount(res.account.id);
  await Auth.remember(res.account.id);
  await enterApp();
}

async function enterApp() {
  // 授权检查：先确认是否已激活
  const active = await License.checkActive();
  if (!active.ok) {
    showLicenseScreen(active.error);
    return;
  }
  showMain();
  window.__initialLoad = true;
  await reloadAll();
  // 多设备同步：登录后自动从云端拉取该用户数据
  // （同一用户名在任何手机登录，都能拿到云端数据）
  try {
    if (await Sync.isConfigured()) {
      await Sync.pullIfExists();
      await reloadAll();
    }
  } catch (e) {
    // 同步失败不阻塞
  }
  window.__initialLoad = false;
  renderToday();
  renderItems();
  renderOrders();
  initSettings();
  startClock();
  showView("today");
  // 检查更新（不阻塞）
  checkUpdateSilently();
}

/* ============ 授权激活界面 ============ */

function showLicenseScreen(error) {
  $("#view-auth").classList.add("hidden");
  $("#view-main").classList.add("hidden");
  $("#view-license").classList.remove("hidden");
  $("#license-code").value = "";
  $("#license-tagline").textContent = error ? "授权状态：" + error : "请向软件管理方索取授权码";
  $("#license-info").textContent = "";
}

function hideLicenseScreen() {
  $("#view-license").classList.add("hidden");
}

async function submitLicense() {
  const code = $("#license-code").value.trim();
  const info = $("#license-info");
  info.textContent = "正在验证…";
  info.style.color = "var(--text2)";
  const res = await License.verify(code);
  if (!res.ok) {
    info.textContent = res.error;
    info.style.color = "var(--danger)";
    return;
  }
  await License.saveLocalCode(res.code || code.toUpperCase());
  info.textContent = "激活成功！欢迎 " + (res.name || "您");
  info.style.color = "var(--ok)";
  setTimeout(() => {
    hideLicenseScreen();
    enterApp();
  }, 800);
}

async function checkUpdateSilently() {
  try {
    const up = await License.checkUpdate();
    if (up.hasNew && up.url) {
      const go = await confirmModal("发现新版本 " + up.version, (up.notes || "有新版本可用") + "\n\n是否立即更新？");
      if (go && up.url) {
        window.open(up.url, "_blank");
      }
    }
  } catch (e) {}
}

async function logout() {
  await Auth.logout();
  currentAccount = null;
  itemsCache = [];
  ordersCache = [];
  addrCache = [];
  stocktakeCache = [];
  purchaseCache = [];
  salesCache = [];
  customersCache = [];
  factoriesCache = [];
  outsourcesCache = [];
  $("#view-main").classList.add("hidden");
  $("#view-license").classList.add("hidden");
  $("#view-auth").classList.remove("hidden");
  $("#auth-username").value = "";
  $("#auth-password").value = "";
  setAuthTab("login");
}

/* ================= 事件绑定 ================= */

function bindEvents() {
  // Tab 导航
  $$(".tab").forEach((t) => {
    t.onclick = () => {
      const v = t.dataset.view;
      if (v === "today") renderToday();
      if (v === "items") renderItems();
      if (v === "customers") renderCustomers();
      if (v === "orders") renderOrders();
      if (v === "settings") initSettings();
      showView(v);
    };
  });

  // 今日快捷入口
  $$(".quick-btn").forEach((b) => {
    b.onclick = () => {
      const go = b.dataset.go;
      if (go === "stocktake") openStocktake();
      else if (go === "purchase") openPurchaseForItem();
      else if (go === "stats") { renderStats(); showView("stats"); }
      else if (go === "quick-order") openQuickOrder();
      else if (go === "outsource") { renderOutsources(); showView("outsource"); }
      else if (go === "trends") { renderTrends(); showView("trends"); }
      else if (go === "addrbook") openAddrBook();
      else { const tab = $(`.tab[data-view=${go}]`); if (tab) tab.click(); }
    };
  });

  // 主题
  $("#theme-toggle").onclick = () => applyTheme(!isDark);

  // 新增款式 / 新订单 / 新客户 / 新加工厂
  $("#header-btn").onclick = () => {
    const v = currentView || ($(".tab.active") ? $(".tab.active").dataset.view : "items");
    if (v === "orders") openOrderEdit();
    else if (v === "customers") openCustomerEdit();
    else if (v === "factories") openFactoryEdit();
    else openItemEdit();
  };
  $("#user-btn").onclick = () => { showView("settings"); initSettings(); };

  // 搜索与筛选
  $("#item-search").oninput = debounce((e) => { itemSearch = e.target.value; renderItems(); }, 200);
  $("#filter-all").onclick = () => { itemFilter = "all"; setChips("all"); renderItems(); };
  $("#filter-low").onclick = () => { itemFilter = "low"; setChips("low"); renderItems(); };
  $("#filter-out").onclick = () => { itemFilter = "out"; setChips("out"); renderItems(); };

  // 款式编辑
  $("#ie-save").onclick = saveItemEdit;
  $("#ie-cancel").onclick = () => showView("items");
  $("#ie-add-img").onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.onchange = () => {
      Array.from(inp.files).forEach((f) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (editingImages.length >= 6) return toast("最多 6 张图片");
          editingImages.push(reader.result);
          renderImageThumbs();
        };
        reader.readAsDataURL(f);
      });
    };
    inp.click();
  };
  $("#ie-add-color").onclick = () => {
    if (editingColors.length >= 8) return toast("最多 8 个颜色");
    editingColors.push({ name: "", stock: 0 });
    renderColorEditor();
  };

  // 销售
  $("#sale-item").onchange = updateSaleColor;
  $("#sale-confirm").onclick = confirmSale;

  // 订单筛选
  const orderChip = (key) => () => { orderFilter = key; setOrderChips(key); renderOrders(); };
  $("#order-filter-today").onclick = orderChip("today");
  $("#order-filter-history").onclick = orderChip("history");
  $("#order-filter-all").onclick = orderChip("all");
  $("#order-filter-pending").onclick = orderChip("pending");
  $("#order-filter-done").onclick = orderChip("done");
  $("#order-filter-unship").onclick = orderChip("unship");
  $("#order-filter-debt").onclick = orderChip("debt");
  $("#order-filter-custom").onclick = orderChip("custom");
  // 排序切换：按时间 / 按金额
  $("#order-sort-btn").onclick = () => {
    orderSort = orderSort === "time" ? "amount" : "time";
    $("#order-sort-btn").textContent = orderSort === "time" ? "⏱ 按时间" : "💰 按金额";
    renderOrders();
  };
  // 订单类型
  $("#oe-type-stock").onclick = () => setOrderType("stock");
  $("#oe-type-custom").onclick = () => setOrderType("custom");

  // 订单批量操作
  $("#order-import-btn").onclick = openImport;
  $("#order-batch-done").onclick = batchMarkDone;
  $("#order-batch-cancel").onclick = exitOrderBatchMode;

  // 客户
  $("#customer-search").oninput = debounce((e) => { customerSearch = e.target.value; renderCustomers(); }, 200);
  $("#ce-save").onclick = saveCustomerEdit;
  $("#ce-cancel").onclick = () => { showView("customers"); renderCustomers(); };

  // 快速开单
  $("#qo-customer").onchange = updateQuickCustomerInfo;
  $("#qo-new-customer").onclick = () => openCustomerEdit();
  $("#qo-add-line").onclick = addQuickLine;
  $("#qo-save").onclick = () => saveQuickOrder(false);
  $("#qo-save-continue").onclick = () => saveQuickOrder(true);
  // 语音/文字快速加商品
  $("#qo-voice-btn").onclick = startVoiceQuickOrder;
  $("#qo-text-btn").onclick = () => parseQuickText($("#qo-voice-text").value);
  $("#qo-voice-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); parseQuickText($("#qo-voice-text").value); }
  });

  // 批量导入
  $("#import-preview").onclick = previewImport;
  $("#import-do").onclick = doImport;

  // 外发加工
  $("#os-new").onclick = openOutsourceEdit;
  $("#os-factories").onclick = () => { renderFactories(); showView("factories"); };
  $("#os-save").onclick = saveOutsource;
  $("#os-cancel").onclick = () => { renderOutsources(); showView("outsource"); };
  $("#os-filter-all").onclick = () => { osFilter = "all"; setOsChips("all"); renderOutsources(); };
  $("#os-filter-active").onclick = () => { osFilter = "active"; setOsChips("active"); renderOutsources(); };
  $("#os-filter-overdue").onclick = () => { osFilter = "overdue"; setOsChips("overdue"); renderOutsources(); };
  $("#os-filter-settled").onclick = () => { osFilter = "settled"; setOsChips("settled"); renderOutsources(); };
  $("#os-factory").onchange = () => {
    const f = factoriesCache.find((x) => x.id === $("#os-factory").value);
    if (f && f.price && !$("#os-price").value) $("#os-price").value = f.price;
  };
  // 加工厂
  $("#fa-new").onclick = () => openFactoryEdit();
  $("#fa-save").onclick = saveFactoryEdit;
  $("#fa-cancel").onclick = () => { renderFactories(); showView("factories"); };

  // 地址簿
  $("#ab-new").onclick = () => openAddrEdit();
  $("#ab-save").onclick = saveAddrEdit;
  $("#ab-cancel").onclick = () => { renderAddrBookList(); showView("addrbook"); };

  // 经营报表（周报/月报）
  $("#rp-week").onclick = () => openReport("week");
  $("#rp-month").onclick = () => openReport("month");

  // 线上爆款速查（跳转淘宝/小红书）
  $("#trend-tb").onclick = () => jumpToSearch("tb");
  $("#trend-xhs").onclick = () => jumpToSearch("xhs");

  // 订单编辑
  $("#oe-save").onclick = saveOrder;
  $("#oe-cancel").onclick = () => { showView("orders"); renderOrders(); };
  $("#oe-add-line").onclick = addOrderLine;
  // 选择已有客户（自动填充姓名/电话/地址）
  $("#oe-customer-pick").onclick = () => {
    const id = $("#oe-customer-select").value;
    if (!id) return toast("请先选择客户");
    const c = customersCache.find((x) => x.id === id);
    if (!c) return;
    $("#oe-customer").value = c.name;
    if (c.phone) $("#oe-phone").value = c.phone;
    if (c.address) $("#oe-address").value = c.address;
    toast(`已选择客户「${c.name}」，信息已填充`);
  };
  $("#oe-addr-pick").onclick = async () => {
    const id = $("#oe-addr-book").value;
    if (!id) return toast("请先选择地址");
    const a = addrCache.find((x) => x.id === id);
    if (!a) return;
    $("#oe-address").value = a.address || "";
    if (a.phone && !$("#oe-phone").value) $("#oe-phone").value = a.phone;
    toast(`已调用「${a.name}」的地址`);
  };
  $("#oe-save-addr").onclick = async () => {
    const name = $("#oe-customer").value.trim();
    const phone = $("#oe-phone").value.trim();
    const address = $("#oe-address").value.trim();
    if (!name || !address) return toast("请先填写客户姓名和地址");
    await Store.saveAddr({ name, phone, address });
    await reloadAll();
    await renderAddrBook();
    toast("已保存到地址簿");
  };

  // 盘点
  $("#st-filter-all").onclick = () => { stocktakeOnlyStocked = false; setStocktakeChips("all"); renderStocktakeList(); };
  $("#st-filter-stocked").onclick = () => { stocktakeOnlyStocked = true; setStocktakeChips("stocked"); renderStocktakeList(); };
  $("#st-finish").onclick = finishStocktake;
  $("#st-history").onclick = () => { renderStocktakeHistory(); showView("stocktake-history"); };

  // 进货
  $("#pu-item").onchange = updatePurchaseColor;
  $("#pu-confirm").onclick = confirmPurchase;

  // 批量改价
  $("#bp-mode").onchange = () => {
    const lbl = $("#bp-value-lbl");
    const m = $("#bp-mode").value;
    lbl.textContent = m === "set" ? "新售价（元）" : m === "percent" ? "调整百分比（如 90 = 打九折，110 = 加价10%）" : "加/减金额（元，负数减价）";
  };
  $("#bp-apply").onclick = applyBatchPrice;

  // 统计排序
  $("#stats-sort").onchange = renderStats;

  // 设置
  $("#set-lowstock-save").onclick = async () => {
    const v = Number($("#set-lowstock").value);
    if (!(v >= 0)) return toast("请输入正确的数值");
    await Store.setGlobalLowStock(v);
    toast("已保存，警告线为 " + v + " 件");
    await reloadAll();
    renderItems();
  };
  $("#set-sync-save").onclick = async () => {
    const url = $("#set-sync-url").value.trim();
    const key = $("#set-sync-key").value.trim();
    const auto = $("#set-sync-auto").checked;
    if (url && !key) return toast("填了 URL 也需要填 key");
    await Sync.saveConfig({ url, key, autoPull: auto });
    toast("同步配置已保存");
    initSettings();
  };
  $("#set-sync-test").onclick = async () => {
    const st = $("#sync-status");
    st.textContent = "正在测试连接…";
    st.style.color = "var(--text2)";
    try {
      await Sync.testConnection();
      st.textContent = "连接成功 ✅ 配置有效";
      st.style.color = "var(--ok)";
      toast("连接成功");
    } catch (e) {
      st.textContent = "连接失败：" + e.message;
      st.style.color = "var(--danger)";
      toast("连接失败");
    }
  };
  $("#set-sync-upload").onclick = async () => {
    try {
      await Sync.upload();
      toast("已上传到云端");
    } catch (e) {
      toast("上传失败：" + e.message);
    }
  };
  $("#set-sync-pull").onclick = async () => {
    try {
      await Sync.pull();
      await reloadAll();
      toast("已从云端拉取");
      renderItems();
    } catch (e) {
      toast("拉取失败：" + e.message);
    }
  };
  $("#set-export").onclick = exportData;
  $("#set-import").onclick = () => $("#set-import-file").click();
  $("#set-import-file").onchange = (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  };
  $("#set-logout").onclick = async () => {
    if (await confirmModal("退出登录", "确定退出当前账号吗？")) logout();
  };
  // 授权
  $("#license-submit").onclick = submitLicense;
  $("#license-code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitLicense();
  });
  $("#set-reactivate").onclick = () => {
    showLicenseScreen();
  };
  $("#set-check-update").onclick = async () => {
    const res = $("#update-result");
    res.textContent = "正在检查…";
    res.style.color = "var(--text2)";
    const up = await checkAppUpdate();
    if (up.hasNew) {
      res.innerHTML = `发现新版本 <b>${up.version}</b>${up.notes ? "：" + escapeHtml(up.notes) : ""}`;
      res.style.color = "var(--warn)";
      const go = await confirmModal(
        "发现新版本 " + up.version,
        (up.notes ? "更新内容：" + up.notes + "\n\n" : "") + "点击「确定」立即更新，无需重新安装或重新添加到桌面，更新完成后刷新即为最新版。"
      );
      if (go) await doAppUpdate();
    } else {
      res.textContent = "已是最新版本（" + APP_VERSION + "）";
      res.style.color = "var(--ok)";
    }
  };
}

/** 检查是否有新版本：优先读取站点 version.json（部署时自动生成），失败则回退到云端版本表 */
async function checkAppUpdate() {
  try {
    const base = location.origin + location.pathname.replace(/[^/]*$/, "");
    const r = await fetch(base + "version.json?v=" + Date.now(), { cache: "no-store" });
    if (r.ok) {
      const v = await r.json();
      if (v && v.version && v.version !== APP_VERSION) {
        return { hasNew: true, version: v.version, notes: v.notes || "" };
      }
      return { hasNew: false };
    }
  } catch {}
  try {
    const up = await License.checkUpdate();
    return up && up.hasNew ? up : { hasNew: false };
  } catch {
    return { hasNew: false };
  }
}

/** 执行更新：清缓存 + 更新 Service Worker + 刷新页面 */
async function doAppUpdate() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
  } catch {}
  toast("正在更新…");
  setTimeout(() => window.location.reload(), 600);
}

function setChips(which) {
  $("#filter-all").classList.toggle("active", which === "all");
  $("#filter-low").classList.toggle("active", which === "low");
  $("#filter-out").classList.toggle("active", which === "out");
}

function setOrderChips(which) {
  $("#order-filter-today").classList.toggle("active", which === "today");
  $("#order-filter-history").classList.toggle("active", which === "history");
  $("#order-filter-all").classList.toggle("active", which === "all");
  $("#order-filter-pending").classList.toggle("active", which === "pending");
  $("#order-filter-done").classList.toggle("active", which === "done");
  $("#order-filter-unship").classList.toggle("active", which === "unship");
  $("#order-filter-debt").classList.toggle("active", which === "debt");
  $("#order-filter-custom").classList.toggle("active", which === "custom");
}

function setStocktakeChips(which) {
  $("#st-filter-all").classList.toggle("active", which === "all");
  $("#st-filter-stocked").classList.toggle("active", which === "stocked");
}

function setOsChips(which) {
  $("#os-filter-all").classList.toggle("active", which === "all");
  $("#os-filter-active").classList.toggle("active", which === "active");
  $("#os-filter-overdue").classList.toggle("active", which === "overdue");
  $("#os-filter-settled").classList.toggle("active", which === "settled");
}

/* ================= 启动 ================= */

(async function init() {
  bindEvents();
  initAuth();
  // 主题恢复
  let theme = "light";
  try { theme = localStorage.getItem("knit-theme") || "light"; } catch {}
  applyTheme(theme === "dark");
  // 字体大小恢复
  initFontSize();
  // 恢复上次登录
  const saved = await Auth.restore();
  if (saved) {
    currentAccount = saved;
    setCurrentAccount(saved.id);
    await enterApp();
  } else {
    setAuthTab("login");
  }
  // 注册 service worker + 自动更新机制
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      // 检测到新 sw 就绪时自动刷新，确保用户拿到最新版
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "activated" && navigator.serviceWorker.controller) {
            // 新 sw 已接管，刷新页面加载最新版
            setTimeout(() => window.location.reload(), 300);
          }
        });
      });
    }).catch(() => {});
  }
})();
