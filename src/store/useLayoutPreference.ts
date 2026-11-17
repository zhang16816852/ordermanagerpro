import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LayoutPreference = 'auto' | 'mobile' | 'desktop';

interface LayoutPreferenceState {
  preference: LayoutPreference;
  setPreference: (p: LayoutPreference) => void;
  cycle: () => void;
}

const ORDER: LayoutPreference[] = ['auto', 'mobile', 'desktop'];

export const useLayoutPreference = create<LayoutPreferenceState>()(
  persist(
    (set, get) => ({
      preference: 'auto',
      setPreference: (p) => set({ preference: p }),
      cycle: () => {
        const cur = get().preference;
        const idx = ORDER.indexOf(cur);
        set({ preference: ORDER[(idx + 1) % ORDER.length] });
      },
    }),
    { name: 'layout-preference' }
  )
);

export const LAYOUT_LABELS: Record<LayoutPreference, string> = {
  auto: '自動（依視窗）',
  mobile: '強制手機版',
  desktop: '強制桌面版',
};