import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { SpecDialog } from './SpecDialog';
import { useSpecData } from '../hooks/useSpecData';
import { SpecDefinition } from '../types';
import { Toolbar } from './spec-library/SpecLibraryToolbar';
import { GridView } from './spec-library/SpecLibraryGridView';
import { TreeView } from './spec-library/SpecLibraryTreeView';
import { SpecTreeNode } from './spec-library/SpecLibraryTreeView'; 

// 規格屬性庫面板 (v4.8 JSON 支援與視覺化管理)
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

    const [isSpecDialogOpen, setIsSpecDialogOpen] = useState(false);
    const [editingSpec, setEditingSpec] = useState<SpecDefinition | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'grid' | 'tree'>('grid');
    const [specForm, setSpecForm] = useState<Partial<SpecDefinition>>({
        name: '',
        type: 'select',
        options: [''],
    });

    /**
     * v4.10 計算規格間的關係圖
     */
    const specRelations = useMemo(() => {
        const relations = new Map<string, { isSource: boolean; isTarget: boolean; parentNames: string[] }>();

        // 初始化
        specDefinitions.forEach(s => relations.set(s.id, { isSource: false, isTarget: false, parentNames: [] }));

        // 解析連動
        specDefinitions.forEach(s => {
            const triggers = s.logic_config?.triggers || [];
            if (triggers.length > 0) {
                const info = relations.get(s.id);
                if (info) info.isSource = true;

                triggers.forEach((t: any) => {
                    const targets = t.targets || t.target_ids?.map((id: string) => ({ id })) || [];
                    targets.forEach((tar: any) => {
                        const targetInfo = relations.get(tar.id);
                        if (targetInfo) {
                            targetInfo.isTarget = true;
                            if (!targetInfo.parentNames.includes(s.name)) {
                                targetInfo.parentNames.push(s.name);
                            }
                        }
                    });
                });
            }
        });

        return relations;
    }, [specDefinitions]);

    /**
     * 搜尋過濾
     */
    const filteredSpecs = useMemo(() => {
        if (!searchQuery.trim()) return specDefinitions;
        const q = searchQuery.toLowerCase();
        return specDefinitions.filter(s => 
            s.name.toLowerCase().includes(q) || 
            s.type.toLowerCase().includes(q) ||
            s.options?.some(o => o.toLowerCase().includes(q))
        );
    }, [specDefinitions, searchQuery]);

    /**
     * 建構樹狀結構
     */
    const treeData = useMemo(() => {
        if (viewMode !== 'tree') return [];

        // 1. 找出所有作為「連動目標」的規格 ID
        const targetIds = new Set<string>();
        specDefinitions.forEach(s => {
            const triggers = s.logic_config?.triggers || (s as any).logicConfig?.triggers;
            (triggers || []).forEach((t: any) => {
                (t.targets || []).forEach((tar: any) => targetIds.add(tar.id));
            });
        });

        // 2. 只有不是別人目標的，才是根節點
        const roots = specDefinitions.filter(s => !targetIds.has(s.id));

        const buildTree = (spec: SpecDefinition, onValue?: string): any => {
            const node: any = {
                id: spec.id,
                spec: spec,
                onValue,
                children: []
            };

            const triggers = spec.logic_config?.triggers || (spec as any).logicConfig?.triggers || [];
            triggers.forEach((t: any) => {
                const prefix = t.operator === 'ne' ? '不等於 ' : '';
                (t.targets || []).forEach((tar: any) => {
                    const childSpec = specDefinitions.find(s => s.id === tar.id);
                    if (childSpec) {
                        node.children.push(buildTree(childSpec, prefix + t.on_value));
                    }
                });
            });

            return node;
        };

        return roots.map(root => buildTree(root));
    }, [specDefinitions, viewMode]);
    console.log("規格定義", specDefinitions)
    const openSpecDialog = (spec: SpecDefinition | null = null) => {
        if (spec) {
            setEditingSpec(spec);
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

    return (
        <TooltipProvider>
            <div className="space-y-6 pb-20">
                {/* 使用組件化 Toolbar */}
                <Toolbar 
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onAdd={() => openSpecDialog()}
                    onExportJSON={handleSpecExportJSON}
                    onImportJSON={handleSpecImportJSON}
                    onExportCSV={handleSpecExport}
                    onImportCSV={handleSpecImport}
                />

                {isLoadingSpecs ? (
                    <div className="py-20 text-center animate-pulse text-muted-foreground">正在載入規格百科全書...</div>
                ) : (
                    <>
                        {viewMode === 'grid' ? (
                            <GridView 
                                specs={filteredSpecs}
                                relations={specRelations as any}
                                onEdit={openSpecDialog}
                                onDelete={handleDelete}
                            />
                        ) : (
                            <TreeView 
                                treeData={treeData}
                                onEdit={openSpecDialog}
                                onDelete={handleDelete}
                            />
                        )}
                    </>
                )}

                {/* 新增/編輯 Dialog */}
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
        </TooltipProvider>
    );
}
