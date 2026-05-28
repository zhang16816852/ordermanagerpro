import { useState, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import Papa from 'papaparse';
import jschardet from 'jschardet';
import { toast } from 'sonner';
import { serializeSpecs, deserializeSpecs, formatSpecValue } from '@/utils/specLogic';
import { useColorStore } from '@/store/useColorStore';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
import { useEffect } from 'react';
import { parseProductExcel, generateProductExcel } from '@/utils/excelUtils';
import * as XLSX from 'xlsx';
import { useSpecStore } from '@/store/useSpecStore';
import { entityRelationService } from '@/services/entityRelationService';

export interface ImportRow {
    product_sku: string;
    product_name: string;
    description: string;
    category: string;
    category_id?: string;
    brand: string;
    brand_id?: string;
    model: string;
    series: string;
    base_wholesale_price: number;
    base_retail_price: number;
    product_status: 'active' | 'discontinued' | 'preorder' | 'sold_out';
    spec_values?: any;
    variant_sku?: string;
    variant_name?: string;
    option_1?: string;
    option_2?: string;
    option_3?: string;
    variant_wholesale_price?: number;
    variant_retail_price?: number;
    variant_status?: 'active' | 'discontinued' | 'preorder' | 'sold_out';
    variant_spec_values?: any;
    barcode?: string;
    device_models?: string;
    variant_device_models?: string;
    is_variant: boolean;
    product_id?: string;
    variant_id?: string;
    _specs?: Record<string, any>;
    errors: string[];
    isValid: boolean;
    action?: 'create' | 'update';
    diff?: string[];
    has_variants?: boolean; // 用於內部判定
    _multiSpecs?: Record<string, Record<string, any>>; // category_id -> specs
    _categoryIds?: string[]; // 收集所有出現過的分類 IDs
}

export function useProductImport(onSuccess: () => void) {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<'upload' | 'preview'>('upload');
    const [importData, setImportData] = useState<ImportRow[]>([]);
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const [filterStatus, setFilterStatus] = useState<string>('all');

    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data, error } = await supabase.from('categories').select('*');
            if (error) return [];
            return data;
        },
    });

    const { specDefinitions: specDefs, fetchSpecs } = useSpecStore();
    const { colors: allColors, fetchColors } = useColorStore();
    const {
        models: allDeviceModels,
        groups: allGroups,
        fetchData: fetchDeviceData
    } = useDeviceModelStore();

    useEffect(() => {
        fetchColors();
        fetchDeviceData();
        fetchSpecs();
    }, [fetchColors, fetchDeviceData, fetchSpecs]);

    useEffect(() => {
        if (importData.length === 0) return;
        setImportData(prev => prev.map(row => {
            const { errors, is_variant } = validateRow(row as any);
            return { ...row, errors, is_variant, isValid: errors.length === 0 };
        }));
    }, [allColors, allDeviceModels, allGroups]);

    const { data: allBrands = [] } = useQuery({
        queryKey: ['brands-all-for-import'],
        queryFn: async () => {
            const { data, error } = await supabase.from('brands').select('*');
            if (error) return [];
            return (data as any[]) || [];
        },
    });

    const parseCondensedSpecs = (specStr: string) => {
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
    };

    const normalizeBarcode = (value: any): string => {
        if (!value) return '';
        let str = '';
        if (typeof value === 'number') {
            str = value.toLocaleString('fullwide', { useGrouping: false });
        } else {
            str = String(value).trim();
        }
        if (str.startsWith("'")) str = str.substring(1);
        if (/e\+/i.test(str)) return Number(str).toLocaleString('fullwide', { useGrouping: false });
        return str;
    };

    const validateRow = (row: Omit<ImportRow, 'errors' | 'isValid' | 'is_variant'>): { errors: string[]; is_variant: boolean } => {
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

        if (row.category && !row.category_id) {
            errors.push(`找不到分類 "${row.category}"`);
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
            // 僅支援用逗號 (,) 區隔多個型號或型號群組，保留名稱內部的斜線（例如 "三星 S25+/S24+" 會被視為一整個群組名稱）
            const parts = modelStr.split(',').map(s => s.trim()).filter(Boolean);
            parts.forEach(part => {
                let name = part;
                let type: 'group' | 'model' | 'exclude' | 'auto' = 'auto';
                const lowerPart = part.toLowerCase();

                if (lowerPart.startsWith('group:')) {
                    type = 'group';
                    name = part.substring(6).trim();
                } else if (lowerPart.startsWith('exclude:')) {
                    type = 'exclude';
                    name = part.substring(8).trim();
                } else if (lowerPart.startsWith('model:')) {
                    type = 'model';
                    name = part.substring(6).trim();
                }

                if (type === 'group') {
                    if (!allGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
                        errors.push(`${fieldName}: 找不到型號群組 "${name}"`);
                    }
                } else if (type === 'exclude') {
                    if (!allDeviceModels.some(m =>
                        (m.name?.trim().toLowerCase() === name.toLowerCase()) ||
                        (Array.isArray(m.aliases) && m.aliases.some((a: string) => a?.trim().toLowerCase() === name.toLowerCase()))
                    )) {
                        errors.push(`${fieldName}: 找不到排除型號 "${name}"`);
                    }
                } else if (type === 'model') {
                    if (!allDeviceModels.some(m =>
                        (m.name?.trim().toLowerCase() === name.toLowerCase()) ||
                        (Array.isArray(m.aliases) && m.aliases.some((a: string) => a?.trim().toLowerCase() === name.toLowerCase()))
                    )) {
                        errors.push(`${fieldName}: 找不到型號 "${name}"`);
                    }
                } else {
                    // type === 'auto'：自動判定。如果存在同名的型號群組則優先對應群組，否則對應一般型號
                    const hasGroup = allGroups.some(g => g.name.toLowerCase() === name.toLowerCase());
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
    };

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const result = event.target?.result;
            if (!(result instanceof ArrayBuffer)) return;

            try {
                const parsedRows = parseProductExcel(result);
                if (parsedRows.length === 0) {
                    toast.error('檔案中沒有有效的產品資料');
                    return;
                }

                const REVERSE_STATUS_MAP: Record<string, string> = {
                    '上架中': 'active', '上架': 'active',
                    '已停售': 'discontinued', '停產': 'discontinued', '停售': 'discontinued',
                    '預購中': 'preorder', '預購': 'preorder',
                    '售完停產': 'sold_out', '缺貨': 'sold_out', '售完': 'sold_out',
                };

                const parseStatus = (val: any): any => {
                    const v = String(val || '').trim();
                    if (!v) return 'active';
                    if (REVERSE_STATUS_MAP[v]) return REVERSE_STATUS_MAP[v];
                    return v.toLowerCase();
                };

                const rawParsed = parsedRows.map(row => {
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
                        
                        // 主商品欄位 (只有在非變體列時才有值)
                        base_wholesale_price: !is_variant ? (parseFloat(row.wholesale_price || row.base_wholesale_price) || 0) : 0,
                        base_retail_price: !is_variant ? (parseFloat(row.retail_price || row.base_retail_price) || 0) : 0,
                        product_status: !is_variant ? parseStatus(row.status || row.product_status) : 'active',
                        
                        // 變體欄位
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
                        
                        device_models: !is_variant ? String(row['適用型號'] || row.device_models || '').trim() : '',
                        variant_device_models: is_variant ? String(row['適用型號'] || row.device_models || row.variant_device_models || '').trim() : '',
                        
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
                        if (matched) (baseRow as any).brand_id = matched.id;
                    }

                    if (baseRow.category) {
                        const search = baseRow.category.split(',')[0].trim().toLowerCase();
                        const matched = categories.find(c => c.name?.trim().toLowerCase() === search);
                        if (matched) baseRow.category_id = matched.id;
                    }

                    const { errors } = validateRow(baseRow as any);
                    return { ...baseRow, errors, isValid: errors.length === 0 };
                });

                const allSkus = rawParsed.map(r => r.product_sku).filter(Boolean);
                const allVariantSkus = rawParsed.map(r => r.variant_sku).filter(Boolean);
                const allIds = rawParsed.map(r => r.product_id || r.variant_id).filter(Boolean);

                const { data: existingProducts } = await supabase.from('products').select('*')
                    .or(`sku.in.(${allSkus.join(',')})${allIds.length > 0 ? `,id.in.(${allIds.join(',')})` : ''}`) as { data: any[] | null };
                
                const { data: existingVariants } = await supabase.from('product_variants').select('*')
                    .or(`sku.in.(${allVariantSkus.join(',')})${allIds.length > 0 ? `,id.in.(${allIds.join(',')})` : ''}`) as { data: any[] | null };

                const enrichedData = rawParsed.map(row => {
                    const product = (existingProducts || []).find(p => (row.product_id && p.id === row.product_id) || p.sku === row.product_sku);
                    const variant = (existingVariants || []).find(v => (row.variant_id && v.id === row.variant_id) || v.sku === row.variant_sku);

                    const diff: string[] = [];
                    let action: 'create' | 'update' = 'create';

                    if (product) {
                        action = 'update';
                        row.product_id = product.id;
                        row.spec_values = product.spec_values;
                        if (product.name !== row.product_name) diff.push('產品名稱');
                        if (!row.is_variant && product.base_wholesale_price !== row.base_wholesale_price) diff.push('批發價');
                        
                        const incomingSpecs = row._specs || {};
                        const currentSpecs = deserializeSpecs(product.spec_values);
                        const hasSpecDiff = Object.entries(incomingSpecs).some(([id, val]) => {
                            const currentVal = currentSpecs[`root:${id}`] || currentSpecs[id];
                            return formatSpecValue(currentVal) !== String(val);
                        });
                        if (hasSpecDiff) diff.push('產品規格');
                    }

                    if (row.variant_sku && variant) {
                        action = 'update';
                        row.variant_id = variant.id;
                        row.variant_spec_values = variant.spec_values;
                        if (variant.name !== row.variant_name) diff.push('變體名稱');
                    }

                    return { ...row, action, diff };
                });

                setImportData(enrichedData);
                setStep('preview');
            } catch (err: any) {
                console.error('File parsing error:', err);
                toast.error(`檔案解析失敗: ${err.message}`);
            }
        };
        reader.readAsArrayBuffer(file);
    }, [specDefs, allBrands, allColors]);

    const resetState = useCallback(() => {
        setStep('upload');
        setImportData([]);
        setFilterCategory('all');
    }, []);

    const updateRow = useCallback((index: number, updatedRow: ImportRow) => {
        setImportData(prev => {
            const next = [...prev];
            next[index] = { ...updatedRow };
            return next;
        });
    }, []);

    const removeRow = useCallback((index: number) => {
        setImportData(prev => prev.filter((_, i) => i !== index));
    }, []);

    const importMutation = useMutation({
        mutationFn: async () => {
            const validRows = importData.filter(r => r.isValid);
            
            // 1. 建立產品 Map
            const uniqueProductsMap = new Map<string, ImportRow>();
            validRows.forEach(row => {
                const sku = row.product_sku;
                const existing = uniqueProductsMap.get(sku);
                
                // 取得分類 ID (從明確的 category_id，或是從 _categoryName / category 對應名稱)
                const getCatId = (cName: string | undefined) => categories.find(c => c.name === cName?.split(',')[0].trim())?.id;
                const catId = row.category_id || getCatId((row as any)._categoryName) || getCatId(row.category);

                if (!existing) {
                    const newRow = { ...row, has_variants: false, _categoryIds: [], _multiSpecs: {} };
                    if (catId) {
                        newRow._categoryIds.push(catId);
                        if (row._specs) newRow._multiSpecs![catId] = { ...row._specs };
                    }
                    uniqueProductsMap.set(sku, newRow);
                } else {
                    const merged = { ...existing };
                    if (!row.is_variant) {
                        Object.assign(merged, row);
                    }
                    merged.has_variants = existing.has_variants || row.is_variant;
                    merged._categoryIds = [...(existing._categoryIds || [])];
                    if (catId && !merged._categoryIds.includes(catId)) {
                        merged._categoryIds.push(catId);
                    }
                    merged._multiSpecs = { ...(existing._multiSpecs || {}) };
                    if (catId && row._specs) {
                        merged._multiSpecs[catId] = { ...(merged._multiSpecs[catId] || {}), ...row._specs };
                    }
                    uniqueProductsMap.set(sku, merged);
                }
            });

            // 標註是否有變體
            validRows.forEach(row => {
                if (row.is_variant || (row.variant_sku && row.variant_sku !== row.product_sku)) {
                    const p = uniqueProductsMap.get(row.product_sku);
                    if (p) p.has_variants = true;
                }
            });

            // 2. 準備規格字典
            const { data: specDefsData } = await supabase.from('specification_definitions').select('*');
            const specMap = new Map(specDefsData?.map(s => [s.id, s]) || []);

            // 3. 處理產品寫入
            const productsToInsert = Array.from(uniqueProductsMap.values()).map(row => {
                const data: any = {
                    sku: row.product_sku,
                    name: row.product_name,
                    description: row.description || null,
                    brand_id: row.brand_id || null,
                    model: row.model || null,
                    series: row.series || null,
                    base_wholesale_price: row.base_wholesale_price,
                    base_retail_price: row.base_retail_price,
                    status: row.product_status,
                    has_variants: row.has_variants
                };
                if (row.product_id) data.id = row.product_id;

                return { 
                    data, 
                    row 
                };
            });

            // 過濾掉 category 欄位（因為資料表不存在此欄位）
            const productsUpsertData = productsToInsert.map(p => {
                const { category, ...rest } = (p.data as any);
                return rest;
            });

            const { error: pErr } = await supabase.from('products').upsert(productsUpsertData, { onConflict: 'sku' });
            if (pErr) throw pErr;

            const { data: products } = await supabase.from('products').select('id, sku').in('sku', Array.from(uniqueProductsMap.keys()));
            const productIdMap = new Map(products?.map(p => [p.sku, p.id]) || []);

            // 4. 同步產品規格與分類關聯
            await Promise.all(productsToInsert.map(async p => {
                const pId = productIdMap.get(p.data.sku);
                if (!pId) return;

                const categoryIds = p.row._categoryIds || [];

                // 更新分類關聯表
                if (categoryIds.length > 0) {
                    await supabase.from('product_category_links').upsert(
                        categoryIds.map(cid => ({
                            product_id: pId,
                            category_id: cid
                        })), 
                        { onConflict: 'product_id,category_id' }
                    );
                }

                // 同步規格
                for (const catId of categoryIds) {
                    const specsForCat = p.row._multiSpecs?.[catId] || {};
                    let pathMap = new Map();
                    if (p.row.spec_values) {
                        const existingSpecs = deserializeSpecs(p.row.spec_values);
                        Object.entries(existingSpecs).forEach(([p, v]) => pathMap.set(p, v));
                    }
                    Object.entries(specsForCat).forEach(([id, val]) => pathMap.set(`root:${id}`, val));
                    const serialized = serializeSpecs(Object.fromEntries(pathMap), specMap as any);

                    if (serialized && serialized.length > 0) {
                        await supabase.rpc('sync_product_specs_v6', {
                            p_entity_id: pId,
                            p_entity_type: 'product',
                            p_category_id: catId,
                            p_new_data: serialized
                        });
                    }
                }
            }));

            // 5. 處理變體寫入
            const uniqueVariantsMap = new Map<string, ImportRow>();
            const skuGroups = new Map<string, ImportRow[]>();
            validRows.forEach(r => {
                const g = skuGroups.get(r.product_sku) || [];
                g.push(r);
                skuGroups.set(r.product_sku, g);
            });

            skuGroups.forEach((rows, pSku) => {
                // 如果有變體列，就處理變體列；如果沒有，但有填寫 variant_sku，則視為主商品當變體
                const targetRows = rows.filter(r => r.is_variant);
                const processRows = targetRows.length > 0 ? targetRows : (rows[0].variant_sku ? [rows[0]] : []);

                processRows.forEach(row => {
                    if (!row.variant_sku) return;
                    
                    const getCatId = (cName: string | undefined) => categories.find(c => c.name === cName?.split(',')[0].trim())?.id;
                    const catId = row.category_id || getCatId((row as any)._categoryName) || getCatId(row.category);
                    
                    const existing = uniqueVariantsMap.get(row.variant_sku);
                    if (!existing) {
                        const newRow = { ...row, _categoryIds: [], _multiSpecs: {} };
                        if (catId) {
                            newRow._categoryIds.push(catId);
                            if (row._specs) newRow._multiSpecs![catId] = { ...row._specs };
                        }
                        uniqueVariantsMap.set(row.variant_sku, newRow);
                    } else {
                        const merged = { ...existing };
                        Object.assign(merged, row);
                        merged._categoryIds = [...(existing._categoryIds || [])];
                        if (catId && !merged._categoryIds.includes(catId)) {
                            merged._categoryIds.push(catId);
                        }
                        merged._multiSpecs = { ...(existing._multiSpecs || {}) };
                        if (catId && row._specs) {
                            merged._multiSpecs[catId] = { ...(merged._multiSpecs[catId] || {}), ...row._specs };
                        }
                        uniqueVariantsMap.set(row.variant_sku, merged);
                    }
                });
            });

            const variantsToInsert = Array.from(uniqueVariantsMap.values())
                .filter(r => !!r.variant_sku)
                .map(row => {
                    const data: any = {
                        product_id: productIdMap.get(row.product_sku),
                        sku: row.variant_sku,
                        name: row.variant_name || row.product_name,
                        option_1: row.option_1 || null,
                        option_2: row.option_2 || null,
                        option_3: row.option_3 || null,
                        wholesale_price: row.variant_wholesale_price || row.base_wholesale_price,
                        retail_price: row.variant_retail_price || row.base_retail_price,
                        status: row.variant_status || row.product_status,
                        barcode: row.barcode || null
                    };
                    if (row.variant_id) data.id = row.variant_id;
                    return data;
                });

            if (variantsToInsert.length > 0) {
                const { error: vErr } = await supabase.from('product_variants').upsert(variantsToInsert, { onConflict: 'sku' });
                if (vErr) throw vErr;
            }

            const parseModelString = (modelStr: string | undefined) => {
                const result: { modelIds: string[]; groupIds: string[]; exclusions: { model_id: string }[] } = {
                    modelIds: [],
                    groupIds: [],
                    exclusions: []
                };
                if (modelStr === undefined) return result; // 沒填或沒這欄
                if (modelStr.trim() === '') return result; // 故意清空

                const parts = modelStr.split(',').map(s => s.trim()).filter(Boolean);
                parts.forEach(part => {
                    let name = part;
                    let type: 'group' | 'model' | 'exclude' | 'auto' = 'auto';
                    const lowerPart = part.toLowerCase();

                    if (lowerPart.startsWith('group:')) {
                        type = 'group';
                        name = part.substring(6).trim();
                    } else if (lowerPart.startsWith('exclude:')) {
                        type = 'exclude';
                        name = part.substring(8).trim();
                    } else if (lowerPart.startsWith('model:')) {
                        type = 'model';
                        name = part.substring(6).trim();
                    }

                    if (type === 'group') {
                        const group = allGroups.find(g => g.name.toLowerCase() === name.toLowerCase());
                        if (group) result.groupIds.push(group.id);
                    } else if (type === 'exclude') {
                        const model = allDeviceModels.find(m => 
                            m.name.toLowerCase() === name.toLowerCase() || 
                            (m.aliases || []).some((a: string) => a.toLowerCase() === name.toLowerCase())
                        );
                        if (model) result.exclusions.push({ model_id: model.id });
                    } else if (type === 'model') {
                        const model = allDeviceModels.find(m => 
                            m.name.toLowerCase() === name.toLowerCase() || 
                            (m.aliases || []).some((a: string) => a.toLowerCase() === name.toLowerCase())
                        );
                        if (model) result.modelIds.push(model.id);
                    } else {
                        // 自動判定
                        const group = allGroups.find(g => g.name.toLowerCase() === name.toLowerCase());
                        if (group) {
                            result.groupIds.push(group.id);
                        } else {
                            const model = allDeviceModels.find(m => 
                                m.name.toLowerCase() === name.toLowerCase() || 
                                (m.aliases || []).some((a: string) => a.toLowerCase() === name.toLowerCase())
                            );
                            if (model) result.modelIds.push(model.id);
                        }
                    }
                });
                return result;
            };

            const relationPromises: Promise<void>[] = [];

            // 處理主商品關聯
            for (const row of Array.from(uniqueProductsMap.values())) {
                const pId = productIdMap.get(row.product_sku);
                if (!pId || row.device_models === undefined) continue;
                
                const relations = parseModelString(row.device_models);
                relationPromises.push(entityRelationService.updateRelations('product', pId, relations));
            }

            // 取得剛匯入的 variants IDs
            const { data: insertedVariants } = await supabase.from('product_variants').select('id, sku').in('sku', variantsToInsert.map(v => v.sku));
            const variantIdMap = new Map(insertedVariants?.map(v => [v.sku, v.id]) || []);

            // 處理變體關聯與規格
            const variantSpecPromises: PromiseLike<any>[] = [];

            for (const row of Array.from(uniqueVariantsMap.values())) {
                if (!row.variant_sku) continue;
                const vId = variantIdMap.get(row.variant_sku);
                if (!vId) continue;

                // 處理型號關聯
                if (row.variant_device_models !== undefined) {
                    const relations = parseModelString(row.variant_device_models);
                    relationPromises.push(entityRelationService.updateRelations('variant', vId, relations));
                }

                // 處理變體規格
                const categoryIds = row._categoryIds || [];
                
                for (const catId of categoryIds) {
                    const specsForCat = row._multiSpecs?.[catId] || {};
                    const hasSpecs = Object.keys(specsForCat).length > 0 || (row.spec_values && Object.keys(row.spec_values).length > 0);
                    
                    if (hasSpecs) {
                        let pathMap = new Map();
                        // 1. 保留原本可能已經存在的規格
                        if (row.spec_values) {
                            const existingSpecs = deserializeSpecs(row.spec_values);
                            Object.entries(existingSpecs).forEach(([p, v]) => pathMap.set(p, v));
                        }
                        // 2. 覆蓋該分類下的新規格
                        Object.entries(specsForCat).forEach(([id, val]) => pathMap.set(`root:${id}`, val));
                        
                        const serialized = serializeSpecs(Object.fromEntries(pathMap), specMap as any);
                        
                        if (serialized.length > 0) {
                            variantSpecPromises.push(
                                supabase.rpc('sync_product_specs_v6', {
                                    p_entity_id: vId,
                                    p_entity_type: 'variant',
                                    p_category_id: catId,
                                    p_new_data: serialized
                                })
                            );
                        }
                    }
                }
            }

            // 批次執行所有關聯更新與規格更新，避免一次發出太多請求
            for (let i = 0; i < relationPromises.length; i += 5) {
                await Promise.all(relationPromises.slice(i, i + 5));
            }

            for (let i = 0; i < variantSpecPromises.length; i += 5) {
                await Promise.all(variantSpecPromises.slice(i, i + 5));
            }

            // 同步每個匯入商品的前台展示
            const importedProductIds = Array.from(productIdMap.values());
            for (let i = 0; i < importedProductIds.length; i += 5) {
                await Promise.all(
                    importedProductIds.slice(i, i + 5).map(pId => 
                        supabase.rpc('sync_storefront_items', { p_product_id: pId })
                    )
                );
            }

            // 通知版本系統：產品資料有異動，觸發前台快取全量同步
            await supabase.rpc('bump_data_version', { p_table_name: 'products' });

            return { success: true };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            toast.success('匯入成功');
            onSuccess();
            resetState();
        },
        onError: (err: any) => {
            console.error('Import error:', err);
            toast.error(`匯入失敗: ${err.message}`);
        }
    });

    const filteredData = importData.filter(row => {
        const categoryMatch = filterCategory === 'all' || row.category === filterCategory;
        const statusMatch = filterStatus === 'all' || 
            (filterStatus === 'changed' && row.diff && row.diff.length > 0) ||
            (filterStatus === 'new' && row.action === 'create') ||
            (filterStatus === 'error' && !row.isValid);
        return categoryMatch && statusMatch;
    });

    const downloadTemplate = useCallback(() => {
        const { categoryLinks } = useSpecStore.getState();
        const brandMap = Object.fromEntries(allBrands.map(b => [b.id, b.name]));
        const blob = generateProductExcel([], categories, specDefs, categoryLinks, brandMap);
        
        // generateProductExcel returns a workbook, we need to convert it to a blob
        const excelBuffer = XLSX.write(blob, { bookType: 'xlsx', type: 'array' });
        const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = '產品匯入範本.xlsx';
        a.click();
        URL.revokeObjectURL(url);
    }, [categories, specDefs, allBrands]);

    return {
        step,
        importData,
        filteredData,
        filterCategory,
        setFilterCategory,
        filterStatus,
        setFilterStatus,
        categories,
        isLoading: importMutation.isPending,
        handleFileUpload,
        updateRow,
        removeRow,
        importMutation,
        downloadTemplate,
        resetState,
        allBrands
    };
}
