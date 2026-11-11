const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://aweqytcelujpqezjitsk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3ZXF5dGNlbHVqcHFlemppdHNrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzk4MTY2NiwiZXhwIjoyMDgzNTU3NjY2fQ.OMupwMg_sPo7bOdN2vAyCbtZBmXK84_5aig1Oy1JMkw';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const SUPPLIER_ID = '9734a72c-ab3d-4cb8-b29d-61db169e1873';
const BASE_URL = 'http://kcimos.kv.idv.tw';

const cookies = {};
function setCookies(res) {
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/^([^=]+)="([^"]*)"/);
    if (match) {
      cookies[match[1]] = '"' + match[2] + '"';
    } else {
      const [nameValue] = setCookie.split(';');
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx > 0) {
        cookies[nameValue.substring(0, eqIdx).trim()] = nameValue.substring(eqIdx + 1).trim();
      }
    }
  }
}
function getCookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseProductTable(html) {
  const products = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  let rowIndex = 0;

  while ((trMatch = trRegex.exec(html)) !== null) {
    rowIndex++;
    if (rowIndex === 1) continue;

    const rowHtml = trMatch[1];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(tdMatch[1]);
    }

    if (cells.length < 6) continue;

    const stripTags = (html) => html.replace(/<[^>]*>/g, '').trim();
    const category = stripTags(cells[0]);
    const name = stripTags(cells[2]);
    const price = stripTags(cells[3]);
    const cost = stripTags(cells[4]);
    const inputMatch = cells[5].match(/id="([^"]*)"/);
    const btnId = inputMatch ? inputMatch[1] : null;

    if (name) {
      products.push({
        分類: category,
        產品名稱: name,
        售價: price,
        成本: cost,
        按鈕ID: btnId,
      });
    }
  }

  return products;
}

