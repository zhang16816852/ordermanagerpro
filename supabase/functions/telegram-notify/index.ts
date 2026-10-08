import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

// Telegram 通知 dispatcher
// DB trigger 寫 notification_outbox 後以 net.http_post 呼叫本函式（帶 x-webhook-secret）。
// 本函式以 service role 重查最新資料組訊息，回寫 bot_id / chat_id / message_id。

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

type TgResult = { ok: boolean; description?: string; result?: any }

async function tgCall(method: string, token: string, payload: Record<string, unknown>): Promise<TgResult> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  let json: TgResult
  try {
    json = await res.json()
  } catch (_e) {
    return { ok: false, description: `HTTP ${res.status} 非 JSON 回應` }
  }
  return json
}

type BotConfig = { id: string | null; token: string; chatId: string }

// 依事件類型挑選作用中的 bot（未設定 event_types 視為通用）；
// DB 未提供 token/chat 時 fallback 環境變數（現行來源）。
async function resolveBot(supabase: any, eventType: string, envToken: string, envChat: string): Promise<BotConfig> {
  const { data: bots } = await supabase
    .from('notification_bots')
    .select('id, bot_token, chat_id, event_types, is_default')
    .eq('channel', 'telegram')
    .eq('is_active', true)
    .order('is_default', { ascending: false })

  const match = (bots ?? []).find((b: any) => {
    const types = b.event_types ?? []
    return types.length === 0 || types.includes(eventType)
  }) ?? null

  return {
    id: match?.id ?? null,
    token: match?.bot_token || envToken,
    chatId: match?.chat_id || envChat,
  }
}

