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
      accounting_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          type?: string
        }
        Relationships: []
      }
      accounting_entries: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          paid_amount: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          reference_id: string | null
          reference_type: string | null
          transaction_date: string
          type: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          paid_amount?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string
          type: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          paid_amount?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          reference_id?: string | null
          reference_type?: string | null
          transaction_date?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "accounting_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          balance: number
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
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
      brands: {
        Row: {
          abbreviation: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          abbreviation?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          abbreviation?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      category_hierarchy: {
        Row: {
          child_id: string
          parent_id: string
        }
        Insert: {
          child_id: string
          parent_id: string
        }
        Update: {
          child_id?: string
          parent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_hierarchy_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_hierarchy_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_spec_links: {
        Row: {
          category_id: string
          is_manual: boolean | null
          sort_order: number | null
          spec_id: string
        }
        Insert: {
          category_id: string
          is_manual?: boolean | null
          sort_order?: number | null
          spec_id: string
        }
        Update: {
          category_id?: string
          is_manual?: boolean | null
          sort_order?: number | null
          spec_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_spec_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_spec_links_spec_id_fkey"
            columns: ["spec_id"]
            isOneToOne: false
            referencedRelation: "specification_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      data_change_logs: {
        Row: {
          action: string
          created_at: string | null
          id: number
          record_id: string
          table_name: string
          version_tag: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: number
          record_id: string
          table_name: string
          version_tag?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: number
          record_id?: string
          table_name?: string
          version_tag?: string | null
        }
        Relationships: []
      }
      data_snapshots: {
        Row: {
          data_json: Json
          last_sequence_id: string
          table_name: string
          updated_at: string | null
        }
        Insert: {
          data_json: Json
          last_sequence_id: string
          table_name: string
          updated_at?: string | null
        }
        Update: {
          data_json?: Json
          last_sequence_id?: string
          table_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      data_versions: {
        Row: {
          last_triggered_by: string | null
          table_name: string
          updated_at: string
          version: string
        }
        Insert: {
          last_triggered_by?: string | null
          table_name: string
          updated_at?: string
          version?: string
        }
        Update: {
          last_triggered_by?: string | null
          table_name?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      device_brands: {
        Row: {
          created_at: string | null
          id: string
          name: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      device_model_group_history: {
        Row: {
          action: string
          created_at: string | null
          group_id: string
          id: string
          new_data: Json | null
          old_data: Json | null
          performed_by: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          group_id: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          performed_by?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          group_id?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          performed_by?: string | null
        }
        Relationships: []
      }
      device_model_group_items: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          model_id: string
          position: number | null
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          model_id: string
          position?: number | null
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          model_id?: string
          position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "device_model_group_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "device_model_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_model_group_items_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "device_models"
            referencedColumns: ["id"]
          },
        ]
      }
      device_model_groups: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      device_models: {
        Row: {
          aliases: string[] | null
          brand_id: string | null
          created_at: string | null
          device_remarks: string | null
          device_series: string | null
          device_type: string | null
          id: string
          is_active: boolean | null
          name: string
          release_date: string | null
          screen_size: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          aliases?: string[] | null
          brand_id?: string | null
          created_at?: string | null
          device_remarks?: string | null
          device_series?: string | null
          device_type?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          release_date?: string | null
          screen_size?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          aliases?: string[] | null
          brand_id?: string | null
          created_at?: string | null
          device_remarks?: string | null
          device_series?: string | null
          device_type?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          release_date?: string | null
          screen_size?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_models_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "device_brands"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_model_relations: {
        Row: {
          created_at: string | null
          group_id: string | null
          id: string
          model_id: string | null
          product_id: string | null
          reason: string | null
          relation_type: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          model_id?: string | null
          product_id?: string | null
          reason?: string | null
          relation_type: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          model_id?: string | null
          product_id?: string | null
          reason?: string | null
          relation_type?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_model_relations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "device_model_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_model_relations_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "device_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_model_relations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_model_relations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_spec_values: {
        Row: {
          category_id: string
          created_at: string | null
          deleted_at: string | null
          display_order: number | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["spec_entity_type"]
          id: string
          instance_uuid: string
          is_inherited: boolean | null
          lifecycle_state:
            | Database["public"]["Enums"]["spec_instance_state"]
            | null
          origin_entity_id: string | null
          parent_id: string | null
          spec_id: string
          updated_at: string | null
          value: Json | null
        }
        Insert: {
          category_id: string
          created_at?: string | null
          deleted_at?: string | null
          display_order?: number | null
          entity_id: string
          entity_type: Database["public"]["Enums"]["spec_entity_type"]
          id?: string
          instance_uuid?: string
          is_inherited?: boolean | null
          lifecycle_state?:
            | Database["public"]["Enums"]["spec_instance_state"]
            | null
          origin_entity_id?: string | null
          parent_id?: string | null
          spec_id: string
          updated_at?: string | null
          value?: Json | null
        }
        Update: {
          category_id?: string
          created_at?: string | null
          deleted_at?: string | null
          display_order?: number | null
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["spec_entity_type"]
          id?: string
          instance_uuid?: string
          is_inherited?: boolean | null
          lifecycle_state?:
            | Database["public"]["Enums"]["spec_instance_state"]
            | null
          origin_entity_id?: string | null
          parent_id?: string | null
          spec_id?: string
          updated_at?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "product_spec_values_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_spec_values_spec_id_fkey"
            columns: ["spec_id"]
            isOneToOne: false
            referencedRelation: "specification_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          is_pre_created: boolean | null
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
          is_pre_created?: boolean | null
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
          is_pre_created?: boolean | null
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
      market_listings: {
        Row: {
          author_id: string
          brand: string | null
          condition: string | null
          contact_method: Database["public"]["Enums"]["market_contact_method"]
          created_at: string
          description: string | null
          id: string
          images: string[] | null
          listing_type: Database["public"]["Enums"]["market_listing_type"]
          main_category: string
          model: string | null
          price: number | null
          published_at: string | null
          status: Database["public"]["Enums"]["market_listing_status"]
          sub_category: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          brand?: string | null
          condition?: string | null
          contact_method?: Database["public"]["Enums"]["market_contact_method"]
          created_at?: string
          description?: string | null
          id?: string
          images?: string[] | null
          listing_type: Database["public"]["Enums"]["market_listing_type"]
          main_category?: string
          model?: string | null
          price?: number | null
          published_at?: string | null
          status?: Database["public"]["Enums"]["market_listing_status"]
          sub_category?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          brand?: string | null
          condition?: string | null
          contact_method?: Database["public"]["Enums"]["market_contact_method"]
          created_at?: string
          description?: string | null
          id?: string
          images?: string[] | null
          listing_type?: Database["public"]["Enums"]["market_listing_type"]
          main_category?: string
          model?: string | null
          price?: number | null
          published_at?: string | null
          status?: Database["public"]["Enums"]["market_listing_status"]
          sub_category?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_market_listings_author_profile"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          selected_model_name: string | null
          shipped_quantity: number
          status: Database["public"]["Enums"]["order_item_status"]
          store_id: string
          unit_price: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          quantity?: number
          selected_model_name?: string | null
          shipped_quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          store_id: string
          unit_price: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          selected_model_name?: string | null
          shipped_quantity?: number
          status?: Database["public"]["Enums"]["order_item_status"]
          store_id?: string
          unit_price?: number
          updated_at?: string
          variant_id?: string | null
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
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          access_token: string | null
          code: string | null
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
          access_token?: string | null
          code?: string | null
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
          access_token?: string | null
          code?: string | null
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
      product_category_links: {
        Row: {
          category_id: string
          product_id: string
        }
        Insert: {
          category_id: string
          product_id: string
        }
        Update: {
          category_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_category_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_colors: {
        Row: {
          code: string
          created_at: string | null
          hex_code: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number | null
        }
        Insert: {
          code: string
          created_at?: string | null
          hex_code?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order?: number | null
        }
        Update: {
          code?: string
          created_at?: string | null
          hex_code?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      product_images: {
        Row: {
          alt_text: string | null
          created_at: string
          entity_id: string
          entity_type: string
          external_url: string | null
          id: string
          is_cover: boolean
          sort_order: number
          storage_path: string | null
          url: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          external_url?: string | null
          id?: string
          is_cover?: boolean
          sort_order?: number
          storage_path?: string | null
          url: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          external_url?: string | null
          id?: string
          is_cover?: boolean
          sort_order?: number
          storage_path?: string | null
          url?: string
        }
        Relationships: []
      }
      product_inventory: {
        Row: {
          id: string
          product_id: string | null
          quantity: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          id?: string
          product_id?: string | null
          quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          id?: string
          product_id?: string | null
          quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
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
          brand_id: string | null
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
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          base_retail_price?: number
          base_wholesale_price?: number
          brand_id?: string | null
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
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          base_retail_price?: number
          base_wholesale_price?: number
          brand_id?: string | null
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
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          line_id: string | null
          phone: string | null
          telegram_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          line_id?: string | null
          phone?: string | null
          telegram_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          line_id?: string | null
          phone?: string | null
          telegram_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          purchase_order_id: string
          quantity: number
          received_quantity: number
          unit_cost: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          purchase_order_id: string
          quantity?: number
          received_quantity?: number
          unit_cost?: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          purchase_order_id?: string
          quantity?: number
          received_quantity?: number
          unit_cost?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string
          expected_date: string | null
          id: string
          notes: string | null
          order_date: string
          received_date: string | null
          status: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          received_date?: string | null
          status?: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          received_date?: string | null
          status?: Database["public"]["Enums"]["purchase_order_status"]
          supplier_id?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
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
          access_token: string | null
          code: string | null
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
          access_token?: string | null
          code?: string | null
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
          access_token?: string | null
          code?: string | null
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
      specification_definitions: {
        Row: {
          configuration: Json | null
          created_at: string | null
          default_value: string | null
          dsl_schema_json: Json | null
          expected_type: Database["public"]["Enums"]["spec_value_type"]
          id: string
          name: string
          options: Json | null
          quantity_source_id: string | null
          sort_order: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          configuration?: Json | null
          created_at?: string | null
          default_value?: string | null
          dsl_schema_json?: Json | null
          expected_type?: Database["public"]["Enums"]["spec_value_type"]
          id?: string
          name: string
          options?: Json | null
          quantity_source_id?: string | null
          sort_order?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          configuration?: Json | null
          created_at?: string | null
          default_value?: string | null
          dsl_schema_json?: Json | null
          expected_type?: Database["public"]["Enums"]["spec_value_type"]
          id?: string
          name?: string
          options?: Json | null
          quantity_source_id?: string | null
          sort_order?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      specification_triggers: {
        Row: {
          condition_dsl: Json
          created_at: string | null
          id: string
          max_depth_limit: number | null
          priority: number | null
          source_spec_id: string
          target_spec_id: string
        }
        Insert: {
          condition_dsl?: Json
          created_at?: string | null
          id?: string
          max_depth_limit?: number | null
          priority?: number | null
          source_spec_id: string
          target_spec_id: string
        }
        Update: {
          condition_dsl?: Json
          created_at?: string | null
          id?: string
          max_depth_limit?: number | null
          priority?: number | null
          source_spec_id?: string
          target_spec_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "specification_triggers_source_spec_id_fkey"
            columns: ["source_spec_id"]
            isOneToOne: false
            referencedRelation: "specification_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specification_triggers_target_spec_id_fkey"
            columns: ["target_spec_id"]
            isOneToOne: false
            referencedRelation: "specification_definitions"
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
      storefront_items: {
        Row: {
          created_at: string | null
          display_name: string
          id: string
          model_id: string | null
          product_id: string | null
          slug: string
          status: string | null
          updated_at: string | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string | null
          display_name: string
          id?: string
          model_id?: string | null
          product_id?: string | null
          slug: string
          status?: string | null
          updated_at?: string | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string
          id?: string
          model_id?: string | null
          product_id?: string | null
          slug?: string
          status?: string | null
          updated_at?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storefront_items_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "device_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storefront_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
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
      supplier_import_configs: {
        Row: {
          created_at: string | null
          header_row: number | null
          id: string
          mapping_config: Json
          supplier_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          header_row?: number | null
          id?: string
          mapping_config: Json
          supplier_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          header_row?: number | null
          id?: string
          mapping_config?: Json
          supplier_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_import_configs_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_product_mappings: {
        Row: {
          created_at: string | null
          id: string
          internal_product_id: string
          internal_variant_id: string | null
          supplier_id: string
          updated_at: string | null
          vendor_product_id: string
          vendor_product_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          internal_product_id: string
          internal_variant_id?: string | null
          supplier_id: string
          updated_at?: string | null
          vendor_product_id: string
          vendor_product_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          internal_product_id?: string
          internal_variant_id?: string | null
          supplier_id?: string
          updated_at?: string | null
          vendor_product_id?: string
          vendor_product_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_product_mappings_internal_product_id_fkey"
            columns: ["internal_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_mappings_internal_variant_id_fkey"
            columns: ["internal_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_mappings_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_sequences: {
        Row: {
          current_value: number
          name: string
          updated_at: string
        }
        Insert: {
          current_value?: number
          name: string
          updated_at?: string
        }
        Update: {
          current_value?: number
          name?: string
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
      repair_orders: {
        Row: {
          id: string
          code: string
          store_id: string | null
          status: Database["public"]["Enums"]["repair_order_status"]
          customer_name: string
          customer_phone: string | null
          customer_email: string | null
          customer_notes: string | null
          device_model_id: string | null
          device_color: string | null
          device_storage: string | null
          device_ram: string | null
          device_specs: Json
          device_imei: string | null
          device_sn: string | null
          device_passcode: string | null
          device_condition: string | null
          reported_issue: string | null
          diagnostic_result: string | null
          internal_notes: string | null
          parts_cost: number
          labor_fee: number
          total_cost: number
          total_price: number
          discount: number
          deposit: number
          payment_method: string | null
          created_by: string | null
          assigned_to: string | null
          created_at: string
          updated_at: string
          diagnosed_at: string | null
          started_at: string | null
          completed_at: string | null
          delivered_at: string | null
        }
        Insert: {
          id?: string
          code?: string
          store_id?: string | null
          status?: Database["public"]["Enums"]["repair_order_status"]
          customer_name: string
          customer_phone?: string | null
          customer_email?: string | null
          customer_notes?: string | null
          device_model_id?: string | null
          device_color?: string | null
          device_storage?: string | null
          device_ram?: string | null
          device_specs?: Json
          device_imei?: string | null
          device_sn?: string | null
          device_passcode?: string | null
          device_condition?: string | null
          reported_issue?: string | null
          diagnostic_result?: string | null
          internal_notes?: string | null
          parts_cost?: number
          labor_fee?: number
          total_cost?: number
          total_price?: number
          discount?: number
          deposit?: number
          payment_method?: string | null
          created_by?: string | null
          assigned_to?: string | null
          created_at?: string
          updated_at?: string
          diagnosed_at?: string | null
          started_at?: string | null
          completed_at?: string | null
          delivered_at?: string | null
        }
        Update: {
          id?: string
          code?: string
          store_id?: string | null
          status?: Database["public"]["Enums"]["repair_order_status"]
          customer_name?: string
          customer_phone?: string | null
          customer_email?: string | null
          customer_notes?: string | null
          device_model_id?: string | null
          device_color?: string | null
          device_storage?: string | null
          device_ram?: string | null
          device_specs?: Json
          device_imei?: string | null
          device_sn?: string | null
          device_passcode?: string | null
          device_condition?: string | null
          reported_issue?: string | null
          diagnostic_result?: string | null
          internal_notes?: string | null
          parts_cost?: number
          labor_fee?: number
          total_cost?: number
          total_price?: number
          discount?: number
          deposit?: number
          payment_method?: string | null
          created_by?: string | null
          assigned_to?: string | null
          created_at?: string
          updated_at?: string
          diagnosed_at?: string | null
          started_at?: string | null
          completed_at?: string | null
          delivered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_orders_device_model_id_fkey"
            columns: ["device_model_id"]
            isOneToOne: false
            referencedRelation: "device_models"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_orders_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_order_items: {
        Row: {
          id: string
          repair_order_id: string
          item_type: Database["public"]["Enums"]["repair_item_type"]
          service_name: string | null
          service_category: string | null
          product_id: string | null
          variant_id: string | null
          part_name: string | null
          description: string | null
          quantity: number
          unit_cost: number
          unit_price: number
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          repair_order_id: string
          item_type?: Database["public"]["Enums"]["repair_item_type"]
          service_name?: string | null
          service_category?: string | null
          product_id?: string | null
          variant_id?: string | null
          part_name?: string | null
          description?: string | null
          quantity?: number
          unit_cost?: number
          unit_price?: number
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          repair_order_id?: string
          item_type?: Database["public"]["Enums"]["repair_item_type"]
          service_name?: string | null
          service_category?: string | null
          product_id?: string | null
          variant_id?: string | null
          part_name?: string | null
          description?: string | null
          quantity?: number
          unit_cost?: number
          unit_price?: number
          sort_order?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_order_items_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_order_status_history: {
        Row: {
          id: string
          repair_order_id: string
          from_status: string | null
          to_status: string
          changed_by: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          repair_order_id: string
          from_status?: string | null
          to_status: string
          changed_by?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          repair_order_id?: string
          from_status?: string | null
          to_status?: string
          changed_by?: string | null
          note?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_order_status_history_repair_order_id_fkey"
            columns: ["repair_order_id"]
            isOneToOne: false
            referencedRelation: "repair_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
      repair_order_summary: {
        Row: {
          id: string | null
          code: string | null
          store_id: string | null
          status: Database["public"]["Enums"]["repair_order_status"] | null
          customer_name: string | null
          customer_phone: string | null
          customer_email: string | null
          customer_notes: string | null
          device_model_id: string | null
          device_color: string | null
          device_storage: string | null
          device_ram: string | null
          device_specs: Json | null
          device_imei: string | null
          device_sn: string | null
          device_passcode: string | null
          device_condition: string | null
          reported_issue: string | null
          diagnostic_result: string | null
          internal_notes: string | null
          parts_cost: number | null
          labor_fee: number | null
          total_cost: number | null
          total_price: number | null
          discount: number | null
          deposit: number | null
          payment_method: string | null
          created_by: string | null
          assigned_to: string | null
          created_at: string | null
          updated_at: string | null
          diagnosed_at: string | null
          started_at: string | null
          completed_at: string | null
          delivered_at: string | null
          profit: number | null
          final_price: number | null
          profit_margin_percent: number | null
          device_brand_name: string | null
          device_model_name: string | null
          device_specifications: Json | null
          device_type: string | null
          device_screen_size: string | null
          created_by_email: string | null
          assigned_to_email: string | null
        }
        Insert: {
          [_ in never]: never
        }
        Update: {
          [_ in never]: never
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      bind_user_to_store: {
        Args: { p_role: string; p_store_id: string; p_user_id: string }
        Returns: undefined
      }
      bump_data_version:
        | { Args: { p_table_name: string }; Returns: undefined }
        | {
            Args: { p_source_table?: string; p_table_name: string }
            Returns: undefined
          }
      cleanup_expired_invitations: {
        Args: never
        Returns: {
          deleted_count: number
        }[]
      }
      delete_sales_note: {
        Args: { p_sales_note_id: string }
        Returns: undefined
      }
      direct_ship_order: {
        Args: { p_order_id: string; p_created_by: string; p_notes?: string | null }
        Returns: Json
      }
      duplicate_product_with_variants: {
        Args: { new_name: string; new_sku: string; target_product_id: string }
        Returns: string
      }
      expire_market_listings: { Args: never; Returns: undefined }
      find_uuid_occurrences: {
        Args: { target: string }
        Returns: {
          column_name: string
          matched_value: string
          table_name: string
        }[]
      }
      fn_create_consistent_snapshot: {
        Args: { p_table_name: string }
        Returns: undefined
      }
      fn_pack_data_version: {
        Args: { p_date: string; p_seq: number }
        Returns: string
      }
      fn_unpack_data_version: {
        Args: { p_version: string }
        Returns: Record<string, unknown>
      }
      get_shared_order_details: {
        Args: { p_identifier: string; p_token: string }
        Returns: Json
      }
      get_shared_sales_note_details: {
        Args: { p_identifier: string; p_token: string }
        Returns: Json
      }
      get_store_role: {
        Args: { _store_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["store_role"]
      }
      get_variant_effective_models: {
        Args: { p_variant_id: string }
        Returns: {
          group_name: string
          inherited: boolean
          model_id: string
          name: string
          src: string
        }[]
      }
      get_visible_specs_v6: {
        Args: { p_category_id: string; p_current_values: Json }
        Returns: {
          level: number
          parent_id: string
          spec_id: string
        }[]
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
      migrate_historical_specs_to_v6: { Args: never; Returns: Json }
      safe_eval_dsl: {
        Args: {
          p_condition: Json
          p_type: Database["public"]["Enums"]["spec_value_type"]
          p_val: Json
        }
        Returns: boolean
      }
      ship_from_pool: {
        Args: {
          p_store_ids: string[]
          p_created_by: string
          p_notes?: string | null
        }
        Returns: Json
      }
      sync_product_specs_v6: {
        Args: {
          p_category_id: string
          p_entity_id: string
          p_entity_type: Database["public"]["Enums"]["spec_entity_type"]
          p_new_data: Json
        }
        Returns: undefined
      }
      sync_storefront_items: {
        Args: { p_product_id: string }
        Returns: undefined
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
      market_contact_method: "line" | "phone" | "telegram"
      market_listing_status: "active" | "draft" | "completed" | "closed"
      market_listing_type: "buy" | "sell" | "service"
      order_item_status:
        | "waiting"
        | "partial"
        | "shipped"
        | "out_of_stock"
        | "discontinued"
        | "cancelled"
      order_source_type: "frontend" | "admin_proxy"
      order_status: "pending" | "processing" | "shipped"
      payment_status: "unpaid" | "partial" | "paid"
      product_status: "active" | "discontinued" | "preorder" | "sold_out"
      purchase_order_status:
        | "draft"
        | "ordered"
        | "partial_received"
        | "received"
        | "cancelled"
      sales_note_status: "draft" | "shipped" | "received"
      spec_entity_type: "product" | "variant"
      spec_instance_state: "active" | "orphaned" | "migrated" | "deleted"
      spec_value_type: "string" | "number" | "boolean" | "array" | "object"
      store_role: "founder" | "manager" | "employee"
      system_role: "admin" | "customer"
      repair_order_status:
        | "pending"
        | "diagnosing"
        | "quoting"
        | "awaiting_approval"
        | "awaiting_parts"
        | "repairing"
        | "ready"
        | "delivered"
        | "cancelled"
      repair_item_type: "service" | "part"
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
      market_contact_method: ["line", "phone", "telegram"],
      market_listing_status: ["active", "draft", "completed", "closed"],
      market_listing_type: ["buy", "sell", "service"],
      order_item_status: [
        "waiting",
        "partial",
        "shipped",
        "out_of_stock",
        "discontinued",
        "cancelled",
      ],
      order_source_type: ["frontend", "admin_proxy"],
      order_status: ["pending", "processing", "shipped"],
      payment_status: ["unpaid", "partial", "paid"],
      product_status: ["active", "discontinued", "preorder", "sold_out"],
      purchase_order_status: [
        "draft",
        "ordered",
        "partial_received",
        "received",
        "cancelled",
      ],
      sales_note_status: ["draft", "shipped", "received"],
      spec_entity_type: ["product", "variant"],
      spec_instance_state: ["active", "orphaned", "migrated", "deleted"],
      spec_value_type: ["string", "number", "boolean", "array", "object"],
      store_role: ["founder", "manager", "employee"],
      system_role: ["admin", "customer"],
      repair_order_status: [
        "pending",
        "diagnosing",
        "quoting",
        "awaiting_approval",
        "awaiting_parts",
        "repairing",
        "ready",
        "delivered",
        "cancelled",
      ],
      repair_item_type: ["service", "part"],
    },
  },
} as const