async function fetchCategoryList() {
  const res = await fetch(`${BASE_URL}/frontend/initFastOrder.shtml`, {
    headers: { 'Cookie': getCookieHeader() }
  });
  const html = await res.text();

  const categories = [];
  // Match: <a ... productcatpk="34" ... onclick="listProduct(this);">...<div>name</div>...</a>
  const linkRegex = /<a[^>]*productcatpk="(\d+)"[^>]*>[\s\S]*?<div>([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    categories.push({
      id: match[1],
      name: match[2].trim(),
    });
  }

  return categories;
}

async function fetchProductsByCategory(catPk) {
  const res = await fetch(`${BASE_URL}/frontend/product/listProduct.shtml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': getCookieHeader()
    },
    body: `productCatPk=${catPk}`
  });
  const html = await res.text();
  return parseProductTable(html);
}

async function main() {
  console.log('='.repeat(80));
  console.log('  kcimos 產品資料抓取 + 比對報告');
  console.log('='.repeat(80));

  // Step 1: 登入
  console.log('\n[1/4] 登入 kcimos...');
  const loginRes = await fetch(`${BASE_URL}/login.shtml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: 'login.type=1&login.captchaCheck=d69768b3da745b77e82cdbddcc8bac98&login.account=qaz200581&login.password=000000&login.captcha=8496'
  });
  setCookies(loginRes);
  const loginResult = await loginRes.json();
  if (!loginResult.status) {
    console.error('❌ 登入失敗:', loginResult.msg);
    return;
  }
  console.log('  ✅ 登入成功');

  // Step 2: 取得分類列表
  console.log('\n[2/4] 取得分類列表...');
  const categories = await fetchCategoryList();
  console.log(`  共 ${categories.length} 個分類`);
  categories.forEach((c, i) => console.log(`  ${i+1}. ${c.name} (id=${c.id})`));

  // Step 3: 抓取所有產品
  console.log('\n[3/4] 抓取產品資料...');
  const allProducts = [];
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    console.log(`  [${i+1}/${categories.length}] ${cat.name}...`);
    const products = await fetchProductsByCategory(cat.id);
    allProducts.push(...products);
    console.log(`    → ${products.length} 筆`);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n  總共抓取: ${allProducts.length} 筆產品`);
  fs.writeFileSync('all-products.json', JSON.stringify(allProducts, null, 2));
  console.log('  📁 已存成 all-products.json');

  // Step 4: 比對 Supabase mapping
  console.log('\n[4/4] 比對 Supabase 對照規則...');
  const { data: mappings, error } = await supabase
    .from('supplier_product_mappings')
    .select('vendor_product_id, vendor_product_name, vendor_unit_cost, internal_product_id, internal_variant_id, is_primary')
    .eq('supplier_id', SUPPLIER_ID);

  if (error) {
    console.error('❌ 查詢失敗:', error);
    return;
  }
  console.log(`  現有對照規則: ${mappings.length} 筆`);

  const mappingMap = new Map();
  for (const m of mappings) {
    mappingMap.set(m.vendor_product_id, m);
  }

  const results = {
    matched: [],
    nameChanged: [],
    costChanged: [],
    unmatched: [],
  };

  for (const p of allProducts) {
    const vendorId = p.按鈕ID;
    const mapping = mappingMap.get(vendorId);

    if (!mapping) {
      results.unmatched.push({
        vendor_product_id: vendorId,
        vendor_product_name: p.產品名稱,
        vendor_unit_cost: parseFloat(p.成本) || 0,
        retail_price: parseFloat(p.售價) || 0,
        category: p.分類,
      });
    } else {
      const nameMatch = mapping.vendor_product_name === p.產品名稱;
      const costMatch = mapping.vendor_unit_cost === parseFloat(p.成本);

      const item = {
        vendor_product_id: vendorId,
        scraped_name: p.產品名稱,
        mapped_name: mapping.vendor_product_name,
        scraped_cost: parseFloat(p.成本) || 0,
        mapped_cost: mapping.vendor_unit_cost,
        internal_product_id: mapping.internal_product_id,
        internal_variant_id: mapping.internal_variant_id,
        is_primary: mapping.is_primary,
        category: p.分類,
      };

      if (nameMatch && costMatch) {
        results.matched.push(item);
      } else {
        if (!nameMatch) results.nameChanged.push(item);
        if (!costMatch) results.costChanged.push(item);
      }
    }
  }

  // 輸出報告
  console.log('\n' + '='.repeat(80));
  console.log('📊 比對報告');
  console.log('='.repeat(80));
  console.log(`總抓取產品數: ${allProducts.length}`);
  console.log(`現有對照規則: ${mappings.length}`);
  console.log(`已對應（完全一致）: ${results.matched.length}`);
  console.log(`名稱有變動: ${results.nameChanged.length}`);
  console.log(`成本有變動: ${results.costChanged.length}`);
  console.log(`未對應（新產品）: ${results.unmatched.length}`);
  console.log('='.repeat(80));

  if (results.nameChanged.length > 0) {
    console.log('\n⚠️ 名稱變動項目（建議更新 mapping）:');
    results.nameChanged.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.vendor_product_id}] ${item.category}`);
      console.log(`     舊: ${item.mapped_name?.substring(0, 70)}`);
      console.log(`     新: ${item.scraped_name?.substring(0, 70)}`);
    });
  }

  if (results.costChanged.length > 0) {
    console.log('\n⚠️ 成本變動項目（建議更新 vendor_unit_cost）:');
    results.costChanged.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.vendor_product_id}] ${item.scraped_name?.substring(0, 50)}`);
      console.log(`     舊成本: ${item.mapped_cost} → 新成本: ${item.scraped_cost}`);
    });
  }

  if (results.unmatched.length > 0) {
    console.log('\n🆕 未對應項目（新產品，需決定是否新增）:');
    results.unmatched.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.vendor_product_id}] ${item.vendor_product_name?.substring(0, 60)}`);
      console.log(`     分類: ${item.category} | 成本: ${item.vendor_unit_cost} | 售價: ${item.retail_price}`);
    });
  }

  const report = {
    summary: {
      total_scraped: allProducts.length,
      total_mappings: mappings.length,
      matched: results.matched.length,
      name_changed: results.nameChanged.length,
      cost_changed: results.costChanged.length,
      unmatched: results.unmatched.length,
    },
    categories: categories.map(c => ({ id: c.id, name: c.name })),
    matched: results.matched,
    name_changed: results.nameChanged,
    cost_changed: results.costChanged,
    unmatched: results.unmatched,
  };

  fs.writeFileSync('full-comparison-report.json', JSON.stringify(report, null, 2));
  console.log('\n📁 完整報告已存成 full-comparison-report.json');
  console.log('\n請檢視報告後決定要執行哪些更新操作。');
}

main().catch(err => {
  console.error('❌ 錯誤:', err);
});