// 依銷貨單 id 重查最新資料組訊息（created / updated 共用）
async function buildSalesNoteText(supabase: any, noteId: string, appOrigin: string, heading: string) {
  const { data: note } = await supabase
    .from('sales_notes')
    .select('id, code, status, shipping_fee, access_token, created_at, updated_at, stores(name)')
    .eq('id', noteId)
    .maybeSingle()

  if (!note) return null

  const { data: items } = await supabase
    .from('sales_note_items')
    .select('quantity, order_items(unit_price)')
    .eq('sales_note_id', noteId)

  const rows = (items ?? []) as any[]
  const itemsTotal = rows.reduce((sum: number, it: any) => {
    const price = Number(it?.order_items?.unit_price ?? 0)
    return sum + Number(it?.quantity ?? 0) * price
  }, 0)
  const total = itemsTotal + Number(note.shipping_fee ?? 0)
  const totalQty = rows.reduce((sum: number, it: any) => sum + Number(it?.quantity ?? 0), 0)

  const storeName = (note as any)?.stores?.name ?? ''
  const code = note.code ?? String(note.id)
  const shareLink = note.access_token
    ? `${appOrigin}/share/sale/${code}?token=${note.access_token}`
    : `${appOrigin}/admin/sales-notes`

  const lines: (string | null)[] = [
    heading,
    storeName ? `門市：${escapeHtml(storeName)}` : null,
    `單號：<code>${escapeHtml(code)}</code>`,
    `品項：${rows.length} 項`,
    `總數：${totalQty} 件`,
    `金額：<b>${formatMoney(total)}</b>`,
  ]
  const stamp = note.updated_at ?? note.created_at
  if (stamp) lines.push(`時間：${formatDateTime(stamp)}`)
  lines.push('', `<a href="${escapeHtml(shareLink)}">查看銷貨單</a>`)

  const text = lines.filter((l): l is string => l !== null).join('\n')
  return { text, code }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // ── 1. 驗證共享密鑰（DB 持有） ──────────────────────────────
    const providedSecret = req.headers.get('x-webhook-secret') ?? ''
    const { data: secretRow } = await supabase
      .from('app_secrets')
      .select('value')
      .eq('key', 'telegram_webhook_secret')
      .maybeSingle()

    if (!secretRow?.value || providedSecret !== secretRow.value) {
      return json({ ok: false, reason: 'unauthorized' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const outboxId = body?.outbox_id
    if (!outboxId) {
      return json({ ok: false, reason: 'missing outbox_id' }, 400)
    }

    // ── 2. 讀取 outbox 列 ───────────────────────────────────────
    const { data: outbox, error: outboxErr } = await supabase
      .from('notification_outbox')
      .select('*')
      .eq('id', outboxId)
      .maybeSingle()

    if (outboxErr || !outbox) {
      return json({ ok: false, reason: 'outbox not found' }, 404)
    }

    // 冪等：已送出者直接略過
    if (outbox.status === 'sent') {
      return json({ ok: true, skipped: 'already_sent' })
    }

    const envToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
    const envChat = Deno.env.get('TELEGRAM_CHAT_ID') ?? ''
    const appOrigin = (Deno.env.get('APP_ORIGIN') ?? '').replace(/\/+$/, '')

    const markFailed = async (reason: string) => {
      await supabase
        .from('notification_outbox')
        .update({
          status: 'failed',
          attempts: (outbox.attempts ?? 0) + 1,
          last_error: reason.slice(0, 500),
          processed_at: new Date().toISOString(),
        })
        .eq('id', outboxId)
      return json({ ok: false, reason }, 200)
    }

    const markSent = async (bot: BotConfig, chatId: string, messageId: number | null) => {
      await supabase
        .from('notification_outbox')
        .update({
          status: 'sent',
          bot_id: bot.id,
          chat_id: chatId,
          message_id: messageId,
          processed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', outboxId)
    }

    const bot = await resolveBot(supabase, outbox.event_type, envToken, envChat)

    // ── 3. 事件分派 ─────────────────────────────────────────────
    if (outbox.event_type === 'sales_note_created' || outbox.event_type === 'sales_note_updated') {
      if (!bot.token || !bot.chatId) {
        return await markFailed('缺少 bot token 或 chat_id（DB 或環境變數）')
      }

      const noteId = outbox.ref_id
      const isUpdate = outbox.event_type === 'sales_note_updated'
      const heading = isUpdate ? '✏️ <b>銷貨單已更新</b>' : '🆕 <b>新銷貨單</b>'

      const built = await buildSalesNoteText(supabase, noteId, appOrigin, heading)
      if (!built) {
        return await markFailed('sales_note 不存在')
      }

      if (isUpdate) {
        // 找出該銷貨單目前在群組中的訊息（最新一筆已送出）
        const { data: sent } = await supabase
          .from('notification_outbox')
          .select('chat_id, message_id')
          .eq('ref_type', 'sales_note')
          .eq('ref_id', noteId)
          .not('message_id', 'is', null)
          .order('processed_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (sent?.message_id) {
          const targetChat = sent.chat_id ?? bot.chatId
          const editRes = await tgCall('editMessageText', bot.token, {
            chat_id: targetChat,
            message_id: sent.message_id,
            text: built.text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          })

          // Telegram 內容與原訊息相同時回「message is not modified」→ 無事可做
          const notModified = /not modified/i.test(editRes.description ?? '')
          if (editRes.ok || notModified) {
            await markSent(bot, targetChat, sent.message_id)
            return json({ ok: true, action: 'edited' })
          }
          return await markFailed(`editMessageText 失敗：${editRes.description ?? 'unknown'}`)
        }
        // 找不到原訊息 → 改為發送新訊息（等同 established）
      }

      const res = await tgCall('sendMessage', bot.token, {
        chat_id: bot.chatId,
        text: built.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })

      if (!res.ok) {
        return await markFailed(`sendMessage 失敗：${res.description ?? 'unknown'}`)
      }

      await markSent(bot, bot.chatId, res.result?.message_id ?? null)
      return json({ ok: true, message_id: res.result?.message_id ?? null })
    }

    if (outbox.event_type === 'sales_note_recalled') {
      if (!bot.token) {
        return await markFailed('缺少 bot token（DB 或環境變數）')
      }

      const noteId = outbox.ref_id
      const code = outbox.payload?.code ?? String(noteId)

      // 找出原本該銷貨單已送出的訊息
      const { data: sent } = await supabase
        .from('notification_outbox')
        .select('chat_id, message_id')
        .eq('ref_type', 'sales_note')
        .eq('ref_id', noteId)
        .not('message_id', 'is', null)
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // 沒有對應訊息可收回 → 視為完成（無事可做）
      if (!sent?.message_id) {
        await markSent(bot, bot.chatId, null)
        return json({ ok: true, skipped: 'no_message' })
      }

      const targetChat = sent.chat_id ?? bot.chatId
      const targetMsgId = sent.message_id

      // 先嘗試刪除；超過 48h 無法刪除時改為標記作廢
      const delRes = await tgCall('deleteMessage', bot.token, {
        chat_id: targetChat,
        message_id: targetMsgId,
      })

      if (delRes.ok) {
        await markSent(bot, targetChat, targetMsgId)
        return json({ ok: true, action: 'deleted' })
      }

      const editRes = await tgCall('editMessageText', bot.token, {
        chat_id: targetChat,
        message_id: targetMsgId,
        text: `⚠️ <s>銷貨單 ${escapeHtml(code)}</s> 已作廢`,
        parse_mode: 'HTML',
      })

      if (!editRes.ok) {
        return await markFailed(
          `收回失敗：delete=${delRes.description ?? 'unknown'} / edit=${editRes.description ?? 'unknown'}`,
        )
      }

      await markSent(bot, targetChat, targetMsgId)
      return json({ ok: true, action: 'marked_void' })
    }

    return await markFailed(`未知事件類型：${outbox.event_type}`)
  } catch (e: any) {
    console.error('[telegram-notify] Error:', e?.message ?? e)
    return json({ ok: false, reason: e?.message ?? 'internal error' }, 500)
  }
})