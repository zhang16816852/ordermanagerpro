import * as XLSX from 'xlsx';

const BASE_COLUMNS = {
    'ID': 'id',
    '產品類型': 'is_variant',
    'SKU': 'sku',
    '產品名稱': 'name',
    '變體 SKU': 'variant_sku',
    '變體名稱': 'variant_name',
    '描述': 'description',
    '品牌': 'brand',
    '型號': 'model',
    '系列': 'series',
    '適用型號': 'device_models',
    '批發價': 'wholesale_price',
    '零售價': 'retail_price',
    '狀態': 'status',
    '條碼': 'barcode',
    '分類': 'category',
    '規格 1': 'option_1',
    '規格 2': 'option_2',
    '顏色 (規格 3)': 'option_3',
} as const;

type BaseColumnKey = keyof typeof BASE_COLUMNS;

export function parseProductExcel(buffer: ArrayBuffer) {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const allData: any[] = [];

    workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (rows.length < 3) return;

        let headerRowIndex = 2;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
            if (String(rows[i][0]).trim() === 'id' && String(rows[i][2]).trim() === 'sku') {
                headerRowIndex = i;
                break;
            }
        }

        const headerKeys = rows[headerRowIndex].map(h => String(h).trim());
        const dataRows = rows.slice(headerRowIndex + 1);

        dataRows.forEach(row => {
            if (!row || row.length === 0) return;

            const item: any = {
                _categoryName: sheetName,
                _specs: {}
            };

            headerKeys.forEach((key, index) => {
                const value = row[index];
                if (value === undefined || value === null) return;

                const isBase = Object.values(BASE_COLUMNS).includes(key as any);
                if (isBase) {
                    if (key === 'is_variant') {
                        item.is_variant = (value === '變體' || value === '是' || value === true);
                    } else if (key === 'id') {
                        item.id = String(value).trim();
                    } else {
                        item[key] = value;
                    }
                } else if (key && key.includes(':')) {
                    item._specs[key] = String(value).trim();
                }
            });

            if (item.sku) {
                allData.push(item);
            }
        });
    });

    return allData;
}
