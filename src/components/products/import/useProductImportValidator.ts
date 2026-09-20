import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { deserializeSpecs, formatSpecValue } from '@/utils/specLogic';
import { ImportRow } from './useProductImport';

const PRODUCT_DIFF_MAP: Record<string, (keyof ImportRow)[]> = {
    '產品名稱': ['product_name'],
    '描述': ['description'],
    '系列': ['series_name'],
    '品牌': ['brand', 'brand_ids'],
};

const VARIANT_DIFF_MAP: Record<string, (keyof ImportRow)[]> = {
    '變體名稱': ['variant_name'],
    '變體批發價': ['variant_wholesale_price'],
    '變體零售價': ['variant_retail_price'],
    '變體狀態': ['variant_status'],
    '變體條碼': ['barcode'],
    '選項': ['_optionValues'],
};

export function useProductImportValidator(
    allDeviceModels: any[],
    allDeviceGroups: any[],
    categories: any[],
    allSeries: any[] = []
) {
    const validateRow = useCallback((
        row: Omit<ImportRow, 'errors' | 'isValid' | 'is_variant'>
    ): { errors: string[]; is_variant: boolean } => {
        const errors: string[] = [];
        if (!row.product_code) errors.push('產品代碼為必填');
        if (!row.product_name) errors.push('產品名稱為必填');

        const is_variant = typeof (row as any).is_variant === 'boolean'
            ? (row as any).is_variant
            : !!(row.variant_sku || row.variant_name);

        if (is_variant) {
            if (!row.variant_sku) errors.push('變體 SKU 為必填');
            if (!row.variant_name) errors.push('變體名稱為必填');
        }

        if (row.brand && !row.brand_id && (!row.brand_ids || row.brand_ids.length === 0)) {
            errors.push(`找不到品牌 "${row.brand}"`);
        }

        if (row.category) {
            row.category.split(',').map(s => s.trim()).filter(Boolean).forEach(cat => {
                if (!categories.find(c => c.name?.trim().toLowerCase() === cat.toLowerCase())) {
                    errors.push(`找不到分類 "${cat}"`);
                }
            });
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
    }, [allDeviceModels, allDeviceGroups]);

    const enrichWithDiff = useCallback(async (rawParsed: ImportRow[]): Promise<ImportRow[]> => {
        const allCodes = rawParsed.map(r => r.product_code).filter(Boolean);
        const allVariantSkus = rawParsed.map(r => r.variant_sku).filter(Boolean);
        const allIds = rawParsed.map(r => r.product_id || r.variant_id).filter(Boolean);

        const existingProducts: any[] = [];
        if (allCodes.length > 0) {
            const { data } = await (supabase.from('products') as any).select('*').in('code', allCodes);
            if (data) existingProducts.push(...data);
        }
        if (allIds.length > 0) {
            const { data } = await (supabase.from('products') as any).select('*').in('id', allIds);
            if (data) existingProducts.push(...data);
        }

        const productIds = existingProducts.map(p => p.id).filter(Boolean);
        const productSeriesMap = new Map<string, string[]>();
        const productBrandsMap = new Map<string, string[]>();
        if (productIds.length > 0) {
            const [{ data: seriesLinks }, { data: brandLinks }] = await Promise.all([
                (supabase.from('product_series_links') as any).select('product_id, brand_series_id').in('product_id', productIds),
                (supabase.from('product_brands') as any).select('product_id, brand_id').in('product_id', productIds)
            ]);
            if (seriesLinks) {
                seriesLinks.forEach(l => {
                    const arr = productSeriesMap.get(l.product_id) || [];
                    arr.push(l.brand_series_id);
                    productSeriesMap.set(l.product_id, arr);
                });
            }
            if (brandLinks) {
                brandLinks.forEach(l => {
                    const arr = productBrandsMap.get(l.product_id) || [];
                    arr.push(l.brand_id);
                    productBrandsMap.set(l.product_id, arr);
                });
            }
        }

        const existingVariants: any[] = [];
        if (allVariantSkus.length > 0) {
            const { data } = await (supabase.from('product_variants') as any).select('*').in('sku', allVariantSkus);
            if (data) existingVariants.push(...data);
        }
        if (allIds.length > 0) {
            const { data } = await (supabase.from('product_variants') as any).select('*').in('id', allIds);
            if (data) existingVariants.push(...data);
        }

        const existingVariantIds = existingVariants.map(v => v.id).filter(Boolean);

        const groupByIdInfo = new Map<string, { product_id: string; name: string; ln: string }>();
        const dbGroupsByProduct = new Map<string, { id: string; ln: string }[]>();
        if (productIds.length > 0) {
            const { data: optionGroups } = await (supabase.from('product_option_groups') as any)
                .select('id, name, product_id')
                .in('product_id', productIds);
            (optionGroups || []).forEach((g: any) => {
                const info = {
                    product_id: g.product_id,
                    name: String(g.name || '').trim(),
                    ln: String(g.name || '').trim().toLowerCase(),
                };
                groupByIdInfo.set(g.id, info);
                const arr = dbGroupsByProduct.get(info.product_id) || [];
                arr.push({ id: g.id, ln: info.ln });
                dbGroupsByProduct.set(info.product_id, arr);
            });
        }

        const dbVariantOptions = new Map<string, Record<string, { label: string; value: string }>>();
        const dbGroupVariantLabels = new Map<string, Record<string, string>>();
        if (existingVariantIds.length > 0) {
            const { data: variantOptions } = await (supabase.from('product_variant_options') as any)
                .select('variant_id, option_group_id, product_option_values(label, value)')
                .in('variant_id', existingVariantIds);
            (variantOptions || []).forEach((vo: any) => {
                const info = groupByIdInfo.get(vo.option_group_id);
                const pov = vo.product_option_values;
                if (!info || !pov) return;
                const label = String(pov.label ?? '').trim();
                const value = String(pov.value ?? '').trim();
                const map = dbVariantOptions.get(vo.variant_id) || {};
                map[info.ln] = { label, value };
                dbVariantOptions.set(vo.variant_id, map);
                const gl = dbGroupVariantLabels.get(vo.option_group_id) || {};
                gl[vo.variant_id] = label;
                dbGroupVariantLabels.set(vo.option_group_id, gl);
            });
        }

        // 產品層級：以與 RPC 相同的解析規則判斷選項是否有異動（含改名與 SKU 段）
        const fileOptionColsByProduct = new Map<string, Map<string, { name: string; display: string; labels: Record<string, string>; skus: Record<string, string> }>>();
        rawParsed.forEach(row => {
            if (!row.is_variant) return;
            const cols = fileOptionColsByProduct.get(row.product_code) || new Map();
            const names = row._optionValues || {};
            const displays = row._optionNames || {};
            const skus = row._optionValueSkus || {};
            Object.keys(names).forEach(colName => {
                if (!cols.has(colName)) {
                    cols.set(colName, { name: colName, display: displays[colName] || colName, labels: {}, skus: {} });
                }
                const col = cols.get(colName)!;
                if (row.variant_id) {
                    col.labels[row.variant_id] = String(names[colName]).trim();
                    if (skus[colName]) col.skus[row.variant_id] = String(skus[colName]).trim();
                }
            });
            fileOptionColsByProduct.set(row.product_code, cols);
        });

        const resolveOptionColumn = (
            col: { name: string; display: string; labels: Record<string, string> },
            dbGroups: { id: string; ln: string }[],
            matched: Set<string>
        ): { target: { id: string; ln: string } | null; changed: boolean } => {
            const lnName = col.name.toLowerCase();
            const lnDisp = col.display.toLowerCase();
            const byName = dbGroups.find(g => g.ln === lnName);
            if (byName) {
                if (lnDisp !== lnName && !dbGroups.some(g => g.id !== byName.id && g.ln === lnDisp)) {
                    return { target: byName, changed: true };
                }
                return { target: byName, changed: false };
            }
            const byDisplay = dbGroups.find(g => g.ln === lnDisp);
            if (byDisplay) return { target: byDisplay, changed: false };
            const variantKeys = Object.keys(col.labels);
            if (variantKeys.length > 0) {
                const orphans = dbGroups.filter(g => !matched.has(g.id));
                const orphansMatch = orphans.filter(g => {
                    const dbMap = dbGroupVariantLabels.get(g.id) || {};
                    return variantKeys.every(vId => String(dbMap[vId] ?? '') === col.labels[vId]);
                });
                if (orphansMatch.length === 1) return { target: orphansMatch[0], changed: true };
            }
            return { target: null, changed: true };
        };

        const optionChangedProducts = new Set<string>();
        fileOptionColsByProduct.forEach((cols, code) => {
            const product = (existingProducts || []).find(p => p.code === code);
            if (!product) { optionChangedProducts.add(code); return; }
            const dbGroups = dbGroupsByProduct.get(product.id) || [];
            const matched = new Set<string>();
            cols.forEach(col => {
                dbGroups.forEach(g => {
                    if (g.ln === col.name.toLowerCase() || g.ln === col.display.toLowerCase()) matched.add(g.id);
                });
            });
            let changed = false;
            for (const col of cols.values()) {
                const { target, changed: colChanged } = resolveOptionColumn(col, dbGroups, matched);
                if (colChanged || !target) { changed = true; break; }
                for (const [vId, label] of Object.entries(col.labels)) {
                    const cur = (dbVariantOptions.get(vId) || {})[target.ln];
                    if (!cur || cur.label !== label) { changed = true; break; }
                    const sku = col.skus[vId];
                    if (sku !== undefined && cur.value !== sku) { changed = true; break; }
                }
                if (changed) break;
            }
            if (changed) optionChangedProducts.add(code);
        });

        const seenVariantIds = new Set<string>();

        const enrichedRows = rawParsed.map(row => {
            const product = (existingProducts || []).find(p =>
                (row.product_id && p.id === row.product_id) || p.code === row.product_code
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
                const existingSeriesIds = productSeriesMap.get(product.id) || [];
                const hasSeriesChanged = row.brand_series_id
                    ? !existingSeriesIds.includes(row.brand_series_id) || existingSeriesIds.length !== 1
                    : existingSeriesIds.length > 0;
                if (hasSeriesChanged) diff.push('系列');
                const existingBrandIds = productBrandsMap.get(product.id) || [];
                const incomingBrandIds = row.brand_ids || (row.brand_id ? [row.brand_id] : []);
                const hasBrandChanged = incomingBrandIds.length !== existingBrandIds.length
                    || !incomingBrandIds.every((id: string) => existingBrandIds.includes(id));
                if (hasBrandChanged) diff.push('品牌');

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
                if (Number(variant.wholesale_price) !== Number(row.variant_wholesale_price)) diff.push('變體批發價');
                if (Number(variant.retail_price) !== Number(row.variant_retail_price)) diff.push('變體零售價');
                if (variant.status !== row.variant_status) diff.push('變體狀態');
                if (variant.barcode !== row.barcode) diff.push('變體條碼');
            }

            if (optionChangedProducts.has(row.product_code) && !diff.includes('選項')) {
                diff.push('選項');
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
                const key = `${row.product_code}::${row.variant_sku}`;
                if (!variantGroups.has(key)) variantGroups.set(key, []);
                variantGroups.get(key)!.push(row);
            } else {
                const key = row.product_code;
                if (!productGroups.has(key)) productGroups.set(key, []);
                productGroups.get(key)!.push(row);
            }
        });

        const result: ImportRow[] = [];
        rows.forEach(row => {
            if (row.is_variant && row.variant_sku) {
                const key = `${row.product_code}::${row.variant_sku}`;
                if (seenKeys.has(key)) return;
                seenKeys.add(key);
                const group = variantGroups.get(key)!;
                result.push(group.length > 1 ? applyDiffMerge(group, VARIANT_DIFF_MAP) : group[0]);
            } else {
                const key = row.product_code;
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
