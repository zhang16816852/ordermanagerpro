import { useMemo, useState } from "react";
import { Filter, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  usePublicCategoryTree,
  usePublicBrands,
  usePublicBrandSeries,
  usePublicDeviceModels,
  usePublicSpecOptions,
  type PublicCategoryNode,
  type PublicSpecOption,
} from "@/storefront/usePublicCatalog";
import { BrandClassifier } from "@/components/classification/BrandClassifier";
import { DeviceModelClassifier } from "@/components/classification/DeviceModelClassifier";

export type PublicFilters = {
  categoryId: string | null;
  brandIds: string[];
  seriesIds: string[];
  modelIds: string[];
  specFilters: Record<string, string[]>;
};

type Props = {
  filters: PublicFilters;
  onChange: (next: PublicFilters) => void;
  onClear: () => void;
};

export function PublicCatalogSidebar({ filters, onChange, onClear }: Props) {
  const { data: catTree } = usePublicCategoryTree();
  const { data: brands } = usePublicBrands();
  const { data: brandSeries } = usePublicBrandSeries();
  const { data: models } = usePublicDeviceModels();
  const { data: specOpts } = usePublicSpecOptions(filters.categoryId);

  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["categories"]));
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());

  const toggleSection = (s: string) =>
    setOpenSections((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const toggleCat = (id: string) =>
    setExpandedCats((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleBrand = (id: string) =>
    setExpandedBrands((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Build category tree
  const tree = useMemo(() => {
    const nodes = catTree ?? [];
    const byParent = new Map<string | null, PublicCategoryNode[]>();
    nodes.forEach((n) => {
      const key = n.parent_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(n);
    });
    const build = (parentId: string | null): (PublicCategoryNode & { children: any[] })[] =>
      (byParent.get(parentId) ?? [])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
        .map((n) => ({ ...n, children: build(n.id) }));
    return build(null);
  }, [catTree]);

  const seriesByBrand = useMemo(() => {
    const map: Record<string, { id: string; name: string; count?: number }[]> = {};
    (brandSeries ?? []).forEach((s: any) => {
      if (!map[s.brand_id]) map[s.brand_id] = [];
      map[s.brand_id].push({ id: s.series_id, name: s.series_name, count: s.product_count });
    });
    return map;
  }, [brandSeries]);

  const hasActive =
    filters.categoryId !== null ||
    filters.brandIds.length > 0 ||
    filters.seriesIds.length > 0 ||
    filters.modelIds.length > 0 ||
    Object.keys(filters.specFilters).length > 0;

  const renderCatNode = (node: PublicCategoryNode & { children: any[] }, depth = 0) => {
    const hasChildren = node.children.length > 0;
    const expanded = expandedCats.has(node.id);
    const selected = filters.categoryId === node.id;
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-1 py-1"
          style={{ paddingLeft: depth * 12 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleCat(node.id)}
              className="flex h-5 w-5 items-center justify-center text-sf-muted"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-5 w-5" />
          )}
          <button
            type="button"
            onClick={() => onChange({ ...filters, categoryId: selected ? null : node.id })}
            className={`flex-1 text-left text-sm transition-colors ${
              selected ? "font-medium text-sf-text" : "text-sf-muted hover:text-sf-text"
            }`}
          >
            {node.name}
            <span className="ml-1 text-xs opacity-60">({node.product_count})</span>
          </button>
        </div>
        {hasChildren && expanded && (
          <div>{node.children.map((c: any) => renderCatNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border rounded-xl overflow-hidden shadow-sm">
      <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <Filter className="h-4 w-4" />
          篩選條件
        </div>
        {hasActive && (
          <Button variant="ghost" size="sm" onClick={onClear} className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive">
            重設
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-1">
          {/* Categories */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection("categories")}
              className="flex w-full items-center justify-between py-2 text-sm font-medium text-sf-text"
            >
              <span>商品分類</span>
              {openSections.has("categories") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {openSections.has("categories") && (
              <div className="pb-2">{tree.map((n) => renderCatNode(n))}</div>
            )}
          </div>

          {/* Brands + Series (組件化) */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection("brands")}
              className="flex w-full items-center justify-between py-2 text-sm font-medium text-sf-text"
            >
              <span>品牌 / 系列</span>
              {openSections.has("brands") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {openSections.has("brands") && (
              <div className="space-y-1 pb-2">
                <BrandClassifier
                  brands={(brands ?? []).map((b: any) => ({ id: b.id, name: b.name, count: b.product_count }))}
                  childrenByBrand={seriesByBrand}
                  selectedBrands={filters.brandIds}
                  selectedChildren={filters.seriesIds}
                  onBrandToggle={(id) => {
                    const next = filters.brandIds.includes(id)
                      ? filters.brandIds.filter((x) => x !== id)
                      : [...filters.brandIds, id];
                    onChange({ ...filters, brandIds: next });
                  }}
                  onChildToggle={(id) => {
                    const next = filters.seriesIds.includes(id)
                      ? filters.seriesIds.filter((x) => x !== id)
                      : [...filters.seriesIds, id];
                    onChange({ ...filters, seriesIds: next });
                  }}
                  searchable={false}
                  variant="vertical"
                  showCounts
                />
              </div>
            )}
          </div>

          {/* Device Models (組件化) */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection("models")}
              className="flex w-full items-center justify-between py-2 text-sm font-medium text-sf-text"
            >
              <span>裝置型號</span>
              {openSections.has("models") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {openSections.has("models") && (
              <div className="pb-2">
                <DeviceModelClassifier
                  tree={(() => {
                    const t: Record<string, Record<string, { name: string; count: number }[]>> = {};
                    (models ?? []).forEach((m: any) => {
                      const brandId = m.brand_id ?? "__unassigned__";
                      if (!t[brandId]) t[brandId] = {};
                      if (!t[brandId]["__unassigned__"]) t[brandId]["__unassigned__"] = [];
                      t[brandId]["__unassigned__"].push({ name: m.name, count: m.product_count });
                    });
                    return t;
                  })()}
                  brandNameMap={(() => {
                    const m: Record<string, string> = {};
                    (models ?? []).forEach((x: any) => {
                      if (x.brand_id && !m[x.brand_id]) m[x.brand_id] = x.brand_id;
                    });
                    return m;
                  })()}
                  selectedModels={(models ?? [])
                    .filter((mm: any) => filters.modelIds.includes(mm.id))
                    .map((mm: any) => mm.name)}
                  onModelToggle={(name) => {
                    const found = (models ?? []).find((mm: any) => mm.name === name);
                    if (!found) return;
                    const next = filters.modelIds.includes(found.id)
                      ? filters.modelIds.filter((x) => x !== found.id)
                      : [...filters.modelIds, found.id];
                    onChange({ ...filters, modelIds: next });
                  }}
                  searchable
                  variant="vertical"
                  showCounts
                />
              </div>
            )}
          </div>

          {/* Specs */}
          {filters.categoryId && specOpts && specOpts.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => toggleSection("specs")}
                className="flex w-full items-center justify-between py-2 text-sm font-medium text-sf-text"
              >
                <span>規格篩選</span>
                {openSections.has("specs") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {openSections.has("specs") && (
                <div className="space-y-3 pb-2">
                  {specOpts.map((so: PublicSpecOption) => (
                    <div key={so.spec_id}>
                      <div className="mb-1 text-xs font-medium text-sf-text">{so.spec_name}</div>
                      <div className="space-y-1">
                        {(so.distinct_values ?? []).map((v: any, idx: number) => {
                          const val = typeof v === "string" ? v : JSON.stringify(v);
                          const checked = (filters.specFilters[so.spec_id] ?? []).includes(val);
                          return (
                            <label key={idx} className="flex items-center gap-2 text-sm text-sf-muted">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(c) => {
                                  const cur = filters.specFilters[so.spec_id] ?? [];
                                  const next = c ? [...cur, val] : cur.filter((x) => x !== val);
                                  const newSpecs = { ...filters.specFilters };
                                  if (next.length === 0) delete newSpecs[so.spec_id];
                                  else newSpecs[so.spec_id] = next;
                                  onChange({ ...filters, specFilters: newSpecs });
                                }}
                              />
                              {val}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}