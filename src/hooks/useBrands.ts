import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMemo } from 'react';

/**
 * 全域品牌抓取與名稱映射 Hook
 */
export function useBrands() {
  const { data: brands = [], isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) {
        console.error('Error fetching brands:', error);
        return [];
      }
      return data || [];
    },
    // 設定較長的快取時間，因為品牌資料變動頻率低
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  /**
   * 建立 ID -> Name 的快速對照表
   */
  const brandMap = useMemo(() => {
    const map: Record<string, string> = {};
    brands.forEach((b: any) => {
      map[b.id] = b.name;
    });
    return map;
  }, [brands]);

  /**
   * 根據 ID 獲取完整顯示名稱
   */
  const getBrandName = (brandId: string | null | undefined) => {
    if (!brandId) return '-';
    // 若找不到對應名稱，則回傳原始 ID (可能是舊資料或遷移中的 UUID)
    return brandMap[brandId] || brandId;
  };

  return {
    brands,
    brandMap,
    getBrandName,
    isLoading,
  };
}
