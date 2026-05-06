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
    table_settings?: any;
    variant_sku?: string;
    variant_name?: string;
    option_1?: string;
    option_2?: string;
    option_3?: string;
    variant_wholesale_price?: number;
    variant_retail_price?: number;
    variant_status?: 'active' | 'discontinued' | 'preorder' | 'sold_out';
    variant_table_settings?: any;
    barcode?: string;
    device_models?: string;
    variant_device_models?: string;
    is_variant: boolean;
    _specs?: Record<string, any>;
    errors: string[];
    isValid: boolean;
    action?: 'create' | 'update';
    diff?: string[];
}

const PRODUCT_REQUIRED = ['product_sku', 'product_name'];
const PRODUCT_OPTIONAL = ['description', 'category', 'category_id', 'brand', 'model', 'series', 'base_wholesale_price', 'base_retail_price', 'product_status', 'table_settings', 'device_models', 'is_variant'];
const VARIANT_FIELDS = ['variant_sku', 'variant_name', 'option_1', 'option_2', 'option_3', 'variant_wholesale_price', 'variant_retail_price', 'variant_status', 'variant_table_settings', 'barcode', 'variant_device_models'];

export function useProductImport(onSuccess: () => void) {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<'upload' | 'preview'>('upload');
    const [importData, setImportData] = useState<ImportRow[]>([]);
    const [filterCategory, setFilterCategory] = useState<string>('all');

    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data, error } = await supabase.from('categories').select('*');
            if (error) return [];
            return data;
        },
    });

    const { data: specDefs = [] } = useQuery({
        queryKey: ['specification_definitions_all'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('specification_definitions' as any) as any).select('*');
            if (error) return [];
            return data as any[];
        },
    });

    const { colors: allColors, fetchColors } = useColorStore();
    const { 
        models: allDeviceModels, 
        groups: allGroups, 
        fetchData: fetchDeviceData 
    } = useDeviceModelStore();

    useEffect(() => {
        fetchColors();
        fetchDeviceData();
    }, []);

    // 當顏色或型號庫更新時，自動重新校驗所有資料
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
            const [name, ...valParts] = pair.split(':');
            const value = valParts.join(':').trim();
            const specId = specDefs.find(sd => sd.name === name.trim())?.id || name.trim();

            if (value.includes('/')) {
                const items = value.split('/').map(v => v.trim());
                if (items.some(item => item.includes('*'))) {
                    const obj: Record<string, number> = {};
                    items.forEach(item => {
                        const [opt, qty] = item.split('*');
                        if (opt && qty) {
                            obj[opt.trim()] = parseInt(qty.trim()) || 0;
                        }
                    });
                    settings[specId] = obj;
                } else {
                    settings[specId] = items;
                }
            } else if (value.includes('*')) {
                const [opt, qty] = value.split('*');
                if (opt && qty) {
                    settings[specId] = { [opt.trim()]: parseInt(qty.trim()) || 0 };
                } else {
                    settings[specId] = value;
                }
            } else {
                settings[specId] = value;
            }
        });
        return settings;
    };

    const resetState = () => {
        setStep('upload');
        setImportData([]);
    };

    const normalizeBarcode = (value: any): string => {
        if (!value) return '';
        if (typeof value === 'number') return value.toLocaleString('fullwide', { useGrouping: false });
        const str = String(value);
        if (/e\+/i.test(str)) return Number(str).toLocaleString('fullwide', { useGrouping: false });
        return str.trim();
    };

    const validateRow = (row: Omit<ImportRow, 'errors' | 'isValid' | 'is_variant'>): { errors: string[]; is_variant: boolean } => {
        const errors: string[] = [];
        if (!row.product_sku) errors.push('產品 SKU 為必填');
        if (!row.product_name) errors.push('產品名稱為必填');
        const isVariantVal = (row as any).is_variant_raw;
        const is_variant = isVariantVal
            ? (isVariantVal === '是' || isVariantVal === 'true' || isVariantVal === '1' || isVariantVal === 'TRUE')
            : !!(row.variant_sku || row.variant_name);

        if (is_variant) {
            if (!row.variant_sku) errors.push('變體 SKU 為必填（當有變體資料時）');
            if (!row.variant_name) errors.push('變體名稱為必填（當有變體資料時）');
        }

        // v4.11 品牌校驗
        if (row.brand && !row.brand_id) {
            errors.push(`找不到品牌 "${row.brand}"`);
        }

        // 顏色校驗 (針對 option_3)
        if (row.option_3 && is_variant) {
            const searchColor = row.option_3.trim().toLowerCase();
            const colorExists = allColors.some(c =>
                c.name.trim().toLowerCase() === searchColor ||
                c.code.trim().toLowerCase() === searchColor
            );
            if (!colorExists) {
                errors.push(`顏色 "${row.option_3}" 不存在於顏色庫`);
            }
        }

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
                let parsedRows: any[] = [];
                
                if (file.name.endsWith('.csv')) {
                    // 暫時保留 CSV 支援，但簡單處理
                    const uint8Array = new Uint8Array(result);
                    const binaryString = Array.from(uint8Array.slice(0, 1000)).map(b => String.fromCharCode(b)).join('');
                    const detection = jschardet.detect(binaryString);
                    const encoding = detection.encoding || 'UTF-8';
                    
                    const text = new TextDecoder(encoding).decode(result);
                    const csvResult = Papa.parse(text, { header: true, skipEmptyLines: true });
                    parsedRows = csvResult.data.map((r: any) => ({
                        ...r,
                        is_variant: r.is_variant === '是' || r.is_variant === 'true',
                        _specs: r.規格 ? parseCondensedSpecs(r.規格) : (r.變體規格 ? parseCondensedSpecs(r.變體規格) : {})
                    }));
                } else {
                    // Excel 處理
                    parsedRows = parseProductExcel(result);
                }

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
                    const baseRow: ImportRow = {
                        product_sku: String(row.sku || row.product_sku || '').trim(),
                        product_name: String(row.name || row.product_name || '').trim(),
                        brand: String(row.brand || '').trim(),
                        model: String(row.model || '').trim(),
                        series: String(row.series || '').trim(),
                        description: String(row.description || '').trim(),
                        category: String(row._categoryName || row.category || '').trim(),
                        base_wholesale_price: parseFloat(row.wholesale_price || row.base_wholesale_price) || 0,
                        base_retail_price: parseFloat(row.retail_price || row.base_retail_price) || 0,
                        product_status: parseStatus(row.status || row.product_status),
                        variant_sku: String(row.variant_sku || (row.is_variant ? row.sku : '') || '').trim(),
                        variant_name: String(row.variant_name || (row.is_variant ? row.name : '') || '').trim(),
                        option_1: String(row.option_1 || '').trim(),
                        option_2: String(row.option_2 || '').trim(),
                        option_3: String(row.option_3 || '').trim(),
                        variant_wholesale_price: parseFloat(row.variant_wholesale_price || row.wholesale_price) || undefined,
                        variant_retail_price: parseFloat(row.variant_retail_price || row.retail_price) || undefined,
                        variant_status: parseStatus(row.variant_status || row.status),
                        barcode: normalizeBarcode(row.barcode),
                        device_models: String(row.device_models || '').trim(),
                        variant_device_models: String(row.variant_device_models || '').trim(),
                        is_variant: !!row.is_variant,
                        _specs: row._specs || {},
                        errors: [],
                        isValid: true
                    };

                    // 自動匹配品牌 ID
                    if (baseRow.brand) {
                        const matched = allBrands.find(b => b.name.toLowerCase() === baseRow.brand.toLowerCase());
                        if (matched) (baseRow as any).brand_id = matched.id;
                    }

                    const { errors, is_variant } = validateRow(baseRow as any);
                    return { ...baseRow, is_variant, errors, isValid: errors.length === 0 };
                });

                const allSkus = rawParsed.map(r => r.product_sku).filter(Boolean);
                const allVariantSkus = rawParsed.map(r => r.variant_sku).filter(Boolean);

                const { data: existingProducts } = await supabase.from('products').select('*').in('sku', allSkus);
                const { data: existingVariants } = await supabase.from('product_variants').select('*').in('sku', allVariantSkus);

                const productIds = (existingProducts || []).map(p => p.id);
                const { data: existingCatLinks } = await (supabase.from('product_category_links' as any) as any).select('product_id, category_id').in('product_id', productIds);

                const enrichedData = rawParsed.map(row => {
                    const product = (existingProducts || []).find(p => p.sku === row.product_sku);
                    const variant = (existingVariants || []).find(v => v.sku === row.variant_sku);

                    const diff: string[] = [];
                    let action: 'create' | 'update' = 'create';

                    if (product) {
                        action = 'update';
                        row.table_settings = product.table_settings; // 保存現有規格供增量更新使用
                        
                        if (product.name !== row.product_name) diff.push('產品名稱');
                        if (product.base_wholesale_price !== row.base_wholesale_price) diff.push('批發價');
                        if (product.base_retail_price !== row.base_retail_price) diff.push('零售價');
                        
                        // 規格比較
                        const incomingSpecs = row._specs || {};
                        const currentSpecs = deserializeSpecs(product.table_settings);
                        const hasSpecDiff = Object.entries(incomingSpecs).some(([id, val]) => {
                            const currentVal = currentSpecs[`root:${id}`] || currentSpecs[id];
                            return formatSpecValue(currentVal) !== String(val);
                        });
                        if (hasSpecDiff) diff.push('產品規格');
                    }

                    if (row.variant_sku && variant) {
                        action = 'update';
                        row.variant_table_settings = variant.table_settings; // 保存現有規格
                        
                        if (variant.name !== row.variant_name) diff.push('變體名稱');
                        
                        const incomingSpecsV = row._specs || {};
                        const currentSpecsV = deserializeSpecs(variant.table_settings);
                        const hasSpecDiffV = Object.entries(incomingSpecsV).some(([id, val]) => {
                            const currentVal = currentSpecsV[`root:${id}`] || currentSpecsV[id];
                            return formatSpecValue(currentVal) !== String(val);
                        });
                        if (hasSpecDiffV) diff.push('變體規格');
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

    const updateRow = (index: number, field: keyof ImportRow, value: any) => {
        setImportData(prev => {
            const updated = [...prev];
            const targetRow = updated[index];
            const productLevelFields: (keyof ImportRow)[] = [
                'product_name', 'description', 'category', 'brand', 'brand_id',
                'model', 'series', 'base_wholesale_price', 'base_retail_price',
                'product_status', 'table_settings', 'device_models'
            ];

            if (productLevelFields.includes(field)) {
                // 如果是主商品層級欄位，同步所有相同 SKU 的列
                return updated.map(row => {
                    if (row.product_sku === targetRow.product_sku) {
                        const newRow = { ...row, [field]: value };
                        const { errors, is_variant } = validateRow(newRow as any);
                        return { ...newRow, errors, is_variant, isValid: errors.length === 0 };
                    }
                    return row;
                });
            } else {
                // 否則只更新當前列（變體層級欄位）
                const row = { ...targetRow, [field]: value };
                const { errors, is_variant } = validateRow(row as any);
                updated[index] = { ...row, errors, is_variant, isValid: errors.length === 0 };
                return updated;
            }
        });
    };

    const removeRow = (index: number) => setImportData(prev => prev.filter((_, i) => i !== index));

    const importMutation = useMutation({
        mutationFn: async () => {
            const validRows = importData.filter(r => r.isValid);
            const uniqueProductsMap = new Map<string, ImportRow>();
            validRows.forEach(row => { 
                const existing = uniqueProductsMap.get(row.product_sku);
                if (existing) {
                    existing._specs = { ...(existing._specs || {}), ...(row._specs || {}) };
                    Object.assign(existing, { ...row, _specs: existing._specs });
                } else {
                    uniqueProductsMap.set(row.product_sku, row);
                }
            });

            // 建立規格字典供序列化使用
            const specMap = new Map(specDefs.map(s => [s.id, {
                id: s.id, name: s.name, type: s.type, options: s.options || [], defaultValue: s.default_value || ''
            } as any]));

            // [新增] 建立最新的父子關係地圖 (ChildID -> ParentID)
            const currentParentMap = new Map<string, string>();
            specDefs.forEach(s => {
                const triggers = s.logic_config?.triggers || s.logicConfig?.triggers || [];
                triggers.forEach((t: any) => {
                    const targets = t.targets || (t as any).target_ids?.map((tid: string) => ({ id: tid })) || [];
                    targets.forEach((tar: any) => currentParentMap.set(tar.id, s.id));
                });
            });

            const productsToInsert = Array.from(uniqueProductsMap.values()).map(row => {
                const incomingSpecs = row._specs || {};
                
                // [增量更新邏輯]
                // 1. 如果是更新動作且已有舊規格，則先載入舊規格
                let pathMap = new Map();
                if (row.action === 'update' && row.table_settings) {
                    const existingSpecs = deserializeSpecs(row.table_settings);
                    Object.entries(existingSpecs).forEach(([path, val]) => pathMap.set(path, val));
                }
                
                // 2. 將 Excel 中的新規格覆蓋上去
                Object.entries(incomingSpecs).forEach(([key, val]) => {
                    const pathKey = key.includes(':') ? key : `root:${key}`;
                    pathMap.set(pathKey, val);
                });

                // [新增] 規格層級自動遷移機制 (Schema Migration)
                // 根據目前的規格定義，自動將規格值移轉到正確的 parentId 之下
                const migratedPathMap = new Map<string, any>();
                
                pathMap.forEach((val, pathKey) => {
                    const [oldParentId, specId] = pathKey.split(':');
                    if (!specId) return;

                    const currentParentId = currentParentMap.get(specId) || 'root';
                    const newKey = `${currentParentId}:${specId}`;
                    
                    // 如果路徑發生變更 (例如被包進了另一個規格)，則進行遷移
                    // 注意：如果有重複，則以較新的 (來自 Excel) 為準
                    migratedPathMap.set(newKey, val);
                });
                
                const serializedSettings = serializeSpecs(migratedPathMap, specMap);

                return {
                    sku: row.product_sku,
                    name: row.product_name,
                    description: row.description || null,
                    model: row.model || null,
                    series: row.series || null,
                    brand_id: row.brand_id || null,
                    base_wholesale_price: row.base_wholesale_price,
                    base_retail_price: row.base_retail_price,
                    status: row.product_status,
                    has_variants: row.is_variant,
                    table_settings: serializedSettings as any,
                };
            });

            const { error: productError } = await supabase.from('products').upsert(productsToInsert, { onConflict: 'sku' });
            if (productError) throw productError;

            const { data: products, error: fetchError } = await supabase.from('products').select('id, sku').in('sku', Array.from(uniqueProductsMap.keys()));
            if (fetchError) throw fetchError;
            const productIdMap = new Map(products?.map(p => [p.sku, p.id]) || []);

            const catLinks = Array.from(uniqueProductsMap.values()).map(row => {
                let catId = row.category_id || categories.find(c => c.name === row.category)?.id;
                return catId ? { product_id: productIdMap.get(row.product_sku), category_id: catId } : null;
            }).filter(Boolean);

            if (catLinks.length > 0) {
                const productIds = Array.from(productIdMap.values());
                await (supabase.from('product_category_links' as any) as any).delete().in('product_id', productIds);
                await (supabase.from('product_category_links' as any) as any).insert(catLinks);
            }
            const productModelLinksToInsert: any[] = [];
            const productGroupLinksToInsert: any[] = [];

            Array.from(uniqueProductsMap.values()).forEach(row => {
                if (!row.device_models) return;
                const parts = row.device_models.split(',').map(n => n.trim()).filter(Boolean);
                const pId = productIdMap.get(row.product_sku);
                if (!pId) return;

                parts.forEach(part => {
                    let type: 'group' | 'model' | 'auto' = 'auto';
                    let searchStr = part;

                    if (part.startsWith('group:')) {
                        type = 'group';
                        searchStr = part.replace('group:', '');
                    } else if (part.startsWith('model:')) {
                        type = 'model';
                        searchStr = part.replace('model:', '');
                    }

                    if (type === 'group' || type === 'auto') {
                        const gMatched = allGroups.find(g => g.name.toLowerCase() === searchStr.toLowerCase());
                        if (gMatched) {
                            productGroupLinksToInsert.push({ product_id: pId, group_id: gMatched.id });
                            if (type === 'group') return; // 如果指定是 group，就不用再找 model
                        }
                    }

                    if (type === 'model' || type === 'auto') {
                        // 三層匹配：1. Name, 2. Alias (TODO: aliases is JSON array)
                        const mMatched = allDeviceModels.find(dm => 
                            dm.name.toLowerCase() === searchStr.toLowerCase() ||
                            (Array.isArray(dm.aliases) && dm.aliases.some((a: string) => a.toLowerCase() === searchStr.toLowerCase()))
                        );
                        if (mMatched) {
                            productModelLinksToInsert.push({ product_id: pId, model_id: mMatched.id });
                        }
                    }
                });
            });

            // 型號連結去重
            const uniqueProductModelLinks = Array.from(
                productModelLinksToInsert.reduce((map, item) => {
                    const key = `${item.product_id}-${item.model_id}`;
                    map.set(key, item);
                    return map;
                }, new Map<string, any>()).values()
            );

            const uniqueProductGroupLinks = Array.from(
                productGroupLinksToInsert.reduce((map, item) => {
                    const key = `${item.product_id}-${item.group_id}`;
                    map.set(key, item);
                    return map;
                }, new Map<string, any>()).values()
            );

            const pIds = Array.from(productIdMap.values());
            // 先清理舊關聯
            if (pIds.length > 0) {
                await supabase.from('product_model_links').delete().in('product_id', pIds);
                await supabase.from('product_model_group_links').delete().in('product_id', pIds);
            }
            
            if (uniqueProductModelLinks.length > 0) {
                await supabase.from('product_model_links').insert(uniqueProductModelLinks as any);
            }
            if (uniqueProductGroupLinks.length > 0) {
                await supabase.from('product_model_group_links').insert(uniqueProductGroupLinks as any);
            }

            // 合併變體資料
            const uniqueVariantsMap = new Map<string, ImportRow>();
            validRows.filter(r => r.is_variant).forEach(row => {
                const sku = row.variant_sku!;
                const existing = uniqueVariantsMap.get(sku);
                if (existing) {
                    existing._specs = { ...(existing._specs || {}), ...(row._specs || {}) };
                    Object.assign(existing, { ...row, _specs: existing._specs });
                } else {
                    uniqueVariantsMap.set(sku, row);
                }
            });

            const variantsToInsert = Array.from(uniqueVariantsMap.values()).map(row => {
                const incomingSpecsV = row._specs || {};
                
                // [增量更新邏輯]
                let pathMapV = new Map();
                if (row.action === 'update' && row.variant_table_settings) {
                    const existingSpecsV = deserializeSpecs(row.variant_table_settings);
                    Object.entries(existingSpecsV).forEach(([path, val]) => pathMapV.set(path, val));
                }

                Object.entries(incomingSpecsV).forEach(([key, val]) => {
                    const pathKey = key.includes(':') ? key : `root:${key}`;
                    pathMapV.set(pathKey, val);
                });

                // [遷移] 自動修正層級
                const migratedPathMapV = new Map<string, any>();
                pathMapV.forEach((val, pathKey) => {
                    const [oldParentId, specId] = pathKey.split(':');
                    if (!specId) return;
                    const currentParentId = currentParentMap.get(specId) || 'root';
                    migratedPathMapV.set(`${currentParentId}:${specId}`, val);
                });

                const serializedSettingsV = serializeSpecs(migratedPathMapV, specMap);

                return {
                    product_id: productIdMap.get(row.product_sku) as any,
                    sku: row.variant_sku!,
                    name: row.variant_name!,
                    option_1: row.option_1 || null,
                    option_2: row.option_2 || null,
                    option_3: row.option_3 || null,
                    wholesale_price: row.variant_wholesale_price || row.base_wholesale_price,
                    retail_price: row.variant_retail_price || row.base_retail_price,
                    barcode: normalizeBarcode(row.barcode) || null,
                    status: row.variant_status || row.product_status,
                    table_settings: serializedSettingsV as any,
                };
            });

            if (variantsToInsert.length > 0) {
                // 去重：確保同一個 SKU 不會出現在同一次 upsert 中，避免 "on conflict do update command cannot affect row a second time"
                const uniqueVariants = Array.from(
                    variantsToInsert.reduce((map, item) => {
                        map.set(item.sku, item);
                        return map;
                    }, new Map<string, any>()).values()
                );

                const { data: upsertedVariants, error } = await supabase.from('product_variants').upsert(uniqueVariants, { onConflict: 'sku' }).select('id, sku');
                if (error) throw error;
                if (upsertedVariants) {
                    const variantIdMap = new Map(upsertedVariants.map(v => [v.sku, v.id]));
                    const variantModelLinksToInsert: any[] = [];
                    const variantGroupLinksToInsert: any[] = [];

                    validRows.filter(r => r.is_variant).forEach(row => {
                        if (!row.variant_device_models) return;
                        const parts = row.variant_device_models.split(',').map(n => n.trim()).filter(Boolean);
                        const vId = variantIdMap.get(row.variant_sku!);
                        if (!vId) return;

                        parts.forEach(part => {
                            let type: 'group' | 'model' | 'auto' = 'auto';
                            let searchStr = part;

                            if (part.startsWith('group:')) {
                                type = 'group';
                                searchStr = part.replace('group:', '');
                            } else if (part.startsWith('model:')) {
                                type = 'model';
                                searchStr = part.replace('model:', '');
                            }

                            if (type === 'group' || type === 'auto') {
                                const gMatched = allGroups.find(g => g.name.toLowerCase() === searchStr.toLowerCase());
                                if (gMatched) {
                                    variantGroupLinksToInsert.push({ variant_id: vId, group_id: gMatched.id });
                                    if (type === 'group') return;
                                }
                            }

                            if (type === 'model' || type === 'auto') {
                                const mMatched = allDeviceModels.find(dm => 
                                    dm.name.toLowerCase() === searchStr.toLowerCase() ||
                                    (Array.isArray(dm.aliases) && dm.aliases.some((a: string) => a.toLowerCase() === searchStr.toLowerCase()))
                                );
                                if (mMatched) {
                                    variantModelLinksToInsert.push({ variant_id: vId, model_id: mMatched.id });
                                }
                            }
                        });
                    });

                    const vIds = Array.from(variantIdMap.values()) as string[];
                    if (vIds.length > 0) {
                        await supabase.from('variant_model_links').delete().in('variant_id', vIds);
                        await supabase.from('variant_model_group_links').delete().in('variant_id', vIds);
                    }

                    if (variantModelLinksToInsert.length > 0) {
                        const uniqueVML = Array.from(variantModelLinksToInsert.reduce((map, item) => {
                            const key = `${item.variant_id}-${item.model_id}`;
                            map.set(key, item); return map;
                        }, new Map<string, any>()).values());
                        await supabase.from('variant_model_links').insert(uniqueVML as any);
                    }
                    if (variantGroupLinksToInsert.length > 0) {
                        const uniqueVGL = Array.from(variantGroupLinksToInsert.reduce((map, item) => {
                            const key = `${item.variant_id}-${item.group_id}`;
                            map.set(key, item); return map;
                        }, new Map<string, any>()).values());
                        await supabase.from('variant_model_group_links').insert(uniqueVGL as any);
                    }
                }
            }
        },
        onSuccess: () => {
            toast.success('匯入成功');
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            queryClient.invalidateQueries({ queryKey: ['all-active-variants'] });
            queryClient.invalidateQueries({ queryKey: ['product-variants'] });
            onSuccess();
        },
        onError: (error: Error) => toast.error(`匯入失敗：${error.message}`),
    });

    const downloadTemplate = async () => {
        const { data: specDefs } = await supabase.from('specification_definitions').select('*');
        const { data: categoriesData } = await supabase.from('categories').select('*');
        const { data: specLinks } = await supabase.from('category_spec_links').select('*');
        
        // 為每個分類產生一個範例列
        const sampleProducts = (categoriesData || []).map(cat => ({
            sku: `NEW-${cat.name}-001`,
            name: `${cat.name}產品範例`,
            description: '產品描述',
            brand_id: allBrands[0]?.id || null,
            model: '型號',
            series: '系列',
            category_ids: [cat.id],
            category_names: [cat.name],
            base_wholesale_price: 0,
            base_retail_price: 0,
            status: 'active',
            table_settings: {},
            variants: []
        }));

        const brandMap = Object.fromEntries(allBrands.map(b => [b.id, b.name]));

        try {
            const workbook = generateProductExcel(sampleProducts, categoriesData || [], specDefs || [], specLinks || [], brandMap);
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = '產品匯出入範本.xlsx';
            link.click();
            URL.revokeObjectURL(url);
            toast.success('範本已生成');
        } catch (error: any) {
            toast.error(`生成範本失敗: ${error.message}`);
        }
    };

    const [filterStatus, setFilterStatus] = useState<string>('all');
    const filteredData = importData.filter(r => {
        const matchCat = filterCategory === 'all' || r.category === filterCategory;
        const matchStatus = filterStatus === 'all' ||
            (filterStatus === 'changed' && r.action === 'update' && r.diff && r.diff.length > 0) ||
            (filterStatus === 'new' && r.action === 'create') ||
            (filterStatus === 'error' && !r.isValid);
        return matchCat && matchStatus;
    });

    return {
        step, setStep, importData, filteredData, filterCategory, setFilterCategory,
        filterStatus, setFilterStatus, isLoading: importMutation.isPending,
        handleFileUpload, updateRow, removeRow, importMutation, downloadTemplate, resetState, categories,
        allBrands, allColors
    };
}
