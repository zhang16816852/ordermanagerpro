import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, CalendarIcon, X } from "lucide-react";
import { StorePicker } from "@/components/ui/StorePicker";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import type { StoreOption, RepOption } from "./salesNotesTypes";
import type { SalesNoteAggregateItem } from "@/components/sales/SalesNoteProductView";

interface SalesNotesFilterBarProps {
  viewMode: "notes" | "product";
  search: string;
  onSearchChange: (value: string) => void;
  stores: StoreOption[] | undefined;
  storeFilter: string[];
  onStoreFilterChange: (next: string[]) => void;
  repsData: RepOption[];
  repFilter: string;
  onRepFilterChange: (value: string) => void;
  businessFilter: string;
  onBusinessFilterChange: (value: string) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;
  onClearDateRange: () => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  aggregatedProducts: SalesNoteAggregateItem[];
}

export function SalesNotesFilterBar({
  viewMode,
  search,
  onSearchChange,
  stores,
  storeFilter,
  onStoreFilterChange,
  repsData,
  repFilter,
  onRepFilterChange,
  businessFilter,
  onBusinessFilterChange,
  dateRange,
  onDateRangeChange,
  onClearDateRange,
  statusFilter,
  onStatusFilterChange,
  aggregatedProducts,
}: SalesNotesFilterBarProps) {
  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-2 shrink-0">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={viewMode === "product" ? "搜尋商品名稱或 SKU..." : "搜尋銷售單..."}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex-1 min-w-[130px]">
          <StorePicker
            stores={stores || []}
            value={storeFilter}
            multiple
            onChange={(v) => onStoreFilterChange(v as string[])}
            placeholder="選擇店鋪（預設全部）"
            searchPlaceholder="搜尋店鋪..."
            disabled={!stores || stores.length === 0}
          />
        </div>

        <Select value={repFilter} onValueChange={onRepFilterChange}>
          <SelectTrigger className="flex-1 min-w-[110px]">
            <SelectValue placeholder="全部業務" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部業務</SelectItem>
            {repsData.map((r) => (
              <SelectItem key={r.user_id} value={r.user_id}>
                {r.full_name || r.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 有業務 / 無業務 篩選（決定該單顯示「業務利潤」或「毛利」） */}
        <Select value={businessFilter} onValueChange={onBusinessFilterChange}>
          <SelectTrigger className="flex-1 min-w-[120px]">
            <SelectValue placeholder="全部單據" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部單據</SelectItem>
            <SelectItem value="with">有業務</SelectItem>
            <SelectItem value="without">無業務</SelectItem>
          </SelectContent>
        </Select>

        {/* Date range filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "flex-1 min-w-[150px] justify-start text-left font-normal",
                !dateRange && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "yyyy/MM/dd")} ~ {format(dateRange.to, "yyyy/MM/dd")}
                  </>
                ) : (
                  format(dateRange.from, "yyyy/MM/dd")
                )
              ) : (
                <span>選擇日期範圍</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={(range) => {
                const resolved = range?.from && !range.to
                  ? { from: range.from, to: range.from }
                  : range;
                onDateRangeChange(resolved);
              }}
              numberOfMonths={2}
              locale={zhTW}
            />
          </PopoverContent>
        </Popover>
        {dateRange && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="清除日期篩選"
            onClick={onClearDateRange}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2 mb-2 shrink-0">
        <div className="flex gap-1">
          {[
            { value: "all", label: "全部" },
            { value: "unreceived", label: "未收款" },
            { value: "received", label: "已收款" },
          ].map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? "default" : "outline"}
              size="sm"
              className="h-7 px-3"
              onClick={() => onStatusFilterChange(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {viewMode === "product" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-xs sm:text-sm shrink-0">
          <div className="flex items-center gap-3">
            <span>商品數: <strong>{aggregatedProducts.length}</strong></span>
            <span className="text-muted-foreground">|</span>
            <span>總件數: <strong>{aggregatedProducts.reduce((s, p) => s + p.totalQuantity, 0)}</strong></span>
            <span className="text-muted-foreground">|</span>
            <span>總金額: <strong>{formatCurrency(aggregatedProducts.reduce((s, p) => s + p.totalAmount, 0))}</strong></span>
          </div>
        </div>
      )}
    </>
  );
}
