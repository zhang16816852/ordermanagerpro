import { supabase } from '@/integrations/supabase/client';
import { useSpecStore } from '@/store/useSpecStore';
import { generateProductExcel } from '@/utils/excelUtils';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import * as XLSX from 'xlsx';
import { ProductWithPricing } from '@/types/product';

export async function handleBatchExport(
    products: ProductWithPricing[] | null,
    selectedProductIds: Set<string>,
    getProductVariants: (id: string) => any[],
    brandMap: Record<string, string>,
    onClearSelection: () => void
) {
    const { data: categoriesData } = await supabase.from('categories').select('*');
    const { data: specLinks } = await supabase.from('category_spec_links').select('*');

    const { specDefinitions: storeSpecDefs, fetchSpecs } = useSpecStore.getState();
    let defs = storeSpecDefs;
    if (defs.length === 0) {
        await fetchSpecs();
        defs = useSpecStore.getState().specDefinitions;
    }

    const selected = (products || []).filter(p => selectedProductIds.has(p.id)).map(p => ({
        ...p,
        variants: getProductVariants(p.id)
    }));

    if (selected.length === 0) {
        toast.error('請先選取要匯出的產品');
        return;
    }

    try {
        const workbook = generateProductExcel(selected, categoriesData || [], defs, specLinks || [], brandMap);
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `產品匯出_${new Date().toISOString().slice(0, 10)}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        onClearSelection();
        toast.success('匯出成功');
    } catch (error: any) {
        console.error('Export error:', error);
        toast.error(`匯出失敗: ${getErrorMessage(error)}`);
    }
}
