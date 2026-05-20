import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { MarketImageUploader } from "@/components/market/MarketImageUploader";
import {
  ChevronLeft, ArrowRight, ArrowLeft, Send, CheckCircle,
  MessageCircle, Phone, Smartphone, AlertTriangle, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const SUB_CATEGORIES = ["手機", "平板", "智慧手錶", "藍牙耳機", "其它3C"];
const CONDITIONS = [
  { value: "全新", desc: "全新未拆封/未激活" },
  { value: "99新", desc: "極少使用，外觀幾乎無損" },
  { value: "95新", desc: "正常使用痕跡，無明顯刮傷" },
  { value: "90新", desc: "外觀有微刮痕/小撞傷，功能良好" },
  { value: "80新", desc: "外觀有明顯損傷，功能良好" },
  { value: "故障零件機", desc: "部分功能損壞，適合作為零件機" },
];

export default function MarketCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit");

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Form Fields
  const [listingType, setListingType] = useState<"buy" | "sell" | "service">("sell");
  const [subCategory, setSubCategory] = useState("手機");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [condition, setCondition] = useState("95新");
  const [price, setPrice] = useState("");
  const [isPriceNegotiable, setIsPriceNegotiable] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [contactMethod, setContactMethod] = useState<"line" | "phone" | "telegram">("line");

  // Profile binding fields
  const [profile, setProfile] = useState({
    full_name: "",
    line_id: "",
    telegram_id: "",
    phone: "",
  });

  // Fetch Listing for Edit + Fetch User Profile
  useEffect(() => {
    if (!user) {
      toast.error("請先登入後再進行此操作");
      navigate("/auth");
      return;
    }

    // 1. Fetch profile information on mount
    (async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("full_name, line_id, telegram_id, phone")
        .eq("id", user.id)
        .maybeSingle();

      if (!error && data) {
        setProfile({
          full_name: data.full_name || "",
          line_id: data.line_id || "",
          telegram_id: data.telegram_id || "",
          phone: data.phone || "",
        });
      }
    })();

    // 2. Fetch existing listing if editing
    if (editId) {
      (async () => {
        setLoading(true);
        const { data, error } = await (supabase as any)
          .from("market_listings")
          .select("*")
          .eq("id", editId)
          .maybeSingle();

        if (error || !data) {
          toast.error("找不到該刊登資料");
          navigate("/market");
          return;
        }

        if (data.author_id !== user.id) {
          toast.error("您沒有權限編輯此刊登");
          navigate("/market");
          return;
        }

        setListingType(data.listing_type);
        setSubCategory(data.sub_category || "手機");
        setBrand(data.brand || "");
        setModel(data.model || "");
        setCondition(data.condition || "95新");
        setPrice(data.price !== null ? String(data.price) : "");
        setIsPriceNegotiable(data.price === null);
        setTitle(data.title || "");
        setDescription(data.description || "");
        setImages(data.images || []);
        setContactMethod(data.contact_method || "line");
        setLoading(false);
      })();
    }
  }, [user, editId, navigate]);

  const validateStep1 = () => {
    if (!brand.trim()) { toast.error("請輸入品牌"); return false; }
    if (!model.trim()) { toast.error("請輸入型號"); return false; }
    return true;
  };

  const validateStep2 = () => {
    if (!title.trim()) { toast.error("請輸入商品標題"); return false; }
    if (!isPriceNegotiable && !price) { toast.error("請輸入價格或勾選面議"); return false; }
    return true;
  };

  const handleNextStep = () => {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
  };

  const handlePrevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  // Get active contact field value
  const getContactValue = () => {
    if (contactMethod === "line") return profile.line_id;
    if (contactMethod === "phone") return profile.phone;
    if (contactMethod === "telegram") return profile.telegram_id;
    return "";
  };

  const setContactValue = (val: string) => {
    setProfile(prev => ({
      ...prev,
      line_id: contactMethod === "line" ? val : prev.line_id,
      phone: contactMethod === "phone" ? val : prev.phone,
      telegram_id: contactMethod === "telegram" ? val : prev.telegram_id,
    }));
  };

  const handleSubmit = async () => {
    if (!user) return;
    const currentContactVal = getContactValue();

    if (!currentContactVal.trim()) {
      toast.error(`請輸入您的 ${contactMethod === "line" ? "Line ID" : contactMethod === "phone" ? "手機號碼" : "Telegram ID"}`);
      return;
    }

    setLoading(true);

    try {
      // 1. Sync contact information back to Profiles table
      const updateData: any = {};
      if (contactMethod === "line") updateData.line_id = currentContactVal;
      else if (contactMethod === "phone") updateData.phone = currentContactVal;
      else if (contactMethod === "telegram") updateData.telegram_id = currentContactVal;

      const { error: profileErr } = await (supabase as any)
        .from("profiles")
        .update(updateData)
        .eq("id", user.id);

      if (profileErr) throw new Error("同步個人聯絡資訊時發生錯誤：" + profileErr.message);

      // 2. Insert or Update Market Listing
      const listingData = {
        title: title.trim(),
        description: description.trim(),
        listing_type: listingType,
        main_category: "3c_product",
        sub_category: subCategory,
        brand: brand.trim(),
        model: model.trim(),
        condition: condition,
        price: isPriceNegotiable ? null : Number(price),
        images: images,
        contact_method: contactMethod,
        author_id: user.id,
        status: "active",
        published_at: new Date().toISOString(), // Keep track of 7-day expiration from publish
      };

      if (editId) {
        const { error } = await (supabase as any)
          .from("market_listings")
          .update(listingData)
          .eq("id", editId);

        if (error) throw error;
        toast.success("刊登修改成功！");
      } else {
        const { error } = await (supabase as any)
          .from("market_listings")
          .insert(listingData);

        if (error) throw error;
        toast.success("發布成功！資訊已在市場上架");
      }

      navigate("/market/my-listings");
    } catch (err: any) {
      toast.error(err.message || "操作失敗，請重試");
    } finally {
      setLoading(false);
    }
  };

  if (loading && step === 1) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-primary/60" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 px-4 py-3 bg-background/80 backdrop-blur-md border-b border-white/8">
        <Button variant="ghost" size="icon" className="-ml-2 h-9 w-9" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-semibold flex-1">
          {editId ? "修改刊登資訊" : "發布全新刊登"}
        </span>
      </div>

      <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
        {/* Step Indicator */}
        <div className="flex items-center justify-between px-2">
          {[1, 2, 3].map((num) => (
            <div key={num} className="flex items-center flex-1 last:flex-initial">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border transition-all duration-300",
                  step === num
                    ? "bg-primary text-primary-foreground border-primary"
                    : step > num
                    ? "bg-primary/20 text-primary border-primary/30"
                    : "bg-muted text-muted-foreground border-white/10"
                )}
              >
                {num}
              </div>
              {num < 3 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 transition-all duration-300",
                    step > num ? "bg-primary/50" : "bg-white/10"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Specifications */}
        {step === 1 && (
          <Card className="p-4 border-white/8 bg-card/40 backdrop-blur-sm space-y-4 rounded-2xl">
            <h2 className="text-sm font-semibold text-muted-foreground border-b border-white/5 pb-2">商品規格描述</h2>
            
            {/* Listing Type */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">刊登類型</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setListingType("sell")}
                  className={cn(
                    "py-2 px-4 rounded-xl border font-medium text-sm transition-all",
                    listingType === "sell"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-muted/40 text-muted-foreground border-white/10"
                  )}
                >
                  我要出售
                </button>
                <button
                  type="button"
                  onClick={() => setListingType("buy")}
                  className={cn(
                    "py-2 px-4 rounded-xl border font-medium text-sm transition-all",
                    listingType === "buy"
                      ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                      : "bg-muted/40 text-muted-foreground border-white/10"
                  )}
                >
                  我要收購
                </button>
              </div>
            </div>

            {/* Category selection */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">商品次分類</Label>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {SUB_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSubCategory(cat)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs border transition-all whitespace-nowrap",
                      subCategory === cat
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/40 text-muted-foreground border-white/10"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Brand */}
            <div className="space-y-1.5">
              <Label htmlFor="brand" className="text-xs">品牌</Label>
              <Input
                id="brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="例如：Apple, Samsung, ASUS..."
                className="bg-muted/30 border-white/10 rounded-xl"
              />
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <Label htmlFor="model" className="text-xs">型號規格</Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="例如：iPhone 15 Pro Max 256G 黑色..."
                className="bg-muted/30 border-white/10 rounded-xl"
              />
            </div>

            {/* Condition */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">物況描述</Label>
              <div className="grid grid-cols-2 gap-2">
                {CONDITIONS.map((cond) => (
                  <button
                    key={cond.value}
                    type="button"
                    onClick={() => setCondition(cond.value)}
                    className={cn(
                      "py-2 px-3 text-left rounded-xl border transition-all flex flex-col justify-center",
                      condition === cond.value
                        ? "bg-primary/10 text-primary border-primary"
                        : "bg-muted/30 text-muted-foreground border-white/5"
                    )}
                  >
                    <span className="text-xs font-semibold">{cond.value}</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{cond.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Step 2: Information & Photos */}
        {step === 2 && (
          <Card className="p-4 border-white/8 bg-card/40 backdrop-blur-sm space-y-4 rounded-2xl">
            <h2 className="text-sm font-semibold text-muted-foreground border-b border-white/5 pb-2">詳細商品資訊</h2>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-xs">刊登商品標題</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：【自售】極新 iPhone 15 Pro Max, 全配件皆在"
                className="bg-muted/30 border-white/10 rounded-xl"
              />
            </div>

            {/* Price */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label htmlFor="price" className="text-xs">
                  {listingType === "sell" ? "出售價格" : "收購預算"}
                </Label>
                <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setIsPriceNegotiable(!isPriceNegotiable)}>
                  <input
                    type="checkbox"
                    checked={isPriceNegotiable}
                    onChange={(e) => setIsPriceNegotiable(e.target.checked)}
                    className="rounded border-white/20 h-3.5 w-3.5"
                    id="negotiable"
                  />
                  <Label htmlFor="negotiable" className="text-xs text-muted-foreground cursor-pointer">
                    面議
                  </Label>
                </div>
              </div>
              {!isPriceNegotiable && (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">NT$</span>
                  <Input
                    id="price"
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="請輸入台幣金額"
                    className="pl-10 bg-muted/30 border-white/10 rounded-xl"
                  />
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="desc" className="text-xs">商品詳情說明</Label>
              <Textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述細節：如保固期限、刮傷痕跡、面交地點或交易流程..."
                rows={4}
                className="bg-muted/30 border-white/10 rounded-xl resize-none text-sm"
              />
            </div>

            {/* Photo Uploader */}
            <div className="space-y-1.5">
              <Label className="text-xs">上傳實物照片（上限 2 張）</Label>
              <MarketImageUploader value={images} onChange={setImages} />
            </div>
          </Card>
        )}

        {/* Step 3: Contact details */}
        {step === 3 && (
          <Card className="p-4 border-white/8 bg-card/40 backdrop-blur-sm space-y-5 rounded-2xl">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground border-b border-white/5 pb-2">聯絡方式綁定</h2>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                此聯絡方式會與您的帳號 Profile 連動，在發布後會自動綁定！訪客將無法直接看見，僅有登入使用者可查看。
              </p>
            </div>

            {/* Contact Selector */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">選擇優先聯絡管道</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "line", label: "Line", icon: MessageCircle, color: "text-green-400 border-green-500/20 bg-green-500/5" },
                  { value: "phone", label: "電話", icon: Phone, color: "text-blue-400 border-blue-500/20 bg-blue-500/5" },
                  { value: "telegram", label: "Telegram", icon: Send, color: "text-sky-400 border-sky-500/20 bg-sky-500/5" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setContactMethod(item.value as any)}
                      className={cn(
                        "py-3 px-2 rounded-xl border flex flex-col items-center justify-center gap-1.5 font-medium text-xs transition-all",
                        contactMethod === item.value
                          ? item.color + " border-current"
                          : "bg-muted/30 text-muted-foreground border-white/5"
                      )}
                    >
                      <Icon className="h-4.5 w-4.5" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Contact input value */}
            <div className="space-y-2 bg-muted/20 border border-white/5 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-primary font-semibold text-xs mb-1">
                <Smartphone className="h-4 w-4" />
                填寫 {contactMethod === "line" ? "Line ID" : contactMethod === "phone" ? "手機號碼" : "Telegram ID"}
              </div>
              <Input
                value={getContactValue()}
                onChange={(e) => setContactValue(e.target.value)}
                placeholder={
                  contactMethod === "line"     ? "請輸入您的 Line ID (非顯示名稱)" :
                  contactMethod === "phone"    ? "請輸入您的聯絡電話號碼" :
                  contactMethod === "telegram" ? "請輸入您的 Telegram 使用者名稱 (@Username)" : ""
                }
                className="bg-background border-white/10 rounded-xl"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                ※ 輸入後會同步儲存至您的個人資料中，方便下一次發文時自動帶入！
              </p>
            </div>

            {/* Expire warning */}
            <div className="bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 rounded-xl p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>注意：此資訊媒合僅提供媒合管道，系統保留 7 天，到期自動下架為草稿。請自行注意交易安全！</span>
            </div>
          </Card>
        )}

        {/* Footer Navigation Buttons */}
        <div className="flex gap-3 justify-between">
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={handlePrevStep}
              className="px-5 border-white/10 rounded-xl h-12 text-sm flex items-center gap-1.5 flex-1"
            >
              <ArrowLeft className="h-4 w-4" /> 上一步
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(-1)}
              className="px-5 border-white/10 rounded-xl h-12 text-sm flex-1"
            >
              取消
            </Button>
          )}

          {step < 3 ? (
            <Button
              type="button"
              onClick={handleNextStep}
              className="px-5 rounded-xl h-12 text-sm flex items-center gap-1.5 flex-1 font-semibold"
            >
              下一步 <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="px-5 rounded-xl h-12 text-sm flex items-center gap-1.5 flex-1 font-semibold"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {editId ? "儲存修改" : "確認發布"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
