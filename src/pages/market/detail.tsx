import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, Phone, MessageCircle, Send, Copy, EyeOff,
  Tag, Loader2, AlertCircle, CheckCircle2, Pencil, Trash2
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ListingDetail {
  id: string;
  title: string;
  description: string | null;
  listing_type: "buy" | "sell" | "service";
  main_category: string;
  sub_category: string | null;
  brand: string | null;
  model: string | null;
  condition: string | null;
  price: number | null;
  images: string[];
  contact_method: "line" | "phone" | "telegram";
  status: "active" | "draft" | "completed" | "closed";
  published_at: string | null;
  created_at: string;
  author_id: string;
  author?: {
    full_name: string | null;
    line_id: string | null;
    telegram_id: string | null;
    phone: string | null;
  };
}

const CONTACT_ICONS = {
  line:     { icon: MessageCircle, label: "Line",     color: "bg-green-500 hover:bg-green-600" },
  phone:    { icon: Phone,         label: "電話",     color: "bg-blue-500 hover:bg-blue-600" },
  telegram: { icon: Send,          label: "Telegram", color: "bg-sky-500 hover:bg-sky-600" },
};

const TYPE_LABEL = { buy: "收購", sell: "出售", service: "服務" };
const TYPE_COLOR = {
  buy:     "bg-blue-500/10 text-blue-400 border-blue-500/30",
  sell:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  service: "bg-purple-500/10 text-purple-400 border-purple-500/30",
};

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgIndex, setImgIndex] = useState(0);
  const [contactVisible, setContactVisible] = useState(false);

  const isOwner = user && listing && user.id === listing.author_id;

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("market_listings")
        .select(`*, author:profiles(full_name, line_id, telegram_id, phone)`)
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        console.error("Fetch listing error:", error);
        toast.error(error ? `載入失敗: ${error.message}` : "找不到這筆刊登資訊");
        navigate("/market");
        return;
      }
      setListing(data as ListingDetail);
      setLoading(false);
    })();
  }, [id]);

  const getContactInfo = () => {
    if (!listing?.author) return "";
    switch (listing.contact_method) {
      case "line":     return listing.author.line_id ?? "";
      case "phone":    return listing.author.phone ?? "";
      case "telegram": return listing.author.telegram_id ?? "";
      default:         return "";
    }
  };

  const handleCopy = () => {
    const info = getContactInfo();
    if (!info) { toast.error("聯絡資訊尚未設定"); return; }
    navigator.clipboard.writeText(info);
    toast.success("已複製到剪貼簿");
  };

  const handleMarkComplete = async () => {
    if (!listing) return;
    await (supabase as any).from("market_listings").update({ status: "completed" }).eq("id", listing.id);
    toast.success("已標示為成交！");
    navigate("/market/my-listings");
  };

  const handleDelete = async () => {
    if (!listing || !window.confirm("確定要刪除這筆刊登？")) return;
    await (supabase as any).from("market_listings").delete().eq("id", listing.id);
    toast.success("已刪除刊登");
    navigate("/market/my-listings");
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
      </div>
    );
  }
  if (!listing) return null;

  const contactConf = CONTACT_ICONS[listing.contact_method];
  const contactInfo = getContactInfo();
  const daysLeft = listing.published_at
    ? Math.max(0, 7 - Math.floor((Date.now() - new Date(listing.published_at).getTime()) / 86400000))
    : null;

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Back button */}
      <div className="sticky top-0 z-20 flex items-center gap-2 px-4 py-3 bg-background/80 backdrop-blur-md border-b border-white/8">
        <Button variant="ghost" size="icon" className="-ml-2 h-9 w-9" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium flex-1 line-clamp-1">{listing.title}</span>
        {isOwner && (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/market/create?edit=${listing.id}`)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Image Gallery */}
      {listing.images.length > 0 ? (
        <div className="relative">
          <div className="aspect-[4/3] w-full overflow-hidden bg-muted/30">
            <img
              src={listing.images[imgIndex]}
              alt={`圖片 ${imgIndex + 1}`}
              className="w-full h-full object-cover"
            />
          </div>
          {listing.images.length > 1 && (
            <div className="flex gap-2 justify-center p-3">
              {listing.images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setImgIndex(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === imgIndex ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40"
                  )}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="aspect-[4/3] w-full bg-muted/20 flex items-center justify-center">
          <Tag className="h-16 w-16 text-muted-foreground/20" />
        </div>
      )}

      {/* Content */}
      <div className="px-4 py-4 space-y-5">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-xs font-semibold px-2.5 py-0.5 rounded-full border", TYPE_COLOR[listing.listing_type])}>
              {TYPE_LABEL[listing.listing_type]}
            </span>
            {listing.status === "completed" && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3" /> 已成交
              </Badge>
            )}
            {daysLeft !== null && listing.status === "active" && (
              <span className={cn(
                "text-[11px] px-2 py-0.5 rounded-full",
                daysLeft <= 1 ? "bg-red-500/10 text-red-400" :
                daysLeft <= 3 ? "bg-amber-500/10 text-amber-400" :
                "bg-muted/40 text-muted-foreground"
              )}>
                剩 {daysLeft} 天到期
              </span>
            )}
          </div>
          <h1 className="text-xl font-bold leading-snug">{listing.title}</h1>

          {/* Price */}
          {user ? (
            listing.price != null ? (
              <p className="text-2xl font-bold text-primary">NT${listing.price.toLocaleString()}</p>
            ) : (
              <p className="text-lg text-muted-foreground">面議</p>
            )
          ) : (
            <div className="flex items-center gap-2 bg-muted/30 rounded-xl p-3">
              <EyeOff className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">登入後可查看價格與聯絡方式</span>
            </div>
          )}
        </div>

        {/* Specs */}
        {(listing.brand || listing.model || listing.condition || listing.sub_category) && (
          <div className="rounded-2xl border border-white/8 bg-card/40 divide-y divide-white/5">
            {listing.sub_category && <SpecRow label="分類" value={listing.sub_category} />}
            {listing.brand && <SpecRow label="品牌" value={listing.brand} />}
            {listing.model && <SpecRow label="型號" value={listing.model} />}
            {listing.condition && <SpecRow label="物況" value={listing.condition} />}
          </div>
        )}

        {/* Description */}
        {listing.description && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">說明</p>
            <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{listing.description}</p>
          </div>
        )}

        {/* Owner actions */}
        {isOwner && listing.status === "active" && (
          <Button variant="outline" className="w-full gap-2" onClick={handleMarkComplete}>
            <CheckCircle2 className="h-4 w-4" /> 標示為已成交
          </Button>
        )}
      </div>

      {/* ── Fixed Bottom Contact Bar ── */}
      {user && listing.status === "active" && !isOwner && (
        <div className="fixed bottom-0 left-0 right-0 z-30 p-4 bg-background/95 backdrop-blur-md border-t border-white/8">
          {!contactVisible ? (
            <Button
              className="w-full h-13 rounded-2xl text-base font-semibold gap-2"
              onClick={() => setContactVisible(true)}
              id="market-show-contact-btn"
            >
              <contactConf.icon className="h-5 w-5" />
              查看聯絡方式
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs text-muted-foreground">{contactConf.label}</p>
                  <p className="text-base font-semibold">{contactInfo || "（未設定）"}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={handleCopy} disabled={!contactInfo}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button className={cn("w-full h-12 rounded-2xl text-base font-semibold gap-2 text-white", contactConf.color)} asChild>
                <a
                  href={
                    listing.contact_method === "line"     ? `https://line.me/ti/p/~${contactInfo}` :
                    listing.contact_method === "phone"    ? `tel:${contactInfo}` :
                    listing.contact_method === "telegram" ? `https://t.me/${contactInfo}` : "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <contactConf.icon className="h-5 w-5" />
                  聯絡賣家
                </a>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Not logged in bottom hint */}
      {!user && (
        <div className="fixed bottom-0 left-0 right-0 z-30 p-4 bg-background/95 backdrop-blur-md border-t border-white/8">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">登入後才能查看聯絡資訊</p>
            <Button size="sm" onClick={() => navigate("/auth")} id="market-login-cta">登入</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
