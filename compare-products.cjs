const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://aweqytcelujpqezjitsk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3ZXF5dGNlbHVqcHFlemppdHNrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzk4MTY2NiwiZXhwIjoyMDgzNTU3NjY2fQ.OMupwMg_sPo7bOdN2vAyCbtZBmXK84_5aig1Oy1JMkw';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SUPPLIER_ID = '9734a72c-ab3d-4cb8-b29d-61db169e1873';

async function main() {
  console.log('Step 1: 讀取抓到的產品資料...');
  const scrapedProducts = JSON.parse(fs.readFileSync('products-test.json', 'utf8'));
  console.log(`  共 ${scrapedProducts.length} 筆`);

  console.log('Step 2: 取得供應商對照規則...');
  const { data: mappings, error } = await supabase
    .from('supplier_product_mappings')
    .select('vendor_product_id, vendor_product_name, vendor_unit_cost, internal_product_id, internal_variant_id, is_primary')
    .eq('supplier_id', SUPPLIER_ID);

  if (error) {
    console.error('查詢失敗:', error);
    return;
  }
  console.log(`  共 ${mappings.length} 筆對照規則`);

  const mappingMap = new Map();
  for (const m of mappings) {
    mappingMap.set(m.vendor_product_id, m);
  }

  console.log('\nStep 3: 比對資料...');
  console.log('='.repeat(80));

  const results = {
    matched: [],
    nameChanged: [],
    costChanged: [],
    unmatched: [],
  };

  for (const p of scrapedProducts) {
    const vendorId = p.按鈕ID;
    const mapping = mappingMap.get(vendorId);

    if (!mapping) {
      results.unmatched.push({
        vendor_product_id: vendorId,
        vendor_product_name: p.產品名稱,
        vendor_unit_cost: parseFloat(p.成本),
        retail_price: parseFloat(p.售價),
      });
    } else {
      const nameMatch = mapping.vendor_product_name === p.產品名稱;
      const costMatch = mapping.vendor_unit_cost === parseFloat(p.成本);

      const item = {
        vendor_product_id: vendorId,
        scraped_name: p.產品名稱,
        mapped_name: mapping.vendor_product_name,
        scraped_cost: parseFloat(p.成本),
        mapped_cost: mapping.vendor_unit_cost,
        internal_product_id: mapping.internal_product_id,
        is_primary: mapping.is_primary,
      };

      if (nameMatch && costMatch) {
        results.matched.push(item);
      } else {
        if (!nameMatch) results.nameChanged.push(item);
        if (!costMatch) results.costChanged.push(item);
      }
    }
  }

  console.log('\n📊 比對報告');
  console.log('='.repeat(80));
  console.log(`總抓取產品數: ${scrapedProducts.length}`);
  console.log(`已對應（完全一致）: ${results.matched.length}`);
  console.log(`名稱有變動: ${results.nameChanged.length}`);
  console.log(`成本有變動: ${results.costChanged.length}`);
  console.log(`未對應（新產品）: ${results.unmatched.length}`);
  console.log('='.repeat(80));

  if (results.nameChanged.length > 0) {
    console.log('\n⚠️ 名稱變動項目:');
    results.nameChanged.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.vendor_product_id}]`);
      console.log(`     舊: ${item.mapped_name?.substring(0, 80)}`);
      console.log(`     新: ${item.scraped_name?.substring(0, 80)}`);
    });
  }

  if (results.costChanged.length > 0) {
    console.log('\n⚠️ 成本變動項目:');
    results.costChanged.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.vendor_product_id}] ${item.scraped_name?.substring(0, 50)}`);
      console.log(`     舊成本: ${item.mapped_cost} → 新成本: ${item.scraped_cost}`);
    });
  }

  if (results.unmatched.length > 0) {
    console.log('\n🆕 未對應項目（新產品）:');
    results.unmatched.forEach((item, i) => {
      console.log(`  ${i+1}. [${item.vendor_product_id}] ${item.vendor_product_name?.substring(0, 60)} | 成本: ${item.vendor_unit_cost} | 售價: ${item.retail_price}`);
    });
  }

  const report = {
    summary: {
      total_scraped: scrapedProducts.length,
      total_mappings: mappings.length,
      matched: results.matched.length,
      name_changed: results.nameChanged.length,
      cost_changed: results.costChanged.length,
      unmatched: results.unmatched.length,
    },
    matched: results.matched,
    name_changed: results.nameChanged,
    cost_changed: results.costChanged,
    unmatched: results.unmatched,
  };

  fs.writeFileSync('comparison-report.json', JSON.stringify(report, null, 2));
  console.log('\n📁 報告已存成 comparison-report.json');
}

main().catch(err => {
  console.error('❌ 錯誤:', err);
});
