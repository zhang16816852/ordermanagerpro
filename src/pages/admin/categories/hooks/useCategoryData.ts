import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { Category, CategoryHierarchy } from '../types';

// 分類資料層：包含 Query、Mutation、以及 CSV 匯出/匯入（以名稱為主）

export function useCategoryData() {
    const queryClient = useQueryClient();

    // --- Queries ---

    const { data: categories = [], isLoading: isLoadingCats } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            try {
                const { data, error } = await supabase
                    .from('categories')
                    .select('*')
                    .order('sort_order', { ascending: true });
                if (error) throw error;
                return data as Category[];
            } catch (err) {
                console.error('Error fetching categories:', err);
                return [];
            }
        },
    });

    const { data: categorySpecLinks = [] } = useQuery({
        queryKey: ['category_spec_links'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('category_spec_links' as any) as any).select('*');
            if (error) return [];
            return data;
        },
    });

    const { data: categoryHierarchy = [] } = useQuery({
        queryKey: ['category_hierarchy'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('category_hierarchy' as any) as any).select('*');
            if (error) return [];
            return data as CategoryHierarchy[];
        },
    });

    // --- Mutation ---

    const categoryMutation = useMutation({
        mutationFn: async (data: {
            name: string;
            parentIds: string[];
            specIds: string[];
            editingCategoryId?: string;
        }) => {
            const { specIds, parentIds, editingCategoryId, ...catData } = data;
            let catId = editingCategoryId;

            if (editingCategoryId) {
                // 更新既有分類
                const { error } = await supabase.from('categories').update(catData).eq('id', catId!);
                if (error) throw error;
            } else {
                // 新增分類
                const { data: newCat, error } = await supabase.from('categories').insert([catData]).select().single();
                if (error) throw error;
                catId = newCat.id;
            }

            // 更新階層關係
            await (supabase.from('category_hierarchy' as any) as any).delete().eq('child_id', catId);
            if (parentIds.length > 0) {
                const hierarchy = parentIds.map((pid: string) => ({
                    parent_id: pid,
                    child_id: catId
                }));
                await (supabase.from('category_hierarchy' as any) as any).insert(hierarchy);
            }

            // 更新規格關聯
            await (supabase.from('category_spec_links' as any) as any).delete().eq('category_id', catId);
            if (specIds.length > 0) {
                const links = specIds.map((sid: string, idx: number) => ({
                    category_id: catId,
                    spec_id: sid,
                    sort_order: idx
                }));
                await (supabase.from('category_spec_links' as any) as any).insert(links);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            queryClient.invalidateQueries({ queryKey: ['category_spec_links'] });
            queryClient.invalidateQueries({ queryKey: ['category_hierarchy'] });
            toast.success('分類已儲存');
        },
    });

    // --- 匯出 CSV（以名稱為主，輔以 ID 備查）---

    const handleCategoryExport = (specDefinitions: any[]) => {
        // 建立 spec id -> name 的對照表
        const specIdToName = new Map(specDefinitions.map((s: any) => [s.id, s.name]));
        // 建立 category id -> name 的對照表
        const catIdToName = new Map(categories.map(c => [c.id, c.name]));

        const exportData = categories.map(c => {
            // 父分類以「名稱」表示
            const linkedParentNames = categoryHierarchy
                .filter((h: CategoryHierarchy) => h.child_id === c.id)
                .map((h: CategoryHierarchy) => catIdToName.get(h.parent_id) || h.parent_id);

            // 關聯規格以「名稱」表示
            const linkedSpecNames = categorySpecLinks
                .filter((link: any) => link.category_id === c.id)
                .sort((a: any, b: any) => a.sort_order - b.sort_order)
                .map((link: any) => specIdToName.get(link.spec_id) || link.spec_id);

            return {
                name: c.name,
                parent_names: linkedParentNames.join(','),
                sort_order: c.sort_order,
                linked_spec_names: linkedSpecNames.join(','),
                // 備查欄位（ID）
                id: c.id,
            };
        });

        const csv = Papa.unparse(exportData);
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `categories_export_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        toast.success('分類架構已匯出');
    };

    // --- 匯入 CSV（優先以名稱解析，向下相容舊版 ID 欄位）---

    const handleCategoryImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                try {
                    // 1. 取得現有分類與規格供名稱解析
                    const { data: existingCats, error: fetchError } = await supabase
                        .from('categories')
                        .select('id, name');
                    if (fetchError) throw fetchError;

                    const { data: specDefs, error: specError } = await supabase
                        .from('specification_definitions')
                        .select('id, name');
                    if (specError) throw specError;

                    // 名稱 -> ID 對照表
                    const nameToExistingId = new Map(existingCats.map(c => [c.name.trim(), c.id]));
                    const idToExistingId = new Map(existingCats.map(c => [c.id, c.id]));
                    const specNameToId = new Map(specDefs.map(s => [s.name.trim(), s.id]));
                    const specIdToId = new Map(specDefs.map(s => [s.id, s.id]));

                    // session 暫存：CSV 內部名稱/ID -> 最終 UUID
                    const sessionMap = new Map<string, string>();

                    // 2. 決定每筆資料的最終 ID
                    const categoriesToUpsert = rows.map(row => {
                        const name = row.name?.trim();
                        const rawId = row.id?.toString().trim();

                        let targetId: string | null = null;

                        // 優先：CSV 提供的 ID 已存在於資料庫
                        if (rawId && idToExistingId.has(rawId)) {
                            targetId = rawId;
                        }
                        // 其次：名稱已存在於資料庫
                        else if (name && nameToExistingId.has(name)) {
                            targetId = nameToExistingId.get(name)!;
                        }
                        // 再次：CSV 提供的 ID 是合法 UUID（新資料）
                        else if (rawId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
                            targetId = rawId;
                        }
                        // 最後：產生新 UUID
                        else {
                            targetId = crypto.randomUUID();
                        }

                        if (name) sessionMap.set(name, targetId!);
                        if (rawId) sessionMap.set(rawId, targetId!);

                        return {
                            id: targetId,
                            name: name,
                            sort_order: parseInt(row.sort_order) || 0
                        };
                    });

                    // 執行 Upsert
                    const { error: upsertError } = await supabase.from('categories').upsert(categoriesToUpsert);
                    if (upsertError) throw upsertError;

                    // 3. 解析父分類與規格關聯（支援名稱或 ID）
                    const newHierarchy: any[] = [];
                    const newSpecLinks: any[] = [];
                    const importedIds = categoriesToUpsert.map(c => c.id);

                    rows.forEach(row => {
                        const currentId = sessionMap.get(row.name?.trim()) || sessionMap.get(row.id?.toString().trim());
                        if (!currentId) return;

                        // 父分類解析：支援 parent_names（新格式）或 parent_ids（舊格式）
                        const parentsRaw = row.parent_names || row.parent_ids || row.parent_id;
                        if (parentsRaw) {
                            const tokens = parentsRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
                            tokens.forEach((token: string) => {
                                // 先用 sessionMap 查，再用名稱查，最後用 ID 查
                                const resolvedPid =
                                    sessionMap.get(token) ||
                                    nameToExistingId.get(token) ||
                                    idToExistingId.get(token);

                                if (resolvedPid && resolvedPid !== currentId) {
                                    newHierarchy.push({ parent_id: resolvedPid, child_id: currentId });
                                }
                            });
                        }

                        // 規格關聯解析：支援 linked_spec_names（新格式）或 linked_spec_ids（舊格式）
                        const specsRaw = row.linked_spec_names || row.linked_spec_ids;
                        if (specsRaw) {
                            const tokens = specsRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
                            tokens.forEach((token: string, idx: number) => {
                                const resolvedSid = specNameToId.get(token) || specIdToId.get(token);
                                if (resolvedSid) {
                                    newSpecLinks.push({
                                        category_id: currentId,
                                        spec_id: resolvedSid,
                                        sort_order: idx
                                    });
                                }
                            });
                        }
                    });

                    // 4. 批次更新關聯資料
                    if (importedIds.length > 0) {
                        await (supabase.from('category_hierarchy' as any) as any).delete().in('child_id', importedIds);
                        if (newHierarchy.length > 0) {
                            const { error: hError } = await (supabase.from('category_hierarchy' as any) as any).insert(newHierarchy);
                            if (hError) throw hError;
                        }

                        await (supabase.from('category_spec_links' as any) as any).delete().in('category_id', importedIds);
                        if (newSpecLinks.length > 0) {
                            const { error: sError } = await (supabase.from('category_spec_links' as any) as any).insert(newSpecLinks);
                            if (sError) throw sError;
                        }
                    }

                    queryClient.invalidateQueries({ queryKey: ['categories'] });
                    queryClient.invalidateQueries({ queryKey: ['category_hierarchy'] });
                    queryClient.invalidateQueries({ queryKey: ['category_spec_links'] });
                    toast.success(`成功匯入 ${categoriesToUpsert.length} 筆分類`);
                } catch (err: any) {
                    console.error('Import error:', err);
                    toast.error(`匯入失敗: ${err.message}`);
                }
            }
        });
        e.target.value = '';
    };

    return {
        categories,
        isLoadingCats,
        categorySpecLinks,
        categoryHierarchy,
        categoryMutation,
        handleCategoryExport,
        handleCategoryImport,
    };
}
