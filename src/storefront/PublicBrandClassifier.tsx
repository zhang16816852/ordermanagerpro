import {
  usePublicBrands,
  usePublicBrandSeries,
  type PublicBrand,
  type PublicBrandSeries,
} from "@/storefront/usePublicCatalog";
import { BrandClassifier } from "@/components/classification/BrandClassifier";

export type PublicBrandClassifierProps = {
  selectedBrands: string[];
  selectedSeries: string[];
  onBrandToggle: (id: string) => void;
  onSeriesToggle: (id: string) => void;
  searchable?: boolean;
  defaultExpanded?: boolean;
  variant?: "vertical" | "horizontal" | "responsive";
  showCounts?: boolean;
  className?: string;
};

export function PublicBrandClassifier(props: PublicBrandClassifierProps) {
  const { data: brands } = usePublicBrands();
  const { data: series } = usePublicBrandSeries();

  const seriesByBrand: Record<string, { id: string; name: string; count?: number }[]> = {};
  (series ?? []).forEach((s: PublicBrandSeries) => {
    if (!seriesByBrand[s.brand_id]) seriesByBrand[s.brand_id] = [];
    seriesByBrand[s.brand_id].push({
      id: s.series_id,
      name: s.series_name,
      count: s.product_count,
    });
  });

  const brandList = (brands ?? []).map((b: PublicBrand) => ({
    id: b.id,
    name: b.name,
    count: b.product_count,
  }));

  return (
    <BrandClassifier
      brands={brandList}
      childrenByBrand={seriesByBrand}
      selectedBrands={props.selectedBrands}
      selectedChildren={props.selectedSeries}
      onBrandToggle={props.onBrandToggle}
      onChildToggle={props.onSeriesToggle}
      childLabel="系列"
      searchable={props.searchable ?? false}
      defaultExpanded={props.defaultExpanded}
      variant={props.variant ?? "responsive"}
      showCounts={props.showCounts ?? true}
      className={props.className}
    />
  );
}
