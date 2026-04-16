import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, RefreshCw, Upload, Download } from 'lucide-react';
import { VariantManager } from '@/components/products/VariantManager';

import { useProductsList } from './hooks/useProductsList';
import { ProductsTable } from './components/ProductsTable';
import { ProductDialogs } from './components/ProductDialogs';
import { DeviceModelManager } from './components/DeviceModelManager';

export default function AdminProducts() {
    const {
        products, isLoading, version, forceRefresh,
        brandMap,
        search, setSearch, activeTab, setActiveTab,
        selectedProductIds, toggleSelect, toggleSelectAll, isAllSelected,
        expandedProducts, toggleExpanded, filteredProducts,
        isDialogOpen, setIsDialogOpen, isImportOpen, setIsImportOpen,
        editingProduct, setEditingProduct, deleteProduct, setDeleteProduct,
        handleCopy, handleBatchExport, getProductVariants, getProductModels,
        createMutation, updateMutation, deleteMutation, updateVariantPriceMutation
    } = useProductsList();

    const isMutationLoading = createMutation.isPending || updateMutation.isPending;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">產品管理</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        管理產品基本資訊與變體
                        <span className="ml-2 text-[10px] opacity-40">版本: {version}</span>
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {selectedProductIds.size > 0 ? (
                        <div className="flex items-center gap-2 bg-primary/5 p-1 rounded-lg border border-primary/10">
                            <Button variant="ghost" size="sm" onClick={() => toggleSelectAll(false)} className="text-xs h-8">
                                取消選取 ({selectedProductIds.size})
                            </Button>
                            <Button variant="default" size="sm" onClick={handleBatchExport} className="h-8 shadow-sm">
                                <Download className="mr-2 h-4 w-4" />
                                匯出格式匯出
                            </Button>
                        </div>
                    ) : (
                        <>
                            <Button variant="outline" size="sm" onClick={forceRefresh} className="h-9">
                                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                                重新整理
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setIsImportOpen(true)} className="h-9">
                                <Upload className="mr-2 h-4 w-4" />
                                批次匯入
                            </Button>
                        </>
                    )}
                    <Button size="sm" onClick={() => { setEditingProduct(null); setIsDialogOpen(true); }} className="h-9 shadow-md">
                        <Plus className="mr-2 h-4 w-4" />
                        新增產品
                    </Button>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'variants' | 'models')}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/20 p-1.5 rounded-xl border border-muted-foreground/10">
                    <TabsList className="bg-transparent h-9 flex-wrap">
                        <TabsTrigger value="list" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4">
                            產品列表
                        </TabsTrigger>
                        <TabsTrigger value="variants" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4">
                            全域變體總覽
                        </TabsTrigger>
                        <TabsTrigger value="models" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4">
                            型號標籤庫
                        </TabsTrigger>
                    </TabsList>

                    <div className="relative w-full md:w-80">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" />
                        <Input
                            placeholder="搜尋名稱、SKU、品牌..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 bg-background border-none shadow-inner h-9 rounded-lg"
                        />
                    </div>
                </div>

                <TabsContent value="list" className="mt-6 outline-none">
                    <ProductsTable
                        products={filteredProducts}
                        isLoading={isLoading}
                        brandMap={brandMap}
                        selectedIds={selectedProductIds}
                        isAllSelected={isAllSelected || false}
                        expandedIds={expandedProducts}
                        onToggleSelectAll={(checked) => toggleSelectAll(checked)}
                        onToggleSelect={toggleSelect}
                        onToggleExpand={toggleExpanded}
                        getVariants={getProductVariants}
                        getModels={getProductModels}
                        onEdit={(p) => { setEditingProduct(p); setIsDialogOpen(true); }}
                        onCopy={handleCopy}
                        onDelete={setDeleteProduct}
                        onUpdateVariant={(id, updates) => updateVariantPriceMutation.mutate({ id, ...updates })}
                    />
                </TabsContent>


                <TabsContent value="variants" className="mt-6 outline-none">
                    <div className="rounded-xl border bg-card shadow-sm p-1">
                        <VariantManager products={products || []} search={search} />
                    </div>
                </TabsContent>

                <TabsContent value="models" className="mt-6 outline-none">
                    <div className="rounded-xl border bg-card shadow-sm p-4">
                        <DeviceModelManager />
                    </div>
                </TabsContent>
            </Tabs>

            <ProductDialogs
                isDialogOpen={isDialogOpen}
                setIsDialogOpen={setIsDialogOpen}
                isImportOpen={isImportOpen}
                setIsImportOpen={setIsImportOpen}
                editingProduct={editingProduct}
                deleteProduct={deleteProduct}
                setDeleteProduct={setDeleteProduct}
                onFormSubmit={(values) => {
                    if (editingProduct?.id) updateMutation.mutate({ id: editingProduct.id, values });
                    else createMutation.mutate(values);
                }}
                onDeleteConfirm={(id) => deleteMutation.mutate(id)}
                isMutationLoading={isMutationLoading}
            />
        </div>
    );
}
