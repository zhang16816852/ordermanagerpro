/**
 * 共用的產品裝置型號解析邏輯。
 * 從 entity_model_relations 建立索引 Map，再對每個 entity 解析 include/exclude 規則。
 */

export interface ModelMaps {
  linksMap: Map<string, any[]>;
  groupsMap: Map<string, any[]>;
  exclusionsMap: Map<string, any[]>;
}

export interface EntityModelResult {
  device_models: any[];
  device_model_groups: any[];
  device_model_rules: string[];
  _expanded_models: string[];
  _expanded_model_aliases: string[];
  device_model_exclusions: string[];
}

/**
 * 從 entity_model_relations + device_models + device_model_groups 建立索引 Map
 */
export function buildModelMaps(
  allRelations: any[],
  devModelsMap: Map<string, any>,
  devGroupsMap: Map<string, any>,
): ModelMaps {
  const linksMap = new Map<string, any[]>();
  const groupsMap = new Map<string, any[]>();
  const exclusionsMap = new Map<string, any[]>();

  allRelations?.forEach(r => {
    const entityId = r.product_id || r.variant_id;
    if (!entityId) return;

    if (r.relation_type === 'include') {
      if (r.model_id) {
        if (!linksMap.has(entityId)) linksMap.set(entityId, []);
        linksMap.get(entityId)!.push({
          entity_id: entityId,
          model_id: r.model_id,
          device_models: devModelsMap.get(r.model_id),
        });
      }
      if (r.group_id) {
        if (!groupsMap.has(entityId)) groupsMap.set(entityId, []);
        groupsMap.get(entityId)!.push({
          entity_id: entityId,
          group_id: r.group_id,
          device_model_groups: devGroupsMap.get(r.group_id),
        });
      }
    } else if (r.relation_type === 'exclude') {
      if (!exclusionsMap.has(entityId)) exclusionsMap.set(entityId, []);
      exclusionsMap.get(entityId)!.push({
        entity_id: entityId,
        model_id: r.model_id,
        device_models: devModelsMap.get(r.model_id),
      });
    }
  });

  return { linksMap, groupsMap, exclusionsMap };
}

/**
 * 解析單一 entity (product 或 variant) 的裝置型號關聯
 */
export function processEntityModels(
  entityId: string,
  maps: ModelMaps,
): EntityModelResult {
  const { linksMap, groupsMap, exclusionsMap } = maps;
  const rules: string[] = [];
  const directLinks = linksMap.get(entityId) || [];
  const exclusionLinks = exclusionsMap.get(entityId) || [];
  const groupLinks = groupsMap.get(entityId) || [];

  const exclusions = new Set<string>();
  exclusionLinks.forEach(l => {
    if (l.device_models) {
      exclusions.add(l.device_models.id);
      rules.push(`exclude:${l.device_models.name}`);
    }
  });

  const directModels = directLinks
    .filter(l => l.device_models && !exclusions.has(l.device_models.id))
    .map(l => {
      rules.push(`model:${l.device_models.name}`);
      return l.device_models;
    });

  const groups: any[] = [];
  const expandedFromGroups: any[] = [];
  groupLinks.forEach(link => {
    const group = link.device_model_groups;
    if (group) {
      const groupItems = (group.device_model_group_items || [])
        .map((item: any) => {
          if (item.device_models && !exclusions.has(item.device_models.id)) {
            expandedFromGroups.push(item.device_models);
            return { id: item.device_models.id, name: item.device_models.name };
          }
          return null;
        })
        .filter(Boolean);

      groups.push({ id: group.id, name: group.name, items: groupItems });
      rules.push(`group:${group.name}`);
    }
  });

  return {
    device_models: directModels,
    device_model_groups: groups,
    device_model_rules: rules,
    _expanded_models: Array.from(new Set([...directModels, ...expandedFromGroups].map(m => m.name))),
    _expanded_model_aliases: Array.from(new Set([...directModels, ...expandedFromGroups].flatMap(m => m.aliases || []))),
    device_model_exclusions: Array.from(exclusions),
  };
}

/**
 * 從 entity_model_relations 中提取所有被引用的 model ID，
 * 然後從 device_models 表抓取完整資料並回傳 Map。
 */
export async function fetchReferencedModels(
  supabase: any,
  allRelations: any[],
  pageSize = 1000,
): Promise<Map<string, any>> {
  const referencedModelIds = [...new Set(
    (allRelations || [])
      .filter((r: any) => r.model_id)
      .map((r: any) => r.model_id as string)
  )];

  const allModels: any[] = [];
  if (referencedModelIds.length > 0) {
    for (let i = 0; i < referencedModelIds.length; i += pageSize) {
      const batch = referencedModelIds.slice(i, i + pageSize);
      const { data } = await supabase.from('device_models').select('id, name, aliases').in('id', batch);
      if (data) allModels.push(...data);
    }
  }

  const map = new Map<string, any>();
  allModels.forEach(m => map.set(m.id, m));
  return map;
}

/**
 * 從 device_model_groups 抓取完整資料並回傳 Map。
 */
export async function fetchDeviceModelGroups(
  supabase: any,
): Promise<Map<string, any>> {
  const { data: allGroupsWithItems } = await supabase
    .from('device_model_groups')
    .select('id, name, device_model_group_items(device_models(id, name, aliases))');

  const map = new Map<string, any>();
  allGroupsWithItems?.forEach((g: any) => map.set(g.id, g));
  return map;
}
