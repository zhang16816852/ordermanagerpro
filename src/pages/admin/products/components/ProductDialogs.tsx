import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ProductFormDialog } from '@/components/ProductFormDialog/ProductFormDialog';
import { UnifiedProductImport } from '@/components/products/UnifiedProductImport';
import { Tables } from '@/integrations/supabase/types';

type Product = Tables<'products'>;

interface ProductDialogsProps {
    isDialogOpen: boolean;
    setIsDialogOpen: (v: boolean) => void;
    isImportOpen: boolean;
    setIsImportOpen: (v: boolean) => void;
    editingProduct: Product | null;
    deleteProduct: Product | null;
    setDeleteProduct: (p: Product | null) => void;
    onFormSubmit: (values: any) => void;
    onDeleteConfirm: (id: string) => void;
    isMutationLoading: boolean;
}

export function ProductDialogs({
    isDialogOpen,
    setIsDialogOpen,
    isImportOpen,
    setIsImportOpen,
    editingProduct,
    deleteProduct,
    setDeleteProduct,
    onFormSubmit,
    onDeleteConfirm,
    isMutationLoading
}: ProductDialogsProps) {
    return (
        <>
            <ProductFormDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                onSubmit={onFormSubmit}
                initialData={editingProduct}
                isLoading={isMutationLoading}
            />

            <AlertDialog open={!!deleteProduct} onOpenChange={() => setDeleteProduct(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確定要刪除產品嗎？</AlertDialogTitle>
                        <AlertDialogDescription>
                            這將刪除「{deleteProduct?.name}」及其關連的所有變體資料。此操作無法復原。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() => deleteProduct && onDeleteConfirm(deleteProduct.id)}
                        >
                            確認刪除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <UnifiedProductImport open={isImportOpen} onOpenChange={setIsImportOpen} />
        </>
    );
}
