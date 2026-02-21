import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, FolderTree, ChevronRight, ChevronDown, ListPlus, X, Database } from 'lucide-react';
import { toast } from 'sonner';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { SortableItem } from './SortableItem';

interface Category {
    id: string;
    name: string;
    parent_id: string | null;
    spec_schema: any;
    sort_order: number;
}

interface SpecDefinition {
    id: string;
    name: string;
    type: 'select' | 'multiselect' | 'text';
    options: string[];
    default_value?: string;
}

export default function AdminCategories() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState('categories');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Category Form states
    const [name, setName] = useState('');
    const [parentId, setParentId] = useState<string | null>(null);
    const [selectedSpecIds, setSelectedSpecIds] = useState<string[]>([]);

    // Spec library form states
    const [isSpecDialogOpen, setIsSpecDialogOpen] = useState(false);
    const [editingSpec, setEditingSpec] = useState<SpecDefinition | null>(null);
    const [specForm, setSpecForm] = useState<Partial<SpecDefinition>>({
        name: '',
        type: 'select',
        options: [''],
    });

    // --- Queries ---

    const { data: categories = [], isLoading: isLoadingCats } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            try {
                const { data, error } = await supabase
                    .from('categories')
                    .select('*')
                    .order('sort_order', { ascending: true });
                if (error) throw error;
                return data as Category[];
            } catch (err) {
                console.error('Error fetching categories:', err);
                return [];
            }
        },
    });

    const { data: specDefinitions = [], isLoading: isLoadingSpecs } = useQuery({
        queryKey: ['spec_definitions'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('specification_definitions' as any) as any).select('*').order('name');
            if (error) return [];
            return data as SpecDefinition[];
        },
    });

    const { data: categorySpecLinks = [] } = useQuery({
        queryKey: ['category_spec_links'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('category_spec_links' as any) as any).select('*');
            if (error) return [];
            return data;
        },
    });

    // --- Mutations ---

    const categoryMutation = useMutation({
        mutationFn: async (data: any) => {
            const { specIds, ...catData } = data;
            let catId = editingCategory?.id;

            if (editingCategory) {
                const { error } = await supabase.from('categories').update(catData).eq('id', catId);
                if (error) throw error;
            } else {
                const { data: newCat, error } = await supabase.from('categories').insert([catData]).select().single();
                if (error) throw error;
                catId = newCat.id;
            }

            // Update spec links
            await (supabase.from('category_spec_links' as any) as any).delete().eq('category_id', catId);
            if (specIds.length > 0) {
                const links = specIds.map((sid: string, idx: number) => ({
                    category_id: catId,
                    spec_id: sid,
                    sort_order: idx
                }));
                await (supabase.from('category_spec_links' as any) as any).insert(links);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            queryClient.invalidateQueries({ queryKey: ['category_spec_links'] });
            toast.success('分類已儲存');
            closeDialog();
        },
    });

    const specMutation = useMutation({
        mutationFn: async (data: any) => {
            if (editingSpec) {
                const { error } = await (supabase.from('specification_definitions' as any) as any)
                    .update(data)
                    .eq('id', editingSpec.id);
                if (error) throw error;
            } else {
                const { error } = await (supabase.from('specification_definitions' as any) as any).insert([data]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
            toast.success('規格屬性已儲存');
            setIsSpecDialogOpen(false);
        },
    });

    // --- Helpers ---

    const openDialog = (cat: Category | null = null, defaultParentId: string | null = null) => {
        if (cat) {
            setEditingCategory(cat);
            setName(cat.name);
            setParentId(cat.parent_id);
            const currentLinks = categorySpecLinks
                .filter((l: any) => l.category_id === cat.id)
                .sort((a: any, b: any) => a.sort_order - b.sort_order)
                .map((l: any) => l.spec_id);
            setSelectedSpecIds(currentLinks);
        } else {
            setEditingCategory(null);
            setName('');
            setParentId(defaultParentId);
            setSelectedSpecIds([]);
        }
        setIsDialogOpen(true);
    };

    const closeDialog = () => {
        setIsDialogOpen(false);
        setEditingCategory(null);
    };

    const handleCategorySubmit = () => {
        if (!name.trim()) return toast.error('請輸入分類名稱');
        categoryMutation.mutate({
            name,
            parent_id: parentId,
            specIds: selectedSpecIds,
        });
    };

    const toggleSpecSelection = (id: string) => {
        setSelectedSpecIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const buildTree = (cats: Category[], pid: string | null = null): any[] => {
        return cats
            .filter(c => c.parent_id === pid)
            .map(c => ({
                ...c,
                children: buildTree(cats, c.id)
            }));
    };

    const tree = buildTree(categories);

    const renderTreeNode = (node: any, level = 0) => {
        const isExpanded = expandedIds.has(node.id);
        const hasChildren = node.children.length > 0;
        const linkedSpecsCount = categorySpecLinks.filter((l: any) => l.category_id === node.id).length;

        return (
            <div key={node.id} className="space-y-1">
                <div
                    className="flex items-center group py-2 px-3 hover:bg-muted/50 rounded-lg border border-transparent hover:border-border transition-colors cursor-pointer"
                    style={{ marginLeft: `${level * 24}px` }}
                    onClick={() => setExpandedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(node.id)) next.delete(node.id);
                        else next.add(node.id);
                        return next;
                    })}
                >
                    <div className="flex items-center gap-2 flex-1">
                        {hasChildren ? (
                            isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <div className="w-4" />
                        )}
                        <FolderTree className="h-4 w-4 text-primary/70" />
                        <span className="font-medium text-sm">{node.name}</span>
                        {linkedSpecsCount > 0 && (
                            <Badge variant="secondary" className="text-[10px] py-0 h-4">
                                {linkedSpecsCount} 個規格
                            </Badge>
                        )}
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="新增子分類" onClick={(e) => { e.stopPropagation(); openDialog(null, node.id); }}>
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="編輯" onClick={(e) => { e.stopPropagation(); openDialog(node); }}>
                            <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="刪除" onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`確定要刪除「${node.name}」嗎？`)) {
                                supabase.from('categories').delete().eq('id', node.id).then(() => queryClient.invalidateQueries({ queryKey: ['categories'] }));
                            }
                        }}>
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
                {isExpanded && hasChildren && (
                    <div className="space-y-1">
                        {node.children.map((child: any) => renderTreeNode(child, level + 1))}
                    </div>
                )}
            </div>
        );
    };
    //---move/sort---//
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                // 只有移動超過 5px 才判定為拖拽，這樣點擊就不會被攔截
                distance: 5,
            },
        })
    );
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">規格與分類管理</h1>
                    <p className="text-muted-foreground">管理多層級分類及全域共享的屬性規格庫</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="categories" className="flex items-center gap-2">
                        <FolderTree className="h-4 w-4" />
                        分類架構
                    </TabsTrigger>
                    <TabsTrigger value="spec_library" className="flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        規格屬性庫
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="categories" className="space-y-4">
                    <div className="flex justify-end">
                        <Button size="sm" onClick={() => openDialog()}>
                            <Plus className="mr-2 h-4 w-4" /> 新增主分類
                        </Button>
                    </div>
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
                                    {tree.map(node => renderTreeNode(node))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="spec_library" className="space-y-4">
                    <div className="flex justify-end">
                        <Button size="sm" onClick={() => {
                            setEditingSpec(null);
                            setSpecForm({ name: '', type: 'select', options: [''] });
                            setIsSpecDialogOpen(true);
                        }}>
                            <Plus className="mr-2 h-4 w-4" /> 新增規格屬性
                        </Button>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {isLoadingSpecs ? (
                            <div className="col-span-full py-12 text-center">正在抓取規格庫...</div>
                        ) : specDefinitions.map(spec => (
                            <Card key={spec.id} className="relative group overflow-hidden border-primary/10 hover:border-primary/50 transition-colors">
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-base">{spec.name}</CardTitle>
                                        <Badge variant="outline" className="text-[10px]">{spec.type}</Badge>
                                    </div>
                                    <CardDescription className="text-xs truncate">
                                        {spec.type === 'text' ? '自定義文字輸入' : spec.options.join(' / ')}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex justify-end gap-2 py-2 bg-muted/30">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                                        setEditingSpec(spec);
                                        setSpecForm({ ...spec });
                                        setIsSpecDialogOpen(true);
                                    }}>
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => {
                                        if (confirm(`確定要刪除規格「${spec.name}」嗎？這將導致所有關聯分類失去該欄位。`)) {
                                            (supabase.from('specification_definitions' as any) as any).delete().eq('id', spec.id).then(() => {
                                                queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
                                            });
                                        }
                                    }}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Category Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingCategory ? '編輯分類' : '新增分類'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-6 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">分類名稱</label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="後台分類名稱" />
                        </div>

                        <div className="space-y-4">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <ListPlus className="h-4 w-4" /> 關聯規格屬性
                            </label>
                            <div className="grid grid-cols-2 gap-3 p-4 bg-muted/30 rounded-lg border border-dashed">
                                {specDefinitions.length === 0 ? (
                                    <div className="col-span-full py-4 text-center text-xs text-muted-foreground italic">
                                        尚未建立規格屬性，請先至「規格屬性庫」建立。
                                    </div>
                                ) : specDefinitions.map(spec => (
                                    <div
                                        key={spec.id}
                                        className={`flex items-center gap-2 p-2 rounded border transition-colors cursor-pointer ${selectedSpecIds.includes(spec.id) ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted'
                                            }`}
                                        onClick={() => toggleSpecSelection(spec.id)}
                                    >
                                        <Checkbox checked={selectedSpecIds.includes(spec.id)} onCheckedChange={() => { }} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{spec.name}</p>
                                            <p className="text-[10px] text-muted-foreground truncate">{spec.type}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={closeDialog}>取消</Button>
                        <Button onClick={handleCategorySubmit} disabled={categoryMutation.isPending}>儲存變更</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Spec Definition Dialog */}
            <Dialog open={isSpecDialogOpen} onOpenChange={setIsSpecDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingSpec ? '編輯規格定義' : '新增規格定義'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">屬性名稱</label>
                            <Input
                                value={specForm.name}
                                onChange={(e) => setSpecForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="如：長度、容量、顏色"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">輸入型態</label>
                            <select
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                value={specForm.type}
                                onChange={(e) => setSpecForm(prev => ({ ...prev, type: e.target.value as any }))}
                            >
                                <option value="select">單選下拉 (Select)</option>
                                <option value="multiselect">多選 (Multi-select)</option>
                                <option value="text">文字輸入 (Text)</option>
                            </select>
                        </div>

                        {(specForm.type === 'select' || specForm.type === 'multiselect') && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">選項清單</label>

                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={(event) => {
                                        const { active, over } = event;
                                        if (!over || active.id === over.id) return;
                                        setSpecForm(prev => ({
                                            ...prev,
                                            options: arrayMove(prev.options || [], Number(active.id), Number(over.id))
                                        }));
                                    }}
                                >
                                    <SortableContext
                                        items={(specForm.options || []).map((_, i) => i.toString())}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {(specForm.options || []).map((opt, i) => (
                                            <SortableItem key={i} id={i.toString()}>
                                                <div className="flex gap-2 items-center">
                                                    <Input
                                                        name={`spec-option-${i}`}
                                                        className="flex-1 h-8 text-sm"
                                                        value={opt}
                                                        onChange={(e) => {
                                                            const newOpts = [...(specForm.options || [])];
                                                            newOpts[i] = e.target.value;
                                                            setSpecForm(prev => ({ ...prev, options: newOpts }));
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === 'Tab') {
                                                                e.preventDefault();
                                                                setSpecForm(prev => {
                                                                    const currentValue = prev.options?.[i] || '';
                                                                    const options = [...(prev.options || [])];

                                                                    // 如果是最後一個 input 且不空，新增一個
                                                                    if (i === options.length - 1 && currentValue.trim() !== '') {
                                                                        options.push('');
                                                                        setTimeout(() => {
                                                                            const nextInput = document.querySelector<HTMLInputElement>(
                                                                                `input[name="spec-option-${options.length - 1}"]`
                                                                            );
                                                                            nextInput?.focus();
                                                                        }, 0);
                                                                    } else {
                                                                        // 移到下一個空 input
                                                                        const firstEmptyIndex = options.findIndex(o => o.trim() === '');
                                                                        if (firstEmptyIndex >= 0) {
                                                                            setTimeout(() => {
                                                                                const nextInput = document.querySelector<HTMLInputElement>(
                                                                                    `input[name="spec-option-${firstEmptyIndex}"]`
                                                                                );
                                                                                nextInput?.focus();
                                                                            }, 0);
                                                                        }
                                                                    }

                                                                    return { ...prev, options };
                                                                });
                                                            }
                                                        }}
                                                    />
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => {
                                                            setSpecForm(prev => ({
                                                                ...prev,
                                                                options: (prev.options || []).filter((_, idx) => idx !== i)
                                                            }));
                                                        }}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </SortableItem>
                                        ))}
                                    </SortableContext>
                                </DndContext>
                            </div>
                        )}
                        {specForm.type === 'text' && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">預設文字值</label>
                                <Input
                                    value={specForm.options?.[0] || ''}
                                    onChange={(e) => setSpecForm(prev => ({ ...prev, options: [e.target.value] }))}
                                    placeholder="請輸入預設文字"
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsSpecDialogOpen(false)}>取消</Button>
                        <Button
                            onClick={() => {
                                const cleaned = { ...specForm, options: (specForm.options || []).filter(o => o.trim() !== '') };
                                specMutation.mutate(cleaned);
                            }}
                            disabled={specMutation.isPending}
                        >
                            儲存規格
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Badge({ children, variant = "default", className = "" }: any) {
    const variants: any = {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "text-foreground border border-input"
    };
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${variants[variant]} ${className}`}>
            {children}
        </span>
    );
}
