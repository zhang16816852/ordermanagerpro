import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, FolderTree, Download, Upload } from 'lucide-react';
import { CategoryTreeNode } from './CategoryTreeNode';
import CategoryDialog from './CategoryDialog';
import { useCategoryData } from '../hooks/useCategoryData';
import { useSpecData } from '../hooks/useSpecData';
import { useSpecEngine } from '../hooks/useSpecEngine';
import { Category, CategoryHierarchy } from '../types';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';

// 工具：將平坦分類清單建構成樹狀結構
function buildTree(cats: Category[], h: CategoryHierarchy[], links: any[]): any[] {
    const seen = new Set<string>();
    const uniqueH = h.filter(link => {
        const key = `${link.parent_id}-${link.child_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const childIds = new Set(uniqueH.map(item => item.child_id));
    // 取得根分類並排序
    const roots = cats
        .filter(c => !childIds.has(c.id))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const getChildren = (nodeId: string): any[] => {
        return uniqueH
            .filter(link => link.parent_id === nodeId)
            .map(link => {
                const child = cats.find(c => c.id === link.child_id);
                if (!child) return null;
                // 找出該分類關聯的規格
                const specs = links.filter(l => l.category_id === child.id);
                return {
                    ...child,
                    spec_schema: specs,
                    children: getChildren(child.id)
                };
            })
            .filter((node): node is any => node !== null)
            // 子分類也要排序
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    };

    return roots.map(root => {
        const specs = links.filter(l => l.category_id === root.id);
        return {
            ...root,
            spec_schema: specs,
            children: getChildren(root.id)
        };
    });
}

// 分類管理 Tab（樹狀列表 + 新增/匯出/匯入）
export function CategoryTab() {
    const {
        categories,
        isLoadingCats,
        categorySpecLinks,
        categoryHierarchy,
        categoryMutation,
        reorderMutation,
        handleCategoryExport,
        handleCategoryImport,
    } = useCategoryData();

    const { specDefinitions } = useSpecData();
    // 門面模式：一切規格邏輯交由此 Hook
    const { engine, activeConfiguration } = useSpecEngine(specDefinitions);

    // DnD Sensors
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // 處理拖移結束（僅限同層級）
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        // 找出被拖移的項目與其目標所在的父層清單
        const activeItem = categories.find(c => c.id === active.id);
        const overItem = categories.find(c => c.id === over.id);
        if (!activeItem || !overItem) return;

        // 找到同一層的所有兄弟分類
        // 首先找出 activeItem 的所有父 ID
        const activeParentIds = categoryHierarchy
            .filter(h => h.child_id === active.id)
            .map(h => h.parent_id);
        
        // 找出 overItem 的所有父 ID
        const overParentIds = categoryHierarchy
            .filter(h => h.child_id === over.id)
            .map(h => h.parent_id);

        // 檢查是否為同一層級（父分類集合相同，若是根分類則都為空）
        const isSameLevel = JSON.stringify(activeParentIds.sort()) === JSON.stringify(overParentIds.sort());
        if (!isSameLevel) return;

        // 取得該層級的所有項目
        const siblings = categories.filter(c => {
            const cParentIds = categoryHierarchy
                .filter(h => h.child_id === c.id)
                .map(h => h.parent_id);
            return JSON.stringify(cParentIds.sort()) === JSON.stringify(activeParentIds.sort());
        }).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        const oldIndex = siblings.findIndex(s => s.id === active.id);
        const newIndex = siblings.findIndex(s => s.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
            const newSiblingsOrder = arrayMove(siblings, oldIndex, newIndex);
            // 重新分配 sort_order
            const updates = newSiblingsOrder.map((s, idx) => ({
                id: s.id,
                sort_order: idx,
                name: s.name // 加入 name 以符合類型要求
            }));
            reorderMutation.mutate(updates);
        }
    };

    // Dialog 狀態
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // 表單狀態
    const [name, setName] = useState('');
    const [parentIds, setParentIds] = useState<string[]>([]);

    // 開啟 Dialog（新增或編輯）
    const openDialog = (cat: Category | null = null, defaultParentId: string | null = null) => {
        if (cat) {
            setEditingCategory(cat);
            setName(cat.name);
            const currentParents = categoryHierarchy
                .filter(h => h.child_id === cat.id)
                .map(h => h.parent_id);
            setParentIds(currentParents);

            // 原子化恢復狀態
            const snapshot: any = { selected: {} };
            categorySpecLinks
                .filter((l: any) => l.category_id === cat.id)
                .forEach((l: any) => {
                    snapshot.selected[l.spec_id] = {
                        manual: l.is_manual ?? true,
                        sources: [],
                        sortOrder: l.sort_order || 0
                    };
                });
            engine.restore(snapshot);
        } else {
            setEditingCategory(null);
            setName('');
            setParentIds(defaultParentId ? [defaultParentId] : []);
            engine.restore({ selected: {} });
        }
        setIsDialogOpen(true);
    };

    const closeDialog = () => {
        setIsDialogOpen(false);
        setEditingCategory(null);
    };

    // 提交表單
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await categoryMutation.mutateAsync({
                name,
                parentIds,
                specs: activeConfiguration.map(s => ({
                    id: s.id,
                    sortOrder: s.sortOrder,
                    isManual: s.isManual
                })),
                editingCategoryId: editingCategory?.id
            });
            closeDialog();
        } catch (error) {
            console.error('Submit category error:', error);
        }
    };

    const tree = buildTree(categories, categoryHierarchy, categorySpecLinks);

    return (
        <>
            {/* 工具列 */}
            <div className="flex justify-end">
                <div className="flex gap-2">
                    <Button
                        variant="outline" size="sm"
                        onClick={() => handleCategoryExport(specDefinitions)}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        匯出 CSV
                    </Button>
                    <Label htmlFor="category-import" className="cursor-pointer">
                        <Input
                            id="category-import" type="file" accept=".csv"
                            className="hidden" onChange={handleCategoryImport}
                        />
                        <Button variant="outline" size="sm" asChild>
                            <span>
                                <Upload className="h-4 w-4 mr-2" />
                                匯入 CSV
                            </span>
                        </Button>
                    </Label>
                    <Button size="sm" onClick={() => openDialog()}>
                        <Plus className="h-4 w-4 mr-2" />
                        新增分類
                    </Button>
                </div>
            </div>

            {/* 樹狀列表 */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">全部分類</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoadingCats ? (
                        <div className="py-12 text-center text-muted-foreground">載入中...</div>
                    ) : categories.length === 0 ? (
                        <div className="py-12 text-center border-2 border-dashed rounded-xl space-y-3">
                            <FolderTree className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                            <p className="text-muted-foreground text-sm">尚未建立任何分類</p>
                            <Button variant="outline" size="sm" onClick={() => openDialog()}>立即建立</Button>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={tree.map(node => node.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {tree.map(node => (
                                        <CategoryTreeNode
                                            key={node.id}
                                            node={node}
                                            expandedIds={expandedIds}
                                            setExpandedIds={setExpandedIds}
                                            categorySpecLinks={categorySpecLinks}
                                            openDialog={openDialog}
                                            // 傳入排序所需的 props
                                            onReorder={reorderMutation.mutate}
                                            categoryHierarchy={categoryHierarchy}
                                            allCategories={categories}
                                        />
                                    ))}
                                </SortableContext>
                            </DndContext>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 新增/編輯 Dialog */}
            <CategoryDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                name={name}
                setName={setName}
                parentIds={parentIds}
                setParentIds={setParentIds}
                activeConfiguration={activeConfiguration}
                engine={engine}
                categories={categories}
                specDefinitions={specDefinitions}
                onSubmit={handleSubmit}
            />
        </>
    );
}
