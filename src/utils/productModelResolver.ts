/**
 * 共用的產品裝置型號解析邏輯。
 * 從 entity_model_relations 建立索引 Map，再對每個 entity 解析 include/exclude 規則。
 */

export interface ModelMaps {
  linksMap: Map<string, any[]>;
  groupsMap: Map<string, any[]>;
  exclusionsMap: Map<string, any[]>;
  orderedMap: Map<string, Array<{ type: 'model' | 'group' | 'exclude'; id: string; name: string }>>;
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

  return { linksMap, groupsMap, exclusionsMap, orderedMap: new Map() };
}

/**
 * 解析單一 entity (product 或 variant) 的裝置型號關聯
 */
export function processEntityModels(
  entityId: string,
  maps: ModelMaps,
): EntityModelResult {
  const { linksMap, groupsMap, exclusionsMap, orderedMap } = maps;
  const rules: string[] = [];
  const directLinks = linksMap.get(entityId) || [];
  const exclusionLinks = exclusionsMap.get(entityId) || [];
  const groupLinks = groupsMap.get(entityId) || [];

  // 依 orderedMap 產生 device_model_rules（若有的話，否則保持原有行為）
  if (orderedMap && orderedMap.has(entityId)) {
    const ordered = orderedMap.get(entityId)!;
    const exclusionSet = new Set<string>();
    const modelNameMap = new Map<string, string>();

    // 建立 model name 對照
    directLinks.forEach(l => {
      if (l.device_models) modelNameMap.set(l.device_models.id, l.device_models.name);
    });
    groupLinks.forEach(l => {
      if (l.device_model_groups) modelNameMap.set(l.group_id, l.device_model_groups.name || '');
    });

    // 依 ordered 序列產生 rules
    ordered.forEach(entry => {
      if (entry.type === 'model') {
        const name = modelNameMap.get(entry.id) || '';
        if (name && !exclusionSet.has(entry.id)) {
          exclusionSet.add(entry.id);
          rules.push(`exclude:${name}`);
        } else if (name) {
          rules.push(`model:${name}`);
        }
      } else if (entry.type === 'group') {
        const name = modelNameMap.get(entry.id) || '';
        if (name) rules.push(`group:${name}`);
      } else if (entry.type === 'exclude') {
        const name = modelNameMap.get(entry.id) || '';
        if (name) rules.push(`exclude:${name}`);
      }
    });
  } else {
    // 備用：原有行為（excludes → models → groups）
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

  // 若使用 orderedMap 產生 rules，仍需要傳回 device_models / device_model_groups / exclusions
  // 從 links/exclusions 取得基礎資料（保持 UI 相容）
  const exclusionSet = new Set<string>();
  exclusionLinks.forEach(l => {
    if (l.device_models) {
      exclusionSet.add(l.device_models.id);
    }
  });

  const deviceModels = directLinks
    .filter(l => l.device_models && !exclusionSet.has(l.device_models.id))
    .map(l => l.device_models);

  const deviceModelGroups: any[] = [];
  groupLinks.forEach(link => {
    const group = link.device_model_groups;
    if (group) {
      deviceModelGroups.push({ id: group.id, name: group.name || '', items: [] });
    }
  });

  return {
    device_models: deviceModels,
    device_model_groups: deviceModelGroups,
    device_model_rules: rules,
    _expanded_models: Array.from(new Set(deviceModels.map(m => m.name))),
    _expanded_model_aliases: Array.from(new Set([])),
    device_model_exclusions: Array.from(exclusionSet),
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
