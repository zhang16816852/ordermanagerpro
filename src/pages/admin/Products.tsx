// src/pages/admin/Products.tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables, TablesInsert } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, RefreshCw, Upload, MoreHorizontal, Pencil, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductCache } from '@/hooks/useProductCache';
import { ProductBatchImport } from '@/components/products/ProductBatchImport';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { VariantManager } from '@/components/products/VariantManager';

type Product = Tables<'products'>;
type ProductInsert = TablesInsert<'products'>;
type ProductVariant = Tables<'product_variants'>;
const STATUS_LABELS: Record<string, string> = {
  active: '上架中',
  discontinued: '已停售',
  preorder: '預購中',
  sold_out: '售完停產',
};

const STATUS_VARIANTS: Record<string, string> = {
  active: 'bg-success text-success-foreground',
  preorder: 'bg-blue-500 text-white',
  sold_out: 'bg-orange-500 text-white',
  discontinued: '',
};

export default function AdminProducts() {
  const [search, setSearch] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);
  const [editingVariants, setEditingVariants] = useState<ProductVariant[]>([]);

  const [activeTab, setActiveTab] = useState<'list' | 'variants'>('list');
  const queryClient = useQueryClient();

  const { products, isLoading, version, forceRefresh } = useProductCache();

  const createMutation = useMutation({
    mutationFn: async (product: ProductInsert) => {
      const { data, error } = await supabase.from('products').insert(product).select().single();
      if (error) throw error;
      console.log('Created product:', data);
      return data; // ← 回傳新增的產品
    },
    onSuccess: async (newProduct) => {
      toast.success('產品已新增');

      setIsDialogOpen(false);
      if (editingVariants.length > 0) {
        const variantsToInsert = editingVariants.map(v => ({
          sku: `${v.sku}`,
          name: `${v.name}`,
          product_id: newProduct.id,
          barcode: v.barcode,
          color: v.color,
          option_1: v.option_1,
          option_2: v.option_2,
          option_3: v.option_3,
          wholesale_price: v.wholesale_price,
          retail_price: v.retail_price,
          status: v.status,
        }));

        const { error } = await supabase.from('product_variants').insert(variantsToInsert);
        if (error) toast.error('新增變體失敗');
      }
    },
    onError: (error) => {
      toast.error(`新增失敗：${error.message}`);
    },
  });


  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Product> & { id: string }) => {
      const { error } = await supabase.from('products').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      toast.success('產品已更新');
      setIsDialogOpen(false);
      setEditingProduct(null);
    },
    onError: (error) => {
      toast.error(`更新失敗：${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-products'] });
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      toast.success('產品已刪除');
      setDeleteProduct(null);
    },
    onError: (error) => {
      toast.error(`刪除失敗：${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const productData = {
      name: formData.get('name') as string,
      sku: formData.get('sku') as string,
      description: formData.get('description') as string || null,
      brand: formData.get('brand') as string || null,
      model: formData.get('model') as string || null,
      series: formData.get('series') as string || null,
      color: formData.get('color') as string || null,
      barcode: formData.get('barcode') as string || null,
      category: formData.get('category') as string || null,
      base_wholesale_price: parseFloat(formData.get('base_wholesale_price') as string) || 0,
      base_retail_price: parseFloat(formData.get('base_retail_price') as string) || 0,
      status: formData.get('status') as 'active' | 'discontinued' | 'preorder' | 'sold_out',
      has_variants: formData.get('has_variants') === 'on',
    };

    if (editingProduct?.id) {
      // 更新原產品
      updateMutation.mutate({ id: editingProduct.id, ...productData });
    } else {
      // 新增產品

      createMutation.mutate(productData, {
        onSuccess: async (newProduct) => {
          if (editingVariants.length > 0) {
            const variantsToInsert = editingVariants.map(v => ({
              ...v,
              product_id: newProduct.id,
            }));
            const { error } = await supabase.from('product_variants').insert(variantsToInsert);
            if (error) toast.error('新增變體失敗');
          }
        },
      });
    }
  };

  const handleCopy = async (product: Product) => {
    setEditingProduct(null);
    setEditingVariants([]);

    const { id, ...rest } = product;

    const copiedProduct = {
      ...rest,
      sku: `${product.sku}-COPY`,
      name: `${product.name} (複製)`,
    };

    setEditingProduct(copiedProduct as any);

    if (product.has_variants) {
      // 取得原產品變體
      const { data: variants, error } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', product.id);

      if (error) {
        toast.error('複製變體失敗');
      } else if (variants?.length) {
        const copiedVariants = variants.map(v => ({
          ...v,
          id: undefined, // 移除原 id
          sku: `${v.sku}-COPY`,
          name: `${v.name} (複製)`,
        }));
        setEditingVariants(copiedVariants);
      }
    }

    setIsDialogOpen(true);
  };


  const filteredProducts = products?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(search.toLowerCase())) ||
      (p.model && p.model.toLowerCase().includes(search.toLowerCase()))
  );

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">產品管理</h1>
          <p className="text-muted-foreground">
            管理系統中的所有產品
            <span className="ml-2 text-xs">（緩存版本：{version}）</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={forceRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重新整理
          </Button>
          <Button variant="outline" onClick={() => setIsImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            批次匯入
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                onClick={() => {
                  setEditingProduct(null);
                  setIsDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                新增產品
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingProduct?.id ? '編輯產品' : '新增產品'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* 基本資訊 */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="sku">SKU *</Label>
                    <Input
                      id="sku"
                      name="sku"
                      defaultValue={editingProduct?.sku}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">產品名稱 *</Label>
                    <Input
                      id="name"
                      name="name"
                      defaultValue={editingProduct?.name}
                      required
                    />
                  </div>
                </div>

                {/* 品牌/型號/系列 */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="brand">廠牌</Label>
                    <Input
                      id="brand"
                      name="brand"
                      defaultValue={editingProduct?.brand || ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">型號</Label>
                    <Input
                      id="model"
                      name="model"
                      defaultValue={editingProduct?.model || ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="series">系列</Label>
                    <Input
                      id="series"
                      name="series"
                      defaultValue={editingProduct?.series || ''}
                    />
                  </div>
                </div>

                {/* 分類/顏色/條碼 */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="category">分類</Label>
                    <Input
                      id="category"
                      name="category"
                      defaultValue={editingProduct?.category || ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="color">顏色備註</Label>
                    <Input
                      id="color"
                      name="color"
                      defaultValue={editingProduct?.color || ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="barcode">條碼</Label>
                    <Input
                      id="barcode"
                      name="barcode"
                      defaultValue={editingProduct?.barcode || ''}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">描述</Label>
                  <Textarea
                    id="description"
                    name="description"
                    defaultValue={editingProduct?.description || ''}
                  />
                </div>

                {/* 價格 */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="base_wholesale_price">批發價</Label>
                    <Input
                      id="base_wholesale_price"
                      name="base_wholesale_price"
                      type="number"
                      step="0.01"
                      defaultValue={editingProduct?.base_wholesale_price}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="base_retail_price">零售價</Label>
                    <Input
                      id="base_retail_price"
                      name="base_retail_price"
                      type="number"
                      step="0.01"
                      defaultValue={editingProduct?.base_retail_price}
                    />
                  </div>
                </div>

                {/* 狀態和變體 */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="status">狀態</Label>
                    <Select
                      name="status"
                      defaultValue={editingProduct?.status || 'active'}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">上架中</SelectItem>
                        <SelectItem value="preorder">預購中</SelectItem>
                        <SelectItem value="sold_out">售完停產</SelectItem>
                        <SelectItem value="discontinued">已停售</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>有變體選項</Label>
                    <div className="flex items-center gap-2 pt-2">
                      <Switch
                        id="has_variants"
                        name="has_variants"
                        defaultChecked={editingProduct?.has_variants || false}
                      />
                      <Label htmlFor="has_variants" className="font-normal text-muted-foreground">
                        啟用後可在產品頁面管理變體
                      </Label>
                    </div>
                  </div>
                </div>
                {editingVariants.length > 0 && (
                  <div className="mt-4 border-t pt-4 space-y-2">
                    <h4 className="font-medium">複製的變體（可編輯）</h4>
                    {editingVariants.map((variant, index) => (
                      <div key={index} className="grid grid-cols-3 gap-2 items-end">
                        <div className="space-y-1">
                          <Label>SKU</Label>
                          <Input
                            value={variant.sku}
                            onChange={(e) => {
                              const newVariants = [...editingVariants];
                              newVariants[index].sku = e.target.value;
                              setEditingVariants(newVariants);
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>名稱</Label>
                          <Input
                            value={variant.name}
                            onChange={(e) => {
                              const newVariants = [...editingVariants];
                              newVariants[index].name = e.target.value;
                              setEditingVariants(newVariants);
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>批發價</Label>
                          <Input
                            type="number"
                            value={variant.wholesale_price}
                            onChange={(e) => {
                              const newVariants = [...editingVariants];
                              newVariants[index].wholesale_price = parseFloat(e.target.value) || 0;
                              setEditingVariants(newVariants);
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closeDialog}>
                    取消
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                    {editingProduct?.id ? '儲存' : '新增'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'variants')}>
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="list">產品列表</TabsTrigger>
            <TabsTrigger value="variants">變體管理</TabsTrigger>
          </TabsList>

          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜尋產品名稱、SKU、品牌、型號..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <TabsContent value="list" className="mt-4">
          <div className="rounded-lg border bg-card shadow-soft">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>名稱</TableHead>
                  <TableHead>廠牌</TableHead>
                  <TableHead>型號</TableHead>
                  <TableHead className="text-right">批發價</TableHead>
                  <TableHead className="text-right">零售價</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredProducts?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      沒有找到產品
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProducts?.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                      <TableCell className="font-medium">
                        {product.name}
                        {product.has_variants && (
                          <Badge variant="outline" className="ml-2 text-xs">有變體</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{product.brand || '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{product.model || '-'}</TableCell>
                      <TableCell className="text-right">
                        ${product.base_wholesale_price.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${product.base_retail_price.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={product.status === 'discontinued' ? 'secondary' : 'default'}
                          className={STATUS_VARIANTS[product.status] || ''}
                        >
                          {STATUS_LABELS[product.status] || product.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(product)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              編輯
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopy(product)}>
                              <Copy className="mr-2 h-4 w-4" />
                              複製
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteProduct(product)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              刪除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="variants" className="mt-4">
          <VariantManager products={products || []} search={search} />
        </TabsContent>
      </Tabs>

      {/* 刪除確認對話框 */}
      <AlertDialog open={!!deleteProduct} onOpenChange={() => setDeleteProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除此產品嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              您即將刪除產品「{deleteProduct?.name}」（SKU: {deleteProduct?.sku}）。
              此操作無法復原，相關的訂單項目可能會受到影響。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteProduct && deleteMutation.mutate(deleteProduct.id)}
            >
              {deleteMutation.isPending ? '刪除中...' : '確定刪除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProductBatchImport open={isImportOpen} onOpenChange={setIsImportOpen} />
    </div>
  );
}
