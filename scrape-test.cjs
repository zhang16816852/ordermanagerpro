const cheerio = require('cheerio');
const fs = require('fs');

const BASE_URL = 'http://kcimos.kv.idv.tw';

// Cookie jar - handle quoted values properly
const cookies = {};
function setCookies(res) {
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    // The cookie is: FE="value"; Version=1; Max-Age=1800; ...
    // Extract just the FE="..." part
    const match = setCookie.match(/^([^=]+)="([^"]*)"/);
    if (match) {
      cookies[match[1]] = '"' + match[2] + '"';
    } else {
      // Fallback for unquoted cookies
      const [nameValue] = setCookie.split(';');
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx > 0) {
        const name = nameValue.substring(0, eqIdx).trim();
        const value = nameValue.substring(eqIdx + 1).trim();
        cookies[name] = value;
      }
    }
  }
}
function getCookieHeader() {
  return Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');
}

async function main() {
  // Step 1: 取得驗證碼（建立 session）
  console.log('Step 1: 取得驗證碼...');
  const captchaRes = await fetch(`${BASE_URL}/jCaptchaSource.shtml`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
  setCookies(captchaRes);
  const captchaData = await captchaRes.json();
  console.log('  imgInfo:', captchaData.imgInfo);
  console.log('  Cookies:', JSON.stringify(cookies));

  // Step 2: 登入（用固定驗證碼）
  console.log('Step 2: 登入...');
  const loginRes = await fetch(`${BASE_URL}/login.shtml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': getCookieHeader()
    },
    body: 'login.type=1&login.captchaCheck=d69768b3da745b77e82cdbddcc8bac98&login.account=qaz200581&login.password=000000&login.captcha=8496'
  });
  setCookies(loginRes);
  const loginResult = await loginRes.json();
  console.log('  登入結果:', loginResult);

  if (!loginResult.status) {
    console.error('❌ 登入失敗:', loginResult.msg);
    return;
  }
  console.log('✅ 登入成功');

  // Step 3: 進入快速下單頁面
  console.log('Step 3: 進入快速下單頁面...');
  const fastOrderRes = await fetch(`${BASE_URL}/frontend/initFastOrder.shtml`, {
    headers: { 'Cookie': getCookieHeader() }
  });
  const fastOrderHtml = await fastOrderRes.text();
  console.log('  頁面大小:', fastOrderHtml.length, 'bytes');
  console.log('  Has listProduct:', fastOrderHtml.includes('listProduct'));

  // Step 4: 找到第一個分類連結的 productCatPk
  const $ = cheerio.load(fastOrderHtml);
  const firstLink = $('a[onclick^="listProduct"]').first();
  const productCatPk = firstLink.attr('productcatpk');
  console.log('  第一個分類:', firstLink.text().trim());
  console.log('  productCatPk:', productCatPk);

  if (!productCatPk) {
    console.error('❌ 找不到 productCatPk');
    fs.writeFileSync('fastorder-debug.html', fastOrderHtml);
    return;
  }

  // Step 5: 呼叫 listProduct API
  console.log('Step 5: 呼叫 listProduct...');
  const listRes = await fetch(`${BASE_URL}/frontend/product/listProduct.shtml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': getCookieHeader()
    },
    body: `productCatPk=${productCatPk}`
  });
  const listHtml = await listRes.text();
  console.log('  回應大小:', listHtml.length, 'bytes');

  // Step 6: 解析產品表格
  console.log('Step 6: 解析產品資料...');
  const $$ = cheerio.load(listHtml);
  const products = [];

  $$('table tr').each((i, row) => {
    if (i === 0) return;
    const cells = $$(row).find('td');
    if (cells.length < 6) return;

    const name = $$(cells[2]).text().trim();
    const price = $$(cells[3]).text().trim();
    const cost = $$(cells[4]).text().trim();
    const btnId = $$(cells[5]).find('input[type="text"]').attr('id');

    if (name) {
      products.push({
        分類: $$(cells[0]).text().trim(),
        產品名稱: name,
        售價: price,
        成本: cost,
        按鈕ID: btnId
      });
    }
  });

  console.log(`✅ 共抓取 ${products.length} 筆產品`);

  // Step 7: 存成 JSON
  fs.writeFileSync('products-test.json', JSON.stringify(products, null, 2));
  console.log('📁 已存成 products-test.json');

  if (products.length > 0) {
    console.log('\n前 3 筆:');
    products.slice(0, 3).forEach((p, i) => {
      console.log(`  ${i+1}. ${p.產品名稱} | 售價: ${p.售價} | 成本: ${p.成本}`);
    });
  }
}

main().catch(err => {
  console.error('❌ 錯誤:', err);
});
