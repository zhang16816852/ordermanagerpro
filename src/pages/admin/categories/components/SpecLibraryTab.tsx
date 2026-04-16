import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

import { SpecDialog } from './SpecDialog';
import { useSpecData } from '../hooks/useSpecData';
import { useSpecRelations } from '../hooks/useSpecRelations';
import { SpecDefinition } from '../types';

// 導入模組化組件
import { SpecLibraryToolbar } from './spec-library/SpecLibraryToolbar';
import { SpecLibraryGridView } from './spec-library/SpecLibraryGridView';
import { SpecLibraryTreeView } from './spec-library/SpecLibraryTreeView';

/**
 * 規格屬性庫入口 (v4.10 模組化與樹狀架構)
 */
export function SpecLibraryTab() {
    const queryClient = useQueryClient();
    const {
        specDefinitions,
        isLoadingSpecs,
        specMutation,
        handleSpecExport,
        handleSpecImport,
        handleSpecExportJSON,
        handleSpecImportJSON
    } = useSpecData();

    // 1. 視圖狀態
    const [viewMode, setViewMode] = useState<'grid' | 'tree'>('grid');

    // 2. 關係計算邏輯 (已抽離至 Hook)
    const { relations, treeData } = useSpecRelations(specDefinitions);

    // 3. 編輯 Dialog 狀態
    const [isSpecDialogOpen, setIsSpecDialogOpen] = useState(false);
    const [editingSpec, setEditingSpec] = useState<SpecDefinition | null>(null);
    const [specForm, setSpecForm] = useState<Partial<SpecDefinition>>({
        name: '',
        type: 'select',
        options: [''],
        logic_config: { triggers: [] }
    });

    const openSpecDialog = (spec: SpecDefinition | null = null) => {
        if (spec) {
            setEditingSpec(spec);
            // 本地遷移確保 targets 結構正確
            const migratedTriggers = (spec.logic_config?.triggers || []).map(t => ({
                ...t,
                targets: t.targets || (t as any).target_ids?.map((id: string) => ({ id, is_quantity_detail: false })) || []
            }));

            setSpecForm({
                ...spec,
                options: spec.options || [],
                logic_config: { ...spec.logic_config, triggers: migratedTriggers }
            });
        } else {
            setEditingSpec(null);
            setSpecForm({ name: '', type: 'select', options: [''], logic_config: { triggers: [] } });
        }
        setIsSpecDialogOpen(true);
    };

    const handleSubmit = () => {
        const cleaned = { ...specForm, options: (specForm.options || []).filter(o => o.trim() !== '') };
        specMutation.mutate({ spec: cleaned, editingSpecId: editingSpec?.id }, {
            onSuccess: () => setIsSpecDialogOpen(false),
        });
    };

    const handleDelete = async (spec: SpecDefinition) => {
        if (confirm(`確定要刪除規格「${spec.name}」嗎？這將導致所有關廠分類失去該欄位。`)) {
            const { error } = await (supabase.from('specification_definitions' as any) as any).delete().eq('id', spec.id);
            if (error) toast.error('刪除失敗');
            else queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
        }
    };
    console.log(specDefinitions)
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* 1. 工具列模組 */}
            <SpecLibraryToolbar
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onAdd={() => openSpecDialog()}
                onExportJSON={handleSpecExportJSON}
                onImportJSON={handleSpecImportJSON}
                onExportCSV={handleSpecExport}
                onImportCSV={handleSpecImport}
            />

            {/* 2. 主視圖區域 */}
            {isLoadingSpecs ? (
                <div className="py-20 text-center animate-pulse text-muted-foreground">正在載入規格百科全書...</div>
            ) : (
                <>
                    {viewMode === 'grid' ? (
                        <SpecLibraryGridView
                            specs={specDefinitions}
                            relations={relations}
                            onEdit={openSpecDialog}
                            onDelete={handleDelete}
                        />
                    ) : (
                        <SpecLibraryTreeView
                            treeData={treeData}
                            onEdit={openSpecDialog}
                            onDelete={handleDelete}
                        />
                    )}
                </>
            )}

            {/* 3. 編輯彈窗模組 */}
            <SpecDialog
                open={isSpecDialogOpen}
                onOpenChange={setIsSpecDialogOpen}
                editingSpec={editingSpec}
                specForm={specForm}
                setSpecForm={setSpecForm}
                onSubmit={handleSubmit}
                isPending={specMutation.isPending}
                allSpecs={specDefinitions}
            />
        </div>
    );
}
