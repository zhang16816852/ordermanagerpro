import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
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
    onError: (error: any) => toast.error(`新增失敗：${error.message}`),
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
    onError: (error: any) => toast.error(`更新失敗：${error.message}`),
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
    onError: (error: any) => toast.error(`刪除失敗：${error.message}`),
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
    const newName = `${product.name} (複製)`;
    const newSku = `${product.sku}-COPY-${Math.floor(Math.random() * 1000)}`;

    try {
      // 呼叫 Supabase RPC
      const { data: newProductId, error } =
        await supabase.rpc('duplicate_product_with_variants', {
          target_product_id: product.id,
          new_name: newName,
          new_sku: newSku,
        });

      if (error) throw error;

      // 重新整理列表
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      toast.success('產品及其變體已完整複製');

      // 選取新產品並打開 Dialog 讓使用者編輯
      // 注意：這裡可能需要重新抓取新產品的完整資料
      const { data: newProduct } = await supabase
        .from('products')
        .select('*')
        .eq('id', newProductId!)
        .single();

      if (newProduct) {
        setEditingProduct(newProduct);
        setIsDialogOpen(true);
      }

    } catch (error: any) {
      console.error('Copy Error:', error);
      toast.error(`複製失敗：${error.message}`);
    }
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
          <p className="text-muted-foreground text-sm mt-1">
            管理產品基本資訊與變體
            <span className="ml-2 text-xs opacity-50">（緩存版本：{version}）</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={forceRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重新整理
          </Button>
          <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            批次匯入
          </Button>
          <Button size="sm" onClick={() => { setEditingProduct(null); setIsDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            新增產品
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'variants')}>
        <div className="flex items-center justify-between gap-4 bg-muted/20 p-1 rounded-lg">
          <TabsList className="bg-transparent">
            <TabsTrigger value="list" className="data-[state=active]:bg-background shadow-sm">
              產品列表
            </TabsTrigger>
            <TabsTrigger value="variants" className="data-[state=active]:bg-background shadow-sm">
              全域變體總覽
            </TabsTrigger>
          </TabsList>

          <div className="relative flex-1 max-w-sm px-2">
            <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜尋名稱、SKU、品牌..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 bg-background"
            />
          </div>
        </div>

        {/* 產品列表頁簽 */}
        <TabsContent value="list" className="mt-4 outline-none">
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[150px]">SKU</TableHead>
                  <TableHead>名稱</TableHead>
                  <TableHead>廠牌/型號</TableHead>
                  <TableHead className="text-right">批發/零售價</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="w-12 text-center">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-8 mx-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredProducts?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      找不到符合條件的產品
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProducts?.map((product) => (
                    <TableRow key={product.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {product.sku}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {product.name}
                          {product.has_variants && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1">選項</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="text-muted-foreground">{product.brand || '-'}</span>
                        <span className="mx-1 text-slate-300">/</span>
                        <span className="text-slate-500">{product.model || '-'}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="text-sm font-semibold">${product.base_wholesale_price}</div>
                        <div className="text-[10px] text-muted-foreground">${product.base_retail_price}</div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`${STATUS_VARIANTS[product.status] || ''} border-none font-normal`}
                        >
                          {STATUS_LABELS[product.status] || product.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-32">
                            <DropdownMenuItem onClick={() => { setEditingProduct(product); setIsDialogOpen(true); }}>
                              <Pencil className="mr-2 h-4 w-4" /> 編輯詳情
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCopy(product)}>
                              <Copy className="mr-2 h-4 w-4" /> 複製產品
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteProduct(product)}>
                              <Trash2 className="mr-2 h-4 w-4" /> 刪除產品
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

        {/* 全域變體總覽 - 保留原本的 VariantManager 元件用於跨產品搜尋變體 */}
        <TabsContent value="variants" className="mt-4 outline-none">
          <VariantManager products={products || []} search={search} />
        </TabsContent>
      </Tabs>

      {/* 整合了「基本資訊」與「變體管理」標籤的統一對話框 */}
      <ProductFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleFormSubmit}
        initialData={editingProduct}
        isLoading={createMutation.isPending || updateMutation.isPending}
      />

      {/* 刪除確認彈窗 */}
      <AlertDialog open={!!deleteProduct} onOpenChange={() => setDeleteProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除產品嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              這將刪除「{deleteProduct?.name}」及其關聯的所有變體資料。此操作無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteProduct && deleteMutation.mutate(deleteProduct.id)}
            >
              確認刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProductBatchImport open={isImportOpen} onOpenChange={setIsImportOpen} />
    </div>
  );
}