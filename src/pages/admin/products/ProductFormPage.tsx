import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Eye, Loader2 } from 'lucide-react';
import { ProductFormBody } from '@/components/products/form/ProductFormDialog';
import { ProductDetailDialog } from '@/components/products/catalog/ProductDetailDialog';
import { useProductCache } from '@/hooks/useProductCache';
import { useProductMutations } from './hooks/useProductMutations';
import { usePageHeader } from '@/components/layout/PageHeaderContext';
import type { ProductWithPricing } from '@/types/product';

export default function AdminProductFormPage() {
    const { productId } = useParams<{ productId?: string }>();
    const navigate = useNavigate();
    const { products, isLoading, forceRefresh } = useProductCache();
    const mutations = useProductMutations(forceRefresh);
    const formRef = useRef<any>(null);
    const { setPageHeader } = usePageHeader();

    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewProduct, setPreviewProduct] = useState<ProductWithPricing | null>(null);

    const isEdit = !!productId;

    const initialData = useMemo(() => {
        if (!productId) return null;
        const found = products?.find((p: any) => p.id === productId);
        return found ? (found as any) : null;
    }, [products, productId]);

    const isNotFound = isEdit && !isLoading && !initialData;

    const isMutationLoading = mutations.createMutation.isPending || mutations.updateMutation.isPending;

    const goBack = () => navigate('/admin/products');

    const registerForm = useCallback((form: any) => {
        formRef.current = form;
    }, []);

    const handleSubmit = (values: any) => {
        if (isEdit && initialData?.id) {
            mutations.updateMutation.mutate(
                { id: initialData.id, values },
                { onSuccess: () => navigate('/admin/products') }
            );
        } else {
            mutations.createMutation
                .mutateAsync(values)
                .then(() => navigate('/admin/products'))
                .catch(() => { /* 錯誤已由 mutation 的 toast 處理 */ });
        }
    };

    const handlePreview = useCallback(() => {
        const values = formRef.current?.getValues?.() || {};
        const base: any = initialData || {};
        // 變體規格矩陣目前的數值（含尚未存檔的編輯）以「變體 id → spec_values」覆蓋快取中舊的變體規格
        const variantSpecsMap = (formRef.current as any)?.__getVariantSpecs?.() || null;
        const variants = (base.variants || []).map((v: any) => {
            const overrides = variantSpecsMap?.[v.id];
            return overrides ? { ...v, spec_values: overrides } : v;
        });
        const draft: any = {
            ...base,
            name: values.name ?? base.name ?? '',
            code: values.code ?? base.code ?? '',
            description: values.description !== undefined ? values.description : (base.description ?? ''),
            category_ids: values.category_ids?.length ? values.category_ids : (base.category_ids || []),
            brand_ids: values.brand_ids?.length ? values.brand_ids : (base.brand_ids || []),
            brand_series_ids: values.brand_series_ids?.length ? values.brand_series_ids : (base.brand_series_ids || []),
            spec_values: values.spec_values ?? base.spec_values ?? {},
            variants,
            wholesale_price: Number(values.wholesale_price ?? base.wholesale_price ?? 0),
            retail_price: Number(values.retail_price ?? base.retail_price ?? 0),
            has_store_price: base.has_store_price ?? false,
        };
        setPreviewProduct(draft as unknown as ProductWithPricing);
        setPreviewOpen(true);
    }, [initialData]);

    // 將返回＋標題＋預覽按鈕交由共用 Header 呈現（桌面/手機皆適用）
    useLayoutEffect(() => {
        if (isNotFound) return;

        const title = isEdit ? `編輯產品: ${initialData?.name || ''}` : '新增產品';
        setPageHeader({
            title,
            back: '/admin/products',
            actions: (
                <Button variant="outline" size="sm" onClick={handlePreview} disabled={isEdit && !initialData} className="gap-1.5">
                    <Eye className="h-4 w-4" />
                    預覽
                </Button>
            ),
        });

        return () => setPageHeader(null);
    }, [setPageHeader, isEdit, initialData, isNotFound, handlePreview]);

    if (isNotFound) {
        return (
            <div className="min-h-[70vh] flex items-center justify-center">
                <div className="text-center space-y-4">
                    <p className="text-muted-foreground">找不到此產品（可能已被刪除）。</p>
                    <Button onClick={goBack}>返回產品列表</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {isEdit && isLoading && !initialData ? (
                <div className="min-h-[50vh] flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : (
                <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                    <ProductFormBody
                        active={true}
                        initialData={initialData}
                        onSubmit={handleSubmit}
                        isLoading={isMutationLoading}
                        onClose={goBack}
                        registerForm={registerForm}
                    />
                </div>
            )}

            <ProductDetailDialog
                product={previewProduct}
                open={previewOpen && !!previewProduct}
                onOpenChange={setPreviewOpen}
                storeId=""
            />
        </div>
    );
}