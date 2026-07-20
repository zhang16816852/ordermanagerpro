import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { useBrandSeriesCache, type BrandSeriesItem } from '@/hooks/useBrandSeriesCache';

export type BrandSeries = BrandSeriesItem;

export function useBrandSeriesData(brandId?: string) {
  const { allSeries, isLoading, refresh } = useBrandSeriesCache();

  const flatSeries = useMemo(() => {
    if (!brandId) return [];
    return allSeries
      .filter(s => s.brand_id === brandId)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  }, [allSeries, brandId]);

  const getMaxSortOrder = () => {
    if (flatSeries.length === 0) return 0;
    return Math.max(...flatSeries.map(s => s.sort_order ?? 0)) + 1;
  };

  const checkDuplicateName = (name: string, excludeId?: string) => {
    return flatSeries.some(s =>
      s.brand_id === brandId &&
      s.name === name &&
      s.id !== excludeId
    );
  };

  const upsertSeries = useMutation({
    mutationFn: async (data: {
      series: Partial<BrandSeries>;
      editingId?: string;
    }) => {
      const { series: s, editingId } = data;

      if (checkDuplicateName(s.name!, editingId)) {
        throw new Error(`此品牌下已存在「${s.name}」系列`);
      }

      const nextSortOrder = getMaxSortOrder();

      if (editingId) {
        const { error } = await supabase
          .from('brand_series')
          .update(s)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('brand_series')
          .insert([{
            ...s,
            sort_order: nextSortOrder,
          }]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      refresh();
      toast.success('系列已儲存');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteSeries = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('brand_series')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success('系列已刪除');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const reorderSeries = useMutation({
    mutationFn: async (updates: { id: string; sort_order: number }[]) => {
      const { error } = await supabase
        .from('brand_series')
        .upsert(updates, { onConflict: 'id' });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return {
    flatSeries,
    isLoading,
    getMaxSortOrder,
    checkDuplicateName,
    upsertSeries,
    deleteSeries,
    reorderSeries,
  };
}
