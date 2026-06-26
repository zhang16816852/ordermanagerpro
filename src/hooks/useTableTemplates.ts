import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { OrderGridTemplateWithProducts, DimensionConfig } from '@/types/order-grid';

const QUERY_KEY = ['table_templates'];

function generateId(): string {
  return crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useTableTemplates() {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<OrderGridTemplateWithProducts[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('table_templates')
        .select('*, template_variants:table_template_variants(*)')
        .order('name');
      if (error) throw error;
      return (data || []) as OrderGridTemplateWithProducts[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      row_config: DimensionConfig;
      col_config: DimensionConfig;
      tab_config?: DimensionConfig | null;
      variant_ids: string[];
    }) => {
      const now = new Date().toISOString();
      const { data: template, error: templateError } = await supabase
        .from('table_templates')
        .insert({
          name: data.name,
          description: data.description || null,
          row_config: data.row_config,
          col_config: data.col_config,
          tab_config: data.tab_config ?? null,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (templateError) throw templateError;

      if (data.variant_ids.length > 0) {
        const variants = data.variant_ids.map((vid, idx) => ({
          template_id: template.id,
          variant_id: vid,
          sort_order: idx,
        }));
        const { error: variantsError } = await supabase
          .from('table_template_variants')
          .insert(variants);
        if (variantsError) throw variantsError;
      }

      return { ...template, template_variants: data.variant_ids.map((vid, idx) => ({
        id: generateId(),
        template_id: template.id,
        variant_id: vid,
        sort_order: idx,
      })) } as OrderGridTemplateWithProducts;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        name?: string;
        description?: string;
        row_config?: DimensionConfig;
        col_config?: DimensionConfig;
        tab_config?: DimensionConfig | null;
        variant_ids?: string[];
      };
    }) => {
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (data.name !== undefined) updates.name = data.name;
      if (data.description !== undefined) updates.description = data.description || null;
      if (data.row_config !== undefined) updates.row_config = data.row_config;
      if (data.col_config !== undefined) updates.col_config = data.col_config;
      if (data.tab_config !== undefined) updates.tab_config = data.tab_config ?? null;

      const { error: updateError } = await supabase
        .from('table_templates')
        .update(updates)
        .eq('id', id);
      if (updateError) throw updateError;

      if (data.variant_ids !== undefined) {
        const { error: deleteError } = await supabase
          .from('table_template_variants')
          .delete()
          .eq('template_id', id);
        if (deleteError) throw deleteError;

        if (data.variant_ids.length > 0) {
          const variants = data.variant_ids.map((vid, idx) => ({
            template_id: id,
            variant_id: vid,
            sort_order: idx,
          }));
          const { error: insertError } = await supabase
            .from('table_template_variants')
            .insert(variants);
          if (insertError) throw insertError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('table_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const createTemplate = useCallback(
    (data: {
      name: string;
      description?: string;
      row_config: DimensionConfig;
      col_config: DimensionConfig;
      tab_config?: DimensionConfig | null;
      variant_ids: string[];
    }): OrderGridTemplateWithProducts => {
      const tempId = generateId();
      const temp: OrderGridTemplateWithProducts = {
        id: tempId,
        name: data.name,
        description: data.description,
        row_config: data.row_config,
        col_config: data.col_config,
        tab_config: data.tab_config ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        template_variants: data.variant_ids.map((vid, idx) => ({
          id: generateId(),
          template_id: tempId,
          variant_id: vid,
          sort_order: idx,
        })),
      };
      createMutation.mutate(data);
      return temp;
    },
    [createMutation]
  );

  const updateTemplate = useCallback(
    (
      id: string,
      data: {
        name?: string;
        description?: string;
        row_config?: DimensionConfig;
        col_config?: DimensionConfig;
        tab_config?: DimensionConfig | null;
        variant_ids?: string[];
      }
    ): OrderGridTemplateWithProducts | null => {
      updateMutation.mutate({ id, data });
      const existing = templates.find((t) => t.id === id);
      if (!existing) return null;
      return { ...existing, ...data, updated_at: new Date().toISOString() } as OrderGridTemplateWithProducts;
    },
    [updateMutation, templates]
  );

  const deleteTemplate = useCallback(
    (id: string): boolean => {
      const exists = templates.some((t) => t.id === id);
      if (!exists) return false;
      deleteMutation.mutate(id);
      return true;
    },
    [deleteMutation, templates]
  );

  const getTemplateById = useCallback(
    (id: string): OrderGridTemplateWithProducts | undefined => {
      return templates.find((t) => t.id === id);
    },
    [templates]
  );

  return {
    templates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    getTemplateById,
  };
}
