import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { SpecDefinition } from '../types';

/**
 * v4.8 規格屬性庫資料層：實作 JSON 100% 保真資料交換
 */

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
                const { error } = await (supabase.from('specification_definitions' as any) as any)
                    .update(spec)
                    .eq('id', editingSpecId);
                if (error) throw error;
            } else {
                const { error } = await (supabase.from('specification_definitions' as any) as any).insert([spec]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
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
            default_value: s.default_value || '',
            id: s.id,
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
                        } catch (e) {}

                        return {
                            id: targetId || undefined,
                            name: name,
                            type: row.type || 'text',
                            options: row.options ? row.options.split(',').map((s: any) => s.trim()) : [],
                            default_value: row.default_value || null,
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
