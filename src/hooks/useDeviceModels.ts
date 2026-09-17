import { useMemo } from 'react';
import { useDictionaryCache } from './useDictionaryCache';
import { ModelPickerOption } from '@/components/repair/ModelPicker';

export interface DeviceModelOption extends ModelPickerOption {
    brand_id: string | null;
    sort_order: number;
    device_series: string | null;
}

export function useDeviceModels() {
    const { deviceModels, brands, isLoading } = useDictionaryCache();

    const data = useMemo<DeviceModelOption[]>(() => {
        const brandMap = new Map<string, string>();
        brands.forEach((b: any) => {
            if (b?.id && b?.name) brandMap.set(b.id, b.name);
        });
        return deviceModels.map((m: any) => ({
            id: m.id,
            name: m.name,
            brand_id: m.brand_id ?? null,
            sort_order: m.sort_order ?? 0,
            device_series: m.device_series ?? null,
            device_type: m.device_type ?? null,
            specifications: m.specifications,
            brand_name: m.brand_id ? brandMap.get(m.brand_id) ?? null : null,
            aliases: Array.isArray(m.aliases) ? m.aliases.filter((a: string) => a) : null,
        })) as DeviceModelOption[];
    }, [deviceModels, brands]);

    return {
        data,
        isLoading
    };
}