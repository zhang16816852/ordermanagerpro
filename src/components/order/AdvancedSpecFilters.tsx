import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatSpecValue } from "@/utils/specLogic";
import { useEffect } from "react";
import { useSpecStore } from "@/store/useSpecStore";

// 解析字串中的所有數字
const extractNumbers = (str: string) => {
    const matches = str.match(/\d+(\.\d+)?/g);
    return matches ? matches.map(Number) : [];
};

function getFilterConfig(specDef: any) {
    if (!specDef || !specDef.configuration) return undefined;
    const config = Array.isArray(specDef.configuration)
        ? specDef.configuration[0]
        : specDef.configuration;
    return config?.filter_config;
}

// 內部區間篩選拉桿組件
function RangeSliderFilter({
    values,
    specKey,
    selectedRange,
    onChange
}: {
    values: string[];
    specKey: string;
    selectedRange?: string; // 格式如 'MIN-MAX'
    onChange: (range: string | null) => void;
}) {
    // 找出所有可能數值的極值
    const allNumbers = values.flatMap(extractNumbers).filter(n => !isNaN(n));
    const minBound = allNumbers.length > 0 ? Math.floor(Math.min(...allNumbers)) : 0;
    const maxBound = allNumbers.length > 0 ? Math.ceil(Math.max(...allNumbers)) : 100;

    // 解析目前設定
    const currentMin = selectedRange ? Number(selectedRange.split('-')[0]) : minBound;
    const currentMax = selectedRange ? Number(selectedRange.split('-')[1]) : maxBound;

    // 如果沒有任何數字，不顯示
    if (allNumbers.length === 0) return <p className="text-xs text-muted-foreground italic">無有效數值可供篩選</p>;

    return (
        <div className="px-2 pb-2 pt-4 space-y-4">
            <Slider
                defaultValue={[minBound, maxBound]}
                value={[currentMin, currentMax]}
                min={minBound}
                max={maxBound}
                step={maxBound - minBound > 100 ? 10 : 1}
                onValueChange={(val) => {
                    onChange(`${val[0]}-${val[1]}`);
                }}
            />
            <div className="flex justify-between items-center text-xs text-muted-foreground font-mono">
                <span>{currentMin}</span>
                <span>{currentMax}</span>
            </div>
            {selectedRange && (
                <div className="flex justify-end">
                    <Button variant="ghost" size="sm" className="h-5 text-[10px] text-muted-foreground" onClick={() => onChange(null)}>
                        清除區間
                    </Button>
                </div>
            )}
        </div>
    );
}

interface AdvancedSpecFiltersProps {
    availableSpecs: Record<string, string[]>;
    specFields: any[];
    selectedSpecs: Record<string, string[]>;
    onSpecChange: (key: string, values: string[]) => void;
}

