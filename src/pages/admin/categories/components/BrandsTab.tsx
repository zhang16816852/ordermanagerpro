import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import { Pencil, Trash2, Plus, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { useBrandData } from '../hooks/useBrandData';
import { Brand } from '../types';

// 品牌管理 Tab（卡片列表 + 新增/編輯/刪除）
export function BrandsTab() {
    const { brands, isLoadingBrands, brandMutation, deleteBrand } = useBrandData();

    const [isBrandDialogOpen, setIsBrandDialogOpen] = useState(false);
    const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
    const [brandForm, setBrandForm] = useState<Partial<Brand>>({
        name: '',
        description: '',
        sort_order: 0,
    });

    // 開啟 Dialog（新增或編輯）
    const openBrandDialog = (brand: Brand | null = null) => {
        if (brand) {
            setEditingBrand(brand);
            setBrandForm({ name: brand.name, description: brand.description || '', sort_order: brand.sort_order || 0 });
        } else {
            setEditingBrand(null);
            setBrandForm({ name: '', description: '', sort_order: 0 });
        }
        setIsBrandDialogOpen(true);
    };

    // 提交表單
    const handleSubmit = () => {
        if (!brandForm.name?.trim()) return toast.error('請輸入品牌名稱');
        brandMutation.mutate({ brand: brandForm, editingBrandId: editingBrand?.id }, {
            onSuccess: () => setIsBrandDialogOpen(false),
        });
    };

    return (
        <>
            {/* 工具列 */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-semibold">品牌管理</h2>
                    <CardDescription>管理全站產品品牌，建立後可在新增產品時直接選擇。</CardDescription>
                </div>
                <Button size="sm" onClick={() => openBrandDialog()}>
                    <Plus className="mr-2 h-4 w-4" />
                    新增品牌
                </Button>
            </div>

            {/* 品牌卡片列表 */}
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
                                <CardTitle className="text-lg">{brand.name}</CardTitle>
                            </div>
                            {brand.description && (
                                <CardDescription className="text-xs truncate" title={brand.description}>
                                    {brand.description}
                                </CardDescription>
                            )}
                        </CardHeader>
                        <CardContent className="flex justify-end gap-2 py-2 bg-muted/30">
                            <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => openBrandDialog(brand)}
                            >
                                <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                onClick={() => {
                                    if (confirm(`確定要刪除品牌「${brand.name}」嗎？`)) {
                                        deleteBrand(brand.id, brand.name);
                                    }
                                }}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* 新增/編輯 Dialog */}
            <Dialog open={isBrandDialogOpen} onOpenChange={setIsBrandDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingBrand ? '編輯品牌' : '新增品牌'}</DialogTitle>
                        <DialogDescription>
                            請設定品牌名稱及其顯示順序。品牌建立後可用於產品標籤與分類過濾。
                        </DialogDescription>
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
                        <Button onClick={handleSubmit} disabled={brandMutation.isPending}>
                            儲存品牌
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
