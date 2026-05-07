import * as XLSX from 'xlsx';
import { CategorySpec } from '@/hooks/useCategorySpecs';
import { formatSpecValue, getSpecValue } from './specLogic';

/**
 * 產品匯出入基礎欄位定義
 */
export const BASE_COLUMNS = {
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

export type BaseColumnKey = keyof typeof BASE_COLUMNS;

/**
 * 生成 Excel 檔案
 */
export function generateProductExcel(
    products: any[],
    categories: any[],
    specDefs: any[],
    specLinks: any[] = [],
    brandMap: Record<string, string> = {}
) {
    const workbook = XLSX.utils.book_new();
    
    // 1. 建立規格對應字典
    const specMap = new Map<string, CategorySpec>();
    specDefs.forEach(d => { specMap.set(d.id, d); });

    // 2. 將產品依「所有分類」群組（一品多位）
    const categoryGroups: Record<string, any[]> = {};
    const categoryInfoMap: Record<string, { name: string, sort_order: number }> = {};
    categories.forEach(c => { 
        categoryInfoMap[c.id] = { name: c.name, sort_order: c.sort_order || 0 }; 
    });

    products.forEach(p => {
        const catIds = (p.category_ids && p.category_ids.length > 0) ? p.category_ids : ['unclassified'];
        
        catIds.forEach((catId: string) => {
            if (!categoryGroups[catId]) categoryGroups[catId] = [];
            categoryGroups[catId].push({ ...p, _currentCatId: catId === 'unclassified' ? null : catId });
        });
    });

    const sortedCatIds = Object.keys(categoryGroups).sort((a, b) => {
        if (a === 'unclassified') return 1;
        if (b === 'unclassified') return -1;
        return (categoryInfoMap[a]?.sort_order || 0) - (categoryInfoMap[b]?.sort_order || 0);
    });

    // 4. 為每個分類建立一個 Sheet
    sortedCatIds.forEach(catId => {
        const groupProducts = categoryGroups[catId];
        const catName = catId === 'unclassified' ? '未分類' : (categoryInfoMap[catId]?.name || '未知分類');
        const currentCatId = catId === 'unclassified' ? null : catId;
        
        // 找出該分類定義的所有規格
        const definedSpecKeys: { key: string, name: string, path: string }[] = [];
        
        // 預先建立全局父子關係地圖 (基於 logic_config)
        const childrenMap = new Map<string, string[]>();
        specDefs.forEach(spec => {
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

        // 遞迴獲取所有規格（包含子規格）
        const processedKeys = new Set<string>();
        const collectSpecs = (specId: string, parentId: string, parentPath: string = '') => {
            const spec = specMap.get(specId);
            if (!spec) return;
            
            const key = `${parentId}:${specId}`;
            if (processedKeys.has(key)) return;
            processedKeys.add(key);

            const currentPath = parentPath ? `${parentPath} > ${spec.name}` : spec.name;
            const displayName = parentPath ? `[${parentPath.split(' > ').pop()}] ${spec.name}` : spec.name;
            
            definedSpecKeys.push({ key, name: displayName, path: currentPath });
            
            // 處理子規格
            const children = childrenMap.get(specId) || [];
            children.forEach(childId => {
                collectSpecs(childId, specId, currentPath);
            });
        };

        if (currentCatId) {
            // 找出該分類的所有連結
            const links = specLinks
                .filter(link => link.category_id === currentCatId)
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            
            const linkedSpecIds = new Set(links.map(l => l.spec_id));
            
            // 找出哪些連結其實是別人的子規格 (全局判定)
            const allChildIds = new Set<string>();
            specDefs.forEach(s => {
                const children = childrenMap.get(s.id) || [];
                children.forEach(cid => allChildIds.add(cid));
            });
            
            // 只從「不是別人子規格」且「有關聯到此分類」的連結開始遞迴
            links.forEach(link => {
                if (!allChildIds.has(link.spec_id)) {
                    collectSpecs(link.spec_id, 'root');
                }
            });
        } else {
            // 未分類則顯示所有未被分類關聯的規格，且作為根規格出現
            const linkedSpecIds = new Set(specLinks.map(l => l.spec_id));
            const activeKeys = new Set<string>();
            groupProducts.forEach(p => {
                const settings = p.table_settings;
                if (Array.isArray(settings)) {
                    settings.forEach((s: any) => {
                        if (!linkedSpecIds.has(s.id)) {
                            activeKeys.add(`root:${s.id}`);
                        }
                    });
                }
            });
            
            Array.from(activeKeys).forEach(key => {
                const [_, specId] = key.split(':');
                const spec = specMap.get(specId);
                if (spec) {
                    definedSpecKeys.push({ key, name: spec.name, path: spec.name });
                }
            });
        }

        // 構建 Headers (三列)
        // Row 1: 顯示名稱
        // Row 2: 完整路徑 (隱藏)
        // Row 3: 技術 ID (隱藏)
        const row1Names = [...Object.keys(BASE_COLUMNS)];
        const row2Paths = [...Object.keys(BASE_COLUMNS).map(() => '')];
        const row3Ids = [...Object.values(BASE_COLUMNS) as string[]];

        definedSpecKeys.forEach(spec => {
            row1Names.push(spec.name);
            row2Paths.push(spec.path);
            row3Ids.push(spec.key);
        });

        const rows: any[] = [row1Names, row2Paths, row3Ids];
        
        groupProducts.forEach(p => {
            rows.push(buildRowV3(p, false, row3Ids, brandMap, specMap));
            if (p.variants && p.variants.length > 0) {
                p.variants.forEach((v: any) => {
                    rows.push(buildRowV3(v, true, row3Ids, brandMap, specMap, p));
                });
            }
        });

        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        const wscols = row1Names.map(h => ({ wch: Math.max(h.length * 2, 12) }));
        worksheet['!cols'] = wscols;

        // 隱藏第二列與第三列
        if (!worksheet['!rows']) worksheet['!rows'] = [];
        worksheet['!rows'][1] = { hidden: true };
        worksheet['!rows'][2] = { hidden: true };

        // 凍結前三列
        worksheet['!view'] = [{ state: 'frozen', ySplit: 3 }];

        const sanitizedCatName = catName.replace(/[:\\/?*\[\]]/g, '_').substring(0, 31);
        XLSX.utils.book_append_sheet(workbook, worksheet, sanitizedCatName);
    });

    return workbook;
}

/**
 * 構建單一資料列 V3
 */
function buildRowV3(item: any, isVariant: boolean, headerIds: string[], brandMap: Record<string, string>, specMap: Map<string, CategorySpec>, parent?: any) {
    const row: any[] = [];
    
    const baseValues: Record<string, any> = {
        is_variant: isVariant ? '變體' : '主商品',
        sku: isVariant ? (parent?.sku || '') : (item.sku || ''),
        name: isVariant ? (parent?.name || '') : (item.name || ''),
        variant_sku: isVariant ? (item.sku || '') : '',
        variant_name: isVariant ? (item.name || '') : '',
        description: item.description || parent?.description || '',
        brand: (item.brand_id || parent?.brand_id) ? (brandMap[item.brand_id || parent?.brand_id] || '') : '',
        model: item.model || parent?.model || '',
        series: item.series || parent?.series || '',
        wholesale_price: item.wholesale_price || item.base_wholesale_price || 0,
        retail_price: item.retail_price || item.base_retail_price || 0,
        status: item.status || 'active',
        barcode: item.barcode || '',
        option_1: item.option_1 || '',
        option_2: item.option_2 || '',
        option_3: item.option_3 || '',
    };

    const rawModels = item.device_models || item.variant_model_links || [];
    const rawGroups = item.device_model_groups || item.variant_model_group_links || [];
    let modelsStr = '';
    
    const modelParts: string[] = [];
    if (Array.isArray(rawModels)) {
        rawModels.forEach((m: any) => {
            // 處理主商品層級 (device_models) 或 變體層級 (variant_model_links)
            const name = typeof m === 'string' ? m : (m.name || m.device_models?.name);
            if (name) modelParts.push(`model:${name}`);
        });
    }
    if (Array.isArray(rawGroups)) {
        rawGroups.forEach((g: any) => {
            // 處理主商品層級 (device_model_groups) 或 變體層級 (variant_model_group_links)
            const name = typeof g === 'string' ? g : (g.name || g.device_model_groups?.name);
            if (name) modelParts.push(`group:${name}`);
        });
    }
    modelsStr = modelParts.join(', ');
    baseValues.device_models = modelsStr;

    const settings = item.table_settings || [];
    
    headerIds.forEach(key => {
        if (baseValues[key] !== undefined) {
            row.push(baseValues[key]);
        } else {
            // key 格式為 parentId:specId
            const [parentId, specId] = key.split(':');
            const spec = specMap.get(specId); // 獲取規格定義
            let val = undefined;
            
            if (Array.isArray(settings)) {
                // 優先精確匹配 (parentId + specId)
                let found = settings.find((s: any) => s.id === specId && (s.parentId === parentId || (!s.parentId && parentId === 'root')));
                
                // [彈性回退] 如果沒找到精確的，找同一個 specId 的任何資料 (處理包裹/層級異動)
                if (!found) {
                    found = settings.find((s: any) => s.id === specId);
                }
                
                val = found?.value;
            } else if (parentId === 'root') {
                val = settings[specId];
            }
            
            // 傳入 spec 定義，確保 Table 等複雜類型能正確格式化
            row.push(formatSpecValue(val, spec, specMap) || '');
        }
    });

    return row;
}

/**
 * 解析 Excel 檔案 (支援 3-row header)
 */
export function parseProductExcel(buffer: ArrayBuffer) {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const allData: any[] = [];

    workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        if (rows.length < 3) return; 

        const headerKeys = rows[2].map(h => String(h).trim());
        const dataRows = rows.slice(3); // 資料從第四列開始

        dataRows.forEach(row => {
            if (!row || row.length === 0) return;
            
            const item: any = {
                _categoryName: sheetName,
                _specs: {} // Key 將會是 parentId:specId
            };

            headerKeys.forEach((key, index) => {
                const value = row[index];
                if (value === undefined || value === null) return;

                const isBase = Object.values(BASE_COLUMNS).includes(key as any);
                if (isBase) {
                    if (key === 'is_variant') {
                        item.is_variant = (value === '變體' || value === '是' || value === true);
                    } else {
                        item[key] = value;
                    }
                } else if (key && key.includes(':')) {
                    // 這是一個 parentId:specId 組合
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
