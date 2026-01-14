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
import { Plus, Search, RefreshCw, Upload, MoreHorizontal, Pencil, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductCache } from '@/hooks/useProductCache';
import { ProductBatchImport } from '@/components/products/ProductBatchImport';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VariantManager } from '@/components/products/VariantManager';
import { ProductFormDialog } from '@/components/ProductFormDialog/ProductFormDialog';

type Product = Tables<'products'>;
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
  const [activeTab, setActiveTab] = useState<'list' | 'variants'>('list');
  
  const queryClient = useQueryClient();
  const { products, isLoading, version, forceRefresh } = useProductCache();

  // --- Mutations ---
  const createMutation = useMutation({
    mutationFn: async (values: any) => {
      const { data, error } = await supabase.from('products').insert(values).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      toast.success('產品已新增');
      setIsDialogOpen(false);
    },
    onError: (error) => toast.error(`新增失敗：${error.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Product> & { id: string }) => {
      const { error } = await supabase.from('products').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      toast.success('產品已更新');
      setIsDialogOpen(false);
      setEditingProduct(null);
    },
    onError: (error) => toast.error(`更新失敗：${error.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      toast.success('產品已刪除');
      setDeleteProduct(null);
    },
    onError: (error) => toast.error(`刪除失敗：${error.message}`),
  });

  // --- Handlers ---
  const handleFormSubmit = (data: any) => {
    if (editingProduct?.id) {
      updateMutation.mutate({ id: editingProduct.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleCopy = async (product: Product) => {
    const { id, created_at, ...rest } = product;
    const copiedProduct = {
      ...rest,
      sku: `${product.sku}-COPY`,
      name: `${product.name} (複製)`,
    };
    // 注意：這裡直接開啟 Dialog，由 Dialog 內部的 useEffect 同步資料到 RHF
    setEditingProduct(copiedProduct as any);
    setIsDialogOpen(true);
  };

  const filteredProducts = products?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(search.toLowerCase())) ||
      (p.model && p.model.toLowerCase().includes(search.toLowerCase()))
  );

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
          <Button onClick={() => { setEditingProduct(null); setIsDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            新增產品
          </Button>
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
                      <TableCell className="text-right">${product.base_wholesale_price.toFixed(2)}</TableCell>
                      <TableCell className="text-right">${product.base_retail_price.toFixed(2)}</TableCell>
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
                            <DropdownMenuItem onClick={() => { setEditingProduct(product); setIsDialogOpen(true); }}>
                              <Pencil className="mr-2 h-4 w-4" /> 編輯
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopy(product)}>
                              <Copy className="mr-2 h-4 w-4" /> 複製
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteProduct(product)}>
                              <Trash2 className="mr-2 h-4 w-4" /> 刪除
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

      {/* 新增/編輯彈窗元件 */}
      <ProductFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleFormSubmit}
        initialData={editingProduct}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      {/* 刪除確認 */}
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