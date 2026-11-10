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
  type PublicBrand,
  type PublicBrandSeries,
  type PublicDeviceModel,
  type PublicSpecOption,
} from "@/storefront/usePublicCatalog";

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
    const map: Record<string, PublicBrandSeries[]> = {};
    (brandSeries ?? []).forEach((s) => {
      if (!map[s.brand_id]) map[s.brand_id] = [];
      map[s.brand_id].push(s);
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

          {/* Brands + Series */}
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
                {(brands ?? []).map((b: PublicBrand) => {
                  const expanded = expandedBrands.has(b.id);
                  const series = seriesByBrand[b.id] ?? [];
                  const brandSelected = filters.brandIds.includes(b.id);
                  return (
                    <div key={b.id}>
                      <div className="flex items-center gap-2 py-1">
                        <Checkbox
                          checked={brandSelected}
                          onCheckedChange={(c) => {
                            const next = c
                              ? [...filters.brandIds, b.id]
                              : filters.brandIds.filter((x) => x !== b.id);
                            onChange({ ...filters, brandIds: next });
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => toggleBrand(b.id)}
                          className="flex flex-1 items-center justify-between text-sm text-sf-muted hover:text-sf-text"
                        >
                          <span>{b.name} <span className="text-xs opacity-60">({b.product_count})</span></span>
                          {series.length > 0 && (expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
                        </button>
                      </div>
                      {expanded && series.length > 0 && (
                        <div className="ml-6 space-y-1">
                          {series.map((s: PublicBrandSeries) => (
                            <label key={s.series_id} className="flex items-center gap-2 py-0.5 text-sm text-sf-muted">
                              <Checkbox
                                checked={filters.seriesIds.includes(s.series_id)}
                                onCheckedChange={(c) => {
                                  const next = c
                                    ? [...filters.seriesIds, s.series_id]
                                    : filters.seriesIds.filter((x) => x !== s.series_id);
                                  onChange({ ...filters, seriesIds: next });
                                }}
                              />
                              {s.series_name} <span className="text-xs opacity-60">({s.product_count})</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Device Models */}
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
              <div className="max-h-60 space-y-1 overflow-y-auto pb-2">
                {(models ?? []).map((m: PublicDeviceModel) => (
                  <label key={m.id} className="flex items-center gap-2 py-0.5 text-sm text-sf-muted">
                    <Checkbox
                      checked={filters.modelIds.includes(m.id)}
                      onCheckedChange={(c) => {
                        const next = c
                          ? [...filters.modelIds, m.id]
                          : filters.modelIds.filter((x) => x !== m.id);
                        onChange({ ...filters, modelIds: next });
                      }}
                    />
                    {m.name} <span className="text-xs opacity-60">({m.product_count})</span>
                  </label>
                ))}
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