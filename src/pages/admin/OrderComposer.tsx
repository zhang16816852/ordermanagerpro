import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import { useStoreProductCache } from "@/hooks/useProductCache";
import { useStoreDraft } from "@/store/useOrderDraftStore";
import { useDeviceModelStore } from "@/store/useDeviceModelStore";
import { ProductWithPricing, Category } from "@/types/product";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StorePicker } from "@/components/ui/StorePicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { Send, ShoppingCart, Filter, Copy, Check } from "lucide-react";
import ProductCatalog from "@/components/products/catalog/ProductCatalog";
import CartPanel from "@/components/order/CartPanel";
import { CatalogSidebar } from "@/components/products/catalog/CatalogSidebar";

export default function AdminOrderComposer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [createdOrder, setCreatedOrder] = useState<{ id: string; code?: string | null; access_token: string } | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const { data: stores = [], isLoading: storesLoading } = useQuery({
    queryKey: ["admin-stores-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id, name, code")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { products: storefrontItems, isLoading: productsLoading } = useStoreProductCache(selectedStoreId || null);
  const { totalItems } = useStoreDraft(selectedStoreId || "");
  const { fetchData: fetchDeviceData } = useDeviceModelStore();

  const [viewMode, setViewMode] = useState<"products" | "variants" | "gallery" | "table">("products");
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get("search") || "";
  const categoryNameInUrl = searchParams.get("category");
  const selectedBrands = searchParams.get("brands")?.split(",").filter(Boolean) || [];

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) return [];
      return data as Category[];
    },
  });

  const selectedCategory = useMemo(() => {
    if (!categoryNameInUrl || categories.length === 0) return null;
    return categories.find((c) => c.name === categoryNameInUrl)?.id || null;
  }, [categoryNameInUrl, categories]);

  const selectedSpecs = useMemo(() => {
    try {
      const s = searchParams.get("specs");
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  }, [searchParams]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([key, value]) => {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        });
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const handleSearchChange = (val: string) => updateParams({ search: val });

  const setSelectedCategory = (id: string | null) => {
    const cat = categories.find((c) => c.id === id);
    updateParams({ category: cat ? cat.name : null, specs: null });
  };

  const setSelectedBrands = (val: string[]) => updateParams({ brands: val.join(",") });

  const handleSpecChange = useCallback(
    (key: string, values: string[]) => {
      const nextSpecs = { ...selectedSpecs };
      if (values.length === 0) delete nextSpecs[key];
      else nextSpecs[key] = values;
      updateParams({
        specs: Object.keys(nextSpecs).length > 0 ? JSON.stringify(nextSpecs) : null,
      });
    },
    [selectedSpecs, updateParams]
  );

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    fetchDeviceData();
  }, [fetchDeviceData]);

  const products = useMemo(() => {
    return (storefrontItems || []).map((item) => ({
      ...item,
      device_model_name: (item.effective_model_names || [])[0] || "",
      physical_product_id: item.id,
      physical_variant_id: undefined,
    }));
  }, [storefrontItems]) as unknown as ProductWithPricing[];

  const { createOrder, isPending, items, notes, totalAmount, updateNotes } = useCreateOrder({
    storeId: selectedStoreId,
    userId: user?.id ?? "",
    sourceType: "admin_proxy",
    queryKeyToInvalidate: ["admin-orders"],
    onSuccess: (data) => {
      setCreatedOrder({ id: data.id, code: data.code, access_token: data.access_token });
    },
  });

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId);
  };

  const getShareLink = () => {
    if (!createdOrder) return "";
    return `${window.location.origin}/share/order/${createdOrder.code || createdOrder.id}?token=${createdOrder.access_token}`;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(getShareLink());
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    toast.success("連結已複製");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">代訂訂單</h1>
        <p className="text-muted-foreground">為店鋪建立訂單</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>選擇店鋪</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm">
            <Label>店鋪</Label>
            <StorePicker
              stores={stores}
              value={selectedStoreId}
              onChange={(v) => handleStoreChange(v as string)}
              valueField="id"
              placeholder="請選擇店鋪"
              searchPlaceholder="搜尋店鋪..."
            />
          </div>
        </CardContent>
      </Card>

      {selectedStoreId ? (
        <div className="flex flex-col md:flex-row gap-6">
          <aside className="hidden md:block w-64 flex-shrink-0">
            <CatalogSidebar
              products={products}
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              selectedSpecs={selectedSpecs}
              onSpecChange={handleSpecChange}
              selectedBrands={selectedBrands}
              onBrandChange={setSelectedBrands}
              onClearFilters={clearFilters}
            />
          </aside>

          <div className="flex-1 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">商品目錄</h1>
                <p className="text-muted-foreground text-sm">選擇想訂購的商品，加入購物車後去結帳</p>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="md:hidden">
                      <Filter className="h-4 w-4 mr-2" />
                      篩選
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="p-0 w-72">
                    <CatalogSidebar
                      products={products}
                      selectedCategory={selectedCategory}
                      onCategoryChange={setSelectedCategory}
                      selectedSpecs={selectedSpecs}
                      onSpecChange={handleSpecChange}
                      selectedBrands={selectedBrands}
                      onBrandChange={setSelectedBrands}
                      onClearFilters={clearFilters}
                    />
                  </SheetContent>
                </Sheet>

                <div className="flex bg-muted p-1 rounded-lg">
                  <button
                    onClick={() => setViewMode("products")}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      viewMode === "products"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    產品
                  </button>
                  <button
                    onClick={() => setViewMode("variants")}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      viewMode === "variants"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    單品
                  </button>
                  <button
                    onClick={() => setViewMode("gallery")}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      viewMode === "gallery"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    圖卡
                  </button>
                  <button
                    onClick={() => setViewMode("table")}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                      viewMode === "table"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    表格
                  </button>
                </div>

                <Sheet>
                  <SheetTrigger asChild>
                    <Button className="relative h-9">
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      購物車
                      {totalItems > 0 && (
                        <Badge
                          variant="destructive"
                          className="ml-2 -mr-1 h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]"
                        >
                          {totalItems}
                        </Badge>
                      )}
                    </Button>
                  </SheetTrigger>
                  <SheetContent
                    side="right"
                    className="w-full sm:max-w-[500px] p-0 h-full flex flex-col"
                  >
                    <CartPanel storeId={selectedStoreId} showCheckoutButton={false} />
                    {items.length > 0 && (
                      <div className="p-4 border-t space-y-4">
                        <Textarea
                          placeholder="訂單備註..."
                          value={notes}
                          onChange={(e) => updateNotes(e.target.value)}
                          rows={3}
                        />
                        <div className="flex justify-between text-lg font-semibold">
                          <span>總計</span>
                          <span>${totalAmount.toLocaleString()}</span>
                        </div>
                        <Button
                          size="lg"
                          className="w-full"
                          onClick={() => createOrder()}
                          disabled={isPending}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          {isPending ? "處理中..." : "送出訂單"}
                        </Button>
                      </div>
                    )}
                  </SheetContent>
                </Sheet>
              </div>
            </div>

            <ProductCatalog
              products={products}
              isLoading={productsLoading}
              storeId={selectedStoreId}
              viewMode={viewMode}
              search={search}
              onSearchChange={handleSearchChange}
              categoryFilter={selectedCategory}
              specFilters={selectedSpecs}
              brandFilter={selectedBrands}
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          請先選擇店鋪以開始建立訂單
        </div>
      )}

      <Dialog open={!!createdOrder} onOpenChange={(open) => !open && navigate("/admin/orders")}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>訂單建立成功</DialogTitle>
            <DialogDescription>
              您可以複製以下連結並傳送給客戶，以便他們查看訂單詳情。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2">
            <Input value={getShareLink()} readOnly />
            <Button size="icon" variant="outline" onClick={copyToClipboard}>
              {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => navigate("/admin/orders")}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
