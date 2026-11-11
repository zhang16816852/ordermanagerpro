const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ===== 設定 =====
const BASE_URL = 'http://kcimos.kv.idv.tw';
const LOGIN_ACCOUNT = 'qaz200581';
const LOGIN_PASSWORD = '000000';
const CAPTCHA_CHECK = 'd69768b3da745b77e82cdbddcc8bac98';
const CAPTCHA_VALUE = '8496';
const DELAY_BETWEEN_CATEGORIES = 500;

// 載入設定檔
const configPath = path.join(__dirname, 'scrape-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const SUPPLIER_ID = config.supplier_id;
const SUPPLIER_NAME = config.supplier_name;
const EXCLUDED_PATTERNS = config.excluded_patterns || [];
const AUTO_EXCLUDE = config.auto_exclude_rules || {};

// Supabase 設定
const envPath = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)="?(.+?)"?$/);
    if (match) env[match[1]] = match[2];
  }
}
const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://aweqytcelujpqezjitsk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ===== Cookie 管理 =====
const cookies = {};
function setCookies(res) {
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/^([^=]+)="([^"]*)"/);
    if (match) cookies[match[1]] = '"' + match[2] + '"';
    else {
      const [nameValue] = setCookie.split(';');
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx > 0) cookies[nameValue.substring(0, eqIdx).trim()] = nameValue.substring(eqIdx + 1).trim();
    }
  }
}
function getCookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ===== HTML 解析 =====
function stripTags(html) { return html.replace(/<[^>]*>/g, '').trim(); }

function parseProductTable(html) {
  const products = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch, rowIndex = 0;
  while ((trMatch = trRegex.exec(html)) !== null) {
    rowIndex++;
    if (rowIndex === 1) continue;
    const rowHtml = trMatch[1];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) cells.push(tdMatch[1]);
    if (cells.length < 6) continue;
    const category = stripTags(cells[0]);
    const name = stripTags(cells[2]);
    const price = stripTags(cells[3]);
    const cost = stripTags(cells[4]);
    const inputMatch = cells[5].match(/id="([^"]*)"/);
    const btnId = inputMatch ? inputMatch[1] : null;
    if (name) products.push({ category, name, retail_price: price, cost, vendor_product_id: btnId });
  }
  return products;
}

