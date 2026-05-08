import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProductColor {
  id: string;
  name: string;
  code: string;
  hex_code: string | null;
  sort_order: number;
  is_active: boolean;
}

export function useProductColors() {
  const queryClient = useQueryClient();

  // 取得所有顏色
  const { data: colors = [], isLoading } = useQuery({
    queryKey: ['product_colors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_colors' as any)
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) throw error;
      // 透過 unknown 中間轉型，避免 Supabase 型別推斷衝突
      return (data as unknown) as ProductColor[];
    },
  });

  // 新增顏色
  const addColorMutation = useMutation({
    mutationFn: async (newColor: Partial<ProductColor>) => {
      const { data, error } = await supabase
        .from('product_colors' as any)
        .insert([newColor])
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product_colors'] });
    },
  });

  // 更新顏色
  const updateColorMutation = useMutation({
    mutationFn: async (color: ProductColor) => {
      const { error } = await supabase
        .from('product_colors' as any)
        .update(color)
        .eq('id', color.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product_colors'] });
    },
  });

  // 刪除顏色
  const deleteColorMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('product_colors' as any)
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product_colors'] });
    },
  });

  return {
    colors,
    isLoading,
    addColor: addColorMutation.mutateAsync,
    updateColor: updateColorMutation.mutateAsync,
    deleteColor: deleteColorMutation.mutateAsync,
    isAdding: addColorMutation.isPending,
  };
}
