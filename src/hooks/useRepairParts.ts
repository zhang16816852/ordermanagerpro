import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';

export interface RepairPartLink {
  id: string;
  repair_part_id: string;
  product_id: string;
  variant_id: string | null;
  spec_label: string | null;
  is_default: boolean;
  sort_order: number;
  product_name: string;
  product_code: string | null;
  variant_name: string | null;
  sku: string | null;
  unit_cost: number;
  stock: number;
}

export interface RepairPart {
  id: string;
  device_model_id: string | null;
  name: string;
  tags: string[];
  description: string | null;
  supplier_id: string | null;
  default_unit_cost: number;
  default_unit_price: number;
  is_active: boolean;
  sort_order: number;
  device_model?: { name: string } | null;
  links: RepairPartLink[];
}

export interface RepairPartTag {
  id: string;
  name: string;
  sort_order: number;
}

export interface RepairPartLinkInput {
  id?: string | null;
  product_id: string;
  variant_id: string | null;
  spec_label: string | null;
  is_default: boolean;
}

export interface RepairPartInput {
  device_model_id: string | null;
  name: string;
  tags: string[];
  description: string | null;
  supplier_id: string | null;
  default_unit_cost: number;
  default_unit_price: number;
  is_active: boolean;
  sort_order: number;
  links: RepairPartLinkInput[];
}

const PARTS_QUERY_KEY = ['repair-parts-catalog'];

/** 零件顯示名：型號 + 零件名稱（多變體時補規格） */
export function partLabelOf(
  part: Pick<RepairPart, 'name' | 'device_model'>,
  link?: { spec_label: string | null } | null,
) {
  const model = part.device_model?.name?.trim() || '';
  const spec = link?.spec_label?.trim() || '';
  return [model, part.name, spec].filter(Boolean).join(' ');
}

/** 解析零件要寫入維修單的庫存目標：優先預設連結，其次第一筆 */
export function resolveLinkOf(part: Pick<RepairPart, 'links'>) {
  if (part.links.length === 0) return null;
  return part.links.find(l => l.is_default) || part.links[0];
}

function mapPart(raw: any, stockMap: Map<string, number>): RepairPart {
  const links: RepairPartLink[] = (raw.links || []).map((l: any) => {
    const variant = l.variant;
    const product = l.product;
    const unitCost = Number(
      variant?.wholesale_price
      ?? product?.unified_wholesale_price
      ?? 0,
    ) || 0;
    return {
      id: l.id,
      repair_part_id: raw.id,
      product_id: l.product_id,
      variant_id: l.variant_id || null,
      spec_label: l.spec_label || null,
      is_default: !!l.is_default,
      sort_order: l.sort_order ?? 0,
      product_name: product?.name || '未命名商品',
      product_code: product?.code || null,
      variant_name: variant?.name || null,
      sku: variant?.sku || null,
      unit_cost: unitCost,
      stock: stockMap.get(`${l.product_id}|${l.variant_id || ''}`) || 0,
    };
  }).sort((a, b) => a.sort_order - b.sort_order);

  return {
    id: raw.id,
    device_model_id: raw.device_model_id || null,
    name: raw.name || '',
    tags: raw.tags || [],
    description: raw.description || null,
    supplier_id: raw.supplier_id || null,
    default_unit_cost: Number(raw.default_unit_cost) || 0,
    default_unit_price: Number(raw.default_unit_price) || 0,
    is_active: raw.is_active !== false,
    sort_order: raw.sort_order ?? 0,
    device_model: raw.device_model || null,
    links,
  };
}

export function useRepairPartTags() {
  const { data, isLoading } = useQuery({
    queryKey: ['repair-part-tags'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('repair_part_tags')
        .select('id, name, sort_order')
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return (data || []) as RepairPartTag[];
    },
  });
  return { tags: data || [], isLoading };
}

export function useRepairParts() {
  const { data, isLoading, error } = useQuery({
    queryKey: PARTS_QUERY_KEY,
    queryFn: async () => {
      const { data: parts, error: partsError } = await (supabase as any)
        .from('repair_parts')
        .select(`
          *,
          device_model:device_model_id(name),
          links:repair_part_variants(
            *,
            product:product_id(name, code, unified_wholesale_price),
            variant:variant_id(name, sku, wholesale_price)
          )
        `)
        .order('sort_order')
        .order('name');
      if (partsError) throw partsError;

      const rows = (parts || []) as any[];
      const productIds = Array.from(new Set(
        rows.flatMap(p => (p.links || []).map((l: any) => l.product_id as string)),
      ));

      const stockMap = new Map<string, number>();
      if (productIds.length > 0) {
        const { data: inv, error: invError } = await (supabase as any)
          .from('product_inventory')
          .select('product_id, variant_id, quantity, warehouse:warehouse_id(code, type)')
          .in('product_id', productIds);
        if (invError) throw invError;
        (inv || [])
          .filter((r: any) => r.warehouse && (r.warehouse.code === 'own' || r.warehouse.type === '自有倉'))
          .forEach((r: any) => {
            const key = `${r.product_id}|${r.variant_id || ''}`;
            stockMap.set(key, (stockMap.get(key) || 0) + (Number(r.quantity) || 0));
          });
      }

      return rows.map(p => mapPart(p, stockMap)).sort((a, b) => a.sort_order - b.sort_order);
    },
  });

  return { parts: data || [], isLoading, error };
}