export function AdvancedSpecFilters({
    availableSpecs,
    specFields,
    selectedSpecs,
    onSpecChange
}: AdvancedSpecFiltersProps) {
    const { specMap, fetchSpecs } = useSpecStore();

    // 💡 修正 1: 確保組件掛載時會主動拉取規格字典，防止顯示 UUID
    useEffect(() => {
        if (specMap.size === 0) {
            fetchSpecs();
        }
    }, [fetchSpecs, specMap.size]);

    // 監控目前被選取的選項，並將路徑轉換為中文顯示在 Console
    useEffect(() => {
        const coreLabelMap: Record<string, string> = { 'option_1': '規格選項 1', 'option_2': '規格選項 2', 'option_3': '顏色' };

        const readableLogs = Object.entries(selectedSpecs).reduce((acc, [key, values]) => {
            const parts = key.split(':');
            const parentId = parts[0];
            const specId = parts.length >= 2 ? parts[1] : key;

            let pathName = "";
            if (key.startsWith('core:')) {
                pathName = `核心規格 > ${coreLabelMap[specId] || specId}`;
            } else {
                // 優先從 specFields 找，找不到再從全域 specMap 找
                const specDef = specFields.find(f => f.id === specId) || specMap.get(specId);
                const parentDef = specFields.find(f => f.id === parentId) || specMap.get(parentId);
                
                const parentName = parentDef ? parentDef.name : (parentId === 'root' ? '根層級' : '父層級');
                const specName = specDef ? specDef.name : specId;
                pathName = `${parentName} > ${specName}`;
            }

            acc[pathName] = values;
            return acc;
        }, {} as Record<string, string[]>);

        if (Object.keys(selectedSpecs).length > 0) {
            
        }
    }, [selectedSpecs, specFields, specMap]); // 當 specMap 載入後，Console 也會更新

    const specEntries = Object.entries(availableSpecs);

    // 💡 修正 2: 如果字典還在載入中，可以顯示一個 Loading 狀態，避免用戶看到一堆 UUID
    if (specMap.size === 0 && specEntries.length > 0) {
        return (
            <div className="py-4 text-center text-[10px] text-muted-foreground animate-pulse">
                正在載入規格名稱...
            </div>
        );
    }

    if (specEntries.length === 0) {
        return (
            <div className="text-center py-4 bg-muted/20 rounded-lg border border-dashed">
                <p className="text-[10px] text-muted-foreground italic">目前此分類無可用的規格篩選</p>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {specEntries.map(([key, values]) => {
                const parts = key.split(':');
                const specId = parts.length === 3 ? parts[1] : (parts.length === 2 ? parts[1] : key);

                // 處理核心選項 (Core Options)
                if (key.startsWith('core:')) {
                    const coreLabelMap: Record<string, string> = {
                        'option_1': '規格選項 1',
                        'option_2': '規格選項 2',
                        'option_3': '顏色'
                    };
                    const displayName = coreLabelMap[specId] || specId;
                    return (
                        <div key={key} className="space-y-3">
                            <h4 className="text-xs font-semibold text-foreground/80">{displayName}</h4>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                {values.map((val) => (
                                    <div key={val} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`spec-${key}-${val}`}
                                            checked={(selectedSpecs[key] || []).includes(val)}
                                            onCheckedChange={(checked) => {
                                                const current = selectedSpecs[key] || [];
                                                if (checked) {
                                                    onSpecChange(key, [...current, val]);
                                                } else {
                                                    onSpecChange(key, current.filter((v) => v !== val));
                                                }
                                            }}
                                        />
                                        <Label
                                            htmlFor={`spec-${key}-${val}`}
                                            className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground"
                                        >
                                            {val}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }

                // 尋找規格定義
                const specDef = specFields.find(f => f.id === specId || f.name === specId) || specMap.get(specId);
                const filterConfig = getFilterConfig(specDef);

                // 如果明確設定不啟用篩選，則跳過；但如果只是找不到定義，我們仍然顯示以利除錯
                if (filterConfig && filterConfig.enabled === false) return null;

                let displayMode = filterConfig?.display_mode || 'auto';

                if (displayMode === 'auto' && specDef) {
                    if (specDef.type === 'number_with_unit' && values.length > 5) {
                        displayMode = 'range';
                    } else {
                        displayMode = 'checkbox';
                    }
                }

                const displayName = specDef ? specDef.name : `未知規格 (${specId})`;
                return (
                    <div key={key} className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-xs font-semibold text-foreground/80">{displayName}</h4>
                            {displayMode === 'range' && selectedSpecs[key]?.[0] && (
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                                    {selectedSpecs[key][0]}
                                </span>
                            )}
                        </div>

                        {displayMode === 'range' ? (
                            <RangeSliderFilter
                                values={values}
                                specKey={key}
                                selectedRange={selectedSpecs[key]?.[0]}
                                onChange={(range) => {
                                    if (range) {
                                        onSpecChange(key, [range]);
                                    } else {
                                        onSpecChange(key, []);
                                    }
                                }}
                            />
                        ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                {values
                                    .filter((val) => {
                                        if (specDef?.type === "boolean") {
                                            return val === "true" || val === "支援";
                                        }
                                        return true;
                                    })
                                    .map((val) => (
                                        <div key={val} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`spec-${key}-${val}`}
                                                checked={(selectedSpecs[key] || []).includes(val)}
                                                onCheckedChange={(checked) => {
                                                    const current = selectedSpecs[key] || [];
                                                    const cleanedCurrent = current.filter(c => !c.includes('-'));
                                                    if (checked) {
                                                        onSpecChange(key, [...cleanedCurrent, val]);
                                                    } else {
                                                        onSpecChange(key, cleanedCurrent.filter((v) => v !== val));
                                                    }
                                                }}
                                            />
                                            <Label
                                                htmlFor={`spec-${key}-${val}`}
                                                className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground"
                                            >
                                                {val}
                                            </Label>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}