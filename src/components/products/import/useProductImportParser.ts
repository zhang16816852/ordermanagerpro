import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import Papa from 'papaparse';
import jschardet from 'jschardet';
import { parseProductExcel } from '@/utils/excelUtils';
import { ImportRow } from './useProductImport';

type ProductStatus = 'active' | 'discontinued' | 'preorder' | 'sold_out';

const REVERSE_STATUS_MAP: Record<string, ProductStatus> = {
    '上架中': 'active', '上架': 'active',
    '已停售': 'discontinued', '停產': 'discontinued', '停售': 'discontinued',
    '預購中': 'preorder', '預購': 'preorder',
    '售完停產': 'sold_out', '缺貨': 'sold_out', '售完': 'sold_out',
};

const VALID_STATUSES: ProductStatus[] = ['active', 'discontinued', 'preorder', 'sold_out'];

const parseStatus = (val: any): ProductStatus => {
    const v = String(val || '').trim();
    if (!v) return 'active';
    const mapped = REVERSE_STATUS_MAP[v];
    if (mapped) return mapped;
    const lower = v.toLowerCase() as ProductStatus;
    return VALID_STATUSES.includes(lower) ? lower : 'active';
};

const normalizeBarcode = (value: any): string => {
    if (!value) return '';
    let str: string;
    if (typeof value === 'number') {
        str = value.toLocaleString('fullwide', { useGrouping: false });
    } else {
        str = String(value).trim();
    }
    if (str.startsWith("'")) str = str.substring(1);
    if (/e\+/i.test(str)) return Number(str).toLocaleString('fullwide', { useGrouping: false });
    return str;
};

export function useProductImportParser(
    specDefs: any[],
    allBrands: any[],
    allColors: any[],
    categories: any[],
    allSeries: any[] = []
) {
    const parseCondensedSpecs = useCallback((specStr: string) => {
        if (!specStr || specStr.trim() === '') return {};
        const settings: Record<string, any> = {};
        const pairs = specStr.split(',').map(p => p.trim()).filter(Boolean);

        pairs.forEach(pair => {
            const separatorIndex = pair.indexOf(':');
            if (separatorIndex === -1) return;
            const name = pair.substring(0, separatorIndex).trim();
            const value = pair.substring(separatorIndex + 1).trim();
            const specDef = specDefs.find(sd => sd.name === name);
            const specId = specDef?.id || name;

            if (value.includes('/')) {
                const items = value.split('/').map(v => v.trim());
                if (items.some(item => item.includes('*'))) {
                    const obj: Record<string, number> = {};
                    items.forEach(item => {
                        const starIndex = item.indexOf('*');
                        if (starIndex !== -1) {
                            const opt = item.substring(0, starIndex).trim();
                            const qty = item.substring(starIndex + 1).trim();
                            obj[opt] = parseInt(qty) || 0;
                        }
                    });
                    settings[specId] = obj;
                } else {
                    settings[specId] = items;
                }
            } else if (value.includes('*')) {
                const starIndex = value.indexOf('*');
                const opt = value.substring(0, starIndex).trim();
                const qty = value.substring(starIndex + 1).trim();
                settings[specId] = { [opt]: parseInt(qty) || 0 };
            } else {
                settings[specId] = value;
            }
        });
        return settings;
    }, [specDefs]);

    const handleFileUpload = useCallback(async (file: File): Promise<ImportRow[]> => {
        const result = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (e.target?.result instanceof ArrayBuffer) resolve(e.target.result);
                else reject(new Error('讀取檔案失敗'));
            };
            reader.onerror = () => reject(new Error('讀取檔案失敗'));
            reader.readAsArrayBuffer(file);
        });

        const parsedRows = parseProductExcel(result);
        if (parsedRows.length === 0) return [];

        const rawParsed: ImportRow[] = parsedRows.map(row => {
            const is_variant = !!row.is_variant;
            const has_variant_sku = !!(row['變體 SKU'] || row.variant_sku);

            const baseRow: ImportRow = {
                product_sku: String(row.sku || row.product_sku || '').trim(),
                product_name: String(row.name || row.product_name || '').trim(),
                brand: String(row.brand || '').trim(),
                model: String(row.model || '').trim(),
                series: String(row.series || '').trim(),
                description: String(row.description || '').trim(),
                category: String(row.category || row._categoryName || '').trim(),

                base_wholesale_price: !is_variant ? (parseFloat(row.wholesale_price || row.base_wholesale_price) || 0) : 0,
                base_retail_price: !is_variant ? (parseFloat(row.retail_price || row.base_retail_price) || 0) : 0,
                product_status: !is_variant ? parseStatus(row.status || row.product_status) : 'active',

                variant_sku: is_variant
                    ? String(row['變體 SKU'] || row.variant_sku || '').trim()
                    : (has_variant_sku ? '' : String(row.sku || row.product_sku || '').trim()),
                variant_name: is_variant
                    ? String(row['變體名稱'] || row.variant_name || '').trim()
                    : (has_variant_sku ? '' : String(row.name || row.product_name || '').trim()),
                option_1: String(row['規格 1'] || row.option_1 || '').trim(),
                option_2: String(row['規格 2'] || row.option_2 || '').trim(),
                option_3: String(row['顏色 (規格 3)'] || row.option_3 || '').trim(),
                variant_wholesale_price: parseFloat(row.variant_wholesale_price || row.wholesale_price) || undefined,
                variant_retail_price: parseFloat(row.variant_retail_price || row.retail_price) || undefined,
                variant_status: parseStatus(row.variant_status || row.status),
                barcode: normalizeBarcode(row.barcode),

                device_models: !is_variant ? String(row['適用型號'] || row.device_models || '').replace(/\s+/g, ' ').trim() : '',
                variant_device_models: is_variant ? String(row['適用型號'] || row.device_models || row.variant_device_models || '').replace(/\s+/g, ' ').trim() : '',

                is_variant,
                product_id: !is_variant ? row.id : undefined,
                variant_id: is_variant ? row.id : undefined,
                _specs: row._specs || {},
                errors: [],
                isValid: true
            };

            if (baseRow.brand) {
                const search = baseRow.brand.trim().toLowerCase();
                const matched = allBrands.find(b => b.name?.trim().toLowerCase() === search);
                if (matched) baseRow.brand_id = matched.id;
            }

            if (baseRow.series && baseRow.brand_id) {
                const search = baseRow.series.trim().toLowerCase();
                const matched = allSeries.find(s =>
                    s.brand_id === baseRow.brand_id && s.name.trim().toLowerCase() === search
                );
                if (matched) {
                    baseRow.brand_series_id = matched.id;
                    baseRow.series_name = matched.name;
                }
            }

            if (baseRow.category) {
                const names = baseRow.category.split(',').map(s => s.trim()).filter(Boolean);
                baseRow.category_names = names;
                baseRow.category_ids = names.map(n => {
                    const m = categories.find(c => c.name?.trim().toLowerCase() === n.toLowerCase());
                    return m?.id;
                }).filter(Boolean) as string[];
                if (baseRow.category_ids.length > 0) {
                    baseRow.category_id = baseRow.category_ids[0];
                }
            }

            return baseRow;
        });

        return rawParsed;
    }, [allBrands, categories, allSeries]);
    return { handleFileUpload, parseCondensedSpecs, normalizeBarcode, parseStatus };
}
