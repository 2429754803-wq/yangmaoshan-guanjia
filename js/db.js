/**
 * 数据层：IndexedDB 封装（2.0 版）
 *
 * 账号架构：
 *  - meta 库 (knit-stock-meta)：账号列表 {id, username, salt, hash} + 设置
 *  - 每账号一个数据库 (knit-stock-<accountId>)：
 *      items      - 款式 { id, name, price, cost, images:[dataURL], colors:[{name, stock, sold}], lowStock, createdAt }
 *      sales      - 销售记录 { id, itemId, itemName, color, qty, price, customer, time }
 *      orders     - 订单 { id, customer, phone, address, lines:[{itemId, itemName, color, qty, price, shipped}], status:'pending'|'done'|'cancelled',
 *                          payStatus:'unpaid'|'partial'|'paid', paidAmount, createdAt, doneAt, shippedAt }
 *      addrs      - 地址簿 { id, name, phone, address }
 *      stocktakes - 盘点记录 { id, time, lines:[{itemId, itemName, color, book, actual, diff}] }
 *      purchases  - 送货入库记录 { id, itemId, itemName, color, qty, unitPrice(工费), supplier(加工商), time }
 *  - 同步接口：每账号数据 export/import（未来接 Supabase）
 */

const META_DB = "knit-stock-meta";
const META_VERSION = 1;
const DATA_VERSION = 4;

/* ---------------- 通用 IndexedDB 封装 ---------------- */

function openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (upgrade) upgrade(db, e);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(dbP, store, mode, fn) {
  return dbP.then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function getAll(dbP, store) {
  return tx(dbP, store, "readonly", (s) => s.getAll()).then((req) => req.result || []);
}

function get(dbP, store, id) {
  return tx(dbP, store, "readonly", (s) => s.get(id)).then((req) => req.result);
}

function put(dbP, store, obj) {
  return tx(dbP, store, "readwrite", (s) => s.put(obj));
}

function del(dbP, store, id) {
  return tx(dbP, store, "readwrite", (s) => s.delete(id));
}

function clearStore(dbP, store) {
  return tx(dbP, store, "readwrite", (s) => s.clear());
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- 密码哈希 ---------------- */

async function sha256(text) {
  // 超时保护：crypto.subtle 在某些环境（headless/旧浏览器）可能挂起
  try {
    const result = await Promise.race([
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("sha-timeout")), 2000))
    ]);
    return Array.from(new Uint8Array(result)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    // 降级：简单确定性哈希（不依赖 crypto.subtle），保证注册/登录永不卡死
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h1 = ((h1 ^ s.charCodeAt(i)) * 16777619) >>> 0;
      h2 = ((h2 * 31) + s.charCodeAt(i)) >>> 0;
    }
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + "fallback";
  }
}

function randomSalt() {
  try {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    // 降级：用时间戳+随机数
    return Date.now().toString(16) + Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
  }
}

/* ---------------- Meta 库 ---------------- */

