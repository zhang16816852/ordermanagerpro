export type ClassificationNode = {
  id: string;
  name: string;
  count?: number;
  children?: ClassificationNode[];
};

export type ClassificationVariant = 'vertical' | 'horizontal' | 'responsive';

export type BrandChildNode = {
  id: string;
  name: string;
  count?: number;
};

export type BrandNode = {
  id: string;
  name: string;
  count?: number;
  children?: BrandChildNode[];
};

export type DeviceModelTreeNode = Record<
  string,
  Record<string, { name: string; count: number }[]>
>;
