import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MarketListingCard, MarketListingSummary } from "@/components/market/MarketListingCard";
import { MarketFiltersDrawer, MarketFilters } from "@/components/market/MarketFiltersDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Search, ShoppingBag, Package, Wrench, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const MAIN_CATS = [
  { value: "3c_product", label: "3C 買賣", icon: Package },
  { value: "repair",     label: "找維修",  icon: Wrench,    soon: true },
  { value: "telecom",    label: "找門號",  icon: ShoppingBag, soon: true },
  { value: "wrapping",   label: "找包膜",  icon: ShoppingBag, soon: true },
];

const EMPTY_FILTERS: MarketFilters = {
  listing_type: "", brand: "", condition: "", priceMin: "", priceMax: "",
};

function countActiveFilters(f: MarketFilters) {
  return [f.listing_type, f.brand, f.condition, f.priceMin, f.priceMax].filter(Boolean).length;
}

export default function MarketPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<MarketListingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<MarketFilters>(EMPTY_FILTERS);
  const [mainCat, setMainCat] = useState("3c_product");

  const fetchListings = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any)
      .from("market_listings")
      .select("id, title, listing_type, sub_category, brand, model, condition, price, images, status, published_at, created_at")
      .eq("status", "active")
      .eq("main_category", mainCat)
      .order("published_at", { ascending: false });

    if (filters.listing_type) q = q.eq("listing_type", filters.listing_type);
    if (filters.brand) q = q.ilike("brand", filters.brand);
    if (filters.condition) q = q.eq("condition", filters.condition);
    if (filters.priceMin) q = q.gte("price", Number(filters.priceMin));
    if (filters.priceMax) q = q.lte("price", Number(filters.priceMax));
    if (search.trim()) q = q.ilike("title", `%${search.trim()}%`);

    const { data, error } = await q.limit(50);
    if (!error && data) setListings(data as MarketListingSummary[]);
    setLoading(false);
  }, [mainCat, filters, search]);

  useEffect(() => {
    const timer = setTimeout(fetchListings, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [fetchListings, search]);

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero Header ── */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-white/8">
        <div className="px-4 pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                媒合市場
              </span>
            </h1>
            {user && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-sm rounded-full border-white/10 h-8"
                  onClick={() => navigate("/market/my-listings")}
                  id="market-my-listings-btn"
                >
                  我的刊登
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 text-sm rounded-full h-8"
                  onClick={() => navigate("/market/create")}
                  id="market-create-btn"
                >
                  <Plus className="h-4 w-4" /> 發布
                </Button>
              </div>
            )}
          </div>

          {/* Category tabs */}
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
            {MAIN_CATS.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.value}
                  onClick={() => !cat.soon && setMainCat(cat.value)}
                  disabled={cat.soon}
                  className={cn(
                    "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all",
                    cat.value === mainCat
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-white/10",
                    cat.soon && "opacity-40 cursor-not-allowed"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {cat.label}
                  {cat.soon && <span className="text-[9px] ml-0.5">即將</span>}
                </button>
              );
            })}
          </div>

          {/* Search + Filter row */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="market-search"
                placeholder="搜尋品牌、型號或關鍵字..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-muted/30 border-white/10 rounded-xl h-9 text-sm"
              />
            </div>
            <MarketFiltersDrawer
              filters={filters}
              onChange={setFilters}
              activeCount={countActiveFilters(filters)}
            />
          </div>
        </div>
      </div>

      {/* ── Listing Grid ── */}
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-7 w-7 animate-spin text-primary/60" />
          </div>
        ) : listings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3 text-center">
            <Package className="h-14 w-14 text-muted-foreground/20" />
            <p className="text-muted-foreground text-sm">目前沒有符合條件的刊登</p>
            {user && (
              <Button variant="outline" size="sm" onClick={() => navigate("/market/create")}>
                <Plus className="h-4 w-4 mr-1" /> 成為第一個發布者
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-3">共 {listings.length} 筆</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {listings.map((l) => (
                <MarketListingCard key={l.id} listing={l} isAuthenticated={!!user} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── FAB (Mobile) ── */}
      {user && (
        <div className="fixed bottom-6 right-4 lg:hidden z-30">
          <Button
            size="lg"
            className="h-14 w-14 rounded-full shadow-lg shadow-primary/30 p-0"
            onClick={() => navigate("/market/create")}
            id="market-fab-create"
          >
            <Plus className="h-6 w-6" />
          </Button>
        </div>
      )}
    </div>
  );
}
