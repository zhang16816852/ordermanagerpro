import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { SpecDefinition } from '../types';

// 規格屬性庫資料層：包含 Query、Mutation、以及 CSV 匯出/匯入（以名稱為主）

export function useSpecData() {
    const queryClient = useQueryClient();

    // --- Query ---

    const { data: specDefinitions = [], isLoading: isLoadingSpecs } = useQuery({
        queryKey: ['spec_definitions'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('specification_definitions' as any) as any)
                .select('*')
                .order('name');
            if (error) return [];
            return data as SpecDefinition[];
        },
    });

    // --- Mutation ---

    const specMutation = useMutation({
        mutationFn: async (data: { spec: Partial<SpecDefinition>; editingSpecId?: string }) => {
            const { spec, editingSpecId } = data;
            if (editingSpecId) {
                // 更新既有規格
                const { error } = await (supabase.from('specification_definitions' as any) as any)
                    .update(spec)
                    .eq('id', editingSpecId);
                if (error) throw error;
            } else {
                // 新增規格
                const { error } = await (supabase.from('specification_definitions' as any) as any).insert([spec]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
            toast.success('規格屬性已儲存');
        },
    });

    // --- 匯出 CSV（以名稱為主）---

    const handleSpecExport = () => {
        const exportData = specDefinitions.map(s => ({
            name: s.name,
            type: s.type,
            options: s.options.join(','),
            default_value: s.default_value || '',
            // 備查欄位（ID）
            id: s.id,
        }));

        const csv = Papa.unparse(exportData);
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `specs_export_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        toast.success('規格屬性庫已匯出');
    };

    // --- 匯入 CSV（以名稱解析，向下相容舊版 ID）---

    const handleSpecImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                try {
                    // 1. 取得現有規格清單供名稱比對
                    const { data: existingSpecs, error: fetchError } = await supabase
                        .from('specification_definitions')
                        .select('id, name');
                    if (fetchError) throw fetchError;

                    // 以 name 為 key，先過濾 CSV 內部重複（後面的同名覆蓋前面的）
                    const finalMap = new Map<string, any>();

                    rows.forEach(row => {
                        const name = row.name?.trim();
                        if (!name) return;

                        const cleanedId = row.id?.toString().trim();
                        let targetId = (cleanedId && cleanedId !== 'null' && cleanedId !== '') ? cleanedId : null;

                        // 若無 ID，以名稱查找現有資料
                        if (!targetId && existingSpecs) {
                            const match = existingSpecs.find(s => s.name === name);
                            if (match) targetId = match.id;
                        }

                        const specData: any = {
                            name: name,
                            type: row.type || 'text',
                            options: row.options
                                ? row.options.split(',').map((s: any) => s.trim()).filter(Boolean)
                                : [],
                            default_value: row.default_value || null
                        };

                        if (targetId) specData.id = targetId;

                        finalMap.set(name, specData);
                    });

                    const toUpsert = Array.from(finalMap.values()).filter((s: any) => !!s.id);
                    const toInsert = Array.from(finalMap.values()).filter((s: any) => !s.id);
                    const totalCount = toUpsert.length + toInsert.length;

                    if (totalCount === 0) {
                        toast.error('沒有有效的資料可供匯入');
                        return;
                    }

                    // 2a. 更新/覆寫：有 ID 的規格（既有資料或從 CSV id 欄取得）
                    if (toUpsert.length > 0) {
                        const { error: upsertError } = await supabase
                            .from('specification_definitions')
                            .upsert(toUpsert, { onConflict: 'id' });
                        if (upsertError) throw upsertError;
                    }

                    // 2b. 新增：沒有 ID 的全新規格，讓資料庫自動產生 UUID
                    if (toInsert.length > 0) {
                        const { error: insertError } = await supabase
                            .from('specification_definitions')
                            .insert(toInsert);
                        if (insertError) throw insertError;
                    }

                    queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
                    toast.success(`規格同步成功，共處理 ${totalCount} 筆（更新 ${toUpsert.length} 筆、新增 ${toInsert.length} 筆）`);

                } catch (err: any) {
                    console.error(err);
                    toast.error(`匯入失敗: ${err.message}`);
                }
            }
        });
        e.target.value = '';
    };

    return {
        specDefinitions,
        isLoadingSpecs,
        specMutation,
        handleSpecExport,
        handleSpecImport,
    };
}
