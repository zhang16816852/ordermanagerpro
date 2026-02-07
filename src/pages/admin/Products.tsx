import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Download, Layers } from 'lucide-react';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import { Plus, Search, RefreshCw, Upload, MoreHorizontal, Pencil, Copy, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductCache } from '@/hooks/useProductCache';
import { UnifiedProductImport } from '@/components/products/UnifiedProductImport';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VariantManager } from '@/components/products/VariantManager';
import { ProductFormDialog } from '@/components/ProductFormDialog/ProductFormDialog';
import { Checkbox } from '@/components/ui/checkbox';
import Papa from 'papaparse';

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
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

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

  const updateVariantPriceMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string, wholesale_price?: number, retail_price?: number, status?: 'active' | 'discontinued' | 'preorder' | 'sold_out' }) => {
      const { error } = await supabase.from('product_variants').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-product-variants'] });
      toast.success('變體已更新');
    },
    onError: (error: any) => toast.error(`更新失敗：${error.message}`),
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
      // 呼叫 Supabase RPC - 使用 any 繞過類型檢查（RPC 函數存在但類型未同步）
      const { data: newProductId, error } = await (supabase.rpc as any)(
        'duplicate_product_with_variants',
        {
          target_product_id: product.id,
          new_name: newName,
          new_sku: newSku,
        }
      );

      if (error) throw error;

      // 重新整理列表
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      toast.success('產品及其變體已完整複製');

      // 選取新產品並打開 Dialog 讓使用者編輯
      if (newProductId) {
        const { data: newProduct } = await supabase
          .from('products')
          .select('*')
          .eq('id', newProductId)
          .single();

        if (newProduct) {
          setEditingProduct(newProduct);
          setIsDialogOpen(true);
        }
      }

    } catch (error: any) {
      console.error('Copy Error:', error);
      toast.error(`複製失敗：${error.message}`);
    }
  };
  // 取得所有變體
  const { data: allVariants = [], isLoading: variantsLoading } = useQuery({
    queryKey: ['all-product-variants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_variants')
        .select('*')
        .order('sku');
      if (error) throw error;
      return data || [];
    },
  });

  // 取得產品的變體
  const getProductVariants = (productId: string) => {
    return allVariants.filter(v => v.product_id === productId);
  };

  const filteredProducts = products?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(search.toLowerCase())) ||
      (p.model && p.model.toLowerCase().includes(search.toLowerCase()))
  );

  const isAllSelected = filteredProducts && filteredProducts.length > 0 &&
    filteredProducts.every(p => selectedProductIds.has(p.id));

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = filteredProducts?.map(p => p.id) || [];
      setSelectedProductIds(prev => {
        const next = new Set(prev);
        allIds.forEach(id => next.add(id));
        return next;
      });
    } else {
      setSelectedProductIds(prev => {
        const next = new Set(prev);
        filteredProducts?.forEach(p => next.delete(p.id));
        return next;
      });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchExport = () => {
    const selected = products?.filter(p => selectedProductIds.has(p.id)) || [];
    const exportData: any[] = [];

    selected.forEach(p => {
      const variants = getProductVariants(p.id);

      if (variants.length > 0) {
        variants.forEach(v => {
          exportData.push({
            product_sku: p.sku,
            product_name: p.name,
            description: p.description || '',
            category: p.category || '',
            brand: p.brand || '',
            model: p.model || '',
            series: p.series || '',
            base_wholesale_price: p.base_wholesale_price,
            base_retail_price: p.base_retail_price,
            product_status: p.status,

            variant_sku: v.sku,
            variant_name: v.name,
            option_1: v.option_1 || '',
            option_2: v.option_2 || '',
            option_3: v.option_3 || '',
            variant_wholesale_price: v.wholesale_price,
            variant_retail_price: v.retail_price,
            variant_status: v.status,

            barcode: `'${v.barcode}` || '',
          });
        });
      } else {
        exportData.push({
          product_sku: p.sku,
          product_name: p.name,
          description: p.description || '',
          category: p.category || '',
          brand: p.brand || '',
          base_wholesale_price: p.base_wholesale_price,
          base_retail_price: p.base_retail_price,
          product_status: p.status,

          variant_sku: '',
          variant_name: '',
          option_1: '',
          option_2: '',
          option_3: '',
          variant_wholesale_price: '',
          variant_retail_price: '',
          variant_status: '',
          barcode: '',
        });
      }
    });

    const csv = Papa.unparse(exportData);

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `products_export_${new Date().toISOString().slice(0, 10)}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


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
          {selectedProductIds.size > 0 ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setSelectedProductIds(new Set())}>
                取消全選 ({selectedProductIds.size})
              </Button>
              <Button variant="outline" size="sm" onClick={handleBatchExport}>
                <Download className="mr-2 h-4 w-4" />
                匯出 CSV
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={forceRefresh}>
                <RefreshCw className="mr-2 h-4 w-4" />
                重新整理
              </Button>
              <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                批次匯入
              </Button>
            </>
          )}
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
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={!!isAllSelected}
                      onCheckedChange={(checked) => toggleSelectAll(!!checked)}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead className="w-[150px]">SKU</TableHead>
                  <TableHead>名稱</TableHead>
                  <TableHead>類別</TableHead>
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
                  filteredProducts?.map((product) => {
                    const variants = getProductVariants(product.id);
                    const hasVariants = product.has_variants && variants.length > 0;
                    const isExpanded = expandedProducts.has(product.id);

                    return (
                      <Collapsible key={product.id} open={isExpanded} onOpenChange={() => toggleExpanded(product.id)} asChild>
                        <>
                          <TableRow className={`hover:bg-muted/30 transition-colors ${selectedProductIds.has(product.id) ? 'bg-muted/50' : ''}`}>
                            <TableCell className="w-[40px]">
                              <Checkbox
                                checked={selectedProductIds.has(product.id)}
                                onCheckedChange={() => toggleSelect(product.id)}
                                aria-label="Select row"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell>
                              {hasVariants && (
                                <CollapsibleTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                  </Button>
                                </CollapsibleTrigger>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {product.sku}
                            </TableCell>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                {product.name}
                                {hasVariants && (
                                  <Badge variant="outline" className="ml-2 text-xs">
                                    <Layers className="h-3 w-3 mr-1" />
                                    {variants.length} 變體
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{product.category || '-'}</TableCell>
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

                          {hasVariants && (
                            <CollapsibleContent asChild>
                              <TableRow className="bg-muted/10 hover:bg-muted/20 border-t-0 shadow-inner">
                                <TableCell colSpan={9} className="p-0">
                                  <div className="py-2 px-4 pl-14">
                                    <Table>
                                      <TableHeader className="bg-transparent border-b">
                                        <TableRow className="hover:bg-transparent border-none">
                                          <TableHead className="h-8 text-xs">變體 SKU</TableHead>
                                          <TableHead className="h-8 text-xs">變體名稱</TableHead>
                                          <TableHead className="h-8 text-xs">規格</TableHead>
                                          <TableHead className="h-8 text-xs text-right">狀態</TableHead>
                                          <TableHead className="h-8 text-xs text-right">批發價</TableHead>
                                          <TableHead className="h-8 text-xs text-right">零售價</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {variants.map((v) => (
                                          <TableRow key={v.id} className="hover:bg-background border-none">
                                            <TableCell className="py-1 font-mono text-xs">{v.sku}</TableCell>
                                            <TableCell className="py-1 text-sm font-medium">{v.name}</TableCell>
                                            <TableCell className="py-1 text-xs text-muted-foreground">
                                              {[v.option_1, v.option_2, v.option_3].filter(Boolean).join(' / ')}
                                            </TableCell>
                                            <TableCell className="py-1 text-right">
                                              <Badge variant="outline" className={`text-[10px] ${STATUS_VARIANTS[v.status] || ''}`}>
                                                {STATUS_LABELS[v.status]}
                                              </Badge>
                                            </TableCell>
                                            <TableCell className="py-1 text-right">
                                              <Input
                                                key={`${v.id}-wholesale-${v.wholesale_price}`}
                                                className="h-7 w-20 text-right text-xs ml-auto"
                                                defaultValue={v.wholesale_price}
                                                onBlur={(e) => {
                                                  const val = parseFloat(e.target.value);
                                                  if (!isNaN(val) && val !== v.wholesale_price) {
                                                    updateVariantPriceMutation.mutate({ id: v.id, wholesale_price: val });
                                                  }
                                                }}
                                              />
                                            </TableCell>
                                            <TableCell className="py-1 text-right">
                                              <Input
                                                key={`${v.id}-retail-${v.retail_price}`}
                                                className="h-7 w-20 text-right text-xs ml-auto"
                                                defaultValue={v.retail_price}
                                                onBlur={(e) => {
                                                  const val = parseFloat(e.target.value);
                                                  if (!isNaN(val) && val !== v.retail_price) {
                                                    updateVariantPriceMutation.mutate({ id: v.id, retail_price: val });
                                                  }
                                                }}
                                              />
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </TableCell>
                              </TableRow>
                            </CollapsibleContent>
                          )}
                        </>
                      </Collapsible>
                    );
                  })
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

      <UnifiedProductImport open={isImportOpen} onOpenChange={setIsImportOpen} />
    </div>
  );
}