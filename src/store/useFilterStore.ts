import { create } from 'zustand';

interface FilterState {
  search: string;
  selectedCategory: string | null;
  selectedBrands: string[];
  selectedSeries: string[];
  selectedDeviceModels: string[];
  selectedSpecs: Record<string, string[]>;

  setSearch: (val: string) => void;
  setSelectedCategory: (val: string | null) => void;
  setSelectedBrands: (val: string[]) => void;
  setSelectedSeries: (val: string[]) => void;
  setSelectedDeviceModels: (val: string[]) => void;
  setSelectedSpecs: (val: Record<string, string[]>) => void;
  clearAll: () => void;

  toSearchParams: () => Record<string, string | null>;
  fromSearchParams: (params: URLSearchParams) => void;
}

const INITIAL: Pick<FilterState, 'search' | 'selectedCategory' | 'selectedBrands' | 'selectedSeries' | 'selectedDeviceModels' | 'selectedSpecs'> = {
  search: '',
  selectedCategory: null,
  selectedBrands: [],
  selectedSeries: [],
  selectedDeviceModels: [],
  selectedSpecs: {},
};

function parseSetFromUrl(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').filter(Boolean);
}

function parseSpecsFromUrl(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  try { return JSON.parse(decodeURIComponent(raw)); } catch { return {}; }
}

export const useFilterStore = create<FilterState>((set) => ({
  ...INITIAL,

  setSearch: (val) => set({ search: val }),
  setSelectedCategory: (val) => set({ selectedCategory: val }),
  setSelectedBrands: (val) => set({ selectedBrands: val }),
  setSelectedSeries: (val) => set({ selectedSeries: val }),
  setSelectedDeviceModels: (val) => set({ selectedDeviceModels: val }),
  setSelectedSpecs: (val) => set({ selectedSpecs: val }),
  clearAll: () => set(INITIAL),

  toSearchParams: () => {
    const state = useFilterStore.getState();
    return {
      search: state.search || null,
      category: state.selectedCategory || null,
      brands: state.selectedBrands.length > 0 ? state.selectedBrands.join(',') : null,
      series: state.selectedSeries.length > 0 ? state.selectedSeries.join(',') : null,
      deviceModels: state.selectedDeviceModels.length > 0 ? state.selectedDeviceModels.join(',') : null,
      specs: Object.keys(state.selectedSpecs).length > 0
        ? encodeURIComponent(JSON.stringify(state.selectedSpecs))
        : null,
    };
  },

  fromSearchParams: (params) => set({
    search: params.get('search') || '',
    selectedCategory: params.get('category') || null,
    selectedBrands: parseSetFromUrl(params.get('brands')),
    selectedSeries: parseSetFromUrl(params.get('series')),
    selectedDeviceModels: parseSetFromUrl(params.get('deviceModels')),
    selectedSpecs: parseSpecsFromUrl(params.get('specs')),
  }),
}));

export function activeFilterCount(): number {
  const s = useFilterStore.getState();
  let count = 0;
  if (s.selectedCategory) count++;
  count += s.selectedBrands.length;
  count += s.selectedSeries.length;
  count += s.selectedDeviceModels.length;
  count += Object.values(s.selectedSpecs).reduce((sum, arr) => sum + arr.length, 0);
  return count;
}
