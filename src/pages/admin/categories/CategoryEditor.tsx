import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Database, Eye, Settings2, X } from 'lucide-react';
import { toast } from 'sonner';
import { CategorySpecLibraryTab } from './components/CategorySpecLibraryTab';
import { CategorySelectedConfigTab } from './components/CategorySelectedConfigTab';
import { CategorySpecPreview } from './components/CategorySpecPreview';
import { useCategoryData } from './hooks/useCategoryData';
import { useSpecData } from './hooks/useSpecData';
import { useSpecEngine } from './hooks/useSpecEngine';

export default function CategoryEditor() {
    const { categoryId } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const defaultParent = searchParams.get('parent');

    const { categories, categorySpecLinks, categoryHierarchy, categoryMutation } = useCategoryData();
    const { specDefinitions } = useSpecData();
    const { engine, activeConfiguration } = useSpecEngine(specDefinitions);

    const [activeTab, setActiveTab] = useState<'library' | 'config' | 'preview'>('library');
    const [name, setName] = useState('');
    const [parentIds, setParentIds] = useState<string[]>([]);
    const [requiredMap, setRequiredMap] = useState<Record<string, boolean>>({});
    const [notFound, setNotFound] = useState(false);

    const didInit = useRef(false);

    useEffect(() => {
        if (didInit.current) return;
        if (!categories || categories.length === 0) return;
        didInit.current = true;

        if (categoryId) {
            const cat = categories.find(c => c.id === categoryId);
            if (!cat) {
                setNotFound(true);
                return;
            }
            setName(cat.name);
            const currentParents = categoryHierarchy
                .filter(h => h.child_id === cat.id)
                .map(h => h.parent_id);
            setParentIds(currentParents);

            const snapshot: any = { selected: {} };
            const nextRequired: Record<string, boolean> = {};
            categorySpecLinks
                .filter((l: any) => l.category_id === cat.id)
                .forEach((l: any) => {
                    snapshot.selected[l.spec_id] = {
                        manual: l.is_manual ?? true,
                        sources: [],
                        sortOrder: l.sort_order || 0
                    };
                    nextRequired[l.spec_id] = l.required ?? false;
                });
            setRequiredMap(nextRequired);
            engine.restore(snapshot);
        } else {
            setName('');
            setParentIds(defaultParent ? [defaultParent] : []);
            setRequiredMap({});
            engine.restore({ selected: {} });
        }
    }, [categories, categoryId, categoryHierarchy, categorySpecLinks, engine, defaultParent]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await categoryMutation.mutateAsync({
                name,
                parentIds,
                specs: activeConfiguration.map(s => ({
                    id: s.id,
                    sortOrder: s.sortOrder,
                    isManual: s.isManual,
                    required: requiredMap[s.id] ?? false
                })),
                editingCategoryId: categoryId,
            });
            navigate('/admin/categories');
        } catch (error) {
            console.error('Submit category error:', error);
            toast.error('儲存失敗，請稍後再試');
        }
    };

    const goBack = () => navigate('/admin/categories');

    if (notFound) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center space-y-4">
                    <p className="text-muted-foreground">找不到此分類（可能已被刪除）。</p>
                    <Button onClick={goBack}>返回首頁</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="max-w-6xl mx-auto p-6 flex flex-col min-h-screen">
                {/* 頂部：返回 + 標題 */}
                <div className="flex items-center gap-3 mb-6 shrink-0">
                    <Button variant="ghost" size="icon" onClick={goBack} aria-label="返回分類列表">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <h1 className="text-xl font-bold">{categoryId ? '編輯分類' : '新增分類'}</h1>
                </div>

                <div className="flex-1 flex flex-col bg-white rounded-xl border p-6 space-y-6 overflow-hidden min-h-0">
                    {/* 基本資訊 */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
                        <div className="space-y-2">
                            <Label htmlFor="name">分類名稱</Label>
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="例如：行動電源"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>上層分類 (可複選)</Label>
                            <div className="flex flex-wrap gap-2 p-2 border rounded-md min-h-[42px] bg-slate-50/50">
                                {categories
                                    .filter(c => parentIds.includes(c.id))
                                    .map(c => (
                                        <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
                                            {c.name}
                                            <X
                                                className="h-3 w-3 cursor-pointer hover:text-destructive"
                                                onClick={() => setParentIds(parentIds.filter(id => id !== c.id))}
                                            />
                                        </Badge>
                                    ))}
                                {parentIds.length === 0 && <span className="text-sm text-muted-foreground">根分類</span>}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-2">
                                {categories
                                    .filter(c => !parentIds.includes(c.id))
                                    .slice(0, 10)
                                    .map(c => (
                                        <Badge
                                            key={c.id}
                                            variant="outline"
                                            className="cursor-pointer hover:bg-slate-100"
                                            onClick={() => setParentIds([...parentIds, c.id])}
                                        >
                                            + {c.name}
                                        </Badge>
                                    ))}
                            </div>
                        </div>
                    </div>

                    <Separator className="shrink-0" />

                    {/* 規格關聯區 - 填滿剩餘空間 */}
                    <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-full flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between mb-4 shrink-0">
                            <TabsList>
                                <TabsTrigger value="library" className="gap-2">
                                    <Database className="h-4 w-4" aria-hidden="true" />
                                    規格庫
                                </TabsTrigger>
                                <TabsTrigger value="config" className="gap-2 relative">
                                    <Settings2 className="h-4 w-4" />
                                    已選配置
                                    {activeConfiguration.length > 0 && (
                                        <Badge className="ml-1 px-1 min-w-[1.2rem] h-4 flex items-center justify-center text-[10px] bg-primary">
                                            {activeConfiguration.length}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                                <TabsTrigger value="preview" className="gap-2">
                                    <Eye className="h-4 w-4" />
                                    預覽
                                </TabsTrigger>
                            </TabsList>
                            <div className="text-xs text-muted-foreground flex items-center gap-4">
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-blue-500" aria-hidden="true" /> 手動選取
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 rounded-full bg-slate-300" aria-hidden="true" /> 連動產生
                                </div>
                            </div>
                        </div>

                        <TabsContent value="library" className="mt-0 border rounded-xl bg-white shadow-sm flex-1 flex flex-col min-h-0 overflow-hidden">
                            <CategorySpecLibraryTab
                                specDefinitions={specDefinitions}
                                engine={engine}
                            />
                        </TabsContent>

                        <TabsContent value="config" className="mt-0 border rounded-xl bg-white shadow-inner flex-1 flex flex-col min-h-0 overflow-hidden">
                            <CategorySelectedConfigTab
                                activeConfiguration={activeConfiguration}
                                specDefinitions={specDefinitions}
                                engine={engine}
                                requiredMap={requiredMap}
                                onToggleRequired={onToggleRequired}
                            />
                        </TabsContent>

                        <TabsContent value="preview" className="mt-0 border rounded-xl bg-white shadow-inner flex-1 flex flex-col min-h-0 overflow-hidden">
                            <CategorySpecPreview
                                categoryId={categoryId}
                                activeConfiguration={activeConfiguration}
                                specDefinitions={specDefinitions}
                                requiredMap={requiredMap}
                            />
                        </TabsContent>
                    </Tabs>
                </div>

                <div className="p-4 border bg-white flex justify-end gap-3 shrink-0 mt-4 rounded-xl">
                    <Button variant="outline" onClick={goBack}>取消</Button>
                    <Button onClick={handleSubmit}>儲存分類</Button>
                </div>
            </div>
        </div>
    );

    function onToggleRequired(id: string) {
        setRequiredMap(prev => ({ ...prev, [id]: !prev[id] }));
    }
}
