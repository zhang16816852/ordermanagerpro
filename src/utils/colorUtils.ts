/**
 * 判斷十六進位顏色是否為深色
 * 用於決定背景色上的文字應該顯示白色還是黑色
 */
export function isDarkColor(hex: string | null): boolean {
  if (!hex || hex === 'transparent') return false;
  
  // 移除 # 號
  const color = hex.startsWith('#') ? hex.substring(1) : hex;
  
  // 轉為 RGB
  let r, g, b;
  if (color.length === 3) {
    r = parseInt(color.substring(0, 1).repeat(2), 16);
    g = parseInt(color.substring(1, 2).repeat(2), 16);
    b = parseInt(color.substring(2, 3).repeat(2), 16);
  } else {
    r = parseInt(color.substring(0, 2), 16);
    g = parseInt(color.substring(2, 4), 16);
    b = parseInt(color.substring(4, 6), 16);
  }
  
  // 使用 HSP (Highly Sensitive Poo) 亮度演算法
  // http://alienryderflex.com/hsp.html
  const hsp = Math.sqrt(
    0.299 * (r * r) +
    0.587 * (g * g) +
    0.114 * (b * b)
  );
  
  // 亮度小於 127.5 視為深色
  return hsp < 127.5;
}

/**
 * 根據背景色回傳對比文字顏色 (黑或白)
 */
export function getContrastColor(hex: string | null): string {
  return isDarkColor(hex) ? '#FFFFFF' : '#000000';
}
