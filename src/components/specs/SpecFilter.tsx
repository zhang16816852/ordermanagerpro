import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useEffect } from "react";
import { useSpecStore } from "@/store/useSpecStore";

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

function RangeSliderFilter({
  values,
  specKey,
  selectedRange,
  onChange,
}: {
  values: string[];
  specKey: string;
  selectedRange?: string;
  onChange: (range: string | null) => void;
}) {
  const allNumbers = values.flatMap(extractNumbers).filter((n) => !isNaN(n));
  const minBound = allNumbers.length > 0 ? Math.floor(Math.min(...allNumbers)) : 0;
  const maxBound = allNumbers.length > 0 ? Math.ceil(Math.max(...allNumbers)) : 100;

  const currentMin = selectedRange ? Number(selectedRange.split("-")[0]) : minBound;
  const currentMax = selectedRange ? Number(selectedRange.split("-")[1]) : maxBound;

  if (allNumbers.length === 0) return <p className="text-xs text-muted-foreground italic">無數值可篩選</p>;

  return (
    <div className="w-full max-w-full px-2 pb-2 pt-4 space-y-4 overflow-visible">
      <Slider className="w-full touch-none"
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
            清除範圍
          </Button>
        </div>
      )}
    </div>
  );
}

export interface SpecFilterProps {
  availableSpecs: Record<string, string[]>;
  specFields?: any[];
  selectedSpecs: Record<string, string[]>;
  onSpecChange: (key: string, values: string[]) => void;
  maxListHeight?: string;
}

export function SpecFilter({
  availableSpecs,
  specFields = [],
  selectedSpecs,
  onSpecChange,
  maxListHeight = "max-h-48",
}: SpecFilterProps) {
  const { specMap, fetchSpecs } = useSpecStore();

  useEffect(() => {
    if (specMap.size === 0) {
      fetchSpecs();
    }
  }, [fetchSpecs, specMap.size]);

  const specEntries = Object.entries(availableSpecs);

  if (specMap.size === 0 && specEntries.length > 0) {
    return (
      <div className="py-4 text-center text-[10px] text-muted-foreground animate-pulse">
        載入規格中...
      </div>
    );
  }

  if (specEntries.length === 0) {
    return (
      <div className="text-center py-4 bg-muted/20 rounded-lg border border-dashed">
        <p className="text-[10px] text-muted-foreground italic">目前沒有可篩選的規格</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 w-full">
      {specEntries.map(([key, values]) => {
        const parts = key.split(":");
        const specId = parts.length === 3 ? parts[1] : parts.length === 2 ? parts[1] : key;

        if (key.startsWith("core:")) {
          const displayName = specId;
          return (
            <div key={key} className="space-y-3">
              <h4 className="text-xs font-semibold text-foreground/80">{displayName}</h4>
              <div className={`space-y-2 ${maxListHeight} overflow-y-auto pr-2`}>
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
                    <Label htmlFor={`spec-${key}-${val}`} className="text-sm font-normal cursor-pointer flex-1 py-0.5 text-muted-foreground hover:text-foreground">
                      {val}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        const specDef = specFields.find((f) => f.id === specId || f.name === specId) || specMap.get(specId);
        const filterConfig = getFilterConfig(specDef);

        if (filterConfig && filterConfig.enabled === false) return null;

        let displayMode = filterConfig?.display_mode || "auto";

        if (displayMode === "auto" && specDef) {
          if (specDef.type === "number_with_unit" && values.length > 5) {
            displayMode = "range";
          } else {
            displayMode = "checkbox";
          }
        }

        const displayName = specDef ? specDef.name : `未知規格 (${specId})`;
        return (
          <div key={key} className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-foreground/80">{displayName}</h4>
              {displayMode === "range" && selectedSpecs[key]?.[0] && (
                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                  {selectedSpecs[key][0]}
                </span>
              )}
            </div>

            {displayMode === "range" ? (
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
              <div className={`space-y-2 ${maxListHeight} overflow-y-auto pr-2`}>
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
                          const cleanedCurrent = current.filter((c) => !c.includes("-"));
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
