const fs = require('fs');

const cookies = {};
function setCookies(res) {
  const setCookie = res.headers.get('set-cookie');
  console.log('  Set-Cookie header:', setCookie);
  if (setCookie) {
    // Handle multiple cookies separated by comma (careful with expires dates)
    const cookieStrings = setCookie.split(/,(?=\s*\w+=)/);
    cookieStrings.forEach(c => {
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
  console.log('Cookies after login:', JSON.stringify(cookies));

  // Fetch fast order page
  const res = await fetch('http://kcimos.kv.idv.tw/frontend/initFastOrder.shtml', {
    headers: { 'Cookie': getCookieHeader() }
  });
  const html = await res.text();
  console.log('Fast order page length:', html.length);
  console.log('Has listProduct:', html.includes('listProduct'));
  console.log('Response status:', res.status);
  console.log('Response headers:', JSON.stringify(Object.fromEntries(res.headers.entries())));
  
  // Save for inspection
  fs.writeFileSync('fastorder2.html', html);
}

main().catch(err => console.error('ERR:', err));