export interface RepairPartProductOption {
  product_id: string;
  variant_id: string | null;
  label: string;
  subLabel: string | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
}

const PRODUCT_OPTIONS_QUERY_KEY = ['repair-part-product-options'];

/** 可綁定的維修零件商品／變體（供連結編輯器與批次建立共用） */
export function useRepairPartProductOptions() {
  const { data, isLoading } = useQuery({
    queryKey: PRODUCT_OPTIONS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('products')
        .select('id, name, code, product_variants(id, name, sku, sort_order)')
        .eq('item_type', 'repair_part')
        .eq('is_hidden', false)
        .order('name');
      if (error) throw error;

      const options: RepairPartProductOption[] = [];
      (data || []).forEach((p: any) => {
        const variants = (p.product_variants || []) as any[];
        if (variants.length === 0) {
          options.push({
            product_id: p.id,
            variant_id: null,
            label: p.name,
            subLabel: p.code ? `料號 ${p.code}` : null,
            product_name: p.name,
            variant_name: null,
            sku: null,
          });
          return;
        }
        variants
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .forEach(v => {
            options.push({
              product_id: p.id,
              variant_id: v.id,
              label: `${p.name} — ${v.name}`,
              subLabel: v.sku || (p.code ? `料號 ${p.code}` : null),
              product_name: p.name,
              variant_name: v.name,
              sku: v.sku || null,
            });
          });
      });
      return options;
    },
  });
  return { options: data || [], isLoading };
}

export function useRepairPartMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: PARTS_QUERY_KEY });
  };

  const saveLinks = async (partId: string, links: RepairPartLinkInput[], keepIds: string[]) => {
    const db = supabase as any;
    // 先刪除被移除的連結（即使結果為空集合也要執行，否則無法清空全部連結）
    const removedIds = keepIds.filter(id => !links.some(l => l.id === id));
    if (removedIds.length > 0) {
      const { error } = await db.from('repair_part_variants').delete().in('id', removedIds);
      if (error) throw error;
    }
    if (links.length === 0) return;
    // 維持「每個零件恰有一筆預設連結」：多筆預設時以第一筆為準，其餘取消
    const firstDefault = links.findIndex(l => l.is_default);
    const normalized = links.map((l, i) => ({
      ...l,
      is_default: firstDefault === -1 ? i === 0 : i === firstDefault,
    }));
    for (const link of normalized) {
      const row = {
        repair_part_id: partId,
        product_id: link.product_id,
        variant_id: link.variant_id || null,
        spec_label: link.spec_label || null,
        is_default: link.is_default,
      };
      if (link.id && keepIds.includes(link.id)) {
        const { error } = await db.from('repair_part_variants').update(row).eq('id', link.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('repair_part_variants').insert(row);
        if (error) throw error;
      }
    }
  };

  const createMutation = useMutation({
    mutationFn: async (input: RepairPartInput) => {
      const db = supabase as any;
      const { data, error } = await db
        .from('repair_parts')
        .insert({
          device_model_id: input.device_model_id || null,
          name: input.name.trim(),
          tags: input.tags,
          description: input.description || null,
          supplier_id: input.supplier_id || null,
          default_unit_cost: input.default_unit_cost,
          default_unit_price: input.default_unit_price,
          is_active: input.is_active,
          sort_order: input.sort_order,
        })
        .select('id')
        .single();
      if (error) throw error;

      await saveLinks(data.id, input.links, []);
      return data.id as string;
    },
    onSuccess: () => {
      invalidate();
      toast.success('零件已建立');
    },
    onError: (err: any) => toast.error('建立失敗：' + getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, input, keepIds }: { id: string; input: RepairPartInput; keepIds: string[] }) => {
      const db = supabase as any;
      const { error } = await db
        .from('repair_parts')
        .update({
          device_model_id: input.device_model_id || null,
          name: input.name.trim(),
          tags: input.tags,
          description: input.description || null,
          supplier_id: input.supplier_id || null,
          default_unit_cost: input.default_unit_cost,
          default_unit_price: input.default_unit_price,
          is_active: input.is_active,
          sort_order: input.sort_order,
        })
        .eq('id', id);
      if (error) throw error;

      await saveLinks(id, input.links, keepIds);
      return id;
    },
    onSuccess: () => {
      invalidate();
      toast.success('零件已更新');
    },
    onError: (err: any) => toast.error('更新失敗：' + getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('repair_parts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('零件已刪除');
    },
    onError: (err: any) => toast.error('刪除失敗：' + getErrorMessage(err)),
  });

  return { createMutation, updateMutation, deleteMutation };
}

export function useRepairPartTagMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['repair-part-tags'] });
  };

  const createTagMutation = useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('標籤名稱不可為空');
      const { data: existing } = await (supabase as any)
        .from('repair_part_tags')
        .select('id')
        .eq('name', trimmed)
        .maybeSingle();
      if (existing) throw new Error(`標籤「${trimmed}」已存在`);
      const { data: maxRow } = await (supabase as any)
        .from('repair_part_tags')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await (supabase as any)
        .from('repair_part_tags')
        .insert({ name: trimmed, sort_order: (maxRow?.sort_order ?? -1) + 1 });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('標籤已新增');
    },
    onError: (err: any) => toast.error('新增失敗：' + getErrorMessage(err)),
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('repair_part_tags').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('標籤已刪除');
    },
    onError: (err: any) => toast.error('刪除失敗：' + getErrorMessage(err)),
  });

  return { createTagMutation, deleteTagMutation };
}
