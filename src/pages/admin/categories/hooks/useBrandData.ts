import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Brand } from '../types';

// 品牌資料層：包含 Query 與 Mutation

export function useBrandData() {
    const queryClient = useQueryClient();

    // --- Query ---

    const { data: brands = [], isLoading: isLoadingBrands } = useQuery({
        queryKey: ['brands'],
        queryFn: async () => {
            try {
                const { data, error } = await (supabase.from('brands' as any) as any)
                    .select('*')
                    .order('sort_order', { ascending: true })
                    .order('name', { ascending: true });
                if (error) return [];
                return data as Brand[];
            } catch (err) {
                console.error('Error fetching brands:', err);
                return [];
            }
        },
    });

    // --- Mutation ---

    const brandMutation = useMutation({
        mutationFn: async (data: { brand: Partial<Brand>; editingBrandId?: string }) => {
            const { brand, editingBrandId } = data;
            if (editingBrandId) {
                // 更新既有品牌
                const { error } = await (supabase.from('brands' as any) as any)
                    .update(brand)
                    .eq('id', editingBrandId);
                if (error) throw error;
            } else {
                // 新增品牌
                const { error } = await (supabase.from('brands' as any) as any).insert([brand]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['brands'] });
            toast.success('品牌已儲存');
        },
    });

    // 刪除品牌
    const deleteBrand = async (brandId: string, brandName: string) => {
        const { error } = await (supabase.from('brands' as any) as any)
            .delete()
            .eq('id', brandId);
        if (error) {
            toast.error('刪除失敗: 該品牌可能已被產品關聯');
        } else {
            queryClient.invalidateQueries({ queryKey: ['brands'] });
        }
    };

    return {
        brands,
        isLoadingBrands,
        brandMutation,
        deleteBrand,
    };
}
