import { usePublicDeviceModels } from "@/storefront/usePublicCatalog";
import { MegaMenu, type MegaMenuItem } from "@/components/storefront/MegaMenu";

export function NavDeviceModelMenu() {
  const { data: models } = usePublicDeviceModels();

  const byBrand: Record<string, { id: string; name: string; brand_name: string | null }[]> = {};
  (models ?? []).forEach((m: any) => {
    const key = m.brand_id ?? "__unassigned__";
    if (!byBrand[key]) byBrand[key] = [];
    byBrand[key].push({ id: m.id, name: m.name, brand_name: m.brand_name });
  });

  const brandKeys = Object.keys(byBrand).sort((a, b) => {
    if (a === "__unassigned__") return 1;
    if (b === "__unassigned__") return -1;
    const na = byBrand[a][0]?.brand_name || a;
    const nb = byBrand[b][0]?.brand_name || b;
    return na.localeCompare(nb);
  });

  const items: MegaMenuItem[] = brandKeys.map((bid) => {
    const ms = byBrand[bid];
    const label = bid === "__unassigned__" ? "其他" : ms[0]?.brand_name || bid;
    return {
      id: bid,
      name: label,
      children: ms.map((m) => ({
        id: m.id,
        name: m.name,
        href: `/shop?model=${m.id}`,
      })),
    };
  });

  return (
    <MegaMenu
      label="裝置型號"
      items={items}
      width="w-[min(90vw,640px)]"
      footerHref="/shop"
      footerLabel="查看全部商品 →"
    />
  );
}
