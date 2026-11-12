import { usePublicDeviceModels, type PublicDeviceModel } from "@/storefront/usePublicCatalog";
import { DeviceModelClassifier } from "@/components/classification/DeviceModelClassifier";

export type PublicDeviceModelClassifierProps = {
  selectedModels: string[];
  onModelToggle: (name: string) => void;
  searchable?: boolean;
  defaultExpanded?: boolean;
  variant?: "vertical" | "horizontal" | "responsive";
  showCounts?: boolean;
  className?: string;
};

// Note: public device models RPC returns flat list (id/name/brand_id/product_count).
// We group by brand_id; series grouping uses device_series from the device model store
// when available, otherwise falls back to a single "__unassigned__" bucket per brand.
export function PublicDeviceModelClassifier(props: PublicDeviceModelClassifierProps) {
  const { data: models } = usePublicDeviceModels();

  const tree: Record<string, Record<string, { name: string; count: number }[]>> = {};
  const brandNameMap: Record<string, string> = {};

  (models ?? []).forEach((m: PublicDeviceModel) => {
    const brandId = m.brand_id ?? "__unassigned__";
    if (!tree[brandId]) tree[brandId] = {};
    const seriesKey = "__unassigned__";
    if (!tree[brandId][seriesKey]) tree[brandId][seriesKey] = [];
    tree[brandId][seriesKey].push({ id: m.id, name: m.name, count: m.product_count });
    if (m.brand_id && !brandNameMap[m.brand_id]) {
      brandNameMap[m.brand_id] = m.brand_id;
    }
  });

  return (
    <DeviceModelClassifier
      tree={tree}
      brandNameMap={brandNameMap}
      selectedModels={props.selectedModels}
      onModelToggle={props.onModelToggle}
      searchable={props.searchable ?? true}
      defaultExpanded={props.defaultExpanded}
      variant={props.variant ?? "responsive"}
      showCounts={props.showCounts ?? true}
      className={props.className}
    />
  );
}
