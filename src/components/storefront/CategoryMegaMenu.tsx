import { Link } from "react-router-dom";
import { usePublicCategoryTree, type PublicCategoryNode } from "@/storefront/usePublicCatalog";
import { MegaMenu, type MegaMenuItem } from "@/components/storefront/MegaMenu";

function buildTree(nodes: PublicCategoryNode[]) {
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
}

export function CategoryMegaMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { data: catTree } = usePublicCategoryTree();
  const tree = buildTree(catTree ?? []);

  const items: MegaMenuItem[] = tree.map((root) => ({
    id: root.id,
    name: root.name,
    count: root.product_count,
    children: (root.children || []).flatMap((child: any) => {
      const childItem = {
        id: child.id,
        name: child.name,
        count: child.product_count,
        href: `/shop?cat=${child.id}`,
      };
      const grandChildren = (child.children || []).map((g: any) => ({
        id: g.id,
        name: `${child.name} › ${g.name}`,
        count: g.product_count,
        href: `/shop?cat=${g.id}`,
      }));
      return [childItem, ...grandChildren];
    }),
  }));

  return (
    <MegaMenu
      label="商品分類"
      items={items}
      width="w-[min(90vw,720px)]"
      footerHref="/shop"
      footerLabel="查看全部商品 →"
    />
  );
}
