import { usePublicBrands, usePublicBrandSeries } from "@/storefront/usePublicCatalog";
import { MegaMenu, type MegaMenuItem } from "@/components/storefront/MegaMenu";

export function NavBrandMenu() {
  const { data: brands } = usePublicBrands();
  const { data: series } = usePublicBrandSeries();

  const seriesByBrand: Record<string, any[]> = {};
  (series ?? []).forEach((s: any) => {
    if (!seriesByBrand[s.brand_id]) seriesByBrand[s.brand_id] = [];
    seriesByBrand[s.brand_id].push(s);
  });

  const items: MegaMenuItem[] = (brands ?? []).map((b: any) => ({
    id: b.id,
    name: b.name,
    count: b.product_count,
    children: (seriesByBrand[b.id] ?? []).map((s: any) => ({
      id: s.series_id,
      name: s.series_name,
      count: s.product_count,
      href: `/shop?brand=${b.id}&series=${s.series_id}`,
    })),
  }));

  return (
    <MegaMenu
      label="品牌 / 系列"
      items={items}
      width="w-[min(90vw,520px)]"
      footerHref="/shop"
      footerLabel="查看全部商品 →"
    />
  );
}
