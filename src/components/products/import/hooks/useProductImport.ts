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
    _specs?: Record<string, any>;
    errors: string[];
    isValid: boolean;
    action?: 'create' | 'update';
    diff?: string[];
}

const PRODUCT_REQUIRED = ['product_sku', 'product_name'];
const PRODUCT_OPTIONAL = ['description', 'category', 'category_id', 'brand', 'model', 'series', 'base_wholesale_price', 'base_retail_price', 'product_status', 'spec_values', 'device_models', 'is_variant'];
const VARIANT_FIELDS = ['variant_sku', 'variant_name', 'option_1', 'option_2', 'option_3', 'variant_wholesale_price', 'variant_retail_price', 'variant_status', 'variant_spec_values', 'barcode', 'variant_device_models'];

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
        let str = '';
        if (typeof value === 'number') {
            str = value.toLocaleString('fullwide', { useGrouping: false });
        } else {
            str = String(value).trim();
        }

        // 移除 Excel 可能添加的字首單引號
        if (str.startsWith("'")) {
            str = str.substring(1);
        }

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
                        category: String(row.category || row._categoryName || '').trim(),
                        base_wholesale_price: parseFloat(row.wholesale_price || row.base_wholesale_price) || 0,
                        base_retail_price: parseFloat(row.retail_price || row.base_retail_price) || 0,
                        product_status: parseStatus(row.status || row.product_status),
                        variant_sku: String(row['變體 SKU'] || row.variant_sku || (row.is_variant ? row.sku : '') || '').trim(),
                        variant_name: String(row['變體名稱'] || row.variant_name || (row.is_variant ? row.name : '') || '').trim(),
                        option_1: String(row['規格 1'] || row.option_1 || '').trim(),
                        option_2: String(row['規格 2'] || row.option_2 || '').trim(),
                        option_3: String(row['顏色 (規格 3)'] || row.option_3 || '').trim(),
                        variant_wholesale_price: parseFloat(row.variant_wholesale_price || row.wholesale_price) || undefined,
                        variant_retail_price: parseFloat(row.variant_retail_price || row.retail_price) || undefined,
                        variant_status: parseStatus(row.variant_status || row.status),
                        barcode: normalizeBarcode(row.barcode),
                        device_models: String(row['適用型號'] || row.device_models || '').trim(),
                        variant_device_models: String(row['適用型號'] || row.variant_device_models || '').trim(),
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

                const { data: existingProducts } = await supabase.from('products').select('*').in('sku', allSkus) as { data: any[] | null };
                const { data: existingVariants } = await supabase.from('product_variants').select('*').in('sku', allVariantSkus) as { data: any[] | null };

                const productIds = (existingProducts || []).map(p => p.id);
                const { data: existingCatLinks } = await (supabase.from('product_category_links' as any) as any).select('product_id, category_id').in('product_id', productIds);

                const enrichedData = rawParsed.map(row => {
                    const product = (existingProducts || []).find(p => p.sku === row.product_sku);
                    const variant = (existingVariants || []).find(v => v.sku === row.variant_sku);

                    const diff: string[] = [];
                    let action: 'create' | 'update' = 'create';

                    if (product) {
                        action = 'update';
                        row.spec_values = product.spec_values; // 保存現有規格供增量更新使用

                        if (product.name !== row.product_name) diff.push('產品名稱');
                        if (product.base_wholesale_price !== row.base_wholesale_price) diff.push('批發價');
                        if (product.base_retail_price !== row.base_retail_price) diff.push('零售價');

                        // 規格比較
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
                        row.variant_spec_values = variant.spec_values; // 保存現有規格

                        if (variant.name !== row.variant_name) diff.push('變體名稱');

                        const incomingSpecsV = row._specs || {};
                        const currentSpecsV = deserializeSpecs(variant.spec_values);
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
                'product_status', 'spec_values', 'device_models'
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
                    // 智慧合併規格：僅在數值非空時覆蓋
                    const incomingSpecs = row._specs || {};
                    const currentSpecs = existing._specs || {};
                    Object.entries(incomingSpecs).forEach(([key, val]) => {
                        if (val !== undefined && val !== null && val !== '') {
                            currentSpecs[key] = val;
                        }
                    });
                    existing._specs = currentSpecs;

                    // 合併分類 (用逗號分隔，並去重)
                    if (row.category && existing.category !== row.category) {
                        const allCats = new Set([
                            ...existing.category.split(',').map(c => c.trim()),
                            ...row.category.split(',').map(c => c.trim())
                        ].filter(Boolean));
                        row.category = Array.from(allCats).join(', ');
                    }

                    // 智慧合併基礎欄位 (非破壞性)
                    const fieldsToMerge = [
                        'product_name', 'description', 'brand', 'model', 'series',
                        'base_wholesale_price', 'base_retail_price', 'product_status', 'device_models'
                    ] as const;
                    fieldsToMerge.forEach(f => {
                        const val = (row as any)[f];
                        if (val !== undefined && val !== null && val !== '' && val !== 0) {
                            (existing as any)[f] = val;
                        }
                    });

                    // 修正：確保變體狀態不會被覆蓋，只要有一列是變體，整個產品就是變體
                    existing.is_variant = existing.is_variant || row.is_variant;
                } else {
                    uniqueProductsMap.set(row.product_sku, row);
                }
            });

            // 確保規格定義已載入
            let currentSpecDefs = specDefs;
            if (!currentSpecDefs || currentSpecDefs.length === 0) {
                const { data: fetchedSpecs } = await (supabase.from('specification_definitions' as any) as any).select('*');
                if (fetchedSpecs) currentSpecDefs = fetchedSpecs;
            }

            // 建立規格字典供序列化使用
            const specMap = new Map(currentSpecDefs.map(s => [s.id, {
                id: s.id,
                name: s.name,
                type: s.type,
                options: s.options || [],
                defaultValue: s.default_value || '',
                logic_config: s.logic_config
            } as any]));

            // 確保規格連結已載入
            const { data: specLinksData } = await supabase.from('category_spec_links').select('*');
            const specLinks = (specLinksData as any[]) || [];

            // 預先建立全局父子關係地圖 (基於 logic_config)
            const childrenMap = new Map<string, string[]>();
            currentSpecDefs.forEach(spec => {
                const triggers = spec.logic_config?.triggers || spec.logicConfig?.triggers || [];
                const targets = new Set<string>();
                triggers.forEach((t: any) => {
                    const tars = t.targets || (t as any).target_ids?.map((tid: string) => ({ id: tid })) || [];
                    tars.forEach((tar: any) => targets.add(tar.id));
                });
                if (targets.size > 0) {
                    childrenMap.set(spec.id, Array.from(targets));
                }
            });

            // [核心修正] 建立「分類感知」的父子關係地圖
            // 由於一個規格在不同分類可能有不同位置，我們需要建立一個 Map<CategoryId, Map<SpecId, ParentId>>
            const categoryParentMaps = new Map<string, Map<string, string>>();

            categories.forEach(cat => {
                const catMap = new Map<string, string>();
                const catLinks = specLinks.filter(l => l.category_id === cat.id);
                const linkedSpecIds = new Set(catLinks.map(l => l.spec_id));

                // 找出該分類下的所有父子關係 (僅限於該分類有連結的規格及其子規格)
                const queue = Array.from(linkedSpecIds).map(id => ({ id, parentId: 'root' }));
                const processed = new Set<string>();

                while (queue.length > 0) {
                    const next = queue.shift();
                    if (!next) continue;
                    const { id, parentId } = next;
                    if (processed.has(`${parentId}:${id}`)) continue;
                    processed.add(`${parentId}:${id}`);

                    catMap.set(id, parentId);

                    const children = childrenMap.get(id) || [];
                    children.forEach(cid => queue.push({ id: cid, parentId: id }));
                }
                categoryParentMaps.set(cat.id, catMap);
            });

            // 全域回退 Map (保留原本邏輯作為最後手段)
            const globalParentMap = new Map<string, string>();
            currentSpecDefs.forEach(s => {
                const triggers = s.logic_config?.triggers || s.logicConfig?.triggers || [];
                triggers.forEach((t: any) => {
                    const targets = t.targets || (t as any).target_ids?.map((tid: string) => ({ id: tid })) || [];
                    targets.forEach((tar: any) => globalParentMap.set(tar.id, s.id));
                });
            });

            const productsToInsert = Array.from(uniqueProductsMap.values()).map(row => {
                const incomingSpecs = row._specs || {};

                // [增量更新邏輯]
                // 1. 如果是更新動作且已有舊規格，則先載入舊規格
                let pathMap = new Map();
                if (row.action === 'update' && row.spec_values) {
                    const existingSpecs = deserializeSpecs(row.spec_values);
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

                    // [修正] 分類感知遷移邏輯
                    // 1. 找出該列所屬的分類 ID (優先使用第一分類)
                    const catName = row.category.split(',')[0].trim();
                    const catId = categories.find(c => c.name === catName)?.id;
                    const catParentMap = catId ? categoryParentMaps.get(catId) : null;

                    // 2. 決定當前規格的正確父層
                    const currentParentId = catParentMap?.get(specId) || globalParentMap.get(specId) || 'root';
                    const newKey = `${currentParentId}:${specId}`;

                    migratedPathMap.set(newKey, val);
                });

                const serializedSettings = serializeSpecs(Object.fromEntries(migratedPathMap), specMap);

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
                    _specPayload: serializedSettings,  // 暫存，不寫進 DB
                    _categoryName: row.category,       // 暫存分類名稱
                };
            });

            // 分離暫存欄位，避免寫入資料庫
            const productSpecPayloads = new Map<string, any>();
            const cleanProducts = productsToInsert.map((p: any) => {
                const { _specPayload, _categoryName, ...rest } = p;
                productSpecPayloads.set(p.sku, { payload: _specPayload, categoryName: _categoryName });
                return rest;
            });

            const { error: productError } = await supabase.from('products').upsert(cleanProducts, { onConflict: 'sku' });
            if (productError) throw productError;

            const { data: products, error: fetchError } = await supabase.from('products').select('id, sku').in('sku', Array.from(uniqueProductsMap.keys()));
            if (fetchError) throw fetchError;
            const productIdMap = new Map(products?.map(p => [p.sku, p.id]) || []);

            // v6 同步產品規格至新資料表
            await Promise.allSettled(
                Array.from(productSpecPayloads.entries()).map(async ([sku, { payload, categoryName }]) => {
                    const pId = productIdMap.get(sku);
                    if (!pId || !payload || payload.length === 0) return;
                    const catName = (categoryName || '').split(',')[0].trim();
                    const catId = categories.find((c: any) => c.name === catName)?.id;
                    if (!catId) return;
                    const row = uniqueProductsMap.get(sku);
                    if (row?.is_variant) return; // 有變體的產品規格由變體端管理
                    await supabase.rpc('sync_product_specs_v6', {
                        p_entity_id: pId,
                        p_entity_type: 'product',
                        p_category_id: catId,
                        p_new_data: payload
                    });
                })
            );

            const catLinks: any[] = [];
            Array.from(uniqueProductsMap.values()).forEach(row => {
                const pId = productIdMap.get(row.product_sku);
                if (!pId) return;

                if (row.category) {
                    const catNames = row.category.split(',').map(c => c.trim()).filter(Boolean);
                    catNames.forEach(name => {
                        const matchedCat = categories.find(c => c.name === name);
                        if (matchedCat) {
                            catLinks.push({ product_id: pId, category_id: matchedCat.id });
                        }
                    });
                }
            });

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
                    // 智慧合併規格：僅在數值非空時覆蓋
                    const incomingSpecsV = row._specs || {};
                    const currentSpecsV = existing._specs || {};
                    Object.entries(incomingSpecsV).forEach(([key, val]) => {
                        if (val !== undefined && val !== null && val !== '') {
                            currentSpecsV[key] = val;
                        }
                    });
                    existing._specs = currentSpecsV;

                    // 智慧合併變體欄位 (非破壞性)
                    const fieldsToMergeV = [
                        'variant_name', 'barcode', 'option_1', 'option_2', 'option_3',
                        'variant_wholesale_price', 'variant_retail_price', 'variant_status', 'variant_device_models'
                    ] as const;

                    fieldsToMergeV.forEach(f => {
                        const val = (row as any)[f];
                        if (val !== undefined && val !== null && val !== '' && val !== 0) {
                            (existing as any)[f] = val;
                        }
                    });
                } else {
                    uniqueVariantsMap.set(sku, row);
                }
            });

            const variantsToInsert = Array.from(uniqueVariantsMap.values()).map(row => {
                const incomingSpecsV = row._specs || {};

                // [增量更新邏輯]
                let pathMapV = new Map();
                if (row.action === 'update' && row.variant_spec_values) {
                    const existingSpecsV = deserializeSpecs(row.variant_spec_values);
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

                    // [修正] 分類感知遷移邏輯 (變體)
                    const catName = row.category.split(',')[0].trim();
                    const catId = categories.find(c => c.name === catName)?.id;
                    const catParentMap = catId ? categoryParentMaps.get(catId) : null;

                    const currentParentId = catParentMap?.get(specId) || globalParentMap.get(specId) || 'root';
                    migratedPathMapV.set(`${currentParentId}:${specId}`, val);
                });

                const serializedSettingsV = serializeSpecs(Object.fromEntries(migratedPathMapV), specMap);

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
                    // v6 架構：規格改寫入 product_spec_values
                    _specPayload: serializedSettingsV, // 暫存，不寫進 DB
                    _categoryName: row.category,      // 暫存分類名稱
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

                // 分離暫存欄位，避免寫入資料庫
                const variantSpecPayloads = new Map<string, any>();
                const cleanVariants = uniqueVariants.map((v: any) => {
                    const { _specPayload, _categoryName, ...rest } = v;
                    variantSpecPayloads.set(v.sku, { payload: _specPayload, categoryName: _categoryName });
                    return rest;
                });

                const { data: upsertedVariants, error } = await supabase.from('product_variants').upsert(cleanVariants, { onConflict: 'sku' }).select('id, sku');
                if (error) throw error;
                if (upsertedVariants) {
                    const variantIdMap = new Map(upsertedVariants.map(v => [v.sku, v.id]));

                    // v6 同步變體規格至新資料表
                    await Promise.allSettled(
                        upsertedVariants.map(async (v: any) => {
                            const specInfo = variantSpecPayloads.get(v.sku);
                            if (!specInfo?.payload || specInfo.payload.length === 0) return;
                            const catName = (specInfo.categoryName || '').split(',')[0].trim();
                            const catId = categories.find((c: any) => c.name === catName)?.id;
                            if (!catId) return;
                            await supabase.rpc('sync_product_specs_v6', {
                                p_entity_id: v.id,
                                p_entity_type: 'variant',
                                p_category_id: catId,
                                p_new_data: specInfo.payload
                            });
                        })
                    );
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
            spec_values: {},
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
