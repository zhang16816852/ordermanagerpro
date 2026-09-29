import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import {
  formatAddress,
  getCityDistrictOfPostal,
  getDistrictsOfCity,
  getPostalOf,
  getTaiwanCities,
  parseTaiwanAddressText,
} from "@/utils/taiwanAddress";

export type ShippingAddressValue = {
  recipient: string;
  phone: string;
  postal_code: string;
  city: string;
  district: string;
  address: string;
};

interface ShippingAddressFieldsProps {
  value: ShippingAddressValue;
  onChange: (value: ShippingAddressValue) => void;
  className?: string;
  prefix?: string; // 多實例時 input id 前綴
  hideContact?: boolean; // 隱藏收件人/電話（如店鋪營業地址）
  hideAddress?: boolean; // 隱藏地址欄位、僅保留收件人/電話（如地址沿用他處時）
}

const EMPTY = { recipient: "", phone: "", postal_code: "", city: "", district: "", address: "" };

// 全站共用：收件地址欄位（縣市→鄉鎮級聯、郵區自動帶出、可手動覆寫郵區）
export function ShippingAddressFields({ value, onChange, className, prefix = "addr", hideContact = false, hideAddress = false }: ShippingAddressFieldsProps) {
  const v = { ...EMPTY, ...(value || {}) };
  const districts = v.city ? getDistrictsOfCity(v.city) : [];
  const hintPostal = v.city && v.district ? getPostalOf(v.city, v.district) : null;
  const { postal_code: vPostal, city: vCity, district: vDistrict, address: vAddress } = v;

  const patch = (p: Partial<ShippingAddressValue>) => onChange({ ...v, ...p });

  // 完整地址欄：本元件內部 state（不綁 value）。單向鏈避免循環——
  // local→parent 只在 blur 解析時寫回；parent→local 只經下方 effect（依 primitive 值，非 v 物件）。
  const [fullText, setFullText] = useState(() => formatAddress(v));
  useEffect(() => {
    setFullText(formatAddress({ postal_code: vPostal, city: vCity, district: vDistrict, address: vAddress }));
  }, [vPostal, vCity, vDistrict, vAddress]);

  const handleFullBlur = () => {
    const raw = fullText.trim();
    if (!raw) return;
    const parsed = parseTaiwanAddressText(raw);
    const next: Partial<ShippingAddressValue> = {};
    if (parsed.postal_code) next.postal_code = parsed.postal_code;
    if (parsed.city) next.city = parsed.city;
    if (parsed.district) next.district = parsed.district;
    if (parsed.address) next.address = parsed.address;
    if (Object.keys(next).length > 0) onChange({ ...v, ...next });
    setFullText(formatAddress({ ...v, ...next }));
  };

  const handlePostalBlur = () => {
    const code = v.postal_code.trim();
    if (!code) return;
    const loc = getCityDistrictOfPostal(code);
    if (loc) patch({ city: loc.city, district: loc.district });
  };

  const handleCity = (city: string) => {
    const next: Partial<ShippingAddressValue> = { city, district: "" };
    if (city) {
      const ds = getDistrictsOfCity(city);
      if (ds.length === 1) {
        next.district = ds[0];
        next.postal_code = getPostalOf(city, ds[0]) || "";
      } else {
        next.postal_code = "";
      }
    }
    patch(next);
  };

  const handleDistrict = (district: string) => {
    patch({ district, postal_code: getPostalOf(v.city, district) || "" });
  };

  return (
    <div className={cn("grid gap-3", className)}>
      {!hideAddress && (
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-full`}>完整地址（自動分欄）</Label>
          <Input
            id={`${prefix}-full`}
            value={fullText}
            onChange={(e) => setFullText(e.target.value)}
            onBlur={handleFullBlur}
            placeholder="例：640雲林縣斗六市鎮南里中山路286-3號（郵遞區號可省略）"
          />
        </div>
      )}
      {!hideContact && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-recipient`}>收件人</Label>
            <Input
              id={`${prefix}-recipient`}
              value={v.recipient}
              onChange={(e) => patch({ recipient: e.target.value })}
              placeholder="收件人姓名"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-phone`}>電話</Label>
            <Input
              id={`${prefix}-phone`}
              value={v.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              placeholder="聯絡電話"
            />
          </div>
        </div>
      )}
      {!hideAddress && (
        <>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${prefix}-postal`}>郵遞區號</Label>
              <Input
                id={`${prefix}-postal`}
                value={v.postal_code}
                onChange={(e) => patch({ postal_code: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                onBlur={handlePostalBlur}
                placeholder={hintPostal || "自動帶入"}
                className={cn(hintPostal && !v.postal_code && "text-muted-foreground")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>縣市</Label>
              <SearchableSelect
                options={getTaiwanCities().map((c) => ({ id: c, name: c }))}
                value={v.city || null}
                onChange={(id) => handleCity(id || "")}
                placeholder="選擇縣市"
                searchPlaceholder="搜尋縣市..."
                emptyText="找不到符合的縣市"
                className="h-10"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>鄉鎮市區</Label>
            <SearchableSelect
              options={districts.map((d) => ({
                id: d,
                name: d,
                subLabel: v.city && getPostalOf(v.city, d) ? `郵遞區號 ${getPostalOf(v.city, d)}` : undefined,
              }))}
              value={v.district || null}
              onChange={(id) => handleDistrict(id || "")}
              placeholder={v.city ? "選擇鄉鎮市區" : "請先選擇縣市"}
              searchPlaceholder="搜尋鄉鎮市區..."
              emptyText="找不到符合的鄉鎮市區"
              disabled={!v.city}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-address`}>詳細地址</Label>
            <Input
              id={`${prefix}-address`}
              value={v.address}
              onChange={(e) => patch({ address: e.target.value })}
              placeholder="街道巷弄門牌"
            />
          </div>
        </>
      )}
    </div>
  );
}

export function isEmptyShippingAddress(v: Partial<ShippingAddressValue> | null | undefined): boolean {
  if (!v) return true;
  return !v.recipient && !v.phone && !v.city && !v.district && !v.address && !v.postal_code;
}