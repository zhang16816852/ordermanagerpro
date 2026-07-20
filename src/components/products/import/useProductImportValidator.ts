import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { deserializeSpecs, formatSpecValue } from '@/utils/specLogic';
import { ImportRow } from './useProductImport';

const PRODUCT_DIFF_MAP: Record<string, (keyof ImportRow)[]> = {
    '產品名稱': ['product_name'],
    '描述': ['description'],
    '型號': ['model'],
    '系列': ['series_name'],
    '品牌': ['brand', 'brand_id'],
    '批發價': ['base_wholesale_price'],
    '零售價': ['base_retail_price'],
    '狀態': ['product_status'],
    '條碼': ['barcode'],
    '顏色': ['option_3'],
};

const VARIANT_DIFF_MAP: Record<string, (keyof ImportRow)[]> = {
    '變體名稱': ['variant_name'],
    '變體選項1': ['option_1'],
    '變體選項2': ['option_2'],
    '變體選項3': ['option_3'],
    '變體批發價': ['variant_wholesale_price'],
    '變體零售價': ['variant_retail_price'],
    '變體狀態': ['variant_status'],
    '變體條碼': ['barcode'],
};

export function useProductImportValidator(
    allColors: any[],
    allDeviceModels: any[],
    allDeviceGroups: any[],
    categories: any[],
    allSeries: any[] = []
) {
    const validateRow = useCallback((
        row: Omit<ImportRow, 'errors' | 'isValid' | 'is_variant'>
    ): { errors: string[]; is_variant: boolean } => {
        const errors: string[] = [];
        if (!row.product_sku) errors.push('產品 SKU 為必填');
        if (!row.product_name) errors.push('產品名稱為必填');

        const is_variant = typeof (row as any).is_variant === 'boolean'
            ? (row as any).is_variant
            : !!(row.variant_sku || row.variant_name);

        if (is_variant) {
            if (!row.variant_sku) errors.push('變體 SKU 為必填');
            if (!row.variant_name) errors.push('變體名稱為必填');
        }

        if (row.brand && !row.brand_id) {
            errors.push(`找不到品牌 "${row.brand}"`);
        }

        if (row.category) {
            row.category.split(',').map(s => s.trim()).filter(Boolean).forEach(cat => {
                if (!categories.find(c => c.name?.trim().toLowerCase() === cat.toLowerCase())) {
                    errors.push(`找不到分類 "${cat}"`);
                }
            });
        }

        if (row.option_3 && is_variant) {
            const searchColor = row.option_3.trim().toLowerCase();
            const colorExists = allColors.some(c =>
                (c.name?.trim().toLowerCase() === searchColor) ||
                (c.code?.trim().toLowerCase() === searchColor)
            );
            if (!colorExists) errors.push(`顏色 "${row.option_3}" 不存在於顏色庫`);
        }

        const checkModels = (modelStr: string | undefined, fieldName: string) => {
            if (!modelStr) return;
            const parts = modelStr.split(',').map(s => s.trim()).filter(Boolean);
            parts.forEach(part => {
                let name = part;
                let type: 'group' | 'model' | 'exclude' | 'auto' = 'auto';
                const lowerPart = part.toLowerCase();

                if (lowerPart.startsWith('group:')) { type = 'group'; name = part.substring(6).trim(); }
                else if (lowerPart.startsWith('exclude:')) { type = 'exclude'; name = part.substring(8).trim(); }
                else if (lowerPart.startsWith('model:')) { type = 'model'; name = part.substring(6).trim(); }

                if (type === 'group') {
                    if (!allDeviceGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
                        errors.push(`${fieldName}: 找不到型號群組 "${name}"`);
                    }
                } else if (type === 'exclude' || type === 'model') {
                    const exists = allDeviceModels.some(m =>
                        (m.name?.trim().toLowerCase() === name.toLowerCase()) ||
                        (Array.isArray(m.aliases) && m.aliases.some((a: string) => a?.trim().toLowerCase() === name.toLowerCase()))
                    );
                    if (!exists) errors.push(`${fieldName}: 找不到${type === 'exclude' ? '排除' : ''}型號 "${name}"`);
                } else {
                    const hasGroup = allDeviceGroups.some(g => g.name.toLowerCase() === name.toLowerCase());
                    const hasModel = allDeviceModels.some(m =>
                        (m.name?.trim().toLowerCase() === name.toLowerCase()) ||
                        (Array.isArray(m.aliases) && m.aliases.some((a: string) => a?.trim().toLowerCase() === name.toLowerCase()))
                    );
                    if (!hasGroup && !hasModel) {
                        errors.push(`${fieldName}: 找不到型號或型號群組 "${name}"`);
                    }
                }
            });
        };

        checkModels(row.device_models, '主商品型號');
        if (is_variant) checkModels(row.variant_device_models, '變體型號');

        return { errors, is_variant };
    }, [allColors, allDeviceModels, allDeviceGroups]);

    const enrichWithDiff = useCallback(async (rawParsed: ImportRow[]): Promise<ImportRow[]> => {
        const allSkus = rawParsed.map(r => r.product_sku).filter(Boolean);
        const allVariantSkus = rawParsed.map(r => r.variant_sku).filter(Boolean);
        const allIds = rawParsed.map(r => r.product_id || r.variant_id).filter(Boolean);

        let existingProducts: any[] = [];
        if (allSkus.length > 0) {
            const { data } = await supabase.from('products').select('*').in('sku', allSkus);
            if (data) existingProducts.push(...data);
        }
        if (allIds.length > 0) {
            const { data } = await supabase.from('products').select('*').in('id', allIds);
            if (data) existingProducts.push(...data);
        }

        const productIds = existingProducts.map(p => p.id).filter(Boolean);
        const productSeriesMap = new Map<string, string[]>();
        if (productIds.length > 0) {
            const { data: links } = await supabase.from('product_series_links').select('product_id, brand_series_id').in('product_id', productIds);
            if (links) {
                links.forEach(l => {
                    const arr = productSeriesMap.get(l.product_id) || [];
                    arr.push(l.brand_series_id);
                    productSeriesMap.set(l.product_id, arr);
                });
            }
        }

        let existingVariants: any[] = [];
        if (allVariantSkus.length > 0) {
            const { data } = await supabase.from('product_variants').select('*').in('sku', allVariantSkus);
            if (data) existingVariants.push(...data);
        }
        if (allIds.length > 0) {
            const { data } = await supabase.from('product_variants').select('*').in('id', allIds);
            if (data) existingVariants.push(...data);
        }

            const seenVariantIds = new Set<string>();

        const enrichedRows = rawParsed.map(row => {
            const product = (existingProducts || []).find(p =>
                (row.product_id && p.id === row.product_id) || p.sku === row.product_sku
            );
            const variant = (existingVariants || []).find(v =>
                (row.variant_id && v.id === row.variant_id) || v.sku === row.variant_sku
            );

            const diff: string[] = [];
            let action: 'create' | 'update' = 'create';

            if (product) {
                action = 'update';
                row.product_id = product.id;
                row.spec_values = product.spec_values;

                if (product.name !== row.product_name) diff.push('產品名稱');
                if (product.description !== row.description) diff.push('描述');
                if (product.model !== row.model) diff.push('型號');
                const existingSeriesIds = productSeriesMap.get(product.id) || [];
                const hasSeriesChanged = row.brand_series_id
                    ? !existingSeriesIds.includes(row.brand_series_id) || existingSeriesIds.length !== 1
                    : existingSeriesIds.length > 0;
                if (hasSeriesChanged) diff.push('系列');
                if (product.brand_id !== row.brand_id) diff.push('品牌');
                if (Number(product.base_wholesale_price) !== Number(row.base_wholesale_price)) diff.push('批發價');
                if (Number(product.base_retail_price) !== Number(row.base_retail_price)) diff.push('零售價');
                if (product.status !== row.product_status) diff.push('狀態');
                if (product.barcode !== row.barcode) diff.push('條碼');
                if (product.color !== row.option_3) diff.push('顏色');

                const incomingSpecs = row._specs || {};
                if (Object.keys(incomingSpecs).length > 0) {
                    const currentSpecs = deserializeSpecs(product.spec_values);
                    const hasSpecDiff = Object.entries(incomingSpecs).some(([key, val]) => {
                        const [pId, sId] = key.split(':');
                        const matchingKey = Object.keys(currentSpecs).find(k => {
                            const parts = k.split(':');
                            return parts[0] === pId && parts[1] === sId;
                        });
                        const currentVal = matchingKey ? currentSpecs[matchingKey] : undefined;
                        return formatSpecValue(currentVal) !== String(val);
                    });
                    if (hasSpecDiff) diff.push('產品規格');
                }
            }

            if (row.variant_sku && variant) {
                action = 'update';
                row.variant_id = variant.id;
                row.variant_spec_values = variant.spec_values;

                if (variant.name !== row.variant_name) diff.push('變體名稱');
                if (variant.option_1 !== row.option_1) diff.push('變體選項1');
                if (variant.option_2 !== row.option_2) diff.push('變體選項2');
                if (variant.option_3 !== row.option_3) diff.push('變體選項3');
                if (Number(variant.wholesale_price) !== Number(row.variant_wholesale_price || row.base_wholesale_price)) diff.push('變體批發價');
                if (Number(variant.retail_price) !== Number(row.variant_retail_price || row.base_retail_price)) diff.push('變體零售價');
                if (variant.status !== (row.variant_status || row.product_status)) diff.push('變體狀態');
                if (variant.barcode !== row.barcode) diff.push('變體條碼');
            }

            const { errors } = validateRow(row as any);
            const enriched = { ...row, errors, isValid: errors.length === 0, action, diff };

            if (enriched.is_variant && enriched.variant_id) {
                if (seenVariantIds.has(enriched.variant_id)) {
                    enriched.variant_id = undefined;
                    enriched.errors = [...enriched.errors, '變體 ID 重複，將產生新的 ID'];
                    enriched.isValid = false;
                } else {
                    seenVariantIds.add(enriched.variant_id);
                }
            }

            return enriched;
        });

        return mergeEnrichedRows(enrichedRows);
    }, [validateRow]);

    const mergeEnrichedRows = useCallback((rows: ImportRow[]): ImportRow[] => {
        if (rows.length <= 1) return rows;

        const applyDiffMerge = (group: ImportRow[], diffMap: Record<string, (keyof ImportRow)[]>) => {
            const result = { ...group[0] };
            result.diff = [...new Set(group.flatMap(r => r.diff || []))];
            result.errors = [...new Set(group.flatMap(r => r.errors || []))];
            result.isValid = group.every(r => r.isValid);
            result.action = group.some(r => r.action === 'update') ? 'update' : 'create';

            for (const [diffStr, fields] of Object.entries(diffMap)) {
                const changedRows = group.filter(r => (r.diff || []).includes(diffStr));
                if (changedRows.length === 1) {
                    for (const field of fields) {
                        const val = changedRows[0][field];
                        if (val !== undefined && val !== null && val !== '') {
                            (result as any)[field] = val;
                        }
                    }
                }
            }

            const firstWithId = group.find(r => !r.is_variant ? r.product_id : r.variant_id);
            if (firstWithId) {
                if (!group[0].is_variant) result.product_id = firstWithId.product_id;
                else result.variant_id = firstWithId.variant_id;
            }

            return result as ImportRow;
        };

        const productGroups = new Map<string, ImportRow[]>();
        const variantGroups = new Map<string, ImportRow[]>();
        const seenKeys = new Set<string>();

        rows.forEach(row => {
            if (row.is_variant && row.variant_sku) {
                const key = `${row.product_sku}::${row.variant_sku}`;
                if (!variantGroups.has(key)) variantGroups.set(key, []);
                variantGroups.get(key)!.push(row);
            } else {
                const key = row.product_sku;
                if (!productGroups.has(key)) productGroups.set(key, []);
                productGroups.get(key)!.push(row);
            }
        });

        const result: ImportRow[] = [];
        rows.forEach(row => {
            if (row.is_variant && row.variant_sku) {
                const key = `${row.product_sku}::${row.variant_sku}`;
                if (seenKeys.has(key)) return;
                seenKeys.add(key);
                const group = variantGroups.get(key)!;
                result.push(group.length > 1 ? applyDiffMerge(group, VARIANT_DIFF_MAP) : group[0]);
            } else {
                const key = row.product_sku;
                if (seenKeys.has(key)) return;
                seenKeys.add(key);
                const group = productGroups.get(key)!;
                result.push(group.length > 1 ? applyDiffMerge(group, PRODUCT_DIFF_MAP) : group[0]);
            }
        });

        return result;
    }, []);

    return { validateRow, enrichWithDiff };
}