function parseCategoryList(html) {
  const categories = [];
  const linkRegex = /<a[^>]*productcatpk="(\d+)"[^>]*>[\s\S]*?<div>([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    categories.push({ id: match[1], name: match[2].trim() });
  }
  return categories;
}

// ===== 三層排除機制 =====
function autoExclude(product) {
  const cost = parseFloat(product.cost);
  const price = parseFloat(product.retail_price);
  if (isNaN(cost) || isNaN(price)) return { excluded: true, reason: '價格解析失敗' };
  if (cost >= (AUTO_EXCLUDE.max_cost || 9999)) return { excluded: true, reason: `成本 >= ${AUTO_EXCLUDE.max_cost} (佔位符)` };
  if (price >= (AUTO_EXCLUDE.max_retail_price || 9999)) return { excluded: true, reason: `售價 >= ${AUTO_EXCLUDE.max_retail_price} (佔位符)` };
  if (cost < (AUTO_EXCLUDE.min_cost || 1)) return { excluded: true, reason: `成本 < ${AUTO_EXCLUDE.min_cost} (零成本)` };
  if (!product.name || product.name.trim() === '') return { excluded: true, reason: '名稱為空' };
  return { excluded: false };
}

function patternExclude(product) {
  for (const pattern of EXCLUDED_PATTERNS) {
    try {
      if (new RegExp(pattern).test(product.name)) {
        return { excluded: true, reason: `匹配排除模式: ${pattern}` };
      }
    } catch (e) { /* ignore invalid regex */ }
  }
  return { excluded: false };
}

// ===== 主流程 =====
async function main() {
  console.log('='.repeat(80));
  console.log('  kcimos 產品資料抓取 + 三層排除 + 供應商對照比對');
  console.log(`  供應商: ${SUPPLIER_NAME}`);
  console.log('='.repeat(80));

  // Step 1: 登入
  console.log('\n[1/5] 登入 kcimos...');
  const loginRes = await fetch(`${BASE_URL}/login.shtml`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: `login.type=1&login.captchaCheck=${CAPTCHA_CHECK}&login.account=${LOGIN_ACCOUNT}&login.password=${LOGIN_PASSWORD}&login.captcha=${CAPTCHA_VALUE}`
  });
  setCookies(loginRes);
  const loginResult = await loginRes.json();
  if (!loginResult.status) { console.error('❌ 登入失敗:', loginResult.msg); process.exit(1); }
  console.log('  ✅ 登入成功');

  // Step 2: 取得分類 + 抓取產品
  console.log('\n[2/5] 取得分類 + 抓取產品...');
  const fastOrderRes = await fetch(`${BASE_URL}/frontend/initFastOrder.shtml`, { headers: { 'Cookie': getCookieHeader() } });
  const categories = parseCategoryList(await fastOrderRes.text());
  console.log(`  共 ${categories.length} 個分類`);

  const allProducts = [];
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    process.stdout.write(`  [${i + 1}/${categories.length}] ${cat.name}... `);
    const res = await fetch(`${BASE_URL}/frontend/product/listProduct.shtml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Cookie': getCookieHeader() },
      body: `productCatPk=${cat.id}`
    });
    const products = parseProductTable(await res.text());
    allProducts.push(...products);
    console.log(`${products.length} 筆`);
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_CATEGORIES));
  }
  console.log(`\n  總共抓取: ${allProducts.length} 筆產品`);

  // Step 3: 三層排除
  console.log('\n[3/5] 三層排除...');
  const excluded = { auto: [], pattern: [], manual: [] };
  const included = [];

  // 先查詢 scrape_decisions
  const { data: decisions } = await supabase
    .from('scrape_decisions')
    .select('vendor_product_id, action, note')
    .eq('supplier_id', SUPPLIER_ID);
  const decisionMap = new Map((decisions || []).map(d => [d.vendor_product_id, d]));

  for (const p of allProducts) {
    // Layer 1: 自動排除
    const auto = autoExclude(p);
    if (auto.excluded) { excluded.auto.push({ ...p, reason: auto.reason }); continue; }

    // Layer 2: 模式排除
    const pat = patternExclude(p);
    if (pat.excluded) { excluded.pattern.push({ ...p, reason: pat.reason }); continue; }

    // Layer 3: 人工排除 (scrape_decisions)
    const decision = decisionMap.get(p.vendor_product_id);
    if (decision && decision.action === 'skip') {
      excluded.manual.push({ ...p, reason: `人工排除: ${decision.note || '無備註'}` });
      continue;
    }

    included.push(p);
  }

  console.log(`  自動排除: ${excluded.auto.length} 筆`);
  console.log(`  模式排除: ${excluded.pattern.length} 筆`);
  console.log(`  人工排除: ${excluded.manual.length} 筆`);
  console.log(`  保留比對: ${included.length} 筆`);

  fs.writeFileSync('all-products.json', JSON.stringify(allProducts, null, 2));
  fs.writeFileSync('excluded-products.json', JSON.stringify(excluded, null, 2));

  // Step 4: 比對 Supabase mapping
  console.log('\n[4/5] 比對 Supabase 對照規則...');
  const { data: mappings, error } = await supabase
    .from('supplier_product_mappings')
    .select('vendor_product_id, vendor_product_name, vendor_unit_cost, internal_product_id, internal_variant_id, is_primary')
    .eq('supplier_id', SUPPLIER_ID);

  if (error) { console.error('❌ 查詢失敗:', error); process.exit(1); }
  console.log(`  現有對照規則: ${mappings.length} 筆`);

  const mappingMap = new Map();
  for (const m of mappings) mappingMap.set(m.vendor_product_id, m);

  const results = { matched: [], nameChanged: [], costChanged: [], unmatched: [], autoApplied: [] };

  for (const p of included) {
    const vendorId = p.vendor_product_id;
    const mapping = mappingMap.get(vendorId);
    const decision = decisionMap.get(vendorId);

    if (!mapping) {
      // 未對應 → 檢查 decision
      if (decision && decision.action === 'add') {
        results.autoApplied.push({ ...p, action: 'add', decision });
      } else if (decision && decision.action === 'skip') {
        // 已在 excluded.manual 中，不應到這裡
      } else {
        results.unmatched.push({
          vendor_product_id: vendorId,
          vendor_product_name: p.name,
          vendor_unit_cost: parseFloat(p.cost) || 0,
          retail_price: parseFloat(p.retail_price) || 0,
          category: p.category,
          decision: decision?.action || 'pending',
        });
      }
    } else {
      const nameMatch = mapping.vendor_product_name === p.name;
      const costMatch = mapping.vendor_unit_cost === parseFloat(p.cost);

      const item = {
        vendor_product_id: vendorId,
        scraped_name: p.name,
        mapped_name: mapping.vendor_product_name,
        scraped_cost: parseFloat(p.cost) || 0,
        mapped_cost: mapping.vendor_unit_cost,
        internal_product_id: mapping.internal_product_id,
        internal_variant_id: mapping.internal_variant_id,
        is_primary: mapping.is_primary,
        category: p.category,
      };

      if (nameMatch && costMatch) {
        results.matched.push(item);
      } else {
        if (!nameMatch) {
          if (decision && decision.action === 'update_name') {
            results.autoApplied.push({ ...item, action: 'update_name', decision });
          } else {
            results.nameChanged.push(item);
          }
        }
        if (!costMatch) {
          if (decision && decision.action === 'update_cost') {
            results.autoApplied.push({ ...item, action: 'update_cost', decision });
          } else {
            results.costChanged.push(item);
          }
        }
      }
    }
  }

  // Step 5: 輸出報告
  console.log('\n' + '='.repeat(80));
  console.log('📊 比對報告');
  console.log('='.repeat(80));
  console.log(`總抓取產品數: ${allProducts.length}`);
  console.log(`排除: ${excluded.auto.length + excluded.pattern.length + excluded.manual.length} 筆`);
  console.log(`保留比對: ${included.length} 筆`);
  console.log(`現有對照規則: ${mappings.length} 筆`);
  console.log(`已對應（完全一致）: ${results.matched.length}`);
  console.log(`自動處理（依 decision）: ${results.autoApplied.length}`);
  console.log(`名稱有變動（待決定）: ${results.nameChanged.length}`);
  console.log(`成本有變動（待決定）: ${results.costChanged.length}`);
  console.log(`未對應（待決定）: ${results.unmatched.length}`);
  console.log('='.repeat(80));

  // 自動處理項目
  if (results.autoApplied.length > 0) {
    console.log('\n🤖 自動處理項目（依 scrape_decisions）:');
    results.autoApplied.forEach((item, i) => {
      console.log(`  ${i + 1}. [${item.vendor_product_id}] action=${item.action}`);
    });
  }

  // 成本變動
  if (results.costChanged.length > 0) {
    console.log('\n💰 成本變動（待決定）:');
    results.costChanged.forEach((item, i) => {
      console.log(`  ${i + 1}. [${item.vendor_product_id}] ${item.scraped_name?.substring(0, 50)}`);
      console.log(`     舊: ${item.mapped_cost} → 新: ${item.scraped_cost}`);
    });
  }

  // 未對應（按分類分組）
  if (results.unmatched.length > 0) {
    console.log('\n🆕 未對應（待決定）:');
    const byCategory = {};
    for (const item of results.unmatched) {
      if (!byCategory[item.category]) byCategory[item.category] = [];
      byCategory[item.category].push(item);
    }
    for (const [cat, items] of Object.entries(byCategory)) {
      console.log(`\n  【${cat}】 (${items.length} 筆)`);
      items.slice(0, 10).forEach((item, i) => {
        console.log(`    ${i + 1}. [${item.vendor_product_id}] ${item.vendor_product_name?.substring(0, 50)} | 成本: ${item.vendor_unit_cost} | 售價: ${item.retail_price}`);
      });
      if (items.length > 10) console.log(`    ... 還有 ${items.length - 10} 筆`);
    }
  }

  // 排除統計
  console.log('\n📋 排除統計:');
  console.log(`  自動排除: ${excluded.auto.length} 筆`);
  console.log(`  模式排除: ${excluded.pattern.length} 筆`);
  console.log(`  人工排除: ${excluded.manual.length} 筆`);

  // 存成報告
  const report = {
    generated_at: new Date().toISOString(),
    supplier: SUPPLIER_NAME,
    supplier_id: SUPPLIER_ID,
    summary: {
      total_scraped: allProducts.length,
      auto_excluded: excluded.auto.length,
      pattern_excluded: excluded.pattern.length,
      manual_excluded: excluded.manual.length,
      total_mappings: mappings.length,
      matched: results.matched.length,
      auto_applied: results.autoApplied.length,
      name_changed: results.nameChanged.length,
      cost_changed: results.costChanged.length,
      unmatched: results.unmatched.length,
    },
    excluded,
    matched: results.matched,
    auto_applied: results.autoApplied,
    name_changed: results.nameChanged,
    cost_changed: results.costChanged,
    unmatched: results.unmatched,
  };

  fs.writeFileSync('comparison-report.json', JSON.stringify(report, null, 2));
  console.log('\n📁 完整報告已存成 comparison-report.json');
  console.log('\n請檢視報告後決定要執行哪些更新操作。');
}

main().catch(err => {
  console.error('❌ 錯誤:', err);
  process.exit(1);
});
