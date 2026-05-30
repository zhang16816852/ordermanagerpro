import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { SpecDialog } from './SpecDialog';
import { useSpecData } from '../hooks/useSpecData';
import { SpecDefinition } from '../types';
import { useSpecStore } from '@/store/useSpecStore';
import { Toolbar } from './spec-library/SpecLibraryToolbar';
import { GridView } from './spec-library/SpecLibraryGridView';
import { TreeView, SpecTreeNode } from './spec-library/SpecLibraryTreeView';

// 規格屬性庫面板 (v4.12 支援自訂排序與智慧連動移除)
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
        sort_order: 0,
        logic_config: { triggers: [] }
    });

    /**
     * v4.10 計算規格間的關係圖 (用於 Grid 模式顯示)
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
                    const targets = t.targets || [];
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
     * 搜尋過濾 (用於 Grid 模式)
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
     * v4.12 建構樹狀結構 (支援搜尋篩選與排序)
     */
    const treeData = useMemo(() => {
        if (viewMode !== 'tree') return [];

        // 1. 找出所有作為「連動目標」的規格 ID (用於決定誰是根節點)
        const targetIds = new Set<string>();
        specDefinitions.forEach(s => {
            const triggers = s.logic_config?.triggers || [];
            triggers.forEach((t: any) => {
                (t.targets || []).forEach((tar: any) => targetIds.add(tar.id));
            });
        });

        const query = searchQuery.toLowerCase().trim();

        const buildTree = (spec: SpecDefinition, onValue?: string, parentId?: string, path: string = ''): SpecTreeNode => {
            // 將觸發條件 (onValue) 納入路徑，確保同一個規格被多次引用時 ID 唯一
            const segment = onValue ? `[${onValue}]${spec.id}` : spec.id;
            const currentPath = path ? `${path}>${segment}` : segment;

            const node: SpecTreeNode = {
                id: currentPath, // 用於 DND 的唯一 Key (包含路徑與條件)
                specId: spec.id, // 用於資料庫更新的 UUID
                spec: spec,
                onValue,
                parentId,
                children: []
            };

            const triggers = spec.logic_config?.triggers || [];
            triggers.forEach((t: any) => {
                const prefix = t.operator === 'ne' ? '不等於 ' : '';
                (t.targets || []).forEach((tar: any) => {
                    const childSpec = specDefinitions.find(s => s.id === tar.id);
                    if (childSpec) {
                        node.children.push(buildTree(childSpec, prefix + t.on_value, spec.id, currentPath));
                    }
                });
            });

            // 子節點排序
            node.children.sort((a: any, b: any) => {
                if (a.spec.sort_order !== b.spec.sort_order) {
                    return (a.spec.sort_order || 0) - (b.spec.sort_order || 0);
                }
                return a.spec.name.localeCompare(b.spec.name);
            });

            return node;
        };

        const filterTree = (node: any): any | null => {
            const isMatch = node.spec.name.toLowerCase().includes(query) ||
                node.spec.type.toLowerCase().includes(query) ||
                node.spec.options?.some((o: string) => o.toLowerCase().includes(query));

            const filteredChildren = node.children
                .map((child: any) => filterTree(child))
                .filter(Boolean);

            if (isMatch || filteredChildren.length > 0) {
                return { ...node, children: filteredChildren };
            }
            return null;
        };

        let roots = specDefinitions
            .filter(s => !targetIds.has(s.id))
            .map(root => buildTree(root));

        // 根節點排序
        roots.sort((a: any, b: any) => {
            if (a.spec.sort_order !== b.spec.sort_order) {
                return (a.spec.sort_order || 0) - (b.spec.sort_order || 0);
            }
            return a.spec.name.localeCompare(b.spec.name);
        });

        if (query) {
            return roots.map(root => filterTree(root)).filter(Boolean);
        }

        return roots;
    }, [specDefinitions, viewMode, searchQuery]);
    console.log("樹狀", treeData)
    const openSpecDialog = (spec: SpecDefinition | null = null) => {
        if (spec) {
            setEditingSpec(spec);
            const migratedTriggers = (spec.logic_config?.triggers || []).map(t => ({
                ...t,
                targets: t.targets || []
            }));

            setSpecForm({
                ...spec,
                options: spec.options || [],
                logic_config: { ...spec.logic_config, triggers: migratedTriggers }
            });
        } else {
            setEditingSpec(null);
            setSpecForm({ name: '', type: 'select', options: [''], sort_order: 0, logic_config: { triggers: [] } });
        }
        setIsSpecDialogOpen(true);
    };

    const handleSubmit = () => {
        console.log("handleSubmit", specForm)
        const cleaned = { ...specForm, options: (specForm.options || []).filter(o => o.trim() !== '') };
        specMutation.mutate({ spec: cleaned, editingSpecId: editingSpec?.id }, {
            onSuccess: () => setIsSpecDialogOpen(false),
        });
    };

    const handleDelete = async (spec: SpecDefinition) => {
        if (confirm(`確定要【全域刪除】規格「${spec.name}」嗎？這將導致所有產品與分類失去該欄位資料。`)) {
            const { error } = await supabase.from('specification_definitions').delete().eq('id', spec.id);
            if (error) toast.error('刪除失敗');
            else queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
        }
    };

    const handleRemoveLink = async (spec: SpecDefinition, parentId?: string) => {
        if (!parentId) {
            return handleDelete(spec);
        }

        const parent = specDefinitions.find(s => s.id === parentId);
        if (!parent) return;

        if (!confirm(`確定要取消從「${parent.name}」到「${spec.name}」的連動關係嗎？\n(規格定義將保留，僅從此樹狀路徑移除)`)) return;

        const { error } = await supabase
            .from('specification_triggers')
            .delete()
            .eq('source_spec_id', parent.id)
            .eq('target_spec_id', spec.id);

        if (error) {
            toast.error('移除連動失敗');
        } else {
            toast.success('已移除連動關係');
            queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
        }
    };

    const handleReorder = async (updates: { id: string; sort_order: number }[]) => {
        // --- 1. 樂觀更新 (Optimistic Update) ---
        // 立即更新本地 Store 狀態，讓 UI 無感切換
        const currentDefs = [...specDefinitions];
        updates.forEach(u => {
            const spec = currentDefs.find(s => s.id === u.id);
            if (spec) spec.sort_order = u.sort_order;
        });
        // 根據新的 sort_order 進行排序
        currentDefs.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        useSpecStore.getState().setDefinitions(currentDefs);

        // --- 2. 背景更新資料庫 ---
        try {
            const promises = updates.map(u =>
                supabase.from('specification_definitions')
                    .update({ sort_order: u.sort_order })
                    .eq('id', u.id)
            );

            // 不使用 await 阻塞 UI 渲染，讓它在背景執行
            Promise.all(promises).then(async () => {
                // 觸發版號更新 (用於其他分頁同步)
                const { error: rpcError } = await supabase.rpc('bump_data_version', { p_table_name: 'specs', p_source_table: 'specification_definitions' });
                if (rpcError) {
                    await supabase.from('data_versions')
                        .update({ version: Date.now(), updated_at: new Date().toISOString() })
                        .eq('table_name', 'specs');
                }
                // 靜默更新快取，不觸發重新渲染
                queryClient.setQueryData(['spec_definitions'], currentDefs);
            });

            toast.success('排序已儲存', { duration: 1000 });
        } catch (error) {
            console.error('排序更新失敗:', error);
            toast.error('排序同步失敗，請重新整理');
            // 如果失敗，可以考慮在這裡重新拉取資料以恢復狀態
            useSpecStore.getState().fetchSpecs(true);
        }
    };

    return (
        <TooltipProvider>
            <div className="space-y-6 pb-20">
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
                                onDelete={handleRemoveLink}
                                onReorder={handleReorder}
                            />
                        )}
                    </>
                )}

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
