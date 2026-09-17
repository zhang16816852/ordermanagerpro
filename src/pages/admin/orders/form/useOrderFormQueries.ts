import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBrands } from '@/hooks/useBrands';

export interface OrderFormQueryParams {
  orderId?: string;
  isEditMode: boolean;
  storeId: string;
  orderType: string;
  isRep: boolean;
  user: { id: string } | null;
  supplierId: string;
  storeIdFromParam: string;
}

export function useOrderFormQueries({
  orderId,
  isEditMode,
  storeId,
  orderType,
  isRep,
  user,
  supplierId,
  storeIdFromParam,
}: OrderFormQueryParams) {
  // Edit mode: fetch existing order
  const { data: order, isLoading: orderLoading } = useQuery({
    queryKey: ['order-detail', orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const { data, error } = await (supabase
        .from('orders') as any)
        .select(`
          *,
          stores (name, code, brand),
          order_items (
            id,
            product_id,
            variant_id,
            quantity,
            unit_price,
            shipped_quantity,
            status,
            selected_model_name,
            sort_order,
            products (name, code),
            product_variants (name)
          )
        `)
        .eq('id', orderId)
        .order('sort_order', { foreignTable: 'order_items' })
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!orderId,
  });

  // Fetch store info (create mode)
  const { data: storeInfo } = useQuery({
    queryKey: ['store', storeId],
    queryFn: async () => {
      if (!storeId) return null;
      const { data, error } = await (supabase
        .from('stores') as any)
        .select('id, name, code, brand')
        .eq('id', storeId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!storeId && !isEditMode,
  });

  const displayStoreName = isEditMode ? order?.stores?.name : (storeInfo?.name || storeId);
  const displayBrand = isEditMode ? order?.stores?.brand : storeInfo?.brand;

  // Categories for sidebar filter
  const { data: categories = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['categories-for-sidebar'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('categories') as any)
        .select('id, name')
        .order('sort_order', { ascending: true });
      if (error) return [];
      return data || [];
    },
  });

  const { data: categoryHierarchy = [] } = useQuery({
    queryKey: ['category_hierarchy'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('category_hierarchy' as any) as any).select('*');
      if (error) return [];
      return data;
    },
  });

  const { brandMap } = useBrands();

  // Suppliers list (for purchase/consignment types)
  const { data: suppliersList = [] } = useQuery({
    queryKey: ['suppliers-for-order-form'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
    enabled: orderType !== 'sales' && !isEditMode,
  });

  // Stores list (for consignment_send type)
  const { data: storesList = [] } = useQuery({
    queryKey: ['stores-for-order-form', isRep ? (user?.id ?? '') : 'all'],
    queryFn: async () => {
      let query = (supabase as any)
        .from('stores')
        .select('id, name, code, brand')
        .order('name');
      if (isRep && user) {
        // 業務只能選名下店家
        const { data: assignments, error: asnError } = await (supabase as any)
          .from('rep_store_assignments')
          .select('store_id')
          .eq('rep_id', user.id);
        if (asnError) throw asnError;
        const ids = (assignments || []).map((a: any) => a.store_id);
        if (ids.length === 0) return [];
        query = query.in('id', ids);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as { id: string; name: string; code: string | null; brand: string | null }[];
    },
    enabled: (orderType === 'consignment_send' || (orderType === 'sales' && !isEditMode && !storeIdFromParam)) && !isEditMode,
  });

  // Supplier product mappings (for purchase/consignment pricing)
  const { data: supplierMappings = [] } = useQuery({
    queryKey: ['supplier-mappings', supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('supplier_product_mappings')
        .select('internal_product_id, internal_variant_id, vendor_unit_cost')
        .eq('supplier_id', supplierId);
      if (error) throw error;
      return (data || []) as { internal_product_id: string; internal_variant_id: string | null; vendor_unit_cost: number | null }[];
    },
    enabled: !!supplierId && orderType !== 'sales' && !isEditMode,
  });

  return {
    order,
    orderLoading,
    storeInfo,
    displayStoreName,
    displayBrand,
    categories,
    categoryHierarchy,
    brandMap,
    suppliersList,
    storesList,
    supplierMappings,
  };
}