import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

// CORS 標頭設定
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // 處理預檢請求
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 使用 Service Role 金鑰，允許管理員操作
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    const body = await req.json()
    const { action = 'create' } = body

    // ─────────────────────────────────────────
    // action: create - 發送邀請並預建帳號
    // ─────────────────────────────────────────
    if (action === 'create') {
      const { email, storeId, role, invitedBy } = body

      if (!email || !storeId || !role) {
        throw new Error('Missing required fields: email, storeId, role')
      }

      // 1. 分頁搜尋用戶（避免 listUsers 只回傳第一頁）
      let targetUser: any = null
      let page = 1
      const perPage = 1000

      while (true) {
        const { data: { users }, error: listError } = await supabaseClient.auth.admin.listUsers({
          page,
          perPage,
        })
        if (listError) throw listError

        const found = users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase())
        if (found) {
          targetUser = found
          break
        }
        // 如果回傳筆數不足一頁，表示已查完全部
        if (users.length < perPage) break
        page++
      }

      let isPreCreated = false

      // 2. 如果 Email 不存在，則建立預建帳號
      if (!targetUser) {
        const { data: newUser, error: createError } = await supabaseClient.auth.admin.createUser({
          email,
          email_confirm: true, // 跳過 email 驗證
          user_metadata: {
            full_name: '受邀用戶',
            is_pre_created: true
          }
        })
        if (createError) throw createError
        targetUser = newUser.user
        isPreCreated = true
        console.log(`[invitation-service] Pre-created auth user for: ${email}`)
      } else {
        console.log(`[invitation-service] Existing user found for: ${email}, skipping pre-creation`)
      }

      // 3. 建立邀請紀錄
      const { data: invitation, error: inviteError } = await supabaseClient
        .from('invitations')
        .insert({
          email,
          store_id: storeId,
          role,
          invited_by: invitedBy,
          is_pre_created: isPreCreated, // 記錄是否為預建帳號
          status: 'pending'
        })
        .select()
        .single()

      if (inviteError) throw inviteError

      return new Response(
        JSON.stringify({
          success: true,
          invitation,
          isPreCreated,
          userId: targetUser?.id
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    // ─────────────────────────────────────────
    // action: claim - 領取預建帳號（設定密碼）
    // ─────────────────────────────────────────
    if (action === 'claim') {
      const { token, password, fullName } = body

      if (!token || !password) {
        throw new Error('Missing required fields: token, password')
      }

      // 1. 驗證邀請 Token
      const { data: invitation, error: inviteError } = await supabaseClient
        .from('invitations')
        .select('*, store:stores(id, name)')
        .eq('token', token)
        .eq('status', 'pending')
        .single()

      if (inviteError || !invitation) {
        throw new Error('Invalid or expired invitation token')
      }

      // 2. 分頁搜尋對應用戶
      let targetUser: any = null
      let page = 1
      const perPage = 1000

      while (true) {
        const { data: { users }, error: listError } = await supabaseClient.auth.admin.listUsers({
          page,
          perPage,
        })
        if (listError) throw listError

        const found = users.find((u: any) => u.email?.toLowerCase() === invitation.email.toLowerCase())
        if (found) {
          targetUser = found
          break
        }
        if (users.length < perPage) break
        page++
      }

      if (!targetUser) throw new Error('User not found in auth system')

      // 3. 更新用戶資料與密碼
      const { error: updateError } = await supabaseClient.auth.admin.updateUserById(targetUser.id, {
        password: password,
        user_metadata: {
          full_name: fullName || targetUser.user_metadata?.full_name,
          is_pre_created: false // 標記帳號已被領取
        }
      })
      if (updateError) throw updateError

      // 4. 同步更新 profiles 資料表
      if (fullName) {
        await supabaseClient
          .from('profiles')
          .update({ full_name: fullName })
          .eq('id', targetUser.id)
      }

      // 5. 將用戶加入店鋪（若已是成員則忽略）
      const { error: joinError } = await supabaseClient
        .from('store_users')
        .insert({
          store_id: invitation.store_id,
          user_id: targetUser.id,
          role: invitation.role
        })

      if (joinError) {
        // 若是重複鍵錯誤（已是成員），忽略
        if (joinError.code !== '23505') {
          console.error('[invitation-service] Join store error:', joinError)
        }
      }

      // 6. 更新邀請狀態為已接受
      await supabaseClient
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id)

      console.log(`[invitation-service] Claimed account for: ${invitation.email}`)

      return new Response(
        JSON.stringify({ success: true, email: invitation.email }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    // ─────────────────────────────────────────
    // action: cleanup - 清理過期邀請與預建帳號
    // ─────────────────────────────────────────
    if (action === 'cleanup') {
      // 1. 查找已過期且為預建帳號的邀請
      const { data: expiredInvites, error: fetchError } = await supabaseClient
        .from('invitations')
        .select('id, email, is_pre_created')
        .eq('status', 'pending')
        .eq('is_pre_created', true)
        .lt('expires_at', new Date().toISOString())

      if (fetchError) throw fetchError

      const deletedUsers: string[] = []
      const errors: Array<{ email: string; error: string }> = []

      for (const invite of expiredInvites) {
        try {
          // 2. 分頁搜尋對應用戶
          let targetUser: any = null
          let page = 1
          const perPage = 1000

          while (true) {
            const { data: { users }, error: listError } = await supabaseClient.auth.admin.listUsers({
              page,
              perPage,
            })
            if (listError) throw listError

            const found = users.find((u: any) => u.email?.toLowerCase() === invite.email.toLowerCase())
            if (found) {
              targetUser = found
              break
            }
            if (users.length < perPage) break
            page++
          }

          // 3. 確認為預建帳號才刪除（避免誤刪真實用戶）
          if (targetUser && targetUser.user_metadata?.is_pre_created === true) {
            const { error: deleteError } = await supabaseClient.auth.admin.deleteUser(targetUser.id)
            if (deleteError) throw deleteError
            deletedUsers.push(invite.email)
            console.log(`[invitation-service] Deleted pre-created user: ${invite.email}`)
          }

          // 4. 更新邀請狀態為過期
          await supabaseClient
            .from('invitations')
            .update({ status: 'expired' })
            .eq('id', invite.id)

        } catch (e: any) {
          console.error(`[invitation-service] Failed to cleanup ${invite.email}:`, e.message)
          errors.push({ email: invite.email, error: e.message })
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          processedCount: expiredInvites.length,
          deletedUsers,
          errors
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    throw new Error(`Invalid action: ${action}`)

  } catch (error: any) {
    console.error('[invitation-service] Error:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
