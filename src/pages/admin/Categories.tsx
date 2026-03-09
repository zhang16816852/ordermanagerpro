import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Plus, Pencil, Trash2, FolderTree, ChevronRight, ChevronDown, ListPlus, X, Database, Download, Upload, Tag } from 'lucide-react';
import Papa from 'papaparse';
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
    // parent_id field will be kept for legacy/compatibility but the source of truth is the hierarchy table
    parent_id: string | null;
    spec_schema: any;
    sort_order: number;
}

interface CategoryHierarchy {
    parent_id: string;
    child_id: string;
}

interface SpecDefinition {
    id: string;
    name: string;
    type: 'select' | 'multiselect' | 'text' | 'boolean' | 'number_with_unit';
    options: string[];
    default_value?: string;
}

interface Brand {
    id: string;
    name: string;
    description: string | null;
    sort_order: number;
}

export default function AdminCategories() {
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState('categories');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Category Form states
    const [name, setName] = useState('');
    const [parentIds, setParentIds] = useState<string[]>([]);
    const [selectedSpecIds, setSelectedSpecIds] = useState<string[]>([]);

    // Spec library form states
    const [isSpecDialogOpen, setIsSpecDialogOpen] = useState(false);
    const [editingSpec, setEditingSpec] = useState<SpecDefinition | null>(null);
    const [specForm, setSpecForm] = useState<Partial<SpecDefinition>>({
        name: '',
        type: 'select',
        options: [''],
    });

    // Brand form states
    const [isBrandDialogOpen, setIsBrandDialogOpen] = useState(false);
    const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
    const [brandForm, setBrandForm] = useState<Partial<Brand>>({
        name: '',
        description: '',
        sort_order: 0,
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

    const { data: categoryHierarchy = [] } = useQuery({
        queryKey: ['category_hierarchy'],
        queryFn: async () => {
            const { data, error } = await (supabase.from('category_hierarchy' as any) as any).select('*');
            if (error) return [];
            return data as CategoryHierarchy[];
        },
    });

    const { data: brands = [], isLoading: isLoadingBrands } = useQuery({
        queryKey: ['brands'],
        queryFn: async () => {
            try {
                // Ignore error if table doesn't exist yet in case migration isn't fully applied
                const { data, error } = await (supabase.from('brands' as any) as any)
                    .select('*')
                    .order('sort_order', { ascending: true })
                    .order('name', { ascending: true });
                if (error) return [];
                return data as Brand[];
            } catch (err) {
                console.error('Error fetching brands:', err);
                return [];
            }
        },
    });

    // --- Mutations ---

    const categoryMutation = useMutation({
        mutationFn: async (data: any) => {
            const { specIds, parentIds, ...catData } = data;
            let catId = editingCategory?.id;

            if (editingCategory) {
                const { error } = await supabase.from('categories').update(catData).eq('id', catId);
                if (error) throw error;
            } else {
                const { data: newCat, error } = await supabase.from('categories').insert([catData]).select().single();
                if (error) throw error;
                catId = newCat.id;
            }

            // Update hierarchy
            await (supabase.from('category_hierarchy' as any) as any).delete().eq('child_id', catId);
            if (parentIds.length > 0) {
                const hierarchy = parentIds.map((pid: string) => ({
                    parent_id: pid,
                    child_id: catId
                }));
                await (supabase.from('category_hierarchy' as any) as any).insert(hierarchy);
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
            queryClient.invalidateQueries({ queryKey: ['category_hierarchy'] });
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

    const brandMutation = useMutation({
        mutationFn: async (data: any) => {
            if (editingBrand) {
                const { error } = await (supabase.from('brands' as any) as any)
                    .update(data)
                    .eq('id', editingBrand.id);
                if (error) throw error;
            } else {
                const { error } = await (supabase.from('brands' as any) as any).insert([data]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brands'] });
            toast.success('品牌已儲存');
            setIsBrandDialogOpen(false);
        },
    });

    // --- Helpers ---

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

    const handleCategorySubmit = () => {
        if (!name.trim()) return toast.error('請輸入分類名稱');
        categoryMutation.mutate({
            name,
            parentIds,
            specIds: selectedSpecIds,
        });
    };

    const toggleSpecSelection = (id: string) => {
        setSelectedSpecIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const buildTree = (cats: Category[], h: CategoryHierarchy[]): any[] => {
        // Deduplicate hierarchy links
        const seen = new Set<string>();
        const uniqueH = h.filter(link => {
            const key = `${link.parent_id}-${link.child_id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const hToUse = uniqueH;
        // Find root nodes: nodes that are NOT children in any hierarchy row
        const childIds = new Set(hToUse.map(item => item.child_id));
        const roots = cats.filter(c => !childIds.has(c.id));

        const getChildren = (nodeId: string): any[] => {
            const childLinks = hToUse.filter(link => link.parent_id === nodeId);
            return childLinks
                .map(link => {
                    const child = cats.find(c => c.id === link.child_id);
                    if (!child) return null;
                    return {
                        ...child,
                        children: getChildren(child.id)
                    };
                })
                .filter(Boolean);
        };

        return roots.map(root => ({
            ...root,
            children: getChildren(root.id)
        }));
    };

    const tree = buildTree(categories, categoryHierarchy);
    const renderTreeNode = (node: any, level = 0, path = "root") => {
        const isExpanded = expandedIds.has(node.id);
        const hasChildren = node.children.length > 0;
        const linkedSpecsCount = categorySpecLinks.filter((l: any) => l.category_id === node.id).length;
        const uniqueKey = `${path}-${node.id}`;

        return (
            <div key={uniqueKey} className="space-y-1">
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
                        {node.children.map((child: any) => renderTreeNode(child, level + 1, node.id))}
                    </div>
                )}
            </div>
        );
    };
    // --- Import/Export Handlers ---

    const handleCategoryExport = () => {
        const exportData = categories.map(c => {
            const linkedParents = categoryHierarchy
                .filter(h => h.child_id === c.id)
                .map(h => h.parent_id);

            const linkedSpecs = categorySpecLinks
                .filter((link: any) => link.category_id === c.id)
                .sort((a: any, b: any) => a.sort_order - b.sort_order)
                .map((link: any) => link.spec_id);

            return {
                id: c.id,
                name: c.name,
                parent_ids: linkedParents.join(','),
                sort_order: c.sort_order,
                linked_spec_ids: linkedSpecs.join(',')
            };
        });

        const csv = Papa.unparse(exportData);
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `categories_export_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        toast.success('分類架構已匯出');
    };

    const handleCategoryImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                try {
                    // 1. Fetch ALL existing categories and specs for name-to-ID resolution
                    const { data: existingData, error: fetchError } = await supabase
                        .from('categories')
                        .select('id, name');
                    if (fetchError) throw fetchError;

                    const { data: specDefs, error: specError } = await supabase
                        .from('specification_definitions')
                        .select('id, name');
                    if (specError) throw specError;

                    const nameToExistingId = new Map(existingData.map(c => [c.name.trim(), c.id]));
                    const idToExistingId = new Map(existingData.map(c => [c.id, c.id]));
                    const specNameToId = new Map(specDefs.map(s => [s.name.trim(), s.id]));
                    const specIdToId = new Map(specDefs.map(s => [s.id, s.id]));

                    // Session mapping: will store Name/OldID -> CurrentUUID
                    const sessionMap = new Map<string, string>();

                    // 2. Determine IDs for all rows before upserting
                    const categoriesToUpsert = rows.map(row => {
                        const name = row.name?.trim();
                        const rawId = row.id?.toString().trim();

                        let targetId = null;

                        // Priority 1: Check if provided ID already exists
                        if (rawId && idToExistingId.has(rawId)) {
                            targetId = rawId;
                        }
                        // Priority 2: Check if name already exists
                        else if (name && nameToExistingId.has(name)) {
                            targetId = nameToExistingId.get(name);
                        }
                        // Priority 3: Use provided ID if it looks like a UUID but is new
                        else if (rawId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
                            targetId = rawId;
                        }
                        // Priority 4: Generate new UUID
                        else {
                            targetId = crypto.randomUUID();
                        }

                        if (name) sessionMap.set(name, targetId!);
                        if (rawId) sessionMap.set(rawId, targetId!);

                        return {
                            id: targetId,
                            name: name,
                            sort_order: parseInt(row.sort_order) || 0
                        };
                    });

                    // Perform the Categories Upsert
                    const { error: upsertError } = await supabase.from('categories').upsert(categoriesToUpsert);
                    if (upsertError) throw upsertError;

                    // 3. Resolve Hierarchy and Spec Links using names or IDs
                    const newHierarchy: any[] = [];
                    const newSpecLinks: any[] = [];
                    const importedIds = categoriesToUpsert.map(c => c.id);

                    rows.forEach(row => {
                        const currentId = sessionMap.get(row.name?.trim()) || sessionMap.get(row.id?.trim());
                        if (!currentId) return;

                        // Parent Resolution (Names or IDs)
                        const parentsRaw = row.parent_ids || row.parent_id;
                        if (parentsRaw) {
                            const tokens = parentsRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
                            tokens.forEach((token: string) => {
                                // Try sessionMap (which contains new & matched existing), then fallback to existing
                                const resolvedPid = sessionMap.get(token) || nameToExistingId.get(token) || idToExistingId.get(token);

                                if (resolvedPid && resolvedPid !== currentId) {
                                    newHierarchy.push({ parent_id: resolvedPid, child_id: currentId });
                                }
                            });
                        }

                        // Specs Resolution (Names or IDs)
                        if (row.linked_spec_ids) {
                            const tokens = row.linked_spec_ids.split(',').map((s: string) => s.trim()).filter(Boolean);
                            tokens.forEach((token: string, idx: number) => {
                                const resolvedSid = specNameToId.get(token) || specIdToId.get(token);
                                if (resolvedSid) {
                                    newSpecLinks.push({
                                        category_id: currentId,
                                        spec_id: resolvedSid,
                                        sort_order: idx
                                    });
                                }
                            });
                        }
                    });

                    // 4. Batch update relationships
                    if (importedIds.length > 0) {
                        // Clear associations for the categories we just processed
                        await (supabase.from('category_hierarchy' as any) as any).delete().in('child_id', importedIds);
                        if (newHierarchy.length > 0) {
                            const { error: hError } = await (supabase.from('category_hierarchy' as any) as any).insert(newHierarchy);
                            if (hError) throw hError;
                        }

                        await (supabase.from('category_spec_links' as any) as any).delete().in('category_id', importedIds);
                        if (newSpecLinks.length > 0) {
                            const { error: sError } = await (supabase.from('category_spec_links' as any) as any).insert(newSpecLinks);
                            if (sError) throw sError;
                        }
                    }

                    queryClient.invalidateQueries({ queryKey: ['categories'] });
                    queryClient.invalidateQueries({ queryKey: ['category_hierarchy'] });
                    queryClient.invalidateQueries({ queryKey: ['category_spec_links'] });
                    toast.success(`成功匯入 ${categoriesToUpsert.length} 筆分類`);
                } catch (err: any) {
                    console.error('Import error:', err);
                    toast.error(`匯入失敗: ${err.message}`);
                }
            }
        });
        e.target.value = '';
    };

    const handleSpecExport = () => {
        const exportData = specDefinitions.map(s => ({
            id: s.id,
            name: s.name,
            type: s.type,
            options: s.options.join(','),
            default_value: s.default_value || ''
        }));

        const csv = Papa.unparse(exportData);
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `specs_export_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        toast.success('規格屬性庫已匯出');
    };
    const handleSpecImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                try {
                    // 1. 取得現有資料做比對基準
                    const { data: existingSpecs, error: fetchError } = await supabase
                        .from('specification_definitions')
                        .select('id, name');

                    if (fetchError) throw fetchError;

                    // 2. 建立一個 Map 處理「CSV 內部重複」或是「比對更新」
                    // 這樣如果 CSV 裡出現兩次 "顏色"，最後只會有一筆進入 upsert
                    const finalMap = new Map<string, any>();

                    rows.forEach(row => {
                        const name = row.name?.trim();
                        if (!name) return; // 沒名字的跳過

                        const cleanedId = row.id?.toString().trim();
                        let targetId = (cleanedId && cleanedId !== 'null' && cleanedId !== '') ? cleanedId : null;

                        // 如果沒有 ID，去資料庫現有清單找
                        if (!targetId && existingSpecs) {
                            const match = existingSpecs.find(s => s.name === name);
                            if (match) targetId = match.id;
                        }

                        const specData: any = {
                            name: name,
                            type: row.type || 'text', // 確保有預設值
                            options: row.options ? row.options.split(',').map((s: any) => s.trim()).filter(Boolean) : [],
                            default_value: row.default_value || null
                        };

                        if (targetId) specData.id = targetId;

                        // 以 name 為 key 存入 Map，CSV 後面的同名資料會覆蓋前面的
                        finalMap.set(name, specData);
                    });

                    const toUpsert = Array.from(finalMap.values());

                    if (toUpsert.length === 0) {
                        toast.error("沒有有效的資料可供匯入");
                        return;
                    }

                    // 3. 執行 Upsert
                    const { error: upsertError } = await supabase
                        .from('specification_definitions')
                        .upsert(toUpsert, { onConflict: 'id' }); // 明確指定根據 id 衝突

                    if (upsertError) throw upsertError;

                    queryClient.invalidateQueries({ queryKey: ['spec_definitions'] });
                    toast.success(`規格同步成功，共處理 ${toUpsert.length} 筆`);
                } catch (err: any) {
                    console.error(err);
                    toast.error(`匯入失敗: ${err.message}`);
                }
            }
        });
        e.target.value = '';
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
                    <TabsTrigger value="brands" className="flex items-center gap-2">
                        <Tag className="h-4 w-4" />
                        品牌管理
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="categories" className="space-y-4">
                    <div className="flex justify-end">
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleCategoryExport}>
                                <Download className="h-4 w-4 mr-2" />
                                匯出 CSV
                            </Button>
                            <Label htmlFor="category-import" className="cursor-pointer">
                                <Input id="category-import" type="file" accept=".csv" className="hidden" onChange={handleCategoryImport} />
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
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-semibold">規格屬性庫</h2>
                            <CardDescription>管理全站共用的產品規格屬性，定義後可供各分類連結使用。</CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleSpecExport}>
                                <Download className="h-4 w-4 mr-2" />
                                匯出 CSV
                            </Button>
                            <Label htmlFor="spec-import" className="cursor-pointer">
                                <Input id="spec-import" type="file" accept=".csv" className="hidden" onChange={handleSpecImport} />
                                <Button variant="outline" size="sm" asChild>
                                    <span>
                                        <Upload className="h-4 w-4 mr-2" />
                                        匯入 CSV
                                    </span>
                                </Button>
                            </Label>
                            <Button size="sm" onClick={() => {
                                setEditingSpec(null);
                                setSpecForm({ name: '', type: 'select', options: [''] });
                                setIsSpecDialogOpen(true);
                            }}>
                                <Plus className="mr-2 h-4 w-4" /> 新增規格屬性
                            </Button>
                        </div>
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
                                        {spec.type === 'text' ? '自定義文字輸入' :
                                            spec.type === 'boolean' ? '支援/不支援 (開關)' :
                                                spec.type === 'number_with_unit' ? `數值輸入 (單位: ${spec.options?.[0] || '無'})` :
                                                    spec.options.join(' / ')}
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

                <TabsContent value="brands" className="space-y-4">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-semibold">品牌管理</h2>
                            <CardDescription>管理全站產品品牌，建立後可在新增產品時直接選擇。</CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => {
                                setEditingBrand(null);
                                setBrandForm({ name: '', description: '', sort_order: 0 });
                                setIsBrandDialogOpen(true);
                            }}>
                                <Plus className="mr-2 h-4 w-4" /> 新增品牌
                            </Button>
                        </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {isLoadingBrands ? (
                            <div className="col-span-full py-12 text-center text-muted-foreground">正在載入品牌...</div>
                        ) : brands.length === 0 ? (
                            <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl space-y-3">
                                <Tag className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                                <p className="text-muted-foreground text-sm">尚未建立任何品牌</p>
                            </div>
                        ) : brands.map((brand: any) => (
                            <Card key={brand.id} className="relative group overflow-hidden border-primary/10 hover:border-primary/50 transition-colors">
                                <CardHeader className="pb-2">
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-lg">{brand.name}</CardTitle>
                                    </div>
                                    {brand.description && (
                                        <CardDescription className="text-xs truncate" title={brand.description}>
                                            {brand.description}
                                        </CardDescription>
                                    )}
                                </CardHeader>
                                <CardContent className="flex justify-end gap-2 py-2 bg-muted/30">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                                        setEditingBrand(brand);
                                        setBrandForm({ name: brand.name, description: brand.description || '', sort_order: brand.sort_order || 0 });
                                        setIsBrandDialogOpen(true);
                                    }}>
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => {
                                        if (confirm(`確定要刪除品牌「${brand.name}」嗎？`)) {
                                            (supabase.from('brands' as any) as any).delete().eq('id', brand.id).then(({ error }: any) => {
                                                if (error) {
                                                    toast.error(`刪除失敗: 該品牌可能已被產品關聯`);
                                                } else {
                                                    queryClient.invalidateQueries({ queryKey: ['brands'] });
                                                }
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
                                <FolderTree className="h-4 w-4" /> 父分類 (可多選)
                            </label>
                            <div className="grid grid-cols-2 gap-2 p-4 bg-muted/30 rounded-lg border border-dashed max-h-[200px] overflow-y-auto">
                                {categories
                                    .filter(c => c.id !== editingCategory?.id) // Prevent self-parenting
                                    .map(cat => (
                                        <div
                                            key={cat.id}
                                            className={`flex items-center gap-2 p-2 rounded border transition-colors cursor-pointer ${parentIds.includes(cat.id) ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted'
                                                }`}
                                            onClick={() => setParentIds(prev =>
                                                prev.includes(cat.id) ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                                            )}
                                        >
                                            <Checkbox checked={parentIds.includes(cat.id)} onCheckedChange={() => { }} />
                                            <span className="text-sm truncate">{cat.name}</span>
                                        </div>
                                    ))}
                            </div>
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
                                <option value="boolean">是否支援 (Boolean開關)</option>
                                <option value="number_with_unit">數值輸入 (附帶單位)</option>
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
                        {specForm.type === 'number_with_unit' && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">數值單位 (例如: W, mAh, cm, kg)</label>
                                <Input
                                    value={specForm.options?.[0] || ''}
                                    onChange={(e) => setSpecForm(prev => ({ ...prev, options: [e.target.value] }))}
                                    placeholder="請輸入單位名稱"
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

            {/* Brand Dialog */}
            <Dialog open={isBrandDialogOpen} onOpenChange={setIsBrandDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingBrand ? '編輯品牌' : '新增品牌'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">品牌名稱</label>
                            <Input
                                value={brandForm.name}
                                onChange={(e) => setBrandForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="輸入品牌名稱"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">品牌說明 (選填)</label>
                            <Input
                                value={brandForm.description || ''}
                                onChange={(e) => setBrandForm(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="簡單描述"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">排序 (數字越小越前面)</label>
                            <Input
                                type="number"
                                value={brandForm.sort_order ?? 0}
                                onChange={(e) => setBrandForm(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsBrandDialogOpen(false)}>取消</Button>
                        <Button
                            onClick={() => {
                                if (!brandForm.name?.trim()) return toast.error('請輸入品牌名稱');
                                brandMutation.mutate(brandForm);
                            }}
                            disabled={brandMutation.isPending}
                        >
                            儲存品牌
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
