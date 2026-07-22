import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, RefreshCw, Upload, Download, Table2, ShoppingCart } from 'lucide-react';
import { VariantManager } from '@/components/products/VariantManager';
import { toast } from 'sonner';

import { useProductsList } from './hooks/useProductsList';
import { ProductsTable } from './components/ProductsTable';
import { ProductDialogs } from './components/ProductDialogs';
import { ColorManager } from '../libraries/colors/ColorManager';
import { CatalogSidebar } from '@/components/products/catalog/CatalogSidebar';
import { ProductWithPricing } from '@/types/product';
import { OrderGridTemplateFormDialog } from '@/components/order-grid/OrderGridTemplateFormDialog';
import { useTableTemplates } from '@/hooks/useTableTemplates';
import type { DimensionConfig } from '@/types/order-grid';

export default function AdminProducts() {
    const {
        products, isLoading, version, forceRefresh,
        brandMap,
        search, setSearch, activeTab, setActiveTab,
        selectedProductIds, toggleSelect, toggleSelectAll, isAllSelected,
        expandedProducts, toggleExpanded, filteredProducts,
        isDialogOpen, setIsDialogOpen, isImportOpen, setIsImportOpen,
        editingProduct, setEditingProduct, deleteProduct, setDeleteProduct,
        handleCopy, handleBatchExport, handleImportSuccess, getProductVariants, getProductModels, getProductModelGroups,
        createMutation, updateMutation, deleteMutation, updateVariantPriceMutation,
        selectedCategory, setSelectedCategory,
        selectedSpecs, setSelectedSpecs,
        selectedBrands, setSelectedBrands,
        selectedSeries, setSelectedSeries,
        selectedDeviceModels, setSelectedDeviceModels,
        clearFilters
    } = useProductsList();

    const isMutationLoading = createMutation.isPending || updateMutation.isPending;
    const { createTemplate } = useTableTemplates();
    const [quickCreateOpen, setQuickCreateOpen] = useState(false);
    const [isSelectionOpen, setIsSelectionOpen] = useState(false);
    const [quickCreateSaving, setQuickCreateSaving] = useState(false);

    const handleQuickCreateSave = async (data: {
        name: string;
        description?: string;
        row_config: DimensionConfig;
        col_config: DimensionConfig;
        tab_config?: DimensionConfig | null;
        variant_ids: string[];
    }) => {
        setQuickCreateSaving(true);
        try {
            createTemplate(data);
            setQuickCreateOpen(false);
            toast.success(`範本「${data.name}」已建立`);
        } finally {
            setQuickCreateSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="sticky top-0 z-20 bg-background pb-3 md:pb-0 md:relative md:z-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-3 md:pt-0">
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
                                    匯出產品
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
                        <Button variant="outline" size="sm" onClick={() => setQuickCreateOpen(true)} className="h-9">
                            <Table2 className="mr-2 h-4 w-4" />
                            建立表格
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setIsSelectionOpen(true)} className="h-9">
                            <ShoppingCart className="mr-2 h-4 w-4" />
                            選取產品
                        </Button>
                        <Button size="sm" onClick={() => { setEditingProduct(null); setIsDialogOpen(true); }} className="h-9 shadow-md">
                            <Plus className="mr-2 h-4 w-4" />
                            新增產品
                        </Button>
                    </div>
                </div>
                <div className="relative w-full mt-3 md:hidden">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="在目前的篩選結果中搜尋..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 bg-background border-none shadow-inner h-10 rounded-lg"
                    />
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'list' | 'variants' | 'colors')}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/20 p-1.5 rounded-xl border border-muted-foreground/10">
                    <TabsList className="bg-transparent h-9 flex-wrap">
                        <TabsTrigger value="list" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4">
                            產品列表
                        </TabsTrigger>
                        <TabsTrigger value="variants" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4">
                            全域變體總覽
                        </TabsTrigger>
                        <TabsTrigger value="colors" className="data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4">
                            顏色對照表
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="list" className="mt-6 outline-none">
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        <div className="lg:col-span-1">
                            <CatalogSidebar
                                products={(products || []) as any}
                                selectedCategory={selectedCategory}
                                onCategoryChange={setSelectedCategory}
                                selectedSpecs={selectedSpecs}
                                onSpecChange={(key, values) => setSelectedSpecs({ ...selectedSpecs, [key]: values })}
                                selectedBrands={selectedBrands}
                                onBrandChange={setSelectedBrands}
                                selectedSeries={selectedSeries}
                                onSeriesChange={setSelectedSeries}
                                selectedDeviceModels={selectedDeviceModels}
                                onDeviceModelChange={setSelectedDeviceModels}
                                onClearFilters={clearFilters}
                            />
                        </div>
                        <div className="lg:col-span-3 space-y-4">
                            <div className="relative w-full hidden md:block">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground opacity-50" />
                                <Input
                                    placeholder="在目前的篩選結果中搜尋..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-9 bg-background border-none shadow-inner h-10 rounded-lg"
                                />
                            </div>
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
                                getModelGroups={getProductModelGroups}
                                onEdit={(p) => { setEditingProduct(p as any); setIsDialogOpen(true); }}
                                onCopy={handleCopy}
                                onDelete={(p) => setDeleteProduct(p as any)}
                                onUpdateVariant={(id, updates) => updateVariantPriceMutation.mutate({ id, ...updates })}
                            />
                        </div>
                    </div>
                </TabsContent>


                <TabsContent value="variants" className="mt-6 outline-none">
                    <div className="rounded-xl border bg-card shadow-sm p-1">
                        <VariantManager products={products || []} search={search} />
                    </div>
                </TabsContent>

                <TabsContent value="colors" className="mt-6 outline-none">
                    <div className="rounded-xl border bg-card shadow-sm p-4">
                        <ColorManager />
                    </div>
                </TabsContent>
            </Tabs>

            <OrderGridTemplateFormDialog
                open={quickCreateOpen}
                onOpenChange={setQuickCreateOpen}
                products={filteredProducts}
                defaultVariantIds={[]}
                onSave={handleQuickCreateSave}
                isLoading={quickCreateSaving}
            />
            <ProductDialogs
                isDialogOpen={isDialogOpen}
                setIsDialogOpen={setIsDialogOpen}
                isImportOpen={isImportOpen}
                setIsImportOpen={setIsImportOpen}
                editingProduct={editingProduct}
                deleteProduct={deleteProduct}
                setDeleteProduct={setDeleteProduct as any}
                onFormSubmit={async (values) => {
                    if (editingProduct?.id) {
                        updateMutation.mutate({ id: editingProduct.id, values });
                    } else {
                        try {
                            const newProduct = await createMutation.mutateAsync(values);
                            setEditingProduct(newProduct as any);
                        } catch {
                            // 錯誤已由 mutation 的 toast 處理
                        }
                    }
                }}
                onDeleteConfirm={(id) => deleteMutation.mutate(id)}
                onImportSuccess={handleImportSuccess}
                isMutationLoading={isMutationLoading}
                isSelectionOpen={isSelectionOpen}
                setIsSelectionOpen={setIsSelectionOpen}
                products={filteredProducts as any}
            />
        </div>
    );
}
