import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { SpecDefinition } from '../types';
import { useSpecStore } from '@/store/useSpecStore';

/**
 * v4.8 規格屬性庫資料層：實作 JSON 100% 保真資料交換
 * [v6] 已改為使用 useSpecStore 以支援版本校驗與連動規則合併
 */

export function useSpecData() {
    const queryClient = useQueryClient();
    const { specDefinitions, isLoading: isLoadingSpecs, fetchSpecs } = useSpecStore();

    // 進入時確保資料已載入
    useEffect(() => {
        fetchSpecs();
    }, [fetchSpecs]);

    // --- Mutation ---
    const specMutation = useMutation({
        mutationFn: async (data: { spec: Partial<SpecDefinition>; editingSpecId?: string }) => {
            const { spec, editingSpecId } = data;
            
            // [樂觀更新] 立即更新本地 Store 資料，讓 UI 感覺是瞬發的
            const currentDefs = useSpecStore.getState().specDefinitions;
            const updatedDefs = editingSpecId 
                ? currentDefs.map(d => d.id === editingSpecId ? { ...d, ...spec } : d)
                : [...currentDefs, { ...spec, id: 'temp-' + Date.now() }];
            
            useSpecStore.getState().setDefinitions(updatedDefs as any);

            let targetId = editingSpecId;

            if (editingSpecId) {
                const { error } = await supabase.from('specification_definitions')
                    .update({
                        ...spec,
                        quantity_source_id: (spec as any).quantity_source_id || null
                    } as any)
                    .eq('id', editingSpecId);
                if (error) throw error;
            } else {
                const finalSpec = {
                    ...spec,
                    default_value: spec.default_value ?? null,
                    configuration: spec.configuration ?? null,
                    logic_config: spec.logic_config ?? { triggers: [] },
                    options: spec.options ?? [],
                    sort_order: spec.sort_order ?? 0,
                    quantity_source_id: (spec as any).quantity_source_id || null
                };
                const { data: newSpec, error } = await supabase.from('specification_definitions')
                    .insert([finalSpec as any])
                    .select('id')
                    .single();
                if (error) throw error;
                targetId = newSpec.id;
            }

            // [v6] 同步規格連動規則 (Triggers)
            if (targetId && spec.logic_config?.triggers && spec.logic_config.triggers.length > 0) {
                // 先刪除舊規則
                await supabase.from('specification_triggers').delete().eq('source_spec_id', targetId);

                // 將 logic_config.triggers 陣列轉換成資料庫列格式
                const triggerRows = spec.logic_config.triggers.flatMap((t: any) => {
                    return (t.targets || []).map((tar: any) => ({
                        source_spec_id: targetId,
                        target_spec_id: tar.id,
                        condition_dsl: {
                            operator: t.operator || 'eq',
                            on_value: t.on_value,
                            is_quantity_detail: !!tar.is_quantity_detail
                        },
                        priority: t.priority || 0
                    }));
                });

                if (triggerRows.length > 0) {
                    const { error: triggerError } = await supabase.from('specification_triggers').insert(triggerRows as any);
                    if (triggerError) {
                        console.error('觸發規則同步失敗:', triggerError);
                        toast.error('連動規則同步失敗');
                    }
                }
            }
        },
        onSuccess: () => {
            // [關鍵修正] 強制刷新 Store，確保 UI 同步更新
            useSpecStore.getState().fetchSpecs(true);
            toast.success('規格定義已同步至雲端');
        },
    });

    // --- JSON 匯出 (100% 保真) ---
    const handleSpecExportJSON = () => {
        const dataStr = JSON.stringify(specDefinitions, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `specs_full_backup_${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        toast.success('規格庫已匯出 (JSON 格式)');
    };

    // --- JSON 匯入 ---
    const handleSpecImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                const items = Array.isArray(json) ? json : [json];

                // 批次 Upsert，以 ID 或名稱為基準
                const { error } = await supabase
                    .from('specification_definitions')
                    .upsert(items, { onConflict: 'id' });

                if (error) throw error;

                queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
                toast.success(`JSON 匯入成功，共處理 ${items.length} 筆規格`);
            } catch (err: any) {
                toast.error('JSON 匯入失敗：' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // --- 匯出 CSV (基本屬性相容) ---
    const handleSpecExport = () => {
        const exportData = specDefinitions.map(s => ({
            name: s.name,
            type: s.type,
            options: s.options.join(','),
            default_value: s.defaultValue || '',
            id: s.id,
            sort_order: s.sort_order || 0,
            // v4.8 額外包含 logic_config 字串
            logic_config: JSON.stringify(s.logic_config || {})
        }));

        const csv = Papa.unparse(exportData);
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `specs_simple_list_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        toast.success('規格屬性庫已匯出 (CSV)');
    };

    // --- 匯入 CSV ---
    const handleSpecImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                try {
                    const { data: existingSpecs } = await supabase
                        .from('specification_definitions')
                        .select('id, name');

                    const finalItems = rows.map(row => {
                        const name = row.name?.trim();
                        if (!name) return null;

                        let targetId = (row.id && row.id !== 'null' && row.id !== '') ? row.id : null;
                        if (!targetId && existingSpecs) {
                            targetId = existingSpecs.find(s => s.name === name)?.id || null;
                        }

                        // v4.8 嘗試解析 logic_config
                        let logic_config = { triggers: [] };
                        try {
                            if (row.logic_config) logic_config = JSON.parse(row.logic_config);
                        } catch (e) { }

                        return {
                            id: targetId || undefined,
                            name: name,
                            type: row.type || 'text',
                            options: row.options ? row.options.split(',').map((s: any) => s.trim()) : [],
                            default_value: row.default_value || null,
                            sort_order: parseInt(row.sort_order) || 0,
                            logic_config
                        };
                    }).filter(Boolean);

                    const { error } = await supabase
                        .from('specification_definitions')
                        .upsert(finalItems, { onConflict: 'id' });

                    if (error) throw error;
                    queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
                    toast.success('CSV 匯入成功');

                } catch (err: any) {
                    toast.error(`CSV 匯入失敗: ${err.message}`);
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
        handleSpecExportJSON,
        handleSpecImportJSON
    };
}
