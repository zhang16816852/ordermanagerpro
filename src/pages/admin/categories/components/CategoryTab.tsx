import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, FolderTree, Download, Upload } from 'lucide-react';
import { CategoryTreeNode } from './CategoryTreeNode';
import { CategoryDialog } from './CategoryDialog';
import { useCategoryData } from '../hooks/useCategoryData';
import { useSpecData } from '../hooks/useSpecData';
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

    // Dialog 狀態
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // 表單狀態
    const [name, setName] = useState('');
    const [parentIds, setParentIds] = useState<string[]>([]);
    const [selectedSpecIds, setSelectedSpecIds] = useState<string[]>([]);

    // 開啟 Dialog（新增或編輯）
    const openDialog = (cat: Category | null = null, defaultParentId: string | null = null) => {
        if (cat) {
            setEditingCategory(cat);
            setName(cat.name);
            const currentParents = categoryHierarchy
                .filter(h => h.child_id === cat.id)
                .map(h => h.parent_id);
            setParentIds(currentParents);
            const currentLinks = categorySpecLinks
                .filter((l: any) => l.category_id === cat.id)
                .sort((a: any, b: any) => a.sort_order - b.sort_order)
                .map((l: any) => l.spec_id);
            setSelectedSpecIds(currentLinks);
        } else {
            setEditingCategory(null);
            setName('');
            setParentIds(defaultParentId ? [defaultParentId] : []);
            setSelectedSpecIds([]);
        }
        setIsDialogOpen(true);
    };

    const closeDialog = () => {
        setIsDialogOpen(false);
        setEditingCategory(null);
    };

    // 切換規格選取
    const toggleSpecSelection = (id: string) => {
        setSelectedSpecIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    // 提交表單
    const handleSubmit = () => {
        if (!name.trim()) return;
        categoryMutation.mutate({
            name,
            parentIds,
            specIds: selectedSpecIds,
            editingCategoryId: editingCategory?.id,
        }, {
            onSuccess: closeDialog,
        });
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
                editingCategory={editingCategory}
                name={name}
                setName={setName}
                parentIds={parentIds}
                setParentIds={setParentIds}
                selectedSpecIds={selectedSpecIds}
                toggleSpecSelection={toggleSpecSelection}
                categories={categories}
                specDefinitions={specDefinitions}
                onSubmit={handleSubmit}
                isPending={categoryMutation.isPending}
            />
        </>
    );
}
