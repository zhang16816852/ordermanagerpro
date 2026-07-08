import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, Plus, Eye, EyeOff, Pencil, Trash2, Calendar,
  AlertTriangle, CheckCircle, RefreshCw, ShoppingBag
} from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from '@/lib/errorMessages';
import { cn } from "@/lib/utils";

interface MyListing {
  id: string;
  title: string;
  listing_type: "buy" | "sell" | "service";
  price: number | null;
  images: string[];
  status: "active" | "draft" | "completed" | "closed";
  published_at: string | null;
  updated_at: string;
  created_at: string;
}

const TYPE_LABEL = { buy: "收購", sell: "出售", service: "服務" };
const TYPE_COLOR = {
  buy: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  sell: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  service: "bg-purple-500/10 text-purple-400 border-purple-500/30",
};

export default function MyListingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<MyListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("active");

  const fetchMyListings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("market_listings")
      .select("id, title, listing_type, price, images, status, published_at, updated_at, created_at")
      .eq("author_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setListings(data as MyListing[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchMyListings();
  }, [fetchMyListings]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm("確定要刪除這筆刊登嗎？此動作無法復原。")) return;

    const { error } = await (supabase as any)
      .from("market_listings")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("刪除失敗");
    } else {
      toast.success("已成功刪除刊登");
      setListings((prev) => prev.filter((l) => l.id !== id));
    }
  };

  const handleRepublish = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Set status to active and update published_at to now
    const { error } = await (supabase as any)
      .from("market_listings")
      .update({
        status: "active",
        published_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      toast.error("上架失敗");
    } else {
      toast.success("已重新上架！刊登將保留7天");
      fetchMyListings();
    }
  };

  const handleMarkCompleteQuick = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm("確定要將此刊登標示為已成交嗎？該項目將不再公開展示。")) return;

    const { error } = await (supabase as any)
      .from("market_listings")
      .update({ status: "completed" })
      .eq("id", id);

    if (error) {
      toast.error("標示失敗");
    } else {
      toast.success("已成功標示為已成交！已移入歷史檔案。");
      fetchMyListings();
    }
  };

  const handleTakeDownQuick = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!window.confirm("確定要將此刊登下架並轉為草稿嗎？")) return;

    const { error } = await (supabase as any)
      .from("market_listings")
      .update({ status: "draft" })
      .eq("id", id);

    if (error) {
      toast.error("下架失敗");
    } else {
      toast.success("已成功下架並轉為草稿！");
      fetchMyListings();
    }
  };

  const getFilteredListings = (status: string) => {
    return listings.filter((l) => l.status === status);
  };

  const renderListingCard = (l: MyListing) => {
    const mainImg = l.images && l.images.length > 0 ? l.images[0] : null;
    
    // Expiration details
    let warningText = "";
    if (l.status === "active" && l.published_at) {
      const daysLeft = Math.max(0, 7 - Math.floor((Date.now() - new Date(l.published_at).getTime()) / 86400000));
      warningText = `剩 ${daysLeft} 天到期`;
    } else if (l.status === "draft") {
      const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(l.updated_at).getTime()) / 86400000));
      warningText = `${daysLeft} 天後系統自動清除`;
    }

    return (
      <Card
        key={l.id}
        onClick={() => navigate(`/market/${l.id}`)}
        className="overflow-hidden border border-white/8 bg-card/30 backdrop-blur-sm hover:bg-card/50 transition-all duration-300 rounded-2xl cursor-pointer group flex flex-row h-28"
      >
        {/* Left image */}
        <div className="w-28 h-full bg-muted/20 relative flex-shrink-0">
          {mainImg ? (
            <img
              src={mainImg}
              alt={l.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
              <ShoppingBag className="h-8 w-8" />
            </div>
          )}
          <span className={cn(
            "absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full border shadow-sm backdrop-blur-md",
            TYPE_COLOR[l.listing_type]
          )}>
            {TYPE_LABEL[l.listing_type]}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
          <div className="space-y-1">
            <h3 className="font-semibold text-sm line-clamp-1 group-hover:text-primary transition-colors">
              {l.title}
            </h3>
            <p className="text-sm font-bold text-primary">
              {l.price != null ? `NT$${l.price.toLocaleString()}` : "面議"}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            {warningText ? (
              <span className={cn(
                "text-[10px] flex items-center gap-1 font-medium",
                l.status === "active" ? "text-muted-foreground" : "text-amber-400"
              )}>
                <Calendar className="h-3 w-3" />
                {warningText}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                建立於 {new Date(l.created_at).toLocaleDateString()}
              </span>
            )}

            {/* Quick Actions */}
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {l.status === "active" && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => handleMarkCompleteQuick(l.id, e)}
                    className="h-7 w-7 rounded-full text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                    title="標示為已成交"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => handleTakeDownQuick(l.id, e)}
                    className="h-7 w-7 rounded-full text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                    title="下架轉為草稿"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              {l.status === "draft" && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => handleRepublish(l.id, e)}
                  className="h-7 w-7 rounded-full text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                  title="重新上架"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => navigate(`/market/create?edit=${l.id}`)}
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                title="編輯"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => handleDelete(l.id, e)}
                className="h-7 w-7 rounded-full text-destructive hover:text-destructive hover:bg-destructive/10"
                title="刪除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const renderTabContent = (status: string) => {
    const list = getFilteredListings(status);
    if (list.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <ShoppingBag className="h-12 w-12 text-muted-foreground/15" />
          <p className="text-muted-foreground text-sm">無此類別的刊登項目</p>
        </div>
      );
    }
    return (
      <div className="space-y-3 pt-2">
        {list.map(renderListingCard)}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Sticky Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 px-4 py-3 bg-background/80 backdrop-blur-md border-b border-white/8">
        <Button variant="ghost" size="icon" className="-ml-2 h-9 w-9" onClick={() => navigate("/market")}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-semibold flex-1">我的刊登紀錄</span>
        <Button
          size="sm"
          className="gap-1 rounded-full text-xs h-8"
          onClick={() => navigate("/market/create")}
          id="my-listings-create-btn"
        >
          <Plus className="h-3.5 w-3.5" /> 發布
        </Button>
      </div>

      <div className="px-4 py-4 max-w-lg mx-auto">
        {loading ? (
          <div className="flex justify-center py-20">
            <RefreshCw className="h-7 w-7 animate-spin text-primary/60" />
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-4">
            <TabsList className="grid grid-cols-3 bg-muted/40 p-1 border border-white/5 rounded-xl">
              <TabsTrigger value="active" className="rounded-lg text-xs py-2">
                上架中 ({getFilteredListings("active").length})
              </TabsTrigger>
              <TabsTrigger value="draft" className="rounded-lg text-xs py-2">
                草稿箱 ({getFilteredListings("draft").length})
              </TabsTrigger>
              <TabsTrigger value="completed" className="rounded-lg text-xs py-2">
                已成交 ({getFilteredListings("completed").length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="focus-visible:outline-none">
              <div className="bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 rounded-xl p-3 flex gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>貼文上架期限為 7 天。到期後將自動移入「草稿箱」供您重新上架。</span>
              </div>
              {renderTabContent("active")}
            </TabsContent>

            <TabsContent value="draft" className="focus-visible:outline-none">
              <div className="bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 rounded-xl p-3 flex gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>草稿如果超過 30 天未再次更新/上架，系統將自動永久清除！</span>
              </div>
              {renderTabContent("draft")}
            </TabsContent>

            <TabsContent value="completed" className="focus-visible:outline-none">
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 rounded-xl p-3 flex gap-2 mb-3">
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>已標示為成交的媒合項目，不會在市場清單中展示。</span>
              </div>
              {renderTabContent("completed")}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
