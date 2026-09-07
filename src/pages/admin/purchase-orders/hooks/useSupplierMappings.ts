import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export interface SupplierImportConfig {
  id: string;
  supplier_id: string;
  mapping_config: Record<string, string>;
  header_row: number;
}

export interface SupplierProductMapping {
  id: string;
  supplier_id: string;
  vendor_product_id: string;
  vendor_product_name: string | null;
  internal_product_id: string;
  internal_variant_id: string | null;
  vendor_unit_cost: number | null;
  internal_product?: any;
  internal_variant?: any;
}

export interface BatchMappingItem {
  supplier_id: string;
  vendor_product_id: string;
  vendor_product_name: string | null;
  internal_product_id: string;
  internal_variant_id: string | null;
  vendor_unit_cost: number | null;
  row_index?: number;
}

export function useSupplierMappings(supplierId?: string) {
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading: isLoadingMappings } = useQuery({
    queryKey: ['supplier-mappings', supplierId],
    queryFn: async () => {
      if (!supplierId) return [];
      const { data, error } = await (supabase
        .from('supplier_product_mappings') as any)
        .select(`
          *,
          internal_product:products(id, name, code),
          internal_variant:product_variants(id, name, sku)
        `)
        .eq('supplier_id', supplierId)
        .order('created_at', { ascending: false });
        
      if (error) {
        console.error('Error fetching mappings:', error);
        throw error;
      }
      return data as SupplierProductMapping[];
    },
    enabled: !!supplierId,
  });

  const { data: config = null, isLoading: isLoadingConfig } = useQuery({
    queryKey: ['supplier-import-config', supplierId],
    queryFn: async () => {
      if (!supplierId) return null;
      const { data, error } = await (supabase
        .from('supplier_import_configs') as any)
        .select('*')
        .eq('supplier_id', supplierId)
        .maybeSingle();
        
      if (error && error.code !== 'PGRST116') {
        throw error;
      }
      return data as SupplierImportConfig | null;
    },
    enabled: !!supplierId,
  });

  const saveMappingMutation = useMutation({
    mutationFn: async (data: Partial<SupplierProductMapping> & { supplier_id: string, vendor_product_id: string }) => {
      const { data: result, error } = await (supabase
        .from('supplier_product_mappings') as any)
        .upsert(
          {
            supplier_id: data.supplier_id,
            vendor_product_id: data.vendor_product_id,
            vendor_product_name: data.vendor_product_name,
            internal_product_id: data.internal_product_id,
            internal_variant_id: data.internal_variant_id,
            vendor_unit_cost: data.vendor_unit_cost ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'supplier_id, vendor_product_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings', supplierId] });
      toast.success('對照關係已儲存');
    },
    onError: (err) => {
      console.error(err);
      toast.error('儲存對照關係失敗');
    },
  });

  const batchSaveMappingsMutation = useMutation({
    mutationFn: async (items: BatchMappingItem[]) => {
      if (!items || items.length === 0) return [];

      // 1. 前置檢查：檔案內是否有重複的廠商代號
      const seen = new Map<string, number | undefined>();
      for (const item of items) {
        const key = item.vendor_product_id.trim();
        if (seen.has(key)) {
          const prevRow = seen.get(key);
          const rowInfo = prevRow && item.row_index
            ? `（第 ${prevRow} 列 與 第 ${item.row_index} 列）`
            : '';
          throw new Error(`匯入資料中包含重複的廠商代號「${key}」${rowInfo}，請先排除重複資料後再匯入`);
        }
        seen.set(key, item.row_index);
      }

      // 2. 分批執行批次 Upsert（CHUNK_SIZE = 200）
      const CHUNK_SIZE = 200;
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        const rowsToUpsert = chunk.map((item) => ({
          supplier_id: item.supplier_id,
          vendor_product_id: item.vendor_product_id,
          vendor_product_name: item.vendor_product_name,
          internal_product_id: item.internal_product_id,
          internal_variant_id: item.internal_variant_id,
          vendor_unit_cost: item.vendor_unit_cost,
          updated_at: new Date().toISOString(),
        }));

        const { error } = await (supabase.from('supplier_product_mappings') as any)
          .upsert(rowsToUpsert, { onConflict: 'supplier_id, vendor_product_id' });

        if (error) {
          // 批次失敗時：對該批次進行單筆測試，精確抓出是哪一筆導致錯誤
          for (const singleItem of chunk) {
            const singleRow = {
              supplier_id: singleItem.supplier_id,
              vendor_product_id: singleItem.vendor_product_id,
              vendor_product_name: singleItem.vendor_product_name,
              internal_product_id: singleItem.internal_product_id,
              internal_variant_id: singleItem.internal_variant_id,
              vendor_unit_cost: singleItem.vendor_unit_cost,
              updated_at: new Date().toISOString(),
            };

            const { error: singleError } = await (supabase.from('supplier_product_mappings') as any)
              .upsert(singleRow, { onConflict: 'supplier_id, vendor_product_id' });

            if (singleError) {
              const rowDesc = singleItem.row_index ? `第 ${singleItem.row_index} 列` : '';
              const nameDesc = singleItem.vendor_product_name ? `「${singleItem.vendor_product_name}」` : '';
              throw new Error(
                `${rowDesc}${nameDesc}（廠商代號：${singleItem.vendor_product_id}）寫入失敗：${getErrorMessage(singleError)}`
              );
            }
          }
          throw new Error(`批次寫入失敗：${getErrorMessage(error)}`);
        }
      }

      return items;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings', supplierId] });
      toast.success(`成功批次匯入 ${variables.length} 筆對照關係`);
    },
    onError: (err: any) => {
      console.error(err);
      toast.error(err.message || '批次儲存對照關係失敗');
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('supplier_product_mappings') as any)
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings', supplierId] });
      toast.success('對照關係已刪除');
    },
    onError: (err) => {
      console.error(err);
      toast.error('刪除對照關係失敗');
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (data: Partial<SupplierImportConfig> & { supplier_id: string }) => {
      const { data: result, error } = await (supabase
        .from('supplier_import_configs') as any)
        .upsert(
          {
            supplier_id: data.supplier_id,
            mapping_config: data.mapping_config || {},
            header_row: data.header_row || 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'supplier_id' }
        )
        .select()
        .single();

      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-import-config', supplierId] });
      toast.success('導入設定已儲存');
    },
    onError: (err) => {
      console.error(err);
      toast.error('儲存導入設定失敗');
    },
  });

  return {
    mappings,
    config,
    isLoadingMappings,
    isLoadingConfig,
    saveMappingMutation,
    batchSaveMappingsMutation,
    deleteMappingMutation,
    saveConfigMutation,
  };
}