let _metaDb = null;
function metaDb() {
  if (!_metaDb) {
    _metaDb = openDB(META_DB, META_VERSION, (db) => {
      if (!db.objectStoreNames.contains("accounts")) db.createObjectStore("accounts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
    });
  }
  return _metaDb;
}

async function getAllAccounts() {
  return getAll(metaDb(), "accounts");
}

async function getSetting(key, fallback) {
  const v = await get(metaDb(), "settings", key);
  return v ? v.value : fallback;
}

async function setSetting(key, value) {
  await put(metaDb(), "settings", { key, value });
}

/* ---------------- 当前账号数据库 ---------------- */

let _currentAccountId = null;
let _dataDb = null;

function currentAccountId() {
  return _currentAccountId;
}

function setCurrentAccount(accountId) {
  _currentAccountId = accountId;
  _dataDb = null;
}

function dataDb(accountId) {
  const aid = accountId || _currentAccountId;
  if (!aid) throw new Error("未登录");
  if (_dataDb && _currentAccountId === aid) return _dataDb;
  _currentAccountId = aid;
  _dataDb = openDB(`knit-stock-${aid}`, DATA_VERSION, (db, e) => {
    if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
    if (!db.objectStoreNames.contains("sales")) db.createObjectStore("sales", { keyPath: "id" });
    if (!db.objectStoreNames.contains("orders")) db.createObjectStore("orders", { keyPath: "id" });
    if (!db.objectStoreNames.contains("addrs")) db.createObjectStore("addrs", { keyPath: "id" });
    if (!db.objectStoreNames.contains("stocktakes")) db.createObjectStore("stocktakes", { keyPath: "id" });
    if (!db.objectStoreNames.contains("purchases")) db.createObjectStore("purchases", { keyPath: "id" });
    if (!db.objectStoreNames.contains("customers")) db.createObjectStore("customers", { keyPath: "id" });
    if (!db.objectStoreNames.contains("factories")) db.createObjectStore("factories", { keyPath: "id" });
    if (!db.objectStoreNames.contains("outsources")) db.createObjectStore("outsources", { keyPath: "id" });
  });
  return _dataDb;
}

/* ---------------- 账号 API（云端注册/登录，多手机共用同一账号） ---------------- */

const Auth = {
  /**
   * 注册：用户名全局唯一（云端）。
   * 密码只传哈希（SHA-256 加盐），明文不上传。
   */
  async register(username, password) {
    try {
      username = (username || "").trim();
      if (!username) return { ok: false, error: "请输入用户名" };
      if ((password || "").length < 4) return { ok: false, error: "密码至少 4 位" };
      // 本地先建（离线可用），同时尝试云端注册
      const localAccounts = await getAllAccounts();
      if (localAccounts.some((a) => a.username === username)) {
        return { ok: false, error: "该用户名已在本地注册过，请直接登录" };
      }
      const salt = randomSalt();
      const hash = await sha256(password + ":" + salt);
      // 尝试云端注册（未配置云端则纯本地模式）
      let cloudOk = false;
      try {
        const rows = await Sync.request("/rest/v1/cloud_users?username=eq." + encodeURIComponent(username) + "&select=username", {});
        if (rows && rows.length) {
          return { ok: false, error: "该用户名已被注册，请直接登录" };
        }
        await Sync.request("/rest/v1/cloud_users", {
          method: "POST",
          headers: { "Prefer": "return=minimal" },
          body: JSON.stringify({ username, salt, hash })
        });
        cloudOk = true;
      } catch (e) {
        // 云端不可用：降级为本地注册
      }
      const account = { id: uid(), username, salt, hash, createdAt: Date.now(), cloud: cloudOk };
      await put(metaDb(), "accounts", account);
      return { ok: true, account, cloud: cloudOk };
    } catch (e) {
      return { ok: false, error: "注册失败：" + e.message };
    }
  },

  /**
   * 登录：优先云端验证（支持多手机同一账号），云端不可用时用本地。
   */
  async login(username, password) {
    try {
      username = (username || "").trim();
      const localAccounts = await getAllAccounts();
      // 尝试云端验证
      try {
        const rows = await Sync.request("/rest/v1/cloud_users?username=eq." + encodeURIComponent(username) + "&select=username,salt,hash", {});
        if (rows && rows.length) {
          const cu = rows[0];
          const hash = await sha256(password + ":" + cu.salt);
          if (hash !== cu.hash) return { ok: false, error: "密码错误" };
          // 云端验证通过：本地建档（若不存在）
          let account = localAccounts.find((a) => a.username === username);
          if (!account) {
            account = { id: uid(), username, salt: cu.salt, hash: cu.hash, createdAt: Date.now(), cloud: true };
            await put(metaDb(), "accounts", account);
          }
          return { ok: true, account, cloud: true };
        }
      } catch (e) {
        // 云端不可用：走本地
      }
      // 本地验证
      const account = localAccounts.find((a) => a.username === username);
      if (!account) return { ok: false, error: "用户名不存在（离线状态下仅能登录本机注册过的账号）" };
      const hash = await sha256(password + ":" + account.salt);
      if (hash !== account.hash) return { ok: false, error: "密码错误" };
      return { ok: true, account, cloud: false };
    } catch (e) {
      return { ok: false, error: "登录失败：" + e.message };
    }
  },

  async remember(accountId) {
    await setSetting("currentAccount", accountId);
  },

  async restore() {
    const id = await getSetting("currentAccount", null);
    if (!id) return null;
    const accounts = await getAllAccounts();
    return accounts.find((a) => a.id === id) || null;
  },

  async logout() {
    await setSetting("currentAccount", null);
    setCurrentAccount(null);
  }
};

/* ---------------- 数据 API ---------------- */

let _globalLowStock = 5;

const Store = {
  async refreshGlobalLowStock() {
    const v = await getSetting("lowStockGlobal", 5);
    _globalLowStock = (typeof v === "number" && v >= 0) ? v : 5;
    return _globalLowStock;
  },
  async getGlobalLowStock() {
    return this.refreshGlobalLowStock();
  },
  async setGlobalLowStock(n) {
    await setSetting("lowStockGlobal", n);
    _globalLowStock = n;
  },

  isLowStock(item, colorName) {
    const hasPerItem = item.lowStock !== undefined && item.lowStock !== null && item.lowStock !== "";
    const threshold = hasPerItem ? item.lowStock : _globalLowStock;
    const color = (item.colors || []).find((c) => c.name === colorName);
    return color !== undefined && color.stock <= threshold;
  },
  isItemLowStock(item) {
    return (item.colors || []).some((c) => this.isLowStock(item, c.name));
  },

  /* ---- 款式 ---- */
  async listItems() { return getAll(dataDb(), "items"); },
  async getItem(id) { return get(dataDb(), "items", id); },
  async saveItem(item) {
    if (!item.id) item.id = uid();
    if (!item.createdAt) item.createdAt = Date.now();
    await put(dataDb(), "items", item);
    return item;
  },
  async deleteItem(id) { await del(dataDb(), "items", id); },
  async batchUpdateItems(updater) {
    const d = dataDb();
    const items = await getAll(d, "items");
    for (const it of items) {
      const next = updater(it);
      if (next) await put(d, "items", next);
    }
    return items.length;
  },

  /* ---- 销售 ---- */
  async listSales() { return getAll(dataDb(), "sales"); },
  async addSale(sale) {
    sale.id = uid();
    sale.time = Date.now();
    await put(dataDb(), "sales", sale);
    return sale;
  },

  /* ---- 订单 ---- */
  async listOrders() { return getAll(dataDb(), "orders"); },
  async getOrder(id) { return get(dataDb(), "orders", id); },
  async saveOrder(order) {
    if (!order.id) order.id = uid();
    if (!order.createdAt) order.createdAt = Date.now();
    await put(dataDb(), "orders", order);
    return order;
  },
  async setOrderStatus(id, status) {
    const o = await get(dataDb(), "orders", id);
    if (!o) throw new Error("订单不存在");
    o.status = status;
    o.doneAt = status === "done" ? Date.now() : null;
    await put(dataDb(), "orders", o);
    return o;
  },
  async setOrderPay(id, payStatus, paidAmount) {
    const o = await get(dataDb(), "orders", id);
    if (!o) throw new Error("订单不存在");
    o.payStatus = payStatus;
    o.paidAmount = paidAmount;
    await put(dataDb(), "orders", o);
    return o;
  },
  async deleteOrder(id) { await del(dataDb(), "orders", id); },

  /* ---- 地址簿 ---- */
  async listAddrs() { return getAll(dataDb(), "addrs"); },
  async saveAddr(addr) {
    if (!addr.id) addr.id = uid();
    await put(dataDb(), "addrs", addr);
    return addr;
  },
  async deleteAddr(id) { await del(dataDb(), "addrs", id); },

  /* ---- 客户档案（2.2 散单改善） ---- */
  async listCustomers() { return getAll(dataDb(), "customers"); },
  async getCustomer(id) { return get(dataDb(), "customers", id); },
  async saveCustomer(c) {
    if (!c.id) c.id = uid();
    if (!c.createdAt) c.createdAt = Date.now();
    await put(dataDb(), "customers", c);
    return c;
  },
  async deleteCustomer(id) { await del(dataDb(), "customers", id); },

  /** 按名字找客户（用于导入时自动匹配） */
  async findCustomerByName(name) {
    const list = await getAll(dataDb(), "customers");
    return list.find((c) => c.name === name) || null;
  },

  /* ---- 盘点 ---- */
  async listStocktakes() { return getAll(dataDb(), "stocktakes"); },
  async saveStocktake(st) {
    if (!st.id) st.id = uid();
    if (!st.time) st.time = Date.now();
    await put(dataDb(), "stocktakes", st);
    return st;
  },

  /* ---- 进货 ---- */
  async listPurchases() { return getAll(dataDb(), "purchases"); },
  async savePurchase(p) {
    if (!p.id) p.id = uid();
    if (!p.time) p.time = Date.now();
    await put(dataDb(), "purchases", p);
    return p;
  },

  /* ---- 加工厂（外发加工 2.3） ---- */
  async listFactories() { return getAll(dataDb(), "factories"); },
  async getFactory(id) { return get(dataDb(), "factories", id); },
  async saveFactory(f) {
    if (!f.id) f.id = uid();
    if (!f.createdAt) f.createdAt = Date.now();
    await put(dataDb(), "factories", f);
    return f;
  },
  async deleteFactory(id) { await del(dataDb(), "factories", id); },

  /* ---- 外发单 ---- */
  async listOutsources() { return getAll(dataDb(), "outsources"); },
  async getOutsource(id) { return get(dataDb(), "outsources", id); },
  async saveOutsource(o) {
    if (!o.id) o.id = uid();
    if (!o.createdAt) o.createdAt = Date.now();
    await put(dataDb(), "outsources", o);
    return o;
  },
  async deleteOutsource(id) { await del(dataDb(), "outsources", id); },

  /* ---- 导出/导入/同步 payload ---- */
  async exportAll() {
    const [items, sales, orders, addrs, stocktakes, purchases, customers, factories, outsources] = await Promise.all([
      getAll(dataDb(), "items"), getAll(dataDb(), "sales"), getAll(dataDb(), "orders"),
      getAll(dataDb(), "addrs"), getAll(dataDb(), "stocktakes"), getAll(dataDb(), "purchases"),
      getAll(dataDb(), "customers"), getAll(dataDb(), "factories"), getAll(dataDb(), "outsources")
    ]);
    return { app: "knit-stock", version: 4, exportedAt: Date.now(), items, sales, orders, addrs, stocktakes, purchases, customers, factories, outsources };
  },

  async importAll(data) {
    if (!data || data.app !== "knit-stock") throw new Error("不是有效的备份文件");
    const d = dataDb();
    await Promise.all([
      (async () => { for (const x of data.items || []) await put(d, "items", x); })(),
      (async () => { for (const x of data.sales || []) await put(d, "sales", x); })(),
      (async () => { for (const x of data.orders || []) await put(d, "orders", x); })(),
      (async () => { for (const x of data.addrs || []) await put(d, "addrs", x); })(),
      (async () => { for (const x of data.stocktakes || []) await put(d, "stocktakes", x); })(),
      (async () => { for (const x of data.purchases || []) await put(d, "purchases", x); })(),
      (async () => { for (const x of data.customers || []) await put(d, "customers", x); })(),
      (async () => { for (const x of data.factories || []) await put(d, "factories", x); })(),
      (async () => { for (const x of data.outsources || []) await put(d, "outsources", x); })()
    ]);
  },

  /** 合并导入：按 id 去重，云端优先，保留本地独有的（多设备合并用） */
  async mergeImport(cloud) {
    if (!cloud || cloud.app !== "knit-stock") return;
    const d = dataDb();
    const merge = async (store, list) => {
      const local = await getAll(d, store);
      const byId = new Map(local.map((x) => [x.id, x]));
      for (const x of list || []) {
        if (x && x.id) byId.set(x.id, x); // 云端覆盖同 id
      }
      for (const x of byId.values()) await put(d, store, x);
    };
    await Promise.all([
      merge("items", cloud.items), merge("sales", cloud.sales), merge("orders", cloud.orders),
      merge("addrs", cloud.addrs), merge("stocktakes", cloud.stocktakes), merge("purchases", cloud.purchases),
      merge("customers", cloud.customers), merge("factories", cloud.factories), merge("outsources", cloud.outsources)
    ]);
  },

  async clearAll() {
    const d = dataDb();
    await Promise.all([
      clearStore(d, "items"), clearStore(d, "sales"), clearStore(d, "orders"),
      clearStore(d, "addrs"), clearStore(d, "stocktakes"), clearStore(d, "purchases"),
      clearStore(d, "customers"), clearStore(d, "factories"), clearStore(d, "outsources")
    ]);
  }
};

/* ---------------- 云同步（Supabase 可配置） ----------------
 * 用户可在设置页填入 Supabase URL + key 启用。
 * 兼容新旧 key：eyJ...(JWT) 或 sb_publishable_/sb_secret_ 新版格式。
 * 认证规则：key 放 apikey header；JWT 格式额外放 Authorization: Bearer。
 * 每次导出全部数据为一个 JSON 文档，存到 supabase 表 `knit_sync`（行键 = 账号 id）。
 */
const Sync = {
  /** 内置默认配置（发布时内置，换网址自动生效，无需手动配置）
   *  用户在设置页手动填写的配置会覆盖内置值 */
  BUILTIN: {
    url: "https://qdbwjkwhrftaovqbnxha.supabase.co",
    key: "sb_publishable_HUI_HJChS3_Hc6iZMDibLQ_fC7teUbl"
  },

  async config() {
    const savedUrl = await getSetting("supabaseUrl", "");
    const savedKey = await getSetting("supabaseKey", "");
    return {
      url: savedUrl || this.BUILTIN.url,
      key: savedKey || this.BUILTIN.key,
      autoPull: await getSetting("syncAutoPull", false)
    };
  },
  async saveConfig(cfg) {
    if (cfg.url) await setSetting("supabaseUrl", cfg.url.trim().replace(/\/+$/, ""));
    if (cfg.key) await setSetting("supabaseKey", cfg.key.trim());
    await setSetting("syncAutoPull", !!cfg.autoPull);
  },
  async isConfigured() {
    const c = await this.config();
    return !!(c.url && c.key);
  },

  /** 统一请求封装：正确处理新旧 key 认证，带超时（防止网络问题卡死） */
  async request(path, options = {}) {
    const c = await this.config();
    if (!c.url || !c.key) throw new Error("未配置云同步");
    const key = c.key.trim();
    const headers = {
      "Content-Type": "application/json",
      "apikey": key,
      ...(options.headers || {})
    };
    // 新版 key（sb_ 开头）不是 JWT，不能放 Bearer；旧版 JWT 需要放
    if (!key.startsWith("sb_")) {
      headers["Authorization"] = "Bearer " + key;
    }
    // 双重超时保护：AbortController + Promise.race，确保网络异常时快速失败
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let res;
    try {
      res = await Promise.race([
        fetch(c.url + path, { ...options, headers, signal: controller.signal }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("网络超时")), 7000))
      ]);
    } catch (e) {
      throw new Error("网络连接失败（" + (e.name === "AbortError" ? "超时" : e.message) + "）");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error("请求失败 (" + res.status + ")" + (body ? ": " + body.slice(0, 120) : ""));
    }
    const ct = res.headers.get("content-type") || "";
    return ct.includes("json") ? res.json() : res.text();
  },

  /** 测试连接：查询 licenses 表，验证 URL + key 是否有效 */
  async testConnection() {
    await this.request("/rest/v1/licenses?select=code&limit=1");
    return true;
  },

  async upload() {
    const username = currentAccount ? currentAccount.username : null;
    if (!username) throw new Error("未登录");
    const payload = await Store.exportAll();
    const row = { username, data: payload, updated_at: new Date().toISOString() };
    await this.request("/rest/v1/knit_sync", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row)
    });
    return true;
  },
  async pull() {
    const username = currentAccount ? currentAccount.username : null;
    if (!username) throw new Error("未登录");
    const rows = await this.request("/rest/v1/knit_sync?username=eq." + encodeURIComponent(username) + "&select=data");
    if (!rows || !rows.length || !rows[0].data) throw new Error("云端暂无数据");
    await Store.importAll(rows[0].data);
    return rows[0].data;
  },

  /** 登录时安全拉取：云端有该用户数据才拉（避免本地数据被空覆盖） */
  async pullIfExists() {
    const username = currentAccount ? currentAccount.username : null;
    if (!username) return false;
    try {
      const rows = await this.request("/rest/v1/knit_sync?username=eq." + encodeURIComponent(username) + "&select=data");
      if (rows && rows.length && rows[0].data) {
        const cloud = rows[0].data;
        const cloudHasData = (cloud.items && cloud.items.length) || (cloud.orders && cloud.orders.length) || (cloud.customers && cloud.customers.length) || (cloud.outsources && cloud.outsources.length);
        if (cloudHasData) {
          const local = await Store.exportAll();
          const localHasData = (local.items && local.items.length) || (local.orders && local.orders.length) || (local.customers && local.customers.length) || (local.outsources && local.outsources.length);
          if (!localHasData) {
            // 本地为空：直接用云端数据
            await Store.importAll(cloud);
          } else {
            // 两端都有：合并去重（以 id 为键，云端优先，保留本地独有的）
            await Store.mergeImport(cloud);
          }
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }
};

/* ---------------- 授权与版本（2.4 工厂版） ---------------- */

const APP_VERSION = "2.8";

const License = {
  /** 当前账号绑定的授权码（本地记录） */
  async localCode() {
    return getSetting("licenseCode:" + currentAccountId(), null);
  },
  async saveLocalCode(code) {
    await setSetting("licenseCode:" + currentAccountId(), code);
  },
  async clearLocalCode() {
    await setSetting("licenseCode:" + currentAccountId(), null);
  },

  /** 验证授权码：{ok, error, name, code, offline} */
  async verify(code) {
    const c = await Sync.config();
    if (!c.url || !c.key) {
      // 未配置云端时：放行（本地单机模式）
      return { ok: true, name: "本地模式", offline: true };
    }
    code = (code || "").trim().toUpperCase();
    if (!code) return { ok: false, error: "请输入授权码" };
    try {
      const rows = await Sync.request("/rest/v1/licenses?code=eq." + encodeURIComponent(code) + "&select=code,name,revoked_at");
      if (!rows || !rows.length) return { ok: false, error: "授权码不存在" };
      const lic = rows[0];
      if (lic.revoked_at) return { ok: false, error: "该授权码已被吊销" };
      // 记录激活
      try {
        await Sync.request("/rest/v1/license_activations", {
          method: "POST",
          headers: { "Prefer": "return=minimal" },
          body: JSON.stringify({
            license_code: code,
            account_id: currentAccountId(),
            username: currentAccount ? currentAccount.username : "",
            activated_at: new Date().toISOString()
          })
        });
      } catch {}
      return { ok: true, name: lic.name, code: code };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  /** 检查已绑定授权是否仍有效：{ok, name} 或 {ok:false,error} */
  async checkActive() {
    // 授权码为可选功能：没有本地授权码时放行（本地模式，不拦截）
    const code = await this.localCode();
    if (!code) return { ok: true, name: "本地模式" };
    const c = await Sync.config();
    if (!c.url || !c.key) return { ok: true, name: "本地模式" };
    try {
      const rows = await Sync.request("/rest/v1/licenses?code=eq." + encodeURIComponent(code) + "&select=code,name,revoked_at");
      if (!rows || !rows.length) return { ok: false, error: "授权码不存在，请联系管理方" };
      if (rows[0].revoked_at) return { ok: false, error: "授权已被吊销，请联系管理方" };
      return { ok: true, name: rows[0].name };
    } catch (e) {
      // 网络失败：不阻塞使用（本地已激活过）
      return { ok: true, name: "本地模式" };
    }
  },

  /** 检查是否有新版本：返回 {hasNew, version, url, notes} */
  async checkUpdate() {
    const c = await Sync.config();
    if (!c.url || !c.key) return { hasNew: false };
    try {
      const rows = await Sync.request("/rest/v1/app_versions?select=version,url,notes&order=created_at.desc&limit=1");
      if (!rows || !rows.length) return { hasNew: false };
      const v = rows[0];
      const hasNew = v.version !== APP_VERSION;
      return { hasNew, version: v.version, url: v.url, notes: v.notes };
    } catch (e) {
      return { hasNew: false };
    }
  }
};
