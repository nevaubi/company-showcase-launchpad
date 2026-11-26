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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      abs_cmbs_assets: {
        Row: {
          accession: string
          accrual_method_code: string | null
          actual_end_balance: number | null
          asset_added: boolean | null
          asset_number: string
          asset_type_number: string | null
          balloon: boolean | null
          begin_balance: number | null
          extra: Json
          first_payment_date: string | null
          group_id: string | null
          interest_only: boolean | null
          kind: string
          last_modification_date: string | null
          lien_position_code: string | null
          liquidation_prepayment_code: string | null
          liquidation_prepayment_date: string | null
          load_id: number
          loan_structure_code: string | null
          master_servicer_return_date: string | null
          maturity_date: string | null
          modification_code: string | null
          modified: boolean | null
          non_recoverable: boolean | null
          original_amortization_months: number | null
          original_interest_only_months: number | null
          original_loan_amount: number | null
          original_rate: number | null
          original_term_months: number | null
          origination_date: string | null
          originator_name: string | null
          other_advances_outstanding: number | null
          paid_through_date: string | null
          payment_frequency_code: string | null
          payment_status_code: string | null
          payment_type_code: string | null
          period_begin: string | null
          period_end: string | null
          period_modified: boolean | null
          period_rate: number | null
          pi_advances_outstanding: number | null
          primary_servicer_name: string | null
          properties: number | null
          properties_securitization: number | null
          rate_type_code: string | null
          realized_loss: number | null
          rec: number
          sched_end_balance: number | null
          sched_interest: number | null
          sched_principal: number | null
          securitization_balance: number | null
          securitization_rate: number | null
          special_servicer_transfer_date: string | null
          subject_to_demand: boolean | null
          ti_advances_outstanding: number | null
          total_pi_due: number | null
          unparsed: Json
          unsched_principal: number | null
          workout_strategy_code: string | null
        }
        Insert: {
          accession: string
          accrual_method_code?: string | null
          actual_end_balance?: number | null
          asset_added?: boolean | null
          asset_number: string
          asset_type_number?: string | null
          balloon?: boolean | null
          begin_balance?: number | null
          extra?: Json
          first_payment_date?: string | null
          group_id?: string | null
          interest_only?: boolean | null
          kind: string
          last_modification_date?: string | null
          lien_position_code?: string | null
          liquidation_prepayment_code?: string | null
          liquidation_prepayment_date?: string | null
          load_id: number
          loan_structure_code?: string | null
          master_servicer_return_date?: string | null
          maturity_date?: string | null
          modification_code?: string | null
          modified?: boolean | null
          non_recoverable?: boolean | null
          original_amortization_months?: number | null
          original_interest_only_months?: number | null
          original_loan_amount?: number | null
          original_rate?: number | null
          original_term_months?: number | null
          origination_date?: string | null
          originator_name?: string | null
          other_advances_outstanding?: number | null
          paid_through_date?: string | null
          payment_frequency_code?: string | null
          payment_status_code?: string | null
          payment_type_code?: string | null
          period_begin?: string | null
          period_end?: string | null
          period_modified?: boolean | null
          period_rate?: number | null
          pi_advances_outstanding?: number | null
          primary_servicer_name?: string | null
          properties?: number | null
          properties_securitization?: number | null
          rate_type_code?: string | null
          realized_loss?: number | null
          rec: number
          sched_end_balance?: number | null
          sched_interest?: number | null
          sched_principal?: number | null
          securitization_balance?: number | null
          securitization_rate?: number | null
          special_servicer_transfer_date?: string | null
          subject_to_demand?: boolean | null
          ti_advances_outstanding?: number | null
          total_pi_due?: number | null
          unparsed?: Json
          unsched_principal?: number | null
          workout_strategy_code?: string | null
        }
        Update: {
          accession?: string
          accrual_method_code?: string | null
          actual_end_balance?: number | null
          asset_added?: boolean | null
          asset_number?: string
          asset_type_number?: string | null
          balloon?: boolean | null
          begin_balance?: number | null
          extra?: Json
          first_payment_date?: string | null
          group_id?: string | null
          interest_only?: boolean | null
          kind?: string
          last_modification_date?: string | null
          lien_position_code?: string | null
          liquidation_prepayment_code?: string | null
          liquidation_prepayment_date?: string | null
          load_id?: number
          loan_structure_code?: string | null
          master_servicer_return_date?: string | null
          maturity_date?: string | null
          modification_code?: string | null
          modified?: boolean | null
          non_recoverable?: boolean | null
          original_amortization_months?: number | null
          original_interest_only_months?: number | null
          original_loan_amount?: number | null
          original_rate?: number | null
          original_term_months?: number | null
          origination_date?: string | null
          originator_name?: string | null
          other_advances_outstanding?: number | null
          paid_through_date?: string | null
          payment_frequency_code?: string | null
          payment_status_code?: string | null
          payment_type_code?: string | null
          period_begin?: string | null
          period_end?: string | null
          period_modified?: boolean | null
          period_rate?: number | null
          pi_advances_outstanding?: number | null
          primary_servicer_name?: string | null
          properties?: number | null
          properties_securitization?: number | null
          rate_type_code?: string | null
          realized_loss?: number | null
          rec?: number
          sched_end_balance?: number | null
          sched_interest?: number | null
          sched_principal?: number | null
          securitization_balance?: number | null
          securitization_rate?: number | null
          special_servicer_transfer_date?: string | null
          subject_to_demand?: boolean | null
          ti_advances_outstanding?: number | null
          total_pi_due?: number | null
          unparsed?: Json
          unsched_principal?: number | null
          workout_strategy_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abs_cmbs_assets_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "abs_loads"
            referencedColumns: ["load_id"]
          },
        ]
      }
      abs_cmbs_properties: {
        Row: {
          accession: string
          address: string | null
          asset_number: string
          city: string | null
          county: string | null
          debt_service_recent: number | null
          defeased_code: string | null
          dscr_code_recent: string | null
          dscr_code_securitization: string | null
          dscr_ncf_recent: number | null
          dscr_ncf_securitization: number | null
          dscr_noi_recent: number | null
          dscr_noi_securitization: number | null
          extra: Json
          financials_recent_end: string | null
          financials_recent_start: string | null
          financials_securitization_date: string | null
          lease_rollover_review_date: string | null
          link: string
          load_id: number
          loan_asset_number: string
          name: string | null
          ncf_recent: number | null
          ncf_securitization: number | null
          noi_ncf_code_recent: string | null
          noi_ncf_code_securitization: string | null
          noi_recent: number | null
          noi_securitization: number | null
          occupancy_recent: number | null
          occupancy_securitization: number | null
          opex_recent: number | null
          opex_securitization: number | null
          rec: number
          revenue_recent: number | null
          revenue_securitization: number | null
          seq: number
          sq_ft: number | null
          sq_ft_securitization: number | null
          state: string | null
          status_code: string | null
          tenant1: string | null
          tenant1_lease_end: string | null
          tenant1_sq_ft: number | null
          tenant2: string | null
          tenant2_lease_end: string | null
          tenant2_sq_ft: number | null
          tenant3: string | null
          tenant3_lease_end: string | null
          tenant3_sq_ft: number | null
          type_code: string | null
          units: number | null
          units_securitization: number | null
          unparsed: Json
          valuation_recent: number | null
          valuation_recent_date: string | null
          valuation_recent_source: string | null
          valuation_securitization: number | null
          valuation_securitization_date: string | null
          valuation_source_securitization: string | null
          year_built: number | null
          year_renovated: number | null
          zip: string | null
        }
        Insert: {
          accession: string
          address?: string | null
          asset_number: string
          city?: string | null
          county?: string | null
          debt_service_recent?: number | null
          defeased_code?: string | null
          dscr_code_recent?: string | null
          dscr_code_securitization?: string | null
          dscr_ncf_recent?: number | null
          dscr_ncf_securitization?: number | null
          dscr_noi_recent?: number | null
          dscr_noi_securitization?: number | null
          extra?: Json
          financials_recent_end?: string | null
          financials_recent_start?: string | null
          financials_securitization_date?: string | null
          lease_rollover_review_date?: string | null
          link: string
          load_id: number
          loan_asset_number: string
          name?: string | null
          ncf_recent?: number | null
          ncf_securitization?: number | null
          noi_ncf_code_recent?: string | null
          noi_ncf_code_securitization?: string | null
          noi_recent?: number | null
          noi_securitization?: number | null
          occupancy_recent?: number | null
          occupancy_securitization?: number | null
          opex_recent?: number | null
          opex_securitization?: number | null
          rec: number
          revenue_recent?: number | null
          revenue_securitization?: number | null
          seq: number
          sq_ft?: number | null
          sq_ft_securitization?: number | null
          state?: string | null
          status_code?: string | null
          tenant1?: string | null
          tenant1_lease_end?: string | null
          tenant1_sq_ft?: number | null
          tenant2?: string | null
          tenant2_lease_end?: string | null
          tenant2_sq_ft?: number | null
          tenant3?: string | null
          tenant3_lease_end?: string | null
          tenant3_sq_ft?: number | null
          type_code?: string | null
          units?: number | null
          units_securitization?: number | null
          unparsed?: Json
          valuation_recent?: number | null
          valuation_recent_date?: string | null
          valuation_recent_source?: string | null
          valuation_securitization?: number | null
          valuation_securitization_date?: string | null
          valuation_source_securitization?: string | null
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
        }
        Update: {
          accession?: string
          address?: string | null
          asset_number?: string
          city?: string | null
          county?: string | null
          debt_service_recent?: number | null
          defeased_code?: string | null
          dscr_code_recent?: string | null
          dscr_code_securitization?: string | null
          dscr_ncf_recent?: number | null
          dscr_ncf_securitization?: number | null
          dscr_noi_recent?: number | null
          dscr_noi_securitization?: number | null
          extra?: Json
          financials_recent_end?: string | null
          financials_recent_start?: string | null
          financials_securitization_date?: string | null
          lease_rollover_review_date?: string | null
          link?: string
          load_id?: number
          loan_asset_number?: string
          name?: string | null
          ncf_recent?: number | null
          ncf_securitization?: number | null
          noi_ncf_code_recent?: string | null
          noi_ncf_code_securitization?: string | null
          noi_recent?: number | null
          noi_securitization?: number | null
          occupancy_recent?: number | null
          occupancy_securitization?: number | null
          opex_recent?: number | null
          opex_securitization?: number | null
          rec?: number
          revenue_recent?: number | null
          revenue_securitization?: number | null
          seq?: number
          sq_ft?: number | null
          sq_ft_securitization?: number | null
          state?: string | null
          status_code?: string | null
          tenant1?: string | null
          tenant1_lease_end?: string | null
          tenant1_sq_ft?: number | null
          tenant2?: string | null
          tenant2_lease_end?: string | null
          tenant2_sq_ft?: number | null
          tenant3?: string | null
          tenant3_lease_end?: string | null
          tenant3_sq_ft?: number | null
          type_code?: string | null
          units?: number | null
          units_securitization?: number | null
          unparsed?: Json
          valuation_recent?: number | null
          valuation_recent_date?: string | null
          valuation_recent_source?: string | null
          valuation_securitization?: number | null
          valuation_securitization_date?: string | null
          valuation_source_securitization?: string | null
          year_built?: number | null
          year_renovated?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abs_cmbs_properties_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "abs_loads"
            referencedColumns: ["load_id"]
          },
        ]
      }
      abs_deals: {
        Row: {
          created_at: string
          deal_id: string
          depositor_cik: number | null
          family: string
          file_number: string | null
          issuer_cik: number | null
          issuer_name: string
          sponsor_cik: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          depositor_cik?: number | null
          family: string
          file_number?: string | null
          issuer_cik?: number | null
          issuer_name: string
          sponsor_cik?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          depositor_cik?: number | null
          family?: string
          file_number?: string | null
          issuer_cik?: number | null
          issuer_name?: string
          sponsor_cik?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      abs_documents: {
        Row: {
          accession: string
          bytes: number | null
          description: string | null
          doc_type: string
          listed_bytes: number | null
          name: string
          namespace: string | null
          records: number | null
          retrieved_at: string | null
          seq: number
          sha256: string | null
          url: string
        }
        Insert: {
          accession: string
          bytes?: number | null
          description?: string | null
          doc_type: string
          listed_bytes?: number | null
          name: string
          namespace?: string | null
          records?: number | null
          retrieved_at?: string | null
          seq: number
          sha256?: string | null
          url: string
        }
        Update: {
          accession?: string
          bytes?: number | null
          description?: string | null
          doc_type?: string
          listed_bytes?: number | null
          name?: string
          namespace?: string | null
          records?: number | null
          retrieved_at?: string | null
          seq?: number
          sha256?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "abs_documents_accession_fkey"
            columns: ["accession"]
            isOneToOne: false
            referencedRelation: "abs_filing_periods"
            referencedColumns: ["accession"]
          },
          {
            foreignKeyName: "abs_documents_accession_fkey"
            columns: ["accession"]
            isOneToOne: false
            referencedRelation: "abs_filings"
            referencedColumns: ["accession"]
          },
        ]
      }
      abs_filings: {
        Row: {
          accepted_at: string | null
          accession: string
          asset_class: string | null
          attempts: number
          deal_id: string | null
          depositor_cik: number | null
          file_number: string | null
          filed: string
          form: string
          header_sha256: string | null
          is_current: boolean
          issuer_cik: number | null
          issuer_name: string | null
          list_cik: number
          listed_at: string
          load_id: number | null
          loaded_at: string | null
          period_end: string | null
          period_start: string | null
          sponsor_cik: number | null
          status: string
          status_detail: string | null
          superseded_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          accession: string
          asset_class?: string | null
          attempts?: number
          deal_id?: string | null
          depositor_cik?: number | null
          file_number?: string | null
          filed: string
          form: string
          header_sha256?: string | null
          is_current?: boolean
          issuer_cik?: number | null
          issuer_name?: string | null
          list_cik: number
          listed_at?: string
          load_id?: number | null
          loaded_at?: string | null
          period_end?: string | null
          period_start?: string | null
          sponsor_cik?: number | null
          status?: string
          status_detail?: string | null
          superseded_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          accession?: string
          asset_class?: string | null
          attempts?: number
          deal_id?: string | null
          depositor_cik?: number | null
          file_number?: string | null
          filed?: string
          form?: string
          header_sha256?: string | null
          is_current?: boolean
          issuer_cik?: number | null
          issuer_name?: string | null
          list_cik?: number
          listed_at?: string
          load_id?: number | null
          loaded_at?: string | null
          period_end?: string | null
          period_start?: string | null
          sponsor_cik?: number | null
          status?: string
          status_detail?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abs_filings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "abs_deals"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "abs_filings_load_fk"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "abs_loads"
            referencedColumns: ["load_id"]
          },
          {
            foreignKeyName: "abs_filings_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "abs_filing_periods"
            referencedColumns: ["accession"]
          },
          {
            foreignKeyName: "abs_filings_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "abs_filings"
            referencedColumns: ["accession"]
          },
        ]
      }
      abs_loads: {
        Row: {
          accession: string
          counts: Json | null
          finished_at: string | null
          load_id: number
          parser: string
          source_bytes: number
          source_sha256: string
          started_at: string
          status: string
        }
        Insert: {
          accession: string
          counts?: Json | null
          finished_at?: string | null
          load_id?: never
          parser: string
          source_bytes: number
          source_sha256: string
          started_at?: string
          status?: string
        }
        Update: {
          accession?: string
          counts?: Json | null
          finished_at?: string | null
          load_id?: never
          parser?: string
          source_bytes?: number
          source_sha256?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "abs_loads_accession_fkey"
            columns: ["accession"]
            isOneToOne: false
            referencedRelation: "abs_filing_periods"
            referencedColumns: ["accession"]
          },
          {
            foreignKeyName: "abs_loads_accession_fkey"
            columns: ["accession"]
            isOneToOne: false
            referencedRelation: "abs_filings"
            referencedColumns: ["accession"]
          },
        ]
      }
      abs_pool_metrics: {
        Row: {
          accession: string
          bucket: string
          dim: string
          load_id: number
          metric: string
          n: number
          n_missing: number
          unit: string
          value: number | null
        }
        Insert: {
          accession: string
          bucket?: string
          dim?: string
          load_id: number
          metric: string
          n?: number
          n_missing?: number
          unit: string
          value?: number | null
        }
        Update: {
          accession?: string
          bucket?: string
          dim?: string
          load_id?: number
          metric?: string
          n?: number
          n_missing?: number
          unit?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "abs_pool_metrics_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "abs_loads"
            referencedColumns: ["load_id"]
          },
        ]
      }
      ai_cache: {
        Row: {
          created_at: string
          key: string
          payload: Json
        }
        Insert: {
          created_at?: string
          key: string
          payload: Json
        }
        Update: {
          created_at?: string
          key?: string
          payload?: Json
        }
        Relationships: []
      }
      alert_state: {
        Row: {
          last_seen: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_seen?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_seen?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      alt_data: {
        Row: {
          created_at: string
          dataset: string
          date: string | null
          kind: string
          meta: Json
          source: string
          source_url: string | null
          ticker: string
          title: string
          uid: string
          unit: string | null
          value: number | null
        }
        Insert: {
          created_at?: string
          dataset: string
          date?: string | null
          kind?: string
          meta?: Json
          source: string
          source_url?: string | null
          ticker: string
          title: string
          uid: string
          unit?: string | null
          value?: number | null
        }
        Update: {
          created_at?: string
          dataset?: string
          date?: string | null
          kind?: string
          meta?: Json
          source?: string
          source_url?: string | null
          ticker?: string
          title?: string
          uid?: string
          unit?: string | null
          value?: number | null
        }
        Relationships: []
      }
      analyst_estimates: {
        Row: {
          fetched_at: string
          payload: Json
          ticker: string
        }
        Insert: {
          fetched_at?: string
          payload: Json
          ticker: string
        }
        Update: {
          fetched_at?: string
          payload?: Json
          ticker?: string
        }
        Relationships: []
      }
      browser_runs: {
        Row: {
          created_at: string
          goal: string
          model: string
          run_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          goal: string
          model: string
          run_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          goal?: string
          model?: string
          run_id?: string
          user_id?: string
        }
        Relationships: []
      }
      company_visits: {
        Row: {
          last_seen_at: string
          previous_seen_at: string | null
          ticker: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          previous_seen_at?: string | null
          ticker: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          previous_seen_at?: string | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          content: Json
          created_at: string
          firm_id: string | null
          id: string
          kind: string
          ticker: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: Json
          created_at?: string
          firm_id?: string | null
          id?: string
          kind: string
          ticker?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          firm_id?: string | null
          id?: string
          kind?: string
          ticker?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      earnings_events: {
        Row: {
          accn: string
          filed: string
          source: string
          ticker: string
        }
        Insert: {
          accn: string
          filed: string
          source?: string
          ticker: string
        }
        Update: {
          accn?: string
          filed?: string
          source?: string
          ticker?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          idempotency_key: string
          next_attempt_at: string
          recipient: string
          related_id: string | null
          related_table: string | null
          sent_at: string | null
          status: string
          template: string
          template_data: Json
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key: string
          next_attempt_at?: string
          recipient: string
          related_id?: string | null
          related_table?: string | null
          sent_at?: string | null
          status?: string
          template: string
          template_data?: Json
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          next_attempt_at?: string
          recipient?: string
          related_id?: string | null
          related_table?: string | null
          sent_at?: string | null
          status?: string
          template?: string
          template_data?: Json
          updated_at?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          daily_cap: number
          id: number
          updated_at: string
        }
        Insert: {
          daily_cap?: number
          id?: number
          updated_at?: string
        }
        Update: {
          daily_cap?: number
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      filing_documents: {
        Row: {
          accn: string
          bytes: number
          cached_at: string
          content_type: string
          doc: string
          path: string
        }
        Insert: {
          accn: string
          bytes: number
          cached_at?: string
          content_type: string
          doc: string
          path: string
        }
        Update: {
          accn?: string
          bytes?: number
          cached_at?: string
          content_type?: string
          doc?: string
          path?: string
        }
        Relationships: []
      }
      filing_redlines: {
        Row: {
          created_at: string
          form: string
          from_accn: string
          high: number
          id: string
          medium: number
          payload: Json
          stats: Json
          summary: Json | null
          ticker: string
          to_accn: string
          to_filed: string
          version: number
        }
        Insert: {
          created_at?: string
          form: string
          from_accn: string
          high?: number
          id?: string
          medium?: number
          payload: Json
          stats?: Json
          summary?: Json | null
          ticker: string
          to_accn: string
          to_filed: string
          version: number
        }
        Update: {
          created_at?: string
          form?: string
          from_accn?: string
          high?: number
          id?: string
          medium?: number
          payload?: Json
          stats?: Json
          summary?: Json | null
          ticker?: string
          to_accn?: string
          to_filed?: string
          version?: number
        }
        Relationships: []
      }
      firm_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          firm_id: string
          id: number
          ticker: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          firm_id: string
          id?: never
          ticker?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          firm_id?: string
          id?: never
          ticker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firm_activity_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_coverage: {
        Row: {
          analyst_id: string | null
          created_at: string
          firm_id: string
          note: string | null
          priority: number
          rating: string
          restricted: boolean
          restricted_reason: string | null
          target_price: number | null
          ticker: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          analyst_id?: string | null
          created_at?: string
          firm_id: string
          note?: string | null
          priority?: number
          rating?: string
          restricted?: boolean
          restricted_reason?: string | null
          target_price?: number | null
          ticker: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          analyst_id?: string | null
          created_at?: string
          firm_id?: string
          note?: string | null
          priority?: number
          rating?: string
          restricted?: boolean
          restricted_reason?: string | null
          target_price?: number | null
          ticker?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firm_coverage_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          firm_id: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["firm_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          firm_id: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["firm_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          firm_id?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["firm_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_invites_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_members: {
        Row: {
          display_name: string | null
          email: string | null
          firm_id: string
          joined_at: string
          role: Database["public"]["Enums"]["firm_role"]
          title: string | null
          user_id: string
        }
        Insert: {
          display_name?: string | null
          email?: string | null
          firm_id: string
          joined_at?: string
          role?: Database["public"]["Enums"]["firm_role"]
          title?: string | null
          user_id: string
        }
        Update: {
          display_name?: string | null
          email?: string | null
          firm_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["firm_role"]
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_members_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_notes: {
        Row: {
          author_id: string
          body: string
          context: Json
          created_at: string
          firm_id: string
          id: string
          pinned: boolean
          ticker: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          context?: Json
          created_at?: string
          firm_id: string
          id?: string
          pinned?: boolean
          ticker?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          context?: Json
          created_at?: string
          firm_id?: string
          id?: string
          pinned?: boolean
          ticker?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_notes_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          branding: Json
          created_at: string
          created_by: string
          id: string
          logo_data: string | null
          name: string
          updated_at: string
        }
        Insert: {
          branding?: Json
          created_at?: string
          created_by: string
          id?: string
          logo_data?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          branding?: Json
          created_at?: string
          created_by?: string
          id?: string
          logo_data?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      free_model_usage: {
        Row: {
          confirms: number
          day: string
          failures: number
          requests: number
          updated_at: string
        }
        Insert: {
          confirms?: number
          day: string
          failures?: number
          requests?: number
          updated_at?: string
        }
        Update: {
          confirms?: number
          day?: string
          failures?: number
          requests?: number
          updated_at?: string
        }
        Relationships: []
      }
      insider_buys: {
        Row: {
          accn: string
          filed: string
          is_director: boolean
          is_officer: boolean
          owner: string
          plan_10b5: boolean
          role: string | null
          shares: number | null
          source: string
          ticker: string
          trade_date: string | null
          value: number | null
        }
        Insert: {
          accn: string
          filed: string
          is_director?: boolean
          is_officer?: boolean
          owner: string
          plan_10b5?: boolean
          role?: string | null
          shares?: number | null
          source?: string
          ticker: string
          trade_date?: string | null
          value?: number | null
        }
        Update: {
          accn?: string
          filed?: string
          is_director?: boolean
          is_officer?: boolean
          owner?: string
          plan_10b5?: boolean
          role?: string | null
          shares?: number | null
          source?: string
          ticker?: string
          trade_date?: string | null
          value?: number | null
        }
        Relationships: []
      }
      insider_trades: {
        Row: {
          accn: string
          acquired: boolean
          code: string
          direct: boolean
          discovered_at: string
          doc: string
          filed: string
          owned_after: number | null
          owner: string
          plan_10b5: boolean
          price: number | null
          role: string
          security: string
          seq: number
          shares: number
          ticker: string
          trade_date: string
        }
        Insert: {
          accn: string
          acquired: boolean
          code: string
          direct: boolean
          discovered_at?: string
          doc: string
          filed: string
          owned_after?: number | null
          owner: string
          plan_10b5?: boolean
          price?: number | null
          role: string
          security: string
          seq: number
          shares: number
          ticker: string
          trade_date: string
        }
        Update: {
          accn?: string
          acquired?: boolean
          code?: string
          direct?: boolean
          discovered_at?: string
          doc?: string
          filed?: string
          owned_after?: number | null
          owner?: string
          plan_10b5?: boolean
          price?: number | null
          role?: string
          security?: string
          seq?: number
          shares?: number
          ticker?: string
          trade_date?: string
        }
        Relationships: []
      }
      ir_company_series: {
        Row: {
          built_at: string
          payload: Json | null
          payload_bytes: number | null
          payload_path: string | null
          stats: Json
          ticker: string
        }
        Insert: {
          built_at?: string
          payload?: Json | null
          payload_bytes?: number | null
          payload_path?: string | null
          stats?: Json
          ticker: string
        }
        Update: {
          built_at?: string
          payload?: Json | null
          payload_bytes?: number | null
          payload_path?: string | null
          stats?: Json
          ticker?: string
        }
        Relationships: []
      }
      ir_documents: {
        Row: {
          accn: string | null
          bytes: number | null
          content_type: string | null
          exhibit: string | null
          ext: string | null
          extract_facts: number | null
          extract_model: string | null
          extract_status: string | null
          extract_usage: Json | null
          extracted_at: string | null
          fetched_at: string
          filed: string | null
          id: string
          kind: string
          pages: number | null
          path: string | null
          period: string | null
          prose_at: string | null
          prose_facts: number | null
          prose_status: string | null
          rendition_path: string | null
          sha256: string | null
          source: string
          source_url: string
          ticker: string
          title: string
          vision_at: string | null
          vision_status: string | null
        }
        Insert: {
          accn?: string | null
          bytes?: number | null
          content_type?: string | null
          exhibit?: string | null
          ext?: string | null
          extract_facts?: number | null
          extract_model?: string | null
          extract_status?: string | null
          extract_usage?: Json | null
          extracted_at?: string | null
          fetched_at?: string
          filed?: string | null
          id?: string
          kind?: string
          pages?: number | null
          path?: string | null
          period?: string | null
          prose_at?: string | null
          prose_facts?: number | null
          prose_status?: string | null
          rendition_path?: string | null
          sha256?: string | null
          source?: string
          source_url: string
          ticker: string
          title?: string
          vision_at?: string | null
          vision_status?: string | null
        }
        Update: {
          accn?: string | null
          bytes?: number | null
          content_type?: string | null
          exhibit?: string | null
          ext?: string | null
          extract_facts?: number | null
          extract_model?: string | null
          extract_status?: string | null
          extract_usage?: Json | null
          extracted_at?: string | null
          fetched_at?: string
          filed?: string | null
          id?: string
          kind?: string
          pages?: number | null
          path?: string | null
          period?: string | null
          prose_at?: string | null
          prose_facts?: number | null
          prose_status?: string | null
          rendition_path?: string | null
          sha256?: string | null
          source?: string
          source_url?: string
          ticker?: string
          title?: string
          vision_at?: string | null
          vision_status?: string | null
        }
        Relationships: []
      }
      ir_kpi_facts: {
        Row: {
          accn: string | null
          breakdown: string | null
          category: string
          created_at: string
          derived: boolean
          doc: string | null
          document_id: string
          document_kind: string | null
          filed: string | null
          id: string
          is_total: boolean
          label: string
          locator: Json
          method: string
          metric: string
          model: string | null
          months: number | null
          parent: string | null
          period_end: string | null
          period_label: string
          period_start: string | null
          ticker: string
          unit: string
          value: number
        }
        Insert: {
          accn?: string | null
          breakdown?: string | null
          category: string
          created_at?: string
          derived?: boolean
          doc?: string | null
          document_id: string
          document_kind?: string | null
          filed?: string | null
          id?: string
          is_total?: boolean
          label: string
          locator?: Json
          method?: string
          metric?: string
          model?: string | null
          months?: number | null
          parent?: string | null
          period_end?: string | null
          period_label: string
          period_start?: string | null
          ticker: string
          unit?: string
          value: number
        }
        Update: {
          accn?: string | null
          breakdown?: string | null
          category?: string
          created_at?: string
          derived?: boolean
          doc?: string | null
          document_id?: string
          document_kind?: string | null
          filed?: string | null
          id?: string
          is_total?: boolean
          label?: string
          locator?: Json
          method?: string
          metric?: string
          model?: string | null
          months?: number | null
          parent?: string | null
          period_end?: string | null
          period_label?: string
          period_start?: string | null
          ticker?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "ir_kpi_facts_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ir_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      ir_label_map: {
        Row: {
          canonical: Json
          created_at: string
          model: string | null
          raw_key: string
          ticker: string
        }
        Insert: {
          canonical: Json
          created_at?: string
          model?: string | null
          raw_key: string
          ticker: string
        }
        Update: {
          canonical?: Json
          created_at?: string
          model?: string | null
          raw_key?: string
          ticker?: string
        }
        Relationships: []
      }
      ir_release_scan: {
        Row: {
          accn: string
          files: number
          scanned_at: string
          status: string
          stored: number
          ticker: string
        }
        Insert: {
          accn: string
          files?: number
          scanned_at?: string
          status: string
          stored?: number
          ticker: string
        }
        Update: {
          accn?: string
          files?: number
          scanned_at?: string
          status?: string
          stored?: number
          ticker?: string
        }
        Relationships: []
      }
      job_runs: {
        Row: {
          detail: Json | null
          finished_at: string | null
          id: number
          items: number
          job: string
          ok: boolean | null
          started_at: string
        }
        Insert: {
          detail?: Json | null
          finished_at?: string | null
          id?: never
          items?: number
          job: string
          ok?: boolean | null
          started_at?: string
        }
        Update: {
          detail?: Json | null
          finished_at?: string | null
          id?: never
          items?: number
          job?: string
          ok?: boolean | null
          started_at?: string
        }
        Relationships: []
      }
      job_state: {
        Row: {
          cursor: number
          job: string
          lease_until: string | null
          paused_reason: string | null
          updated_at: string
        }
        Insert: {
          cursor?: number
          job: string
          lease_until?: string | null
          paused_reason?: string | null
          updated_at?: string
        }
        Update: {
          cursor?: number
          job?: string
          lease_until?: string | null
          paused_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      macro_observations: {
        Row: {
          date: string
          series_id: string
          updated_at: string
          value: number
        }
        Insert: {
          date: string
          series_id: string
          updated_at?: string
          value: number
        }
        Update: {
          date?: string
          series_id?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      macro_summaries: {
        Row: {
          series_id: string
          summary: Json
          updated_at: string
        }
        Insert: {
          series_id: string
          summary: Json
          updated_at?: string
        }
        Update: {
          series_id?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: []
      }
      market_bars: {
        Row: {
          adj_close: number | null
          close: number
          date: string
          high: number | null
          low: number | null
          open: number | null
          symbol: string
          updated_at: string
          volume: number | null
        }
        Insert: {
          adj_close?: number | null
          close: number
          date: string
          high?: number | null
          low?: number | null
          open?: number | null
          symbol: string
          updated_at?: string
          volume?: number | null
        }
        Update: {
          adj_close?: number | null
          close?: number
          date?: string
          high?: number | null
          low?: number | null
          open?: number | null
          symbol?: string
          updated_at?: string
          volume?: number | null
        }
        Relationships: []
      }
      office_files: {
        Row: {
          created_at: string
          id: string
          kind: string
          owner: string
          size_bytes: number
          storage_path: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id: string
          kind: string
          owner: string
          size_bytes?: number
          storage_path?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          owner?: string
          size_bytes?: number
          storage_path?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      openai_allowance: {
        Row: {
          calls: number
          day: string
          tier: string
          tokens: number
          updated_at: string
        }
        Insert: {
          calls?: number
          day: string
          tier: string
          tokens?: number
          updated_at?: string
        }
        Update: {
          calls?: number
          day?: string
          tier?: string
          tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      options_daily: {
        Row: {
          atm_iv: number | null
          call_oi: number
          call_vol: number
          date: string
          fetched_at: string
          iv30: number | null
          pc_oi: number | null
          pc_vol: number | null
          price: number
          put_oi: number
          put_vol: number
          skew25: number | null
          term: Json
          ticker: string
        }
        Insert: {
          atm_iv?: number | null
          call_oi?: number
          call_vol?: number
          date: string
          fetched_at?: string
          iv30?: number | null
          pc_oi?: number | null
          pc_vol?: number | null
          price: number
          put_oi?: number
          put_vol?: number
          skew25?: number | null
          term?: Json
          ticker: string
        }
        Update: {
          atm_iv?: number | null
          call_oi?: number
          call_vol?: number
          date?: string
          fetched_at?: string
          iv30?: number | null
          pc_oi?: number | null
          pc_vol?: number | null
          price?: number
          put_oi?: number
          put_vol?: number
          skew25?: number | null
          term?: Json
          ticker?: string
        }
        Relationships: []
      }
      paper_bot_equity: {
        Row: {
          bot_id: string
          date: string
          equity: number
          invested: number
          open_positions: number
          realized: number
          spy: number | null
        }
        Insert: {
          bot_id: string
          date: string
          equity: number
          invested?: number
          open_positions?: number
          realized?: number
          spy?: number | null
        }
        Update: {
          bot_id?: string
          date?: string
          equity?: number
          invested?: number
          open_positions?: number
          realized?: number
          spy?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "paper_bot_equity_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "paper_bots"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_bot_positions: {
        Row: {
          atr: number | null
          bot_id: string
          close_requested: boolean
          cost: number
          created_at: string
          entry_date: string | null
          entry_price: number | null
          exit_date: string | null
          exit_price: number | null
          exit_reason: string | null
          horizon: number
          id: string
          name: string | null
          notional: number | null
          pnl: number | null
          ret: number | null
          ret_spy: number | null
          sector: string | null
          shares: number | null
          side: number
          signal_date: string
          signal_price: number | null
          spy_entry: number | null
          status: string
          stop: number | null
          strategy: string
          target: number | null
          ticker: string
          updated_at: string
          variant: string
        }
        Insert: {
          atr?: number | null
          bot_id: string
          close_requested?: boolean
          cost?: number
          created_at?: string
          entry_date?: string | null
          entry_price?: number | null
          exit_date?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          horizon: number
          id?: string
          name?: string | null
          notional?: number | null
          pnl?: number | null
          ret?: number | null
          ret_spy?: number | null
          sector?: string | null
          shares?: number | null
          side: number
          signal_date: string
          signal_price?: number | null
          spy_entry?: number | null
          status?: string
          stop?: number | null
          strategy: string
          target?: number | null
          ticker: string
          updated_at?: string
          variant: string
        }
        Update: {
          atr?: number | null
          bot_id?: string
          close_requested?: boolean
          cost?: number
          created_at?: string
          entry_date?: string | null
          entry_price?: number | null
          exit_date?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          horizon?: number
          id?: string
          name?: string | null
          notional?: number | null
          pnl?: number | null
          ret?: number | null
          ret_spy?: number | null
          sector?: string | null
          shares?: number | null
          side?: number
          signal_date?: string
          signal_price?: number | null
          spy_entry?: number | null
          status?: string
          stop?: number | null
          strategy?: string
          target?: number | null
          ticker?: string
          updated_at?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_bot_positions_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "paper_bots"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_bots: {
        Row: {
          capital: number
          created_at: string
          description: string | null
          id: string
          last_as_of: string | null
          last_error: string | null
          last_run_at: string | null
          name: string
          rules: Json
          slug: string | null
          started_on: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          capital?: number
          created_at?: string
          description?: string | null
          id?: string
          last_as_of?: string | null
          last_error?: string | null
          last_run_at?: string | null
          name: string
          rules?: Json
          slug?: string | null
          started_on?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          capital?: number
          created_at?: string
          description?: string | null
          id?: string
          last_as_of?: string | null
          last_error?: string | null
          last_run_at?: string | null
          name?: string
          rules?: Json
          slug?: string | null
          started_on?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      paper_trades: {
        Row: {
          closed_at: string | null
          closed_price: number | null
          created_at: string
          direction: string
          entry_date: string
          entry_price: number
          id: string
          signals: Json
          stop: number | null
          target: number | null
          ticker: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          direction: string
          entry_date?: string
          entry_price: number
          id?: string
          signals?: Json
          stop?: number | null
          target?: number | null
          ticker: string
          user_id?: string
        }
        Update: {
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          direction?: string
          entry_date?: string
          entry_price?: number
          id?: string
          signals?: Json
          stop?: number | null
          target?: number | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      partner_mirror: {
        Row: {
          bytes: number | null
          error: string | null
          kind: string
          mirrored_at: string
          path: string
          sha256: string | null
          status: string
          ticker: string
        }
        Insert: {
          bytes?: number | null
          error?: string | null
          kind: string
          mirrored_at?: string
          path: string
          sha256?: string | null
          status?: string
          ticker: string
        }
        Update: {
          bytes?: number | null
          error?: string | null
          kind?: string
          mirrored_at?: string
          path?: string
          sha256?: string | null
          status?: string
          ticker?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_demo: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_demo?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_demo?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      report_runs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          kind: string
          ms: number | null
          report_id: string | null
          scope: string
          source: string
          status: string
          ticker: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          ms?: number | null
          report_id?: string | null
          scope: string
          source?: string
          status?: string
          ticker: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          ms?: number | null
          report_id?: string | null
          scope?: string
          source?: string
          status?: string
          ticker?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          created_at: string
          created_by: string
          firm_id: string | null
          id: string
          kind: string
          name: string
          options: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          firm_id?: string | null
          id?: string
          kind: string
          name: string
          options?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          firm_id?: string | null
          id?: string
          kind?: string
          name?: string
          options?: Json
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_templates_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          content: Json | null
          created_at: string
          data_version: string
          error: string | null
          firm_id: string | null
          id: string
          kind: string
          options: Json
          requested_by: string | null
          scope: string
          started_at: string | null
          status: string
          ticker: string
          title: string | null
          updated_at: string
          user_id: string | null
          variant: string
        }
        Insert: {
          content?: Json | null
          created_at?: string
          data_version?: string
          error?: string | null
          firm_id?: string | null
          id?: string
          kind: string
          options?: Json
          requested_by?: string | null
          scope: string
          started_at?: string | null
          status?: string
          ticker: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
          variant?: string
        }
        Update: {
          content?: Json | null
          created_at?: string
          data_version?: string
          error?: string | null
          firm_id?: string | null
          id?: string
          kind?: string
          options?: Json
          requested_by?: string | null
          scope?: string
          started_at?: string | null
          status?: string
          ticker?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      research_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          steps: Json
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          steps?: Json
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          steps?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "research_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      research_sessions: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sec_filings: {
        Row: {
          accn: string
          cik: string
          description: string | null
          discovered_at: string
          doc: string
          filed: string
          form: string
          items: string | null
          ixbrl: boolean
          report: string | null
          size: number | null
          ticker: string
        }
        Insert: {
          accn: string
          cik: string
          description?: string | null
          discovered_at?: string
          doc: string
          filed: string
          form: string
          items?: string | null
          ixbrl?: boolean
          report?: string | null
          size?: number | null
          ticker: string
        }
        Update: {
          accn?: string
          cik?: string
          description?: string | null
          discovered_at?: string
          doc?: string
          filed?: string
          form?: string
          items?: string | null
          ixbrl?: boolean
          report?: string | null
          size?: number | null
          ticker?: string
        }
        Relationships: []
      }
      setup_cycles: {
        Row: {
          as_of: string
          cursor: number
          detail: Json
          finished_at: string | null
          lease_until: string | null
          phase: string
          started_at: string
          updated_at: string
        }
        Insert: {
          as_of: string
          cursor?: number
          detail?: Json
          finished_at?: string | null
          lease_until?: string | null
          phase?: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          as_of?: string
          cursor?: number
          detail?: Json
          finished_at?: string | null
          lease_until?: string | null
          phase?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      setup_results: {
        Row: {
          as_of: string
          generated_at: string
          payload: Json
        }
        Insert: {
          as_of: string
          generated_at?: string
          payload: Json
        }
        Update: {
          as_of?: string
          generated_at?: string
          payload?: Json
        }
        Relationships: []
      }
      setup_samples: {
        Row: {
          d: string
          ex: number
          gross: number
          net: number
          ticker: string
          variant: string
        }
        Insert: {
          d: string
          ex: number
          gross: number
          net: number
          ticker: string
          variant: string
        }
        Update: {
          d?: string
          ex?: number
          gross?: number
          net?: number
          ticker?: string
          variant?: string
        }
        Relationships: []
      }
      setup_scan: {
        Row: {
          bars: number | null
          claimed_at: string | null
          error: string | null
          samples: number | null
          scanned_for: string | null
          sector: string | null
          ticker: string
          updated_at: string
        }
        Insert: {
          bars?: number | null
          claimed_at?: string | null
          error?: string | null
          samples?: number | null
          scanned_for?: string | null
          sector?: string | null
          ticker: string
          updated_at?: string
        }
        Update: {
          bars?: number | null
          claimed_at?: string | null
          error?: string | null
          samples?: number | null
          scanned_for?: string | null
          sector?: string | null
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      setup_series: {
        Row: {
          above200: boolean | null
          c: number[]
          dv20: number | null
          end_date: string
          near_high: boolean | null
          o: number[]
          r21: number | null
          r5: number | null
          sector: string | null
          short5: number | null
          start_date: string
          ticker: string
          updated_at: string
          vol60: number | null
        }
        Insert: {
          above200?: boolean | null
          c: number[]
          dv20?: number | null
          end_date: string
          near_high?: boolean | null
          o: number[]
          r21?: number | null
          r5?: number | null
          sector?: string | null
          short5?: number | null
          start_date: string
          ticker: string
          updated_at?: string
          vol60?: number | null
        }
        Update: {
          above200?: boolean | null
          c?: number[]
          dv20?: number | null
          end_date?: string
          near_high?: boolean | null
          o?: number[]
          r21?: number | null
          r5?: number | null
          sector?: string | null
          short5?: number | null
          start_date?: string
          ticker?: string
          updated_at?: string
          vol60?: number | null
        }
        Relationships: []
      }
      setup_signals: {
        Row: {
          atr: number | null
          context: Json
          cost: number | null
          detail: string | null
          dv20: number | null
          fired_at: string
          first_seen: string
          horizon: number
          last_seen: string
          name: string | null
          outcome_at: string | null
          outcome_ex: number | null
          outcome_net: number | null
          price: number | null
          sector: string | null
          side: number
          spark: number[] | null
          strategy: string
          strength: number | null
          ticker: string
          variant: string
        }
        Insert: {
          atr?: number | null
          context?: Json
          cost?: number | null
          detail?: string | null
          dv20?: number | null
          fired_at: string
          first_seen: string
          horizon: number
          last_seen: string
          name?: string | null
          outcome_at?: string | null
          outcome_ex?: number | null
          outcome_net?: number | null
          price?: number | null
          sector?: string | null
          side: number
          spark?: number[] | null
          strategy: string
          strength?: number | null
          ticker: string
          variant: string
        }
        Update: {
          atr?: number | null
          context?: Json
          cost?: number | null
          detail?: string | null
          dv20?: number | null
          fired_at?: string
          first_seen?: string
          horizon?: number
          last_seen?: string
          name?: string | null
          outcome_at?: string | null
          outcome_ex?: number | null
          outcome_net?: number | null
          price?: number | null
          sector?: string | null
          side?: number
          spark?: number[] | null
          strategy?: string
          strength?: number | null
          ticker?: string
          variant?: string
        }
        Relationships: []
      }
      setup_variant_stats: {
        Row: {
          as_of: string
          stats: Json
          updated_at: string
          variant: string
        }
        Insert: {
          as_of: string
          stats: Json
          updated_at?: string
          variant: string
        }
        Update: {
          as_of?: string
          stats?: Json
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      short_volume: {
        Row: {
          date: string
          exempt_vol: number
          short_vol: number
          symbol: string
          total_vol: number
        }
        Insert: {
          date: string
          exempt_vol?: number
          short_vol: number
          symbol: string
          total_vol: number
        }
        Update: {
          date?: string
          exempt_vol?: number
          short_vol?: number
          symbol?: string
          total_vol?: number
        }
        Relationships: []
      }
      source_datasets: {
        Row: {
          agency: string
          created_at: string
          description: string
          grain: string
          id: string
          latest_snapshot_id: string | null
          name: string
          notes: string
          sector: string
          source_id: string | null
          source_url: string | null
          units: string
          updated_at: string
        }
        Insert: {
          agency: string
          created_at?: string
          description?: string
          grain?: string
          id: string
          latest_snapshot_id?: string | null
          name: string
          notes?: string
          sector: string
          source_id?: string | null
          source_url?: string | null
          units?: string
          updated_at?: string
        }
        Update: {
          agency?: string
          created_at?: string
          description?: string
          grain?: string
          id?: string
          latest_snapshot_id?: string | null
          name?: string
          notes?: string
          sector?: string
          source_id?: string | null
          source_url?: string | null
          units?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_datasets_latest_fk"
            columns: ["id", "latest_snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["dataset_id", "id"]
          },
        ]
      }
      source_field_counts: {
        Row: {
          blank: number
          capped: string | null
          computed_at: string
          distinct_values: number | null
          filled: number
          missing: number
          numeric_rows: number
          other_rows: number
          other_values: number | null
          position: number
          snapshot_id: string
          top: Json
          value_cap: number
        }
        Insert: {
          blank: number
          capped?: string | null
          computed_at?: string
          distinct_values?: number | null
          filled: number
          missing: number
          numeric_rows: number
          other_rows: number
          other_values?: number | null
          position: number
          snapshot_id: string
          top?: Json
          value_cap: number
        }
        Update: {
          blank?: number
          capped?: string | null
          computed_at?: string
          distinct_values?: number | null
          filled?: number
          missing?: number
          numeric_rows?: number
          other_rows?: number
          other_values?: number | null
          position?: number
          snapshot_id?: string
          top?: Json
          value_cap?: number
        }
        Relationships: [
          {
            foreignKeyName: "source_field_counts_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      source_files: {
        Row: {
          bytes: number
          chunks: Json
          content_type: string
          created_at: string
          provenance: Json
          sha256: string
          verified_at: string | null
        }
        Insert: {
          bytes: number
          chunks: Json
          content_type: string
          created_at?: string
          provenance?: Json
          sha256: string
          verified_at?: string | null
        }
        Update: {
          bytes?: number
          chunks?: Json
          content_type?: string
          created_at?: string
          provenance?: Json
          sha256?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      source_records: {
        Row: {
          entity_id: string | null
          entity_name: string | null
          geo_code: string | null
          geo_level: string | null
          geo_name: string | null
          period: string | null
          row_number: number
          snapshot_id: string
          source_url: string | null
          values: Json
        }
        Insert: {
          entity_id?: string | null
          entity_name?: string | null
          geo_code?: string | null
          geo_level?: string | null
          geo_name?: string | null
          period?: string | null
          row_number: number
          snapshot_id: string
          source_url?: string | null
          values: Json
        }
        Update: {
          entity_id?: string | null
          entity_name?: string | null
          geo_code?: string | null
          geo_level?: string | null
          geo_name?: string | null
          period?: string | null
          row_number?: number
          snapshot_id?: string
          source_url?: string | null
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "source_records_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      source_snapshot_stats: {
        Row: {
          computed_at: string | null
          entities: number | null
          geographies: number | null
          labels: string | null
          period_max: string | null
          period_min: string | null
          periods: number | null
          snapshot_id: string
        }
        Insert: {
          computed_at?: string | null
          entities?: number | null
          geographies?: number | null
          labels?: string | null
          period_max?: string | null
          period_min?: string | null
          periods?: number | null
          snapshot_id: string
        }
        Update: {
          computed_at?: string | null
          entities?: number | null
          geographies?: number | null
          labels?: string | null
          period_max?: string | null
          period_min?: string | null
          periods?: number | null
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_snapshot_stats_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: true
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      source_snapshots: {
        Row: {
          attempts: number
          column_count: number | null
          columns: Json
          coverage: Json
          created_at: string
          dataset_id: string
          expected_rows: number
          file_sha256: string
          id: string
          ingest: Json
          last_error: string | null
          lease_owner: string | null
          lease_until: string | null
          loaded_rows: number
          published_at: string | null
          quality: Json
          retrieved_at: string | null
          source_path: string
          status: string
        }
        Insert: {
          attempts?: number
          column_count?: number | null
          columns: Json
          coverage?: Json
          created_at?: string
          dataset_id: string
          expected_rows: number
          file_sha256: string
          id: string
          ingest: Json
          last_error?: string | null
          lease_owner?: string | null
          lease_until?: string | null
          loaded_rows?: number
          published_at?: string | null
          quality?: Json
          retrieved_at?: string | null
          source_path: string
          status?: string
        }
        Update: {
          attempts?: number
          column_count?: number | null
          columns?: Json
          coverage?: Json
          created_at?: string
          dataset_id?: string
          expected_rows?: number
          file_sha256?: string
          id?: string
          ingest?: Json
          last_error?: string | null
          lease_owner?: string | null
          lease_until?: string | null
          loaded_rows?: number
          published_at?: string | null
          quality?: Json
          retrieved_at?: string | null
          source_path?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_snapshots_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "source_datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_snapshots_file_sha256_fkey"
            columns: ["file_sha256"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["sha256"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          current_period_end: string | null
          environment: string
          price_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          environment?: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          environment?: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      supply_links: {
        Row: {
          accn: string
          amount_usd: number | null
          counterparty: string
          counterparty_domain: string | null
          counterparty_ticker: string | null
          created_at: string
          detail: string
          doc: string
          filed: string
          form: string
          id: string
          is_current: boolean
          link_type: string | null
          product: string | null
          quote: string
          regions: string[]
          relation: string
          risk: string | null
          share_pct: number | null
          single_source: boolean
          ticker: string
        }
        Insert: {
          accn: string
          amount_usd?: number | null
          counterparty: string
          counterparty_domain?: string | null
          counterparty_ticker?: string | null
          created_at?: string
          detail: string
          doc: string
          filed: string
          form: string
          id?: string
          is_current?: boolean
          link_type?: string | null
          product?: string | null
          quote: string
          regions?: string[]
          relation: string
          risk?: string | null
          share_pct?: number | null
          single_source?: boolean
          ticker: string
        }
        Update: {
          accn?: string
          amount_usd?: number | null
          counterparty?: string
          counterparty_domain?: string | null
          counterparty_ticker?: string | null
          created_at?: string
          detail?: string
          doc?: string
          filed?: string
          form?: string
          id?: string
          is_current?: boolean
          link_type?: string | null
          product?: string | null
          quote?: string
          regions?: string[]
          relation?: string
          risk?: string | null
          share_pct?: number | null
          single_source?: boolean
          ticker?: string
        }
        Relationships: []
      }
      supply_signals: {
        Row: {
          accn: string | null
          amount_usd: number | null
          counterparty: string | null
          country: string | null
          created_at: string
          detail: string | null
          doc: string | null
          filed: string | null
          form: string | null
          id: string
          impact: string
          kind: string
          pct: number | null
          period: string | null
          quote: string
          source_kind: string
          speaker: string | null
          ticker: string
          title: string
          url: string | null
        }
        Insert: {
          accn?: string | null
          amount_usd?: number | null
          counterparty?: string | null
          country?: string | null
          created_at?: string
          detail?: string | null
          doc?: string | null
          filed?: string | null
          form?: string | null
          id?: string
          impact?: string
          kind: string
          pct?: number | null
          period?: string | null
          quote: string
          source_kind: string
          speaker?: string | null
          ticker: string
          title: string
          url?: string | null
        }
        Update: {
          accn?: string | null
          amount_usd?: number | null
          counterparty?: string | null
          country?: string | null
          created_at?: string
          detail?: string | null
          doc?: string | null
          filed?: string | null
          form?: string | null
          id?: string
          impact?: string
          kind?: string
          pct?: number | null
          period?: string | null
          quote?: string
          source_kind?: string
          speaker?: string | null
          ticker?: string
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      theses: {
        Row: {
          catalysts: string[]
          conviction: number
          created_at: string
          entry_price: number | null
          firm_id: string | null
          horizon: string | null
          id: string
          is_public: boolean
          risks: string[]
          stance: string
          status: string
          summary: string
          target_price: number | null
          ticker: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          catalysts?: string[]
          conviction?: number
          created_at?: string
          entry_price?: number | null
          firm_id?: string | null
          horizon?: string | null
          id?: string
          is_public?: boolean
          risks?: string[]
          stance?: string
          status?: string
          summary?: string
          target_price?: number | null
          ticker: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          catalysts?: string[]
          conviction?: number
          created_at?: string
          entry_price?: number | null
          firm_id?: string | null
          horizon?: string | null
          id?: string
          is_public?: boolean
          risks?: string[]
          stance?: string
          status?: string
          summary?: string
          target_price?: number | null
          ticker?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "theses_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      thesis_updates: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          thesis_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          kind?: string
          thesis_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          thesis_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thesis_updates_thesis_id_fkey"
            columns: ["thesis_id"]
            isOneToOne: false
            referencedRelation: "theses"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          kind: string
          period: string
          used: number
          user_id: string
        }
        Insert: {
          kind: string
          period: string
          used?: number
          user_id: string
        }
        Update: {
          kind?: string
          period?: string
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      user_onboarding: {
        Row: {
          checklist: Json
          dismissed: boolean
          seeded_at: string | null
          tour_done_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          checklist?: Json
          dismissed?: boolean
          seeded_at?: string | null
          tour_done_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          checklist?: Json
          dismissed?: boolean
          seeded_at?: string | null
          tour_done_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          display_name: string | null
          email: string | null
          status: string
          terms_accepted_at: string | null
          trial_started_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          display_name?: string | null
          email?: string | null
          status?: string
          terms_accepted_at?: string | null
          trial_started_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          display_name?: string | null
          email?: string | null
          status?: string
          terms_accepted_at?: string | null
          trial_started_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      waitlist_attempts: {
        Row: {
          created_at: string
          email: string
          id: number
          ip_hash: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: number
          ip_hash: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: number
          ip_hash?: string
        }
        Relationships: []
      }
      waitlist_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          email: string
          firm: string | null
          id: string
          name: string
          role: string | null
          status: string
          use_case: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          email: string
          firm?: string | null
          id?: string
          name: string
          role?: string | null
          status?: string
          use_case?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          email?: string
          firm?: string | null
          id?: string
          name?: string
          role?: string | null
          status?: string
          use_case?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      watchlist: {
        Row: {
          created_at: string
          id: string
          note: string | null
          ticker: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          ticker: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      xbrl_concentration: {
        Row: {
          accn: string
          benchmark: string
          benchmark_label: string
          counterparty: string | null
          created_at: string
          element_id: string | null
          filed: string
          form: string
          id: number
          kind: string
          label: string
          member: string
          pct: number
          period_end: string
          period_start: string | null
          ticker: string
        }
        Insert: {
          accn: string
          benchmark: string
          benchmark_label?: string
          counterparty?: string | null
          created_at?: string
          element_id?: string | null
          filed: string
          form: string
          id?: never
          kind: string
          label: string
          member: string
          pct: number
          period_end: string
          period_start?: string | null
          ticker: string
        }
        Update: {
          accn?: string
          benchmark?: string
          benchmark_label?: string
          counterparty?: string | null
          created_at?: string
          element_id?: string | null
          filed?: string
          form?: string
          id?: never
          kind?: string
          label?: string
          member?: string
          pct?: number
          period_end?: string
          period_start?: string | null
          ticker?: string
        }
        Relationships: []
      }
    }
    Views: {
      abs_cmbs_assets_live: {
        Row: {
          accepted_at: string | null
          accession: string | null
          accrual_method_code: string | null
          actual_end_balance: number | null
          asset_added: boolean | null
          asset_number: string | null
          asset_type_number: string | null
          balloon: boolean | null
          begin_balance: number | null
          cover_period_end: string | null
          deal_id: string | null
          extra: Json | null
          filed: string | null
          first_payment_date: string | null
          form: string | null
          group_id: string | null
          interest_only: boolean | null
          is_current: boolean | null
          kind: string | null
          last_modification_date: string | null
          lien_position_code: string | null
          liquidation_prepayment_code: string | null
          liquidation_prepayment_date: string | null
          load_id: number | null
          loan_structure_code: string | null
          master_servicer_return_date: string | null
          maturity_date: string | null
          modification_code: string | null
          modified: boolean | null
          non_recoverable: boolean | null
          original_amortization_months: number | null
          original_interest_only_months: number | null
          original_loan_amount: number | null
          original_rate: number | null
          original_term_months: number | null
          origination_date: string | null
          originator_name: string | null
          other_advances_outstanding: number | null
          paid_through_date: string | null
          payment_frequency_code: string | null
          payment_status_code: string | null
          payment_type_code: string | null
          period_begin: string | null
          period_end: string | null
          period_modified: boolean | null
          period_rate: number | null
          pi_advances_outstanding: number | null
          primary_servicer_name: string | null
          properties: number | null
          properties_securitization: number | null
          rate_type_code: string | null
          realized_loss: number | null
          rec: number | null
          sched_end_balance: number | null
          sched_interest: number | null
          sched_principal: number | null
          securitization_balance: number | null
          securitization_rate: number | null
          special_servicer_transfer_date: string | null
          subject_to_demand: boolean | null
          ti_advances_outstanding: number | null
          total_pi_due: number | null
          unparsed: Json | null
          unsched_principal: number | null
          workout_strategy_code: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abs_cmbs_assets_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "abs_loads"
            referencedColumns: ["load_id"]
          },
          {
            foreignKeyName: "abs_filings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "abs_deals"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      abs_cmbs_properties_live: {
        Row: {
          accepted_at: string | null
          accession: string | null
          address: string | null
          asset_number: string | null
          city: string | null
          county: string | null
          cover_period_end: string | null
          deal_id: string | null
          debt_service_recent: number | null
          defeased_code: string | null
          dscr_code_recent: string | null
          dscr_code_securitization: string | null
          dscr_ncf_recent: number | null
          dscr_ncf_securitization: number | null
          dscr_noi_recent: number | null
          dscr_noi_securitization: number | null
          extra: Json | null
          filed: string | null
          financials_recent_end: string | null
          financials_recent_start: string | null
          financials_securitization_date: string | null
          form: string | null
          is_current: boolean | null
          lease_rollover_review_date: string | null
          link: string | null
          load_id: number | null
          loan_asset_number: string | null
          name: string | null
          ncf_recent: number | null
          ncf_securitization: number | null
          noi_ncf_code_recent: string | null
          noi_ncf_code_securitization: string | null
          noi_recent: number | null
          noi_securitization: number | null
          occupancy_recent: number | null
          occupancy_securitization: number | null
          opex_recent: number | null
          opex_securitization: number | null
          rec: number | null
          revenue_recent: number | null
          revenue_securitization: number | null
          seq: number | null
          sq_ft: number | null
          sq_ft_securitization: number | null
          state: string | null
          status_code: string | null
          tenant1: string | null
          tenant1_lease_end: string | null
          tenant1_sq_ft: number | null
          tenant2: string | null
          tenant2_lease_end: string | null
          tenant2_sq_ft: number | null
          tenant3: string | null
          tenant3_lease_end: string | null
          tenant3_sq_ft: number | null
          type_code: string | null
          units: number | null
          units_securitization: number | null
          unparsed: Json | null
          valuation_recent: number | null
          valuation_recent_date: string | null
          valuation_recent_source: string | null
          valuation_securitization: number | null
          valuation_securitization_date: string | null
          valuation_source_securitization: string | null
          year_built: number | null
          year_renovated: number | null
          zip: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abs_cmbs_properties_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "abs_loads"
            referencedColumns: ["load_id"]
          },
          {
            foreignKeyName: "abs_filings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "abs_deals"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      abs_filing_periods: {
        Row: {
          accepted_at: string | null
          accession: string | null
          alone_amendment: boolean | null
          cover_after_filing: boolean | null
          cover_period_end: string | null
          cover_period_start: string | null
          deal_id: string | null
          filed: string | null
          form: string | null
          is_current: boolean | null
          list_cik: number | null
          load_id: number | null
          loaded_at: string | null
          period_ends: number | null
          records_after_filing: boolean | null
          records_period_end: string | null
          superseded_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abs_filings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "abs_deals"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "abs_filings_load_fk"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "abs_loads"
            referencedColumns: ["load_id"]
          },
          {
            foreignKeyName: "abs_filings_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "abs_filing_periods"
            referencedColumns: ["accession"]
          },
          {
            foreignKeyName: "abs_filings_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "abs_filings"
            referencedColumns: ["accession"]
          },
        ]
      }
      abs_pool_metrics_live: {
        Row: {
          accepted_at: string | null
          accession: string | null
          bucket: string | null
          cover_period_end: string | null
          cover_period_start: string | null
          deal_id: string | null
          dim: string | null
          filed: string | null
          form: string | null
          is_current: boolean | null
          load_id: number | null
          metric: string | null
          n: number | null
          n_missing: number | null
          unit: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "abs_filings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "abs_deals"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "abs_pool_metrics_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "abs_loads"
            referencedColumns: ["load_id"]
          },
        ]
      }
    }
    Functions: {
      abs_begin_load: {
        Args: {
          _accession: string
          _bytes: number
          _force?: boolean
          _parser: string
          _sha256: string
        }
        Returns: Json
      }
      abs_check: {
        Args: never
        Returns: {
          bad: number
          problem: string
        }[]
      }
      abs_claim_next: {
        Args: { _max_attempts: number; _watch: Json }
        Returns: Json
      }
      abs_commit_load: {
        Args: {
          _documents: Json
          _expect: Json
          _filing: Json
          _load_id: number
        }
        Returns: Json
      }
      abs_deal: { Args: { _deal_id: string }; Returns: Json }
      abs_fail_claimed: {
        Args: { _accession: string; _detail: string }
        Returns: undefined
      }
      abs_filing_load: { Args: { _accession: string }; Returns: Json }
      abs_filing_states: { Args: { _list_cik: number }; Returns: Json }
      abs_mark_filing: {
        Args: { _accession: string; _detail: string; _status: string }
        Returns: undefined
      }
      abs_monitor: {
        Args: { _family: string; _periods?: number }
        Returns: Json
      }
      abs_put_rows: {
        Args: { _kind: string; _load_id: number; _rows: Json }
        Returns: number
      }
      abs_register_filings: { Args: { _rows: Json }; Returns: Json }
      abs_release_filing: {
        Args: { _accession: string; _detail: string }
        Returns: undefined
      }
      abs_require_columns: {
        Args: { _rows: Json; _table: string }
        Returns: undefined
      }
      abs_review: {
        Args: never
        Returns: {
          accession: string
          deal_id: string
          filed: string
          period_end: string
          what: string
        }[]
      }
      abs_rows_cmbs_assets: {
        Args: { _accession: string; _load_id: number; _rows: Json }
        Returns: {
          accession: string
          accrual_method_code: string | null
          actual_end_balance: number | null
          asset_added: boolean | null
          asset_number: string
          asset_type_number: string | null
          balloon: boolean | null
          begin_balance: number | null
          extra: Json
          first_payment_date: string | null
          group_id: string | null
          interest_only: boolean | null
          kind: string
          last_modification_date: string | null
          lien_position_code: string | null
          liquidation_prepayment_code: string | null
          liquidation_prepayment_date: string | null
          load_id: number
          loan_structure_code: string | null
          master_servicer_return_date: string | null
          maturity_date: string | null
          modification_code: string | null
          modified: boolean | null
          non_recoverable: boolean | null
          original_amortization_months: number | null
          original_interest_only_months: number | null
          original_loan_amount: number | null
          original_rate: number | null
          original_term_months: number | null
          origination_date: string | null
          originator_name: string | null
          other_advances_outstanding: number | null
          paid_through_date: string | null
          payment_frequency_code: string | null
          payment_status_code: string | null
          payment_type_code: string | null
          period_begin: string | null
          period_end: string | null
          period_modified: boolean | null
          period_rate: number | null
          pi_advances_outstanding: number | null
          primary_servicer_name: string | null
          properties: number | null
          properties_securitization: number | null
          rate_type_code: string | null
          realized_loss: number | null
          rec: number
          sched_end_balance: number | null
          sched_interest: number | null
          sched_principal: number | null
          securitization_balance: number | null
          securitization_rate: number | null
          special_servicer_transfer_date: string | null
          subject_to_demand: boolean | null
          ti_advances_outstanding: number | null
          total_pi_due: number | null
          unparsed: Json
          unsched_principal: number | null
          workout_strategy_code: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "abs_cmbs_assets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      abs_rows_cmbs_properties: {
        Args: { _accession: string; _load_id: number; _rows: Json }
        Returns: {
          accession: string
          address: string | null
          asset_number: string
          city: string | null
          county: string | null
          debt_service_recent: number | null
          defeased_code: string | null
          dscr_code_recent: string | null
          dscr_code_securitization: string | null
          dscr_ncf_recent: number | null
          dscr_ncf_securitization: number | null
          dscr_noi_recent: number | null
          dscr_noi_securitization: number | null
          extra: Json
          financials_recent_end: string | null
          financials_recent_start: string | null
          financials_securitization_date: string | null
          lease_rollover_review_date: string | null
          link: string
          load_id: number
          loan_asset_number: string
          name: string | null
          ncf_recent: number | null
          ncf_securitization: number | null
          noi_ncf_code_recent: string | null
          noi_ncf_code_securitization: string | null
          noi_recent: number | null
          noi_securitization: number | null
          occupancy_recent: number | null
          occupancy_securitization: number | null
          opex_recent: number | null
          opex_securitization: number | null
          rec: number
          revenue_recent: number | null
          revenue_securitization: number | null
          seq: number
          sq_ft: number | null
          sq_ft_securitization: number | null
          state: string | null
          status_code: string | null
          tenant1: string | null
          tenant1_lease_end: string | null
          tenant1_sq_ft: number | null
          tenant2: string | null
          tenant2_lease_end: string | null
          tenant2_sq_ft: number | null
          tenant3: string | null
          tenant3_lease_end: string | null
          tenant3_sq_ft: number | null
          type_code: string | null
          units: number | null
          units_securitization: number | null
          unparsed: Json
          valuation_recent: number | null
          valuation_recent_date: string | null
          valuation_recent_source: string | null
          valuation_securitization: number | null
          valuation_securitization_date: string | null
          valuation_source_securitization: string | null
          year_built: number | null
          year_renovated: number | null
          zip: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "abs_cmbs_properties"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      abs_rows_metrics: {
        Args: { _accession: string; _load_id: number; _rows: Json }
        Returns: {
          accession: string
          bucket: string
          dim: string
          load_id: number
          metric: string
          n: number
          n_missing: number
          unit: string
          value: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "abs_pool_metrics"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      abs_store_filing: {
        Args: {
          _accession: string
          _bytes: number
          _documents: Json
          _expect: Json
          _filing: Json
          _parser: string
          _rows: Json
          _sha256: string
        }
        Returns: Json
      }
      abs_summary: { Args: never; Returns: Json }
      abs_verify_rows: {
        Args: { _accession: string; _kind: string; _rows: Json }
        Returns: number
      }
      accept_firm_invite: { Args: { _token: string }; Returns: string }
      accept_trial_terms: { Args: never; Returns: undefined }
      alt_event_buckets: {
        Args: never
        Returns: {
          bucket: number
          dataset: string
          last_date: string
          n: number
          ticker: string
        }[]
      }
      alt_series_leaders: {
        Args: { _dataset: string; _title: string }
        Returns: {
          base_median: number
          base_n: number
          date: string
          meta: Json
          prior_date: string
          prior_value: number
          source_url: string
          ticker: string
          unit: string
          value: number
        }[]
      }
      alt_source_stats: {
        Args: never
        Returns: {
          dataset: string
          latest: string
          refreshed: string
          rows: number
          tickers: number
        }[]
      }
      consume_usage: { Args: { _kind: string }; Returns: Json }
      create_firm: { Args: { _name: string }; Returns: string }
      data_coverage: {
        Args: never
        Returns: {
          dataset: string
          median_age_hours: number
          p90_age_hours: number
          top100: number
          top1000: number
          top500: number
        }[]
      }
      data_freshness: {
        Args: never
        Returns: {
          key: string
          newest: string
        }[]
      }
      decide_waitlist: {
        Args: { _status: string; _user: string }
        Returns: undefined
      }
      effective_tier: { Args: { _user: string }; Returns: string }
      firm_role_rank: {
        Args: { _role: Database["public"]["Enums"]["firm_role"] }
        Returns: number
      }
      free_model_note: {
        Args: { _confirms: number; _day: string; _ok: boolean }
        Returns: undefined
      }
      free_model_take: {
        Args: { _cap: number; _day: string }
        Returns: boolean
      }
      free_model_today: {
        Args: never
        Returns: {
          confirms: number
          failures: number
          requests: number
        }[]
      }
      get_firm_invite: {
        Args: { _token: string }
        Returns: {
          accepted: boolean
          email: string
          expired: boolean
          firm_name: string
          role: Database["public"]["Enums"]["firm_role"]
        }[]
      }
      has_app_access: { Args: { _user: string }; Returns: boolean }
      has_firm_role: {
        Args: {
          _firm: string
          _min: Database["public"]["Enums"]["firm_role"]
          _user: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ir_coverage: {
        Args: never
        Returns: {
          bytes: number
          docs: number
          first_filed: string
          last_filed: string
          read: number
          readable: number
          ticker: string
          vision_read: number
          waiting: number
        }[]
      }
      ir_live_progress: { Args: never; Returns: Json }
      is_firm_member: {
        Args: { _firm: string; _user: string }
        Returns: boolean
      }
      job_health: {
        Args: { _hours?: number }
        Returns: {
          fail_streak: number
          failed: number
          job: string
          last_ok: string
          last_run: string
          runs: number
          unfinished: number
        }[]
      }
      my_firm_invites: {
        Args: never
        Returns: {
          expires_at: string
          firm_name: string
          role: Database["public"]["Enums"]["firm_role"]
          token: string
        }[]
      }
      needs_trial_terms: { Args: { _user: string }; Returns: boolean }
      openai_allowance_settle: {
        Args: { _day: string; _delta: number; _tier: string }
        Returns: undefined
      }
      openai_allowance_take: {
        Args: { _cap: number; _day: string; _tier: string; _tokens: number }
        Returns: boolean
      }
      options_board: {
        Args: never
        Returns: {
          atm_iv: number
          call_oi: number
          call_vol: number
          date: string
          iv_below: number
          iv_max: number
          iv_min: number
          iv_n: number
          iv_prev: number
          iv30: number
          pc_oi: number
          pc_vol: number
          price: number
          put_oi: number
          put_vol: number
          skew25: number
          term: Json
          ticker: string
          vol_avg20: number
        }[]
      }
      paper_bot_limit: { Args: { _user: string }; Returns: number }
      plan_limit: { Args: { _kind: string; _tier: string }; Returns: number }
      remove_firm_member: {
        Args: { _firm: string; _user: string }
        Returns: undefined
      }
      replace_supply_signals: {
        Args: { _rows: Json; _source_kind: string; _ticker: string }
        Returns: number
      }
      request_bot_close: { Args: { _position: string }; Returns: undefined }
      require_feature: { Args: { _feature: string }; Returns: boolean }
      reset_paper_bot: { Args: { _bot: string }; Returns: undefined }
      set_firm_member_role: {
        Args: {
          _firm: string
          _role: Database["public"]["Enums"]["firm_role"]
          _user: string
        }
        Returns: undefined
      }
      setup_advance: {
        Args: { _as_of: string; _from: string; _to: string }
        Returns: boolean
      }
      setup_claim_tickers: {
        Args: { _as_of: string; _n: number }
        Returns: {
          sector: string
          ticker: string
        }[]
      }
      setup_forward_stats: {
        Args: never
        Returns: {
          avg_ex: number
          avg_net: number
          first_seen: string
          hits: number
          n: number
          variant: string
        }[]
      }
      setup_lease: {
        Args: { _as_of: string; _phase: string; _secs: number }
        Returns: boolean
      }
      setup_take: {
        Args: { _as_of: string; _n: number; _phase: string }
        Returns: number
      }
      setup_variant_daily: { Args: { _variant: string }; Returns: Json }
      setup_variant_list: {
        Args: never
        Returns: {
          n: number
          variant: string
        }[]
      }
      source_chunks_valid: {
        Args: { _bytes: number; _chunks: Json }
        Returns: boolean
      }
      source_claim_snapshot: {
        Args: {
          _owner: string
          _retry_failed?: boolean
          _snapshot_id?: string
          _ttl_seconds?: number
        }
        Returns: Json
      }
      source_columns_valid: { Args: { _columns: Json }; Returns: boolean }
      source_compute_missing_stats: {
        Args: { _max_snapshots?: number; _max_values?: number }
        Returns: number
      }
      source_compute_snapshot_stats: {
        Args: { _max_values?: number; _snapshot_id: string }
        Returns: Json
      }
      source_count_distinct: {
        Args: { _dimension: string; _max_values: number; _snapshot_id: string }
        Returns: number
      }
      source_facets: {
        Args: {
          _after?: string
          _contains?: string
          _dataset_id: string
          _dimension?: string
          _limit?: number
          _scan_limit?: number
          _snapshot_id?: string
        }
        Returns: Json
      }
      source_field_top_valid: {
        Args: {
          _distinct: number
          _filled: number
          _other_rows: number
          _other_values: number
          _top: Json
        }
        Returns: boolean
      }
      source_find: { Args: { _limit?: number; _q: string }; Returns: Json }
      source_get_dataset: {
        Args: { _id: string; _snapshot_id?: string }
        Returns: Json
      }
      source_get_snapshot_stats: {
        Args: { _dataset_id: string; _snapshot_id?: string }
        Returns: Json
      }
      source_library: { Args: never; Returns: Json }
      source_list_datasets: {
        Args: {
          _after?: string
          _agency?: string
          _limit?: number
          _q?: string
          _sector?: string
        }
        Returns: Json
      }
      source_publish_snapshot: {
        Args: { _owner: string; _snapshot_id: string }
        Returns: Json
      }
      source_put_records: {
        Args: { _owner: string; _rows: Json; _snapshot_id: string }
        Returns: Json
      }
      source_query_records: {
        Args: {
          _after?: number
          _columns?: number[]
          _dataset_id: string
          _entity?: string
          _geography?: string
          _limit?: number
          _period?: string
          _q?: string
          _snapshot_id?: string
        }
        Returns: Json
      }
      source_release_snapshot: {
        Args: {
          _error?: string
          _failed?: boolean
          _owner: string
          _snapshot_id: string
        }
        Returns: boolean
      }
      source_renew_lease: {
        Args: { _owner: string; _snapshot_id: string; _ttl_seconds?: number }
        Returns: boolean
      }
      source_snapshot_ref: {
        Args: { s: Database["public"]["Tables"]["source_snapshots"]["Row"] }
        Returns: Json
      }
      source_values_valid: { Args: { _values: Json }; Returns: boolean }
      tier_has_feature: {
        Args: { _feature: string; _tier: string }
        Returns: boolean
      }
      waitlist_reminder_candidates: {
        Args: never
        Returns: {
          decided_at: string
          display_name: string
          email: string
          user_id: string
        }[]
      }
    }
    Enums: {
      app_role: "admin"
      firm_role: "owner" | "admin" | "analyst" | "viewer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin"],
      firm_role: ["owner", "admin", "analyst", "viewer"],
    },
  },
} as const
