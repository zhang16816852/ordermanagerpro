import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
    DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext, verticalListSortingStrategy, arrayMove, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Pencil, Trash2, Plus, Tag, Layers, X, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { useBrandData } from '../hooks/useBrandData';
import { useBrandSeriesData, BrandSeries } from '../hooks/useBrandSeriesData';
import { Brand } from '../types';

function SortableSeriesItem({
    series, onEdit, onDelete, isEditing,
}: {
    series: BrandSeries;
    onEdit: (s: BrandSeries) => void;
    onDelete: (s: BrandSeries) => void;
    isEditing: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: series.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`flex items-center gap-2 py-2 px-3 rounded-lg border transition-colors group ${
                isEditing ? 'bg-primary/10 border-primary/20' : 'hover:bg-muted/50 border-transparent'
            }`}
        >
            <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded shrink-0">
                <GripVertical className="h-4 w-4 text-muted-foreground/50" />
            </div>
            <div className="flex-1 min-w-0">
                <span className="font-medium text-sm truncate block">{series.name}</span>
                {series.description && (
                    <span className="text-[10px] text-muted-foreground truncate block">{series.description}</span>
                )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(series)}>
                    <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(series)}>
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    );
}

export function BrandsTab() {
    const { brands, isLoadingBrands, brandMutation, deleteBrand } = useBrandData();
    const [searchParams, setSearchParams] = useSearchParams();

    const [isBrandDialogOpen, setIsBrandDialogOpen] = useState(false);
    const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
    const [brandForm, setBrandForm] = useState<Partial<Brand>>({ name: '', abbreviation: '', description: '', sort_order: 0 });

    const seriesBrandId = searchParams.get('brand');
    const seriesEditId = searchParams.get('edit');
    const isSeriesDialogOpen = !!seriesBrandId;

    const selectedBrandForSeries = useMemo(() => {
        if (!seriesBrandId) return null;
        return brands.find(b => b.id === seriesBrandId) || null;
    }, [brands, seriesBrandId]);

    const { flatSeries, isLoading: isLoadingSeries, upsertSeries, deleteSeries, reorderSeries } = useBrandSeriesData(seriesBrandId || undefined);

    const editingSeries = useMemo(() => {
        if (!seriesEditId) return null;
        return flatSeries.find(s => s.id === seriesEditId) || null;
    }, [flatSeries, seriesEditId]);

    const [seriesForm, setSeriesForm] = useState<{ name: string; description: string }>({ name: '', description: '' });

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const openSeriesDialog = (brand: Brand) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('brand', brand.id);
            next.delete('edit');
            return next;
        }, { replace: true });
    };

    const closeSeriesDialog = () => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('brand');
            next.delete('edit');
            return next;
        }, { replace: true });
    };

    const startEditSeries = (series: BrandSeries) => {
        setSeriesForm({ name: series.name, description: series.description || '' });
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.set('edit', series.id);
            return next;
        }, { replace: true });
    };

    const cancelEditSeries = () => {
        setSeriesForm({ name: '', description: '' });
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('edit');
            return next;
        }, { replace: true });
    };

    const handleSeriesSubmit = () => {
        if (!seriesForm.name?.trim()) return toast.error('請輸入系列名稱');
        if (!selectedBrandForSeries) return;

        upsertSeries.mutate({
            series: {
                brand_id: selectedBrandForSeries.id,
                name: seriesForm.name.trim(),
                description: seriesForm.description || null,
            },
            editingId: editingSeries?.id,
        }, {
            onSuccess: () => { cancelEditSeries(); setSeriesForm({ name: '', description: '' }); },
        });
    };

    const handleDeleteSeries = (series: BrandSeries) => {
        if (confirm(`確定要刪除系列「${series.name}」嗎？`)) {
            deleteSeries.mutate(series.id, {
                onSuccess: () => { if (editingSeries?.id === series.id) cancelEditSeries(); },
            });
        }
    };

    const handleSeriesDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = flatSeries.findIndex(s => s.id === active.id);
        const newIndex = flatSeries.findIndex(s => s.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(flatSeries, oldIndex, newIndex);
        reorderSeries.mutate(reordered.map((s, idx) => ({ id: s.id, sort_order: idx })));
    };

    const openBrandDialog = (brand: Brand | null = null) => {
        if (brand) {
            setEditingBrand(brand);
            setBrandForm({ name: brand.name, abbreviation: brand.abbreviation || '', description: brand.description || '', sort_order: brand.sort_order || 0 });
        } else {
            setEditingBrand(null);
            setBrandForm({ name: '', abbreviation: '', description: '', sort_order: 0 });
        }
        setIsBrandDialogOpen(true);
    };

    const handleSubmit = () => {
        if (!brandForm.name?.trim()) return toast.error('請輸入品牌名稱');
        brandMutation.mutate({ brand: brandForm, editingBrandId: editingBrand?.id }, {
            onSuccess: () => setIsBrandDialogOpen(false),
        });
    };

    return (
        <>
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-semibold">品牌管理</h2>
                    <CardDescription>管理全站產品品牌與系列，建立後可在新增產品時直接選擇。</CardDescription>
                </div>
                <Button size="sm" onClick={() => openBrandDialog()}>
                    <Plus className="mr-2 h-4 w-4" />
                    新增品牌
                </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {isLoadingBrands ? (
                    <div className="col-span-full py-12 text-center text-muted-foreground">正在載入品牌...</div>
                ) : brands.length === 0 ? (
                    <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl space-y-3">
                        <Tag className="h-12 w-12 text-muted-foreground/30 mx-auto" />
                        <p className="text-muted-foreground text-sm">尚未建立任何品牌</p>
                    </div>
                ) : brands.map((brand: Brand) => (
                    <Card key={brand.id} className="relative group overflow-hidden border-primary/10 hover:border-primary/50 transition-colors">
                        <CardHeader className="pb-2">
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-lg">
                                    {brand.name}
                                    {brand.abbreviation && (
                                        <span className="ml-2 text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                            {brand.abbreviation}
                                        </span>
                                    )}
                                </CardTitle>
                            </div>
                            {brand.description && (
                                <CardDescription className="text-xs truncate" title={brand.description}>{brand.description}</CardDescription>
                            )}
                        </CardHeader>
                        <CardContent className="flex justify-between items-center py-2 bg-muted/30">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openSeriesDialog(brand)}>
                                <Layers className="mr-1 h-3.5 w-3.5" />
                                管理系列
                            </Button>
                            <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openBrandDialog(brand)}>
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => {
                                    if (confirm(`確定要刪除品牌「${brand.name}」嗎？`)) deleteBrand(brand.id, brand.name);
                                }}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Brand dialog */}
            <Dialog open={isBrandDialogOpen} onOpenChange={setIsBrandDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingBrand ? '編輯品牌' : '新增品牌'}</DialogTitle>
                        <DialogDescription>請設定品牌名稱及其顯示順序。品牌建立後可用於產品標籤與分類過濾。</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">品牌名稱</label>
                            <Input value={brandForm.name} onChange={(e) => setBrandForm(prev => ({ ...prev, name: e.target.value }))} placeholder="輸入品牌名稱" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">品牌縮寫</label>
                            <Input value={brandForm.abbreviation || ''} onChange={(e) => setBrandForm(prev => ({ ...prev, abbreviation: e.target.value }))} placeholder="例如：APL" maxLength={50} />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">品牌說明 (選填)</label>
                            <Input value={brandForm.description || ''} onChange={(e) => setBrandForm(prev => ({ ...prev, description: e.target.value }))} placeholder="簡單描述" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">排序 (數字越小越前面)</label>
                            <Input type="number" value={brandForm.sort_order ?? 0} onChange={(e) => setBrandForm(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsBrandDialogOpen(false)}>取消</Button>
                        <Button onClick={handleSubmit} disabled={brandMutation.isPending}>儲存品牌</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Series dialog */}
            <Dialog open={isSeriesDialogOpen} onOpenChange={(open) => { if (!open) closeSeriesDialog(); }}>
                <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            管理系列
                            {selectedBrandForSeries && (
                                <span className="text-sm font-normal text-muted-foreground">— {selectedBrandForSeries.name}</span>
                            )}
                        </DialogTitle>
                        <DialogDescription>拖移排序、新增系列，或點擊鉛筆編輯現有系列。</DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto space-y-4 py-2 min-h-0">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium">
                                    系列列表
                                    {flatSeries.length > 0 && (
                                        <span className="text-xs text-muted-foreground font-normal ml-1">（拖移排序）</span>
                                    )}
                                </label>
                                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { cancelEditSeries(); setSeriesForm({ name: '', description: '' }); }}>
                                    <Plus className="mr-1 h-3 w-3" />
                                    新增系列
                                </Button>
                            </div>

                            {isLoadingSeries ? (
                                <p className="text-xs text-muted-foreground py-4 text-center">載入中...</p>
                            ) : flatSeries.length === 0 ? (
                                <p className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                                    尚未建立任何系列，點擊上方按鈕新增
                                </p>
                            ) : (
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSeriesDragEnd}>
                                    <SortableContext items={flatSeries.map(s => s.id)} strategy={verticalListSortingStrategy}>
                                        <div className="border rounded-lg p-2 space-y-1">
                                            {flatSeries.map(series => (
                                                <SortableSeriesItem
                                                    key={series.id}
                                                    series={series}
                                                    onEdit={startEditSeries}
                                                    onDelete={handleDeleteSeries}
                                                    isEditing={seriesEditId === series.id}
                                                />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            )}
                        </div>

                        {/* Series form */}
                        <div className="border-t pt-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium">
                                    {editingSeries ? `編輯：${editingSeries.name}` : '新增系列'}
                                </label>
                                {editingSeries && (
                                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={cancelEditSeries}>
                                        <X className="mr-1 h-3 w-3" />取消
                                    </Button>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Input
                                    value={seriesForm.name}
                                    onChange={(e) => setSeriesForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="系列名稱，例如：手機殼、CLEAR、MOD NX"
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleSeriesSubmit(); }}
                                />
                                <Input
                                    value={seriesForm.description}
                                    onChange={(e) => setSeriesForm(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="系列說明（選填）"
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleSeriesSubmit(); }}
                                />
                            </div>
                            <Button
                                size="sm"
                                onClick={handleSeriesSubmit}
                                disabled={upsertSeries.isPending || !seriesForm.name.trim()}
                            >
                                {editingSeries ? '更新系列' : '新增系列'}
                            </Button>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeSeriesDialog}>關閉</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
