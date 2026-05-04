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

// 工具：將平坦分類清單建構成樹狀結構
function buildTree(cats: Category[], h: CategoryHierarchy[]): any[] {
    const seen = new Set<string>();
    const uniqueH = h.filter(link => {
        const key = `${link.parent_id}-${link.child_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const childIds = new Set(uniqueH.map(item => item.child_id));
    const roots = cats.filter(c => !childIds.has(c.id));

    const getChildren = (nodeId: string): any[] => {
        return uniqueH
            .filter(link => link.parent_id === nodeId)
            .map(link => {
                const child = cats.find(c => c.id === link.child_id);
                if (!child) return null;
                return { ...child, children: getChildren(child.id) };
            })
            .filter(Boolean);
    };

    return roots.map(root => ({ ...root, children: getChildren(root.id) }));
}

// 分類管理 Tab（樹狀列表 + 新增/匯出/匯入）
export function CategoryTab() {
    const {
        categories,
        isLoadingCats,
        categorySpecLinks,
        categoryHierarchy,
        categoryMutation,
        handleCategoryExport,
        handleCategoryImport,
    } = useCategoryData();

    const { specDefinitions } = useSpecData();
    
    // 門面模式：一切規格邏輯交由此 Hook
    const { engine, activeConfiguration } = useSpecEngine(specDefinitions);

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

    const tree = buildTree(categories, categoryHierarchy);

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
                            {tree.map(node => (
                                <CategoryTreeNode
                                    key={node.id}
                                    node={node}
                                    expandedIds={expandedIds}
                                    setExpandedIds={setExpandedIds}
                                    categorySpecLinks={categorySpecLinks}
                                    openDialog={openDialog}
                                />
                            ))}
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
