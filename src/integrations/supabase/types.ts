export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          new_value: Json | null
          old_value: Json | null
          performed_by: string
          performed_by_store_role:
            | Database["public"]["Enums"]["store_role"]
            | null
          performed_by_system_role:
            | Database["public"]["Enums"]["system_role"]
            | null
          store_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by: string
          performed_by_store_role?:
            | Database["public"]["Enums"]["store_role"]
            | null
          performed_by_system_role?:
            | Database["public"]["Enums"]["system_role"]
            | null
          store_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by?: string
          performed_by_store_role?:
            | Database["public"]["Enums"]["store_role"]
            | null
          performed_by_system_role?:
            | Database["public"]["Enums"]["system_role"]
            | null
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      data_versions: {
        Row: {
          table_name: string
          updated_at: string
          version: number
        }
        Insert: {
          table_name: string
          updated_at?: string
          version?: number
        }
        Update: {
          table_name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["store_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          store_id: string | null
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["store_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          store_id?: string | null
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["store_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          store_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          link: string | null
          message: string
          read: boolean
          store_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link?: string | null
          message: string
          read?: boolean
          store_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link?: string | null
          message?: string
          read?: boolean
          store_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          quantity: number
          shipped_quantity: number
          status: Database["public"]["Enums"]["order_item_status"]
          store_id: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          quantity?: number
          shipped_quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          store_id: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          shipped_quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          store_id?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_order_items_store"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          created_by: string
          id: string
          notes: string | null
          source_type: Database["public"]["Enums"]["order_source_type"]
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          source_type?: Database["public"]["Enums"]["order_source_type"]
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          source_type?: Database["public"]["Enums"]["order_source_type"]
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          color: string | null
          created_at: string
          id: string
          name: string
          option_1: string | null
          option_2: string | null
          option_3: string | null
          product_id: string
          retail_price: number
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          table_settings: Json | null
          updated_at: string
          wholesale_price: number
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name: string
          option_1?: string | null
          option_2?: string | null
          option_3?: string | null
          product_id: string
          retail_price?: number
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          table_settings?: Json | null
          updated_at?: string
          wholesale_price?: number
        }
        Update: {
          barcode?: string | null
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          option_1?: string | null
          option_2?: string | null
          option_3?: string | null
          product_id?: string
          retail_price?: number
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          table_settings?: Json | null
          updated_at?: string
          wholesale_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          base_retail_price: number
          base_wholesale_price: number
          brand: string | null
          category: string | null
          color: string | null
          created_at: string
          description: string | null
          has_variants: boolean | null
          id: string
          model: string | null
          name: string
          series: string | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          table_settings: Json | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          base_retail_price?: number
          base_wholesale_price?: number
          brand?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          has_variants?: boolean | null
          id?: string
          model?: string | null
          name: string
          series?: string | null
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          table_settings?: Json | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          base_retail_price?: number
          base_wholesale_price?: number
          brand?: string | null
          category?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          has_variants?: boolean | null
          id?: string
          model?: string | null
          name?: string
          series?: string | null
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          table_settings?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sales_note_items: {
        Row: {
          created_at: string
          id: string
          order_item_id: string
          quantity: number
          sales_note_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_item_id: string
          quantity: number
          sales_note_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_item_id?: string
          quantity?: number
          sales_note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_note_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_note_items_sales_note_id_fkey"
            columns: ["sales_note_id"]
            isOneToOne: false
            referencedRelation: "sales_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_notes: {
        Row: {
          created_at: string
          created_by: string
          id: string
          notes: string | null
          received_at: string | null
          received_by: string | null
          shipped_at: string | null
          status: Database["public"]["Enums"]["sales_note_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["sales_note_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          shipped_at?: string | null
          status?: Database["public"]["Enums"]["sales_note_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_notes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_pool: {
        Row: {
          created_at: string
          created_by: string
          id: string
          order_item_id: string
          quantity: number
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          order_item_id: string
          quantity: number
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          order_item_id?: string
          quantity?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_pool_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_pool_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_products: {
        Row: {
          brand: string | null
          created_at: string
          id: string
          product_id: string
          retail_price: number | null
          updated_at: string
          variant_id: string | null
          wholesale_price: number | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          id?: string
          product_id: string
          retail_price?: number | null
          updated_at?: string
          variant_id?: string | null
          wholesale_price?: number | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          id?: string
          product_id?: string
          retail_price?: number | null
          updated_at?: string
          variant_id?: string | null
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_products_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      store_users: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["store_role"]
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["store_role"]
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["store_role"]
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_users_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          brand: string | null
          code: string | null
          created_at: string
          id: string
          name: string
          owner_id: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          brand?: string | null
          code?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          brand?: string | null
          code?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["system_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["system_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["system_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      duplicate_product_with_variants: {
        Args: { new_name: string; new_sku: string; target_product_id: string }
        Returns: string
      }
      get_store_role: {
        Args: { _store_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["store_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["system_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_store_member: {
        Args: { _store_id: string; _user_id: string }
        Returns: boolean
      }
      upsert_brand_product_prices: {
        Args: { p_brand: string; p_products: Json }
        Returns: undefined
      }
      upsert_store_products_batch: {
        Args: { p_items: Json }
        Returns: undefined
      }
    }
    Enums: {
      invitation_status: "pending" | "accepted" | "expired"
      order_item_status:
        | "waiting"
        | "partial"
        | "shipped"
        | "out_of_stock"
        | "discontinued"
      order_source_type: "frontend" | "admin_proxy"
      order_status: "pending" | "processing"
      product_status: "active" | "discontinued" | "preorder" | "sold_out"
      sales_note_status: "draft" | "shipped" | "received"
      store_role: "founder" | "manager" | "employee"
      system_role: "admin" | "customer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]        

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])   
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &    
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"] 
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]      
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      invitation_status: ["pending", "accepted", "expired"],
      order_item_status: [
        "waiting",
        "partial",
        "shipped",
        "out_of_stock",
        "discontinued",
      ],
      order_source_type: ["frontend", "admin_proxy"],
      order_status: ["pending", "processing"],
      product_status: ["active", "discontinued", "preorder", "sold_out"],
      sales_note_status: ["draft", "shipped", "received"],
      store_role: ["founder", "manager", "employee"],
      system_role: ["admin", "customer"],
    },
  },
} as const