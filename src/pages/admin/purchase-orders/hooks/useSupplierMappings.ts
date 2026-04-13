import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  internal_product?: any;
  internal_variant?: any;
}

export function useSupplierMappings(supplierId?: string) {
  const queryClient = useQueryClient();

  const { data: mappings = [], isLoading: isLoadingMappings } = useQuery({
    queryKey: ['supplier-mappings', supplierId],
    queryFn: async () => {
      if (!supplierId) return [];
      const { data, error } = await supabase
        .from('supplier_product_mappings')
        .select(`
          *,
          internal_product:products(id, name, sku),
          internal_variant:product_variants(id, name, sku, option_1, option_2, option_3)
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
      const { data, error } = await supabase
        .from('supplier_import_configs')
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
      const { data: result, error } = await supabase
        .from('supplier_product_mappings')
        .upsert(
          {
            supplier_id: data.supplier_id,
            vendor_product_id: data.vendor_product_id,
            vendor_product_name: data.vendor_product_name,
            internal_product_id: data.internal_product_id,
            internal_variant_id: data.internal_variant_id,
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

  const deleteMappingMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('supplier_product_mappings')
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
      const { data: result, error } = await supabase
        .from('supplier_import_configs')
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
    deleteMappingMutation,
    saveConfigMutation,
  };
}
