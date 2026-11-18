import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RepairPartCategory {
  id: string;
  name: string;
  sort_order: number;
  is_hidden: boolean;
  is_repair_part: boolean;
}

/**
 * 載入維修零件分類（categories where is_repair_part = true）
 */
export function useRepairPartCategories() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['repair-part-categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('categories')
        .select('id, name, sort_order, is_hidden, is_repair_part')
        .eq('is_repair_part', true)
        .eq('is_hidden', false)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return (data || []) as RepairPartCategory[];
    },
  });

  return { categories: data || [], isLoading, error };
}