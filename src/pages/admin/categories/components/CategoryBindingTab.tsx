import { useState, useMemo, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import {
  Search, Save, Upload, ChevronRight, Package, Layers,
  Loader2, Check, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { useCategoryBindings, ProductBinding, VariantBinding } from '../hooks/useCategoryBindings';
import { CategoryBindingImport } from './CategoryBindingImport';

// 分類綁定管理 Tab：依路徑管理分類綁定到產品/變體

export function CategoryBindingTab() {
  const {
    brands,
    brandSeries,
    products,
    isLoadingProducts,
    fetchVariants,
    updateProductBinding,
    updateVariantBinding,
    categories,
    categoryHierarchy,
  } = useCategoryBindings();

  // 路徑選擇狀態
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>('');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');

  // 篩選狀態
  const [search, setSearch] = useState('');

  // 變體資料
  const [variants, setVariants] = useState<VariantBinding[]>([]);
  const [isLoadingVariants, setIsLoadingVariants] = useState(false);

  // 匯入對話框
  const [isImportOpen, setIsImportOpen] = useState(false);

  // 當前選中的分類 IDs
  const [bindingCategoryIds, setBindingCategoryIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // 篩選後的品牌系列（如犀牛盾→CLEAR系列）
  const filteredSeries = useMemo(() => {
    if (!selectedBrandId) return [];
    return brandSeries.filter(s => s.brand_id === selectedBrandId);
  }, [brandSeries, selectedBrandId]);

  // 篩選後的產品（依品牌、搜尋）
  const filteredProducts = useMemo(() => {
    let result = products;

    if (selectedBrandId) {
      result = result.filter(p => p.brand_id === selectedBrandId);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(p =>
        p.product_name.toLowerCase().includes(searchLower) ||
        p.product_sku.toLowerCase().includes(searchLower)
      );
    }

    return result;
  }, [products, selectedBrandId, search]);

  // 當選擇產品時，載入變體
  const handleProductSelect = useCallback(async (productId: string) => {
    setSelectedProductId(productId);
    setSelectedVariantId('');

    const product = products.find(p => p.product_id === productId);
    if (product && product.has_variants) {
      setIsLoadingVariants(true);
      try {
        const v = await fetchVariants(productId);
        setVariants(v);
      } catch (err) {
        toast.error('載入變體失敗');
      } finally {
        setIsLoadingVariants(false);
      }
    } else {
      setVariants([]);
    }
  }, [products, fetchVariants]);

  // 當選擇實體時，載入其分類綁定
  useEffect(() => {
    if (selectedVariantId) {
      const variant = variants.find(v => v.variant_id === selectedVariantId);
      setBindingCategoryIds(variant?.category_ids || []);
    } else if (selectedProductId) {
      const product = products.find(p => p.product_id === selectedProductId);
      setBindingCategoryIds(product?.category_ids || []);
    } else {
      setBindingCategoryIds([]);
    }
  }, [selectedProductId, selectedVariantId, products, variants]);

  // 切換分類選擇
  const toggleCategory = useCallback((categoryId: string) => {
    setBindingCategoryIds(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(id => id !== categoryId);
      }
      return [...prev, categoryId];
    });
  }, []);

  // 選擇分類（含祖先自動選取）
  const selectCategoryWithAncestors = useCallback((categoryId: string) => {
    const ancestors = getAncestors(categoryId, categoryHierarchy);
    setBindingCategoryIds(prev => {
      const newIds = new Set(prev);
      newIds.add(categoryId);
      ancestors.forEach(id => newIds.add(id));
      return Array.from(newIds);
    });
  }, [categoryHierarchy]);

  // 取消選擇分類（含子孫自動取消）
  const deselectCategoryWithDescendants = useCallback((categoryId: string) => {
    const descendants = getDescendants(categoryId, categoryHierarchy);
    setBindingCategoryIds(prev => {
      const newIds = new Set(prev);
      newIds.delete(categoryId);
      descendants.forEach(id => newIds.delete(id));
      // 也移除沒有子孫選中的祖先
      return Array.from(newIds);
    });
  }, [categoryHierarchy]);

  // 儲存綁定
  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (selectedVariantId) {
        await updateVariantBinding.mutateAsync({
          variantId: selectedVariantId,
          categoryIds: bindingCategoryIds,
        });
      } else if (selectedProductId) {
        await updateProductBinding.mutateAsync({
          productId: selectedProductId,
          categoryIds: bindingCategoryIds,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  // 建立分類樹
  const categoryTree = useMemo(() => {
    return buildCategoryTree(categories, categoryHierarchy);
  }, [categories, categoryHierarchy]);

  // 取得當前路徑文字
  const getPathText = () => {
    const parts: string[] = [];
    if (selectedBrandId) {
      const brand = brands.find(b => b.id === selectedBrandId);
      if (brand) parts.push(brand.name);
    }
    if (selectedSeriesId) {
      const series = brandSeries.find(s => s.id === selectedSeriesId);
      if (series) parts.push(series.name);
    }
    if (selectedProductId) {
      const product = products.find(p => p.product_id === selectedProductId);
      if (product) parts.push(product.product_name);
    }
    if (selectedVariantId) {
      const variant = variants.find(v => v.variant_id === selectedVariantId);
      if (variant) parts.push(variant.variant_name);
    }
    return parts.join(' › ') || '尚未選擇';
  };

  const hasChanges = selectedProductId && (
    JSON.stringify(bindingCategoryIds.sort()) !== JSON.stringify(
      (selectedVariantId
        ? variants.find(v => v.variant_id === selectedVariantId)?.category_ids
        : products.find(p => p.product_id === selectedProductId)?.category_ids
      )?.sort() || []
    )
  );

  return (
    <div className="space-y-6">
      {/* 標題列 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">分類綁定管理</h2>
          <p className="text-muted-foreground text-sm">
            依路徑管理產品或變體的分類綁定，支援批次匯入
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsImportOpen(true)} className="shadow-sm">
            <Upload className="mr-2 h-4 w-4" /> 批次匯入
          </Button>
        </div>
      </div>

      {/* 路徑選擇器 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-4 w-4" />
            路徑選擇
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {/* 品牌選擇 */}
            <Select value={selectedBrandId} onValueChange={(v) => {
              setSelectedBrandId(v);
              setSelectedSeriesId('');
              setSelectedProductId('');
              setSelectedVariantId('');
            }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="選擇品牌" />
              </SelectTrigger>
              <SelectContent>
                {brands.map((brand: any) => (
                  <SelectItem key={brand.id} value={brand.id}>
                    {brand.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <ChevronRight className="h-4 w-4 text-muted-foreground" />

            {/* 系列選擇（品牌系列，如犀牛盾→CLEAR） */}
            {filteredSeries.length > 0 && (
              <>
                <Select value={selectedSeriesId} onValueChange={(v) => {
                  setSelectedSeriesId(v);
                  setSelectedProductId('');
                  setSelectedVariantId('');
                }}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="選擇系列" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSeries.map((series) => (
                      <SelectItem key={series.id} value={series.id}>
                        {series.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </>
            )}

            {/* 搜尋產品 */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜尋產品名稱或 SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* 當前路徑 */}
          <div className="mt-3 text-sm text-muted-foreground">
            當前路徑：<span className="font-medium text-foreground">{getPathText()}</span>
          </div>
        </CardContent>
      </Card>

      {/* 主要內容區 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左側：產品/變體列表 */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                {selectedBrandId ? '產品列表' : '請先選擇品牌'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {isLoadingProducts ? (
                  <div className="flex justify-center p-8">
                    <Loader2 className="animate-spin h-6 w-6 opacity-20" />
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center p-8 text-muted-foreground text-sm">
                    {selectedBrandId ? '此品牌下無產品' : '請先選擇品牌以查看產品'}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredProducts.map((product) => (
                      <div key={product.product_id}>
                        <button
                          className={`w-full text-left p-2 rounded-lg text-sm transition-colors ${
                            selectedProductId === product.product_id
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted/50'
                          }`}
                          onClick={() => handleProductSelect(product.product_id)}
                        >
                          <div className="font-medium truncate">{product.product_name}</div>
                          <div className="text-xs text-muted-foreground">{product.product_sku}</div>
                          <div className="flex items-center gap-2 mt-1">
                            {product.has_variants && (
                              <Badge variant="secondary" className="text-[10px]">
                                {product.variant_count} 變體
                              </Badge>
                            )}
                            {product.category_ids.length > 0 && (
                              <Badge variant="outline" className="text-[10px]">
                                {product.category_ids.length} 分類
                              </Badge>
                            )}
                          </div>
                        </button>

                        {/* 變體列表（展開） */}
                        {selectedProductId === product.product_id && product.has_variants && (
                          <div className="ml-4 mt-1 space-y-1">
                            {isLoadingVariants ? (
                              <div className="flex justify-center p-4">
                                <Loader2 className="animate-spin h-4 w-4 opacity-20" />
                              </div>
                            ) : variants.map((variant) => (
                              <button
                                key={variant.variant_id}
                                className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${
                                  selectedVariantId === variant.variant_id
                                    ? 'bg-primary/10 text-primary'
                                    : 'hover:bg-muted/50'
                                }`}
                                onClick={() => setSelectedVariantId(variant.variant_id)}
                              >
                                <div className="font-medium truncate">{variant.variant_name}</div>
                                <div className="text-muted-foreground">{variant.variant_sku}</div>
                                {variant.category_ids.length > 0 && (
                                  <Badge variant="outline" className="text-[10px] mt-1">
                                    {variant.category_ids.length} 分類
                                  </Badge>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* 右側：分類選擇 */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  分類綁定
                  {selectedVariantId && (
                    <Badge variant="secondary" className="ml-2">變體層級</Badge>
                  )}
                  {selectedProductId && !selectedVariantId && (
                    <Badge variant="outline" className="ml-2">產品層級</Badge>
                  )}
                </CardTitle>
                {selectedProductId && (
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    className="shadow-sm"
                  >
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    儲存
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedProductId ? (
                <div className="text-center p-12 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>請從左側選擇產品</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-1">
                    {categoryTree.map((node) => (
                      <CategoryTreeNode
                        key={node.id}
                        node={node}
                        selectedIds={bindingCategoryIds}
                        onToggle={(id) => {
                          if (bindingCategoryIds.includes(id)) {
                            deselectCategoryWithDescendants(id);
                          } else {
                            selectCategoryWithAncestors(id);
                          }
                        }}
                        level={0}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 匯入對話框 */}
      <CategoryBindingImport
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        brands={brands}
        products={products}
        categories={categories}
        categoryHierarchy={categoryHierarchy}
      />
    </div>
  );
}

// 分類樹節點元件
interface CategoryTreeNodeProps {
  node: CategoryTreeNode;
  selectedIds: string[];
  onToggle: (id: string) => void;
  level: number;
}

function CategoryTreeNode({ node, selectedIds, onToggle, level }: CategoryTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level < 1);
  const isSelected = selectedIds.includes(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-2 p-2 rounded-lg text-sm transition-colors ${
          isSelected ? 'bg-primary/10' : 'hover:bg-muted/50'
        }`}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggle(node.id)}
        />
        {hasChildren && (
          <button
            className="h-4 w-4 flex items-center justify-center"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            />
          </button>
        )}
        {!hasChildren && <div className="w-4" />}
        <span className="flex-1">{node.name}</span>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <CategoryTreeNode
              key={child.id}
              node={child}
              selectedIds={selectedIds}
              onToggle={onToggle}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 類型定義
interface CategoryTreeNode {
  id: string;
  name: string;
  children: CategoryTreeNode[];
}

// 建立分類樹
function buildCategoryTree(
  categories: any[],
  hierarchy: any[]
): CategoryTreeNode[] {
  const childToParent = new Map<string, string[]>();
  hierarchy.forEach(h => {
    if (!childToParent.has(h.child_id)) {
      childToParent.set(h.child_id, []);
    }
    childToParent.get(h.child_id)!.push(h.parent_id);
  });

  const rootCategories = categories.filter(c => !childToParent.has(c.id));
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  function buildNode(categoryId: string): CategoryTreeNode {
    const cat = categoryMap.get(categoryId)!;
    const children = categories
      .filter(c => {
        const parents = childToParent.get(c.id);
        return parents?.includes(categoryId);
      })
      .map(c => buildNode(c.id));

    return {
      id: cat.id,
      name: cat.name,
      children,
    };
  }

  return rootCategories.map(c => buildNode(c.id));
}

// 取得祖先節點
function getAncestors(categoryId: string, hierarchy: any[]): string[] {
  const ancestors: string[] = [];
  const childToParent = new Map<string, string[]>();
  hierarchy.forEach(h => {
    if (!childToParent.has(h.child_id)) {
      childToParent.set(h.child_id, []);
    }
    childToParent.get(h.child_id)!.push(h.parent_id);
  });

  let currentId: string | null = categoryId;
  while (currentId) {
    const parents = childToParent.get(currentId);
    if (parents && parents.length > 0) {
      ancestors.push(parents[0]);
      currentId = parents[0];
    } else {
      currentId = null;
    }
  }

  return ancestors;
}

// 取得子孫節點
function getDescendants(categoryId: string, hierarchy: any[]): string[] {
  const descendants: string[] = [];
  const parentToChildren = new Map<string, string[]>();
  hierarchy.forEach(h => {
    if (!parentToChildren.has(h.parent_id)) {
      parentToChildren.set(h.parent_id, []);
    }
    parentToChildren.get(h.parent_id)!.push(h.child_id);
  });

  function traverse(parentId: string) {
    const children = parentToChildren.get(parentId) || [];
    children.forEach(childId => {
      descendants.push(childId);
      traverse(childId);
    });
  }

  traverse(categoryId);
  return descendants;
}


