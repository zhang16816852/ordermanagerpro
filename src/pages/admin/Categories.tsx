import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, FolderTree, ChevronRight, ChevronDown, ListPlus, X } from 'lucide-react';
import { toast } from 'sonner';

interface Category {
    id: string;
    name: string;
    parent_id: string | null;
    spec_schema: any;
    sort_order: number;
}

export default function AdminCategories() {
    const queryClient = useQueryClient();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Form states
    const [name, setName] = useState('');
    const [parentId, setParentId] = useState<string | null>(null);
    const [specSchema, setSpecSchema] = useState<{ fields: any[] }>({ fields: [] });

    const { data: categories = [], isLoading } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            // Note: We use try-catch and handle missing table gracefully
            try {
                const { data, error } = await supabase
                    .from('categories')
                    .select('*')
                    .order('sort_order', { ascending: true });

                if (error) {
                    if (error.code === '42P01') {
                        toast.error('請先在 Supabase SQL Editor 執行 Migration 資料表建立腳本');
                        return [];
                    }
                    throw error;
                }
                return data as Category[];
            } catch (err) {
                console.error('Error fetching categories:', err);
                return [];
            }
        },
    });

    const mutation = useMutation({
        mutationFn: async (newCategory: any) => {
            if (editingCategory) {
                const { error } = await supabase
                    .from('categories')
                    .update(newCategory)
                    .eq('id', editingCategory.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('categories')
                    .insert([newCategory]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            toast.success(editingCategory ? '分類已更新' : '分類已建立');
            closeDialog();
        },
        onError: (error) => {
            toast.error('操作失敗: ' + error.message);
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('categories').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['categories'] });
            toast.success('分類已刪除');
        }
    });

    const openDialog = (cat: Category | null = null, defaultParentId: string | null = null) => {
        if (cat) {
            setEditingCategory(cat);
            setName(cat.name);
            setParentId(cat.parent_id);
            setSpecSchema(cat.spec_schema || { fields: [] });
        } else {
            setEditingCategory(null);
            setName('');
            setParentId(defaultParentId);
            setSpecSchema({ fields: [] });
        }
        setIsDialogOpen(true);
    };

    const closeDialog = () => {
        setIsDialogOpen(false);
        setEditingCategory(null);
    };

    const handleSubmit = () => {
        if (!name.trim()) {
            toast.error('請輸入分類名稱');
            return;
        }
        mutation.mutate({
            name,
            parent_id: parentId,
            spec_schema: specSchema,
        });
    };

    const toggleExpand = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
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

    // Spec Schema Helpers
    const addSpecField = () => {
        setSpecSchema(prev => ({
            fields: [...prev.fields, { key: '', type: 'select', options: [] }]
        }));
    };

    const removeSpecField = (index: number) => {
        setSpecSchema(prev => ({
            fields: prev.fields.filter((_, i) => i !== index)
        }));
    };

    const updateSpecField = (index: number, updates: any) => {
        setSpecSchema(prev => {
            const fields = [...prev.fields];
            fields[index] = { ...fields[index], ...updates };
            return { fields };
        });
    };

    const renderTreeNode = (node: any, level = 0) => {
        const isExpanded = expandedIds.has(node.id);
        const hasChildren = node.children.length > 0;

        return (
            <div key={node.id} className="space-y-1">
                <div
                    className="flex items-center group py-2 px-3 hover:bg-muted/50 rounded-lg border border-transparent hover:border-border transition-colors cursor-pointer"
                    style={{ marginLeft: `${level * 24}px` }}
                    onClick={() => toggleExpand(node.id)}
                >
                    <div className="flex items-center gap-2 flex-1">
                        {hasChildren ? (
                            isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <div className="w-4" />
                        )}
                        <FolderTree className="h-4 w-4 text-primary/70" />
                        <span className="font-medium text-sm">{node.name}</span>
                        {node.spec_schema?.fields?.length > 0 && (
                            <Badge variant="secondary" className="text-[10px] py-0 h-4">
                                {node.spec_schema.fields.length} 個規格
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
                            if (confirm(`確定要刪除「${node.name}」嗎？若其下有子分類將一併刪除或斷開連結。`)) {
                                deleteMutation.mutate(node.id);
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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">分類管理</h1>
                    <p className="text-muted-foreground">建立多層級分類並定義專屬規格欄位</p>
                </div>
                <Button onClick={() => openDialog()}>
                    <Plus className="mr-2 h-4 w-4" />
                    新增主分類
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">全部分類</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="py-12 text-center text-muted-foreground italic">載入中...</div>
                    ) : categories.length === 0 ? (
                        <div className="py-12 text-center border-2 border-dashed rounded-xl space-y-3">
                            <FolderTree className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                            <div className="text-muted-foreground">尚未建立任何分類</div>
                            <Button variant="outline" size="sm" onClick={() => openDialog()}>立即建立</Button>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {tree.map(node => renderTreeNode(node))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingCategory ? '編輯分類' : '新增分類'}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">分類名稱</label>
                            <Input
                                placeholder="例如：充電線、行動電源..."
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium">規格屬性定義 (Spec Schema)</label>
                                <Button variant="outline" size="sm" onClick={addSpecField}>
                                    <ListPlus className="mr-2 h-3 w-3" />
                                    新增規格欄位
                                </Button>
                            </div>

                            <div className="space-y-3">
                                {specSchema.fields.map((field, index) => (
                                    <div key={index} className="p-4 border rounded-lg bg-muted/20 space-y-3 relative">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="absolute top-2 right-2 h-6 w-6"
                                            onClick={() => removeSpecField(index)}
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold uppercase text-muted-foreground">欄位名稱 (Key)</label>
                                                <Input
                                                    placeholder="例如：長度、材質"
                                                    value={field.key}
                                                    onChange={(e) => updateSpecField(index, { key: e.target.value })}
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold uppercase text-muted-foreground">輸入型態</label>
                                                <select
                                                    className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    value={field.type}
                                                    onChange={(e) => updateSpecField(index, { type: e.target.value })}
                                                >
                                                    <option value="select">單選下拉 (Select)</option>
                                                    <option value="multiselect">多選 (Multi-select)</option>
                                                    <option value="text">文字輸入 (Text)</option>
                                                </select>
                                            </div>
                                        </div>

                                        {(field.type === 'select' || field.type === 'multiselect') && (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold uppercase text-muted-foreground">選項內容</label>
                                                <div className="space-y-1">
                                                    {field.options.map((option: string, i: number) => (
                                                        <div key={i} className="flex items-center gap-2">
                                                            <Input
                                                                className="h-8 text-sm flex-1"
                                                                value={option}
                                                                onChange={(e) => {
                                                                    const newOptions = [...field.options];
                                                                    newOptions[i] = e.target.value;
                                                                    updateSpecField(index, { options: newOptions });
                                                                }}
                                                                onBlur={() => {
                                                                    // 如果最後一個 input 不空就自動加一個新的空 input
                                                                    if (i === field.options.length - 1 && option.trim() !== '') {
                                                                        updateSpecField(index, { options: [...field.options, ''] });
                                                                    }
                                                                }}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') {
                                                                        e.preventDefault();
                                                                        if (option.trim() !== '') {
                                                                            updateSpecField(index, { options: [...field.options, ''] });
                                                                        }
                                                                    }
                                                                }}
                                                            />
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6"
                                                                onClick={() => {
                                                                    const newOptions = field.options.filter((_, idx) => idx !== i);
                                                                    updateSpecField(index, { options: newOptions });
                                                                }}
                                                            >
                                                                <X className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    ))}
                                                    {/* 如果 options 是空陣列，初始生成一個空 input */}
                                                    {field.options.length === 0 && updateSpecField(index, { options: [''] })}
                                                </div>
                                            </div>
                                        )}
                                        {field.type === 'text' && (
                                            <div className="space-y-1.5">
                                                <label className="text-[10px] font-bold uppercase text-muted-foreground">文字範例 / 預設值</label>
                                                <Input
                                                    placeholder="使用者輸入的文字"
                                                    value={field.defaultText || ''}
                                                    onChange={(e) => updateSpecField(index, { defaultText: e.target.value })}
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {specSchema.fields.length === 0 && (
                                    <div className="text-center py-6 border border-dashed rounded-lg text-xs text-muted-foreground">
                                        尚未定義任何規格欄位，此分類將使用一般通用欄位。
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeDialog}>取消</Button>
                        <Button onClick={handleSubmit} disabled={mutation.isPending}>
                            {editingCategory ? '儲存變更' : '建立分類'}
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
