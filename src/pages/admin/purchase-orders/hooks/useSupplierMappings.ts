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
  /** 同料號可對多個內部商品／變體，此欄決定採購匯入與成本查詢時的預設對應目標 */
  is_primary: boolean;
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
  /** 未指定時由寫入邏輯自動判定（該料號第一個目標為主對照） */
  is_primary?: boolean;
  row_index?: number;
}

const targetKeyOf = (productId: string, variantId: string | null | undefined) =>
  `${productId}_${variantId || 'null'}`;

function describeMappingError(error: any, vendorProductId?: string): string {
  if (error?.code === '23505') {
    if (String(error.message || '').includes('idx_supplier_mappings_primary')) {
      return '此廠商代號已有主對照，請先將原主對照改為次要對照';
    }
    return `此廠商代號已存在相同的內部產品／變體對照${vendorProductId ? `（${vendorProductId}）` : ''}`;
  }
  return getErrorMessage(error);
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
        .order('vendor_product_id', { ascending: true })
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });
        
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
      const vendorProductId = (data.vendor_product_id || '').trim();
      if (!vendorProductId) throw new Error('廠商產品代號不可為空白');

      const query = supabase.from('supplier_product_mappings') as any;

      const payload: Record<string, any> = {
        supplier_id: data.supplier_id,
        vendor_product_id: vendorProductId,
        vendor_product_name: data.vendor_product_name?.trim() || null,
        internal_product_id: data.internal_product_id,
        internal_variant_id: data.internal_variant_id ?? null,
        vendor_unit_cost: data.vendor_unit_cost ?? null,
        updated_at: new Date().toISOString(),
      };

      if (data.id) {
        // 更新時未指定 is_primary 則沿用資料庫現值，避免意外把主對照降級
        if (data.is_primary != null) payload.is_primary = data.is_primary;
      } else {
        let isPrimary = data.is_primary;
        if (isPrimary == null) {
          // 新增且未勾選時：該料號完全沒有既有對照才自動成為主對照，
          // 否則視為新增第二個對照目標（次要）
          const { data: sameCodeRows, error: countError } = await query
            .select('id')
            .eq('supplier_id', data.supplier_id)
            .eq('vendor_product_id', vendorProductId)
            .limit(1);
          if (countError) throw countError;
          isPrimary = !(sameCodeRows && sameCodeRows.length > 0);
        }
        payload.is_primary = isPrimary;
      }

      // 有 id → 更新該筆（避免改代號後因衝突鍵變動而意外新增一筆）
      const { data: result, error } = data.id
        ? await query.update(payload).eq('id', data.id).select().single()
        : await query.insert(payload).select().single();

      if (error) throw new Error(describeMappingError(error, vendorProductId));
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings-export', supplierId] });
      toast.success('對照關係已儲存');
    },
    onError: (err) => {
      console.error(err);
      toast.error(err.message || '儲存對照關係失敗');
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (id: string) => {
      const query = supabase.from('supplier_product_mappings') as any;
      const { data: row, error: readError } = await query
        .select('supplier_id, vendor_product_id')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!row) throw new Error('對照關係不存在或已被刪除');

      // 先取消同料號的其他主對照，再設本筆為主對照（順序不可顛倒，partial unique index 會擋）
      const { error: clearError } = await query
        .update({ is_primary: false })
        .eq('supplier_id', row.supplier_id)
        .eq('vendor_product_id', row.vendor_product_id)
        .neq('id', id);
      if (clearError) throw clearError;

      const { error: setError } = await query.update({ is_primary: true }).eq('id', id);
      if (setError) throw new Error(describeMappingError(setError, row.vendor_product_id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings-export', supplierId] });
      toast.success('已設為主對照');
    },
    onError: (err) => {
      console.error(err);
      toast.error(err.message || '設定主對照失敗');
    },
  });

  const batchSaveMappingsMutation = useMutation({
    mutationFn: async (items: BatchMappingItem[]) => {
      if (!items || items.length === 0) return [];

      const normalized = items.map((item) => ({
        ...item,
        vendor_product_id: item.vendor_product_id.trim(),
        vendor_product_name: item.vendor_product_name?.trim() || null,
        internal_variant_id: item.internal_variant_id ?? null,
      }));

      // 1. 前置檢查：同一廠商代號可對多個內部商品（合法），
      //    但「同料號 + 同內部商品／變體」在檔案內重複才需要擋
      const seenExact = new Map<string, number | undefined>();
      for (const item of normalized) {
        if (!item.vendor_product_id) {
          throw new Error(`第 ${item.row_index ?? '?'} 列的廠商代號為空白，請先補齊或移除該列`);
        }
        const key = `${item.vendor_product_id}|${targetKeyOf(item.internal_product_id, item.internal_variant_id)}`;
        if (seenExact.has(key)) {
          const prevRow = seenExact.get(key);
          const rowInfo = prevRow && item.row_index
            ? `（第 ${prevRow} 列 與 第 ${item.row_index} 列）`
            : '';
          throw new Error(
            `匯入資料中「${item.vendor_product_id}」重複對應同一個內部產品／變體${rowInfo}，請先排除重複資料後再匯入`
          );
        }
        seenExact.set(key, item.row_index);
      }

      // 2. 讀取既有對照，用來判定主對照與更新／新增
      const targetSupplierId = normalized[0].supplier_id;
      const query = supabase.from('supplier_product_mappings') as any;
      const { data: existingRows, error: existingError } = await query
        .select('id, supplier_id, vendor_product_id, internal_product_id, internal_variant_id, is_primary')
        .eq('supplier_id', targetSupplierId);
      if (existingError) throw existingError;

      const primaryIdByCode = new Map<string, string>();
      const idByExact = new Map<string, string>();
      for (const row of (existingRows || []) as any[]) {
        const codeKey = `${row.supplier_id}|${row.vendor_product_id}`;
        idByExact.set(`${codeKey}|${targetKeyOf(row.internal_product_id, row.internal_variant_id)}`, row.id);
        if (row.is_primary) primaryIdByCode.set(codeKey, row.id);
      }

      // 3. 決定主對照，優先序：既有 DB 主對照（且出現在檔案中）> 檔案內明確指定 > 檔案內第一個目標自動為主
      //    3a. 檔案內明確標示的 target（每料號取第一筆）；DB 已有主對照時不覆蓋，避免匯入意外降級
      const explicitPrimaryByCode = new Map<string, string>();
      for (const item of normalized) {
        if (!item.is_primary) continue;
        const codeKey = `${item.supplier_id}|${item.vendor_product_id}`;
        if (primaryIdByCode.has(codeKey) || explicitPrimaryByCode.has(codeKey)) continue;
        explicitPrimaryByCode.set(codeKey, `${codeKey}|${targetKeyOf(item.internal_product_id, item.internal_variant_id)}`);
      }

      const assignedPrimary = new Set<string>();
      const rowsToSave = normalized.map((item) => {
        const codeKey = `${item.supplier_id}|${item.vendor_product_id}`;
        const exactKey = `${codeKey}|${targetKeyOf(item.internal_product_id, item.internal_variant_id)}`;
        const currentPrimaryId = primaryIdByCode.get(codeKey);
        const sameTargetId = idByExact.get(exactKey);

        const keepExisting = !!currentPrimaryId && currentPrimaryId === sameTargetId;
        const explicitHere = explicitPrimaryByCode.get(codeKey) === exactKey;

        let isPrimary = false;
        if (keepExisting) {
          isPrimary = true;
          assignedPrimary.add(codeKey);
        } else if (explicitHere) {
          isPrimary = true;
          assignedPrimary.add(codeKey);
        } else if (assignedPrimary.has(codeKey)) {
          isPrimary = false;
        } else if (!currentPrimaryId && !explicitPrimaryByCode.has(codeKey)) {
          isPrimary = true;
          assignedPrimary.add(codeKey);
        }

        return { ...item, is_primary: isPrimary };
      });

      // 4. 分批執行批次 Upsert（CHUNK_SIZE = 200）
      const CHUNK_SIZE = 200;
      for (let i = 0; i < rowsToSave.length; i += CHUNK_SIZE) {
        const chunk = rowsToSave.slice(i, i + CHUNK_SIZE);
        const rowsToUpsert = chunk.map((item) => ({
          supplier_id: item.supplier_id,
          vendor_product_id: item.vendor_product_id,
          vendor_product_name: item.vendor_product_name,
          internal_product_id: item.internal_product_id,
          internal_variant_id: item.internal_variant_id,
          vendor_unit_cost: item.vendor_unit_cost,
          is_primary: item.is_primary,
          updated_at: new Date().toISOString(),
        }));

        const { error } = await query.upsert(rowsToUpsert, {
          onConflict: 'supplier_id, vendor_product_id, internal_product_id, internal_variant_id',
        });

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
              is_primary: singleItem.is_primary,
              updated_at: new Date().toISOString(),
            };

            const { error: singleError } = await query.upsert(singleRow, {
              onConflict: 'supplier_id, vendor_product_id, internal_product_id, internal_variant_id',
            });

            if (singleError) {
              const rowDesc = singleItem.row_index ? `第 ${singleItem.row_index} 列` : '';
              const nameDesc = singleItem.vendor_product_name ? `「${singleItem.vendor_product_name}」` : '';
              throw new Error(
                `${rowDesc}${nameDesc}（廠商代號：${singleItem.vendor_product_id}）寫入失敗：${describeMappingError(singleError, singleItem.vendor_product_id)}`
              );
            }
          }
          throw new Error(`批次寫入失敗：${describeMappingError(error)}`);
        }
      }

      return rowsToSave;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings-export', supplierId] });
      toast.success(`成功批次匯入 ${variables.length} 筆對照關係`);
      return result;
    },
    onError: (err: any) => {
      console.error(err);
      toast.error(err.message || '批次儲存對照關係失敗');
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: async (id: string) => {
      const query = supabase.from('supplier_product_mappings') as any;
      const { data: row, error: readError } = await query
        .select('supplier_id, vendor_product_id, is_primary')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;

      const { error } = await query.delete().eq('id', id);
      if (error) throw error;

      // 刪掉主對照時，自動提升同料號的其餘對照（否則該料號將沒有預設對應目標）
      if (row?.is_primary) {
        const { data: nextRows, error: nextError } = await query
          .select('id')
          .eq('supplier_id', row.supplier_id)
          .eq('vendor_product_id', row.vendor_product_id)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (nextError) throw nextError;

        const nextId = (nextRows?.[0] as { id: string } | undefined)?.id;
        if (nextId) {
          const { error: promoteError } = await query.update({ is_primary: true }).eq('id', nextId);
          if (promoteError) throw promoteError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-mappings-export', supplierId] });
      toast.success('對照關係已刪除');
    },
    onError: (err) => {
      console.error(err);
      toast.error(err.message || '刪除對照關係失敗');
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
    setPrimaryMutation,
    deleteMappingMutation,
    saveConfigMutation,
  };
}
