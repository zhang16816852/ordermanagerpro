export interface PriceEntry {
  productId: string;
  variantId?: string;
  wholesalePrice: string;
}

export interface ExistingStorePrice {
  product_id: string;
  variant_id: string | null;
  wholesale_price: number | null;
}
