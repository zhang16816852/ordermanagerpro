import { useDictionaryCache } from './useDictionaryCache';

export interface DeviceModel {
    id: string;
    name: string;
    brand_id: string | null;
    sort_order: number;
    aliases: string[] | null;
    device_series: string | null;
}

export function useDeviceModels() {
    const { deviceModels, isLoading } = useDictionaryCache();
    
    return {
        data: deviceModels,
        isLoading
    };
}

