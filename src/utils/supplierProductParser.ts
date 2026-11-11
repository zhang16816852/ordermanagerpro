import Papa from 'papaparse';
import { SupplierProduct, SupplierVariant } from './supplierProductSchema';

// 欄位別名（中英）
const HEADER_ALIASES: Record<string, string[]> = {
  supplier_sku: ['supplier_sku', '廠商料號', '供應商料號', '廠商商品編號', '供應商商品編號', '料號', 'sku'],
  name: ['name', '品名', '商品名稱', '產品名稱', '名稱'],
  description: ['description', '描述', '商品描述', '產品描述', '備註'],
  brand: ['brand', '品牌'],
  category: ['category', '分類', '商品分類', '產品分類'],
  wholesale_price: ['wholesale_price', '批發價', '進貨價', '成本', '成本價', '成本（元）'],
  retail_price: ['retail_price', '零售價', '售價', '價錢', '單價（元）', '售價（元）'],
  currency: ['currency', '幣別', '幣種'],
  barcode: ['barcode', '條碼', '商品條碼', '產品條碼'],
  weight_kg: ['weight_kg', 'weight', '重量', '重量(kg)', '重量（kg）'],
  supplier_name: ['supplier_name', '供應商', '供應商名稱', '廠商', '廠商名稱'],
  supplier_url: ['supplier_url', '產品網址', '產品連結', 'url', 'link'],
  source_platform: ['source_platform', '平台', '來源平台'],
  // 變體欄位
  variant_sku: ['variant_sku', '變體SKU', '變體編號', '規格編號'],
  variant_name: ['variant_name', '變體名稱', '規格名稱', '規格'],
  variant_color: ['variant_color', '顏色', 'color'],
  variant_option_1: ['variant_option_1', '選項1', '規格1'],
  variant_option_2: ['variant_option_2', '選項2', '規格2'],
  variant_option_3: ['variant_option_3', '選項3', '規格3'],
  variant_wholesale_price: ['variant_wholesale_price', '變體批發價', '變體進貨價'],
  variant_retail_price: ['variant_retail_price', '變體零售價', '變體售價'],
  variant_barcode: ['variant_barcode', '變體條碼'],
  variant_stock: ['variant_stock', '變體庫存', '庫存'],
  variant_images: ['variant_images', '變體圖片'],
  // 圖片
  images: ['images', '圖片', '圖片網址', '圖片URL', 'image_url', 'image'],
};

const HEADER_KEYS = Object.keys(HEADER_ALIASES);

function normalizeHeader(raw: string): string | null {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return null;
  for (const field of HEADER_KEYS) {
    if (HEADER_ALIASES[field].some(a => a.toLowerCase() === key)) return field;
  }
  return null;
}

function toTrimmed(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseImages(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  return s.split(/[,;|\n\r]+/).map(x => x.trim()).filter(Boolean);
}

function parseDimensions(value: unknown): { length?: number; width?: number; height?: number; unit?: string } | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  // 支援 "LxWxH" 格式，如 "10x5x3cm"
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(\w+)?$/);
  if (m) {
    return {
      length: Number(m[1]),
      width: Number(m[2]),
      height: Number(m[3]),
      unit: m[4] || 'cm',
    };
  }
  return undefined;
}

export async function parseSupplierProductExcel(buffer: ArrayBuffer): Promise<SupplierProduct[]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
  return parseSheetRows(rawRows);
}

export async function parseSupplierProductText(text: string): Promise<SupplierProduct[]> {
  const result = Papa.parse<unknown[]>(text, { skipEmptyLines: 'greedy' });
  const rawRows = (result.data || []) as unknown[][];
  return parseSheetRows(rawRows);
}

