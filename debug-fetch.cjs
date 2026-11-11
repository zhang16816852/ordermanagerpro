const fs = require('fs');

const cookies = {};
function setCookies(res) {
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    setCookie.split(',').forEach(c => {
      const [nameValue] = c.split(';');
      const [name, value] = nameValue.split('=');
      if (name && value) cookies[name.trim()] = value.trim();
    });
  }
}
function getCookieHeader() {
  return Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');
}

async function main() {
  // Login
  const loginRes = await fetch('http://kcimos.kv.idv.tw/login.shtml', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: 'login.type=1&login.captchaCheck=d69768b3da745b77e82cdbddcc8bac98&login.account=qaz200581&login.password=000000&login.captcha=8496'
  });
  setCookies(loginRes);
  const loginResult = await loginRes.json();
  console.log('Login:', loginResult.status);

  // Fetch fast order page
  const res = await fetch('http://kcimos.kv.idv.tw/frontend/initFastOrder.shtml', {
    headers: { 'Cookie': getCookieHeader() }
  });
  const html = await res.text();
  fs.writeFileSync('fastorder.html', html);
  console.log('Length:', html.length);
  console.log('Has listProduct:', html.includes('listProduct'));
  console.log('Has productCatPk:', html.includes('productCatPk'));
}

main().catch(err => console.error('ERR:', err));
