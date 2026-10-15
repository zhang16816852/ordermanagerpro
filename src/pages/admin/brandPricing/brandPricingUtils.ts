export interface VariantLike {
  id: string;
  product_id?: string | null;
  name?: string | null;
  sku?: string | null;
  status?: string | null;
  wholesale_price: number;
  retail_price: number;
}

export interface OptionFacetValue {
  value: string;
  count: number;
}

export interface OptionFacet {
  name: string;
  values: OptionFacetValue[];
}

export type DisplayedVariantsOf = <T extends VariantLike>(variants: T[]) => T[];

export const optionValueKey = (
  ov: { label?: string | null; value?: string | null },
): string => (ov.label ?? ov.value ?? '').trim();

export const getProductVariants = (
  allVariants: VariantLike[],
  productId: string,
): VariantLike[] =>
  allVariants.filter((v) => v.product_id === productId && v.status === 'active');