function parseSheetRows(rawRows: unknown[][]): SupplierProduct[] {
  if (rawRows.length === 0) return [];

  const headerRow = rawRows.findIndex((row, idx) =>
    Array.isArray(row) && row.some((cell) => normalizeHeader(toTrimmed(cell)) !== null),
  );
  const headerIndex = headerRow >= 0 ? headerRow : 0;
  const header = (rawRows[headerIndex] || []).map(h => normalizeHeader(toTrimmed(h)));
  const hasHeader = header.some(Boolean);
  if (!hasHeader) return [];

  const products: SupplierProduct[] = [];
  const productMap = new Map<string, SupplierProduct>();

  for (let i = headerIndex + 1; i < rawRows.length; i++) {
    const raw = rawRows[i];
    if (!Array.isArray(raw)) continue;

    const row: Record<string, unknown> = {};
    let hasValue = false;
    header.forEach((field, colIdx) => {
      if (!field) return;
      const cell = raw[colIdx];
      if (cell === null || cell === undefined || toTrimmed(cell) === '') return;
      hasValue = true;
      row[field] = cell;
    });
    if (!hasValue) continue;

    const supplier_sku = toTrimmed(row.supplier_sku);
    const name = toTrimmed(row.name);
    if (!supplier_sku && !name) continue;

    const key = supplier_sku || name;

    // 變體列：若有 variant_sku 或 variant_name，視為變體
    const variantSku = toTrimmed(row.variant_sku);
    const variantName = toTrimmed(row.variant_name);

    if (variantSku || variantName) {
      // 這是變體列，附加到對應產品
      const variant: SupplierVariant = {
        sku: variantSku || `${supplier_sku}-${variantName}`,
        name: variantName || name || supplier_sku,
        barcode: toTrimmed(row.variant_barcode) || undefined,
        color: toTrimmed(row.variant_color) || undefined,
        option_1: toTrimmed(row.variant_option_1) || undefined,
        option_2: toTrimmed(row.variant_option_2) || undefined,
        option_3: toTrimmed(row.variant_option_3) || undefined,
        wholesale_price: toNumber(row.variant_wholesale_price),
        retail_price: toNumber(row.variant_retail_price),
        images: parseImages(row.variant_images),
        stock: toNumber(row.variant_stock),
      };

      if (productMap.has(key)) {
        const existing = productMap.get(key)!;
        if (!existing.variants) existing.variants = [];
        existing.variants.push(variant);
      } else {
        // 先建立產品，再附加變體
        const product: SupplierProduct = {
          supplier_sku: supplier_sku || name,
          name: name || supplier_sku,
          description: toTrimmed(row.description) || undefined,
          brand: toTrimmed(row.brand) || undefined,
          category: toTrimmed(row.category) || undefined,
          wholesale_price: toNumber(row.wholesale_price),
          retail_price: toNumber(row.retail_price),
          currency: toTrimmed(row.currency) || 'TWD',
          barcode: toTrimmed(row.barcode) || undefined,
          weight_kg: toNumber(row.weight_kg),
          dimensions: parseDimensions(row.dimensions) || undefined,
          images: parseImages(row.images),
          supplier_name: toTrimmed(row.supplier_name) || undefined,
          supplier_url: toTrimmed(row.supplier_url) || undefined,
          source_platform: toTrimmed(row.source_platform) || undefined,
          source: 'import',
          fetched_at: new Date().toISOString(),
          variants: [variant],
        };
        productMap.set(key, product);
        products.push(product);
      }
    } else {
      // 這是產品列（無變體或單一產品）
      if (productMap.has(key)) {
        // 更新現有產品（合併欄位）
        const existing = productMap.get(key)!;
        if (toTrimmed(row.name)) existing.name = toTrimmed(row.name);
        if (toTrimmed(row.description)) existing.description = toTrimmed(row.description);
        if (toTrimmed(row.brand)) existing.brand = toTrimmed(row.brand);
        if (toTrimmed(row.category)) existing.category = toTrimmed(row.category);
        if (toNumber(row.wholesale_price) !== undefined) existing.wholesale_price = toNumber(row.wholesale_price);
        if (toNumber(row.retail_price) !== undefined) existing.retail_price = toNumber(row.retail_price);
        if (toTrimmed(row.barcode)) existing.barcode = toTrimmed(row.barcode);
        if (toNumber(row.weight_kg) !== undefined) existing.weight_kg = toNumber(row.weight_kg);
        const imgs = parseImages(row.images);
        if (imgs) existing.images = imgs;
      } else {
        const product: SupplierProduct = {
          supplier_sku: supplier_sku || name,
          name: name || supplier_sku,
          description: toTrimmed(row.description) || undefined,
          brand: toTrimmed(row.brand) || undefined,
          category: toTrimmed(row.category) || undefined,
          wholesale_price: toNumber(row.wholesale_price),
          retail_price: toNumber(row.retail_price),
          currency: toTrimmed(row.currency) || 'TWD',
          barcode: toTrimmed(row.barcode) || undefined,
          weight_kg: toNumber(row.weight_kg),
          dimensions: parseDimensions(row.dimensions) || undefined,
          images: parseImages(row.images),
          supplier_name: toTrimmed(row.supplier_name) || undefined,
          supplier_url: toTrimmed(row.supplier_url) || undefined,
          source_platform: toTrimmed(row.source_platform) || undefined,
          source: 'import',
          fetched_at: new Date().toISOString(),
        };
        productMap.set(key, product);
        products.push(product);
      }
    }
  }

  return products;
}
