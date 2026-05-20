import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Eye, EyeOff, ArrowUpDown, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export type MarketListingType = "buy" | "sell" | "service";
export type MarketListingStatus = "active" | "draft" | "completed" | "closed";

export interface MarketListingSummary {
  id: string;
  title: string;
  listing_type: MarketListingType;
  sub_category: string | null;
  brand: string | null;
  model: string | null;
  condition: string | null;
  price: number | null;
  images: string[];
  status: MarketListingStatus;
  published_at: string | null;
  created_at: string;
  author?: { email?: string; full_name?: string | null };
}

interface MarketListingCardProps {
  listing: MarketListingSummary;
  isAuthenticated: boolean;
}

const TYPE_CONFIG: Record<MarketListingType, { label: string; color: string; bg: string }> = {
  buy:     { label: "收購", color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/30" },
  sell:    { label: "出售", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
  service: { label: "服務", color: "text-purple-400",  bg: "bg-purple-500/10 border-purple-500/30" },
};

export function MarketListingCard({ listing, isAuthenticated }: MarketListingCardProps) {
  const typeConf = TYPE_CONFIG[listing.listing_type];
  const coverImage = listing.images?.[0] ?? null;
  const daysLeft = listing.published_at
    ? Math.max(0, 7 - Math.floor((Date.now() - new Date(listing.published_at).getTime()) / 86400000))
    : null;

  return (
    <Link to={`/market/${listing.id}`} className="block group focus:outline-none">
      <Card className="overflow-hidden border border-white/8 bg-card/60 backdrop-blur-sm transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 active:translate-y-0">
        {/* Cover Image */}
        <div className="relative aspect-[4/3] w-full bg-muted/30 overflow-hidden">
          {coverImage ? (
            <img
              src={coverImage}
              alt={listing.title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Tag className="h-10 w-10 text-muted-foreground/30" />
            </div>
          )}

          {/* Type badge */}
          <span className={cn(
            "absolute top-2 left-2 text-[11px] font-semibold px-2 py-0.5 rounded-full border backdrop-blur-sm",
            typeConf.bg, typeConf.color
          )}>
            {typeConf.label}
          </span>

          {/* Image count */}
          {listing.images?.length > 1 && (
            <span className="absolute bottom-2 right-2 text-[10px] text-white/70 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
              +{listing.images.length - 1}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-3 space-y-2">
          {/* Title */}
          <p className="text-sm font-medium leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors">
            {listing.title}
          </p>

          {/* Brand / Model pills */}
          {(listing.brand || listing.model) && (
            <div className="flex flex-wrap gap-1">
              {listing.brand && (
                <span className="text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full">
                  {listing.brand}
                </span>
              )}
              {listing.model && (
                <span className="text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full">
                  {listing.model}
                </span>
              )}
              {listing.condition && (
                <span className="text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full">
                  {listing.condition}
                </span>
              )}
            </div>
          )}

          {/* Price */}
          <div className="flex items-center justify-between pt-0.5">
            {isAuthenticated ? (
              listing.price != null ? (
                <span className="text-base font-bold text-primary">
                  NT${listing.price.toLocaleString()}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">面議</span>
              )
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <EyeOff className="h-3 w-3" />
                登入查看價格
              </span>
            )}

            {daysLeft !== null && (
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full",
                daysLeft <= 1 ? "bg-red-500/10 text-red-400" :
                daysLeft <= 3 ? "bg-amber-500/10 text-amber-400" :
                "bg-muted/40 text-muted-foreground"
              )}>
                剩{daysLeft}天
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
