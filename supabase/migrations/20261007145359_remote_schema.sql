SET local check_function_bodies = off;

CREATE EXTENSION IF NOT EXISTS "btree_gist" SCHEMA "public";

CREATE EXTENSION IF NOT EXISTS "pg_cron";

CREATE EXTENSION IF NOT EXISTS "pg_net" SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "unaccent" SCHEMA "public";

CREATE TABLE "public"."app_settings" (
  "id"                                   smallint                 NOT NULL DEFAULT 1,
  "organizer_contact_mode"               text                     NOT NULL DEFAULT 'host'::text,
  "algrass_operational_phone"            text,
  "updated_at"                           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by"                           uuid,
  "free_invites_lead_min"                integer                  NOT NULL DEFAULT 60,
  "attendance_lead_min"                  integer                  NOT NULL DEFAULT 15,
  "match_refund_cutoff_hours"            integer                  NOT NULL DEFAULT 24,
  "rental_full_refund_cutoff_hours"      integer                  NOT NULL DEFAULT 72,
  "rental_partial_refund_cutoff_hours"   integer                  NOT NULL DEFAULT 24,
  "rental_partial_refund_percent"        integer                  NOT NULL DEFAULT 50,
  "captain_release_hours"                integer                  NOT NULL DEFAULT 48,
  "captain_gold_release_hours"           integer                  NOT NULL DEFAULT 24,
  "maintenance_mode"                     boolean                  NOT NULL DEFAULT false,
  "maintenance_message"                  text                     NOT NULL DEFAULT 'Estamos realizando tareas de mantenimiento.'::text,
  "reward_referral_player_enabled"       boolean                  NOT NULL DEFAULT false,
  "reward_referral_player_amount"        numeric                  NOT NULL DEFAULT 0,
  "reward_referral_captain_enabled"      boolean                  NOT NULL DEFAULT false,
  "reward_referral_captain_amount"       numeric                  NOT NULL DEFAULT 0,
  "reward_referral_captain_gold_enabled" boolean                  NOT NULL DEFAULT false,
  "reward_referral_captain_gold_amount"  numeric                  NOT NULL DEFAULT 0,
  "support_whatsapp"                     text,
  "support_email"                        text,
  CONSTRAINT "app_settings_algrass_needs_phone" CHECK (((organizer_contact_mode <> 'algrass'::text) OR (algrass_operational_phone IS NOT NULL))),
  CONSTRAINT "app_settings_algrass_operational_phone_check" CHECK (((algrass_operational_phone IS NULL) OR (algrass_operational_phone ~ '^[1-9][0-9]{7,14}$'::text))),
  CONSTRAINT "app_settings_attendance_lead_min_check" CHECK (((attendance_lead_min >= 0) AND (attendance_lead_min <= 1440))),
  CONSTRAINT "app_settings_captain_gold_release_hours_check" CHECK (((captain_gold_release_hours >= 0) AND (captain_gold_release_hours <= 720))),
  CONSTRAINT "app_settings_captain_release_hours_check" CHECK (((captain_release_hours >= 0) AND (captain_release_hours <= 720))),
  CONSTRAINT "app_settings_free_invites_lead_min_check" CHECK (((free_invites_lead_min >= 0) AND (free_invites_lead_min <= 1440))),
  CONSTRAINT "app_settings_id_check" CHECK ((id = 1)),
  CONSTRAINT "app_settings_maintenance_message_check" CHECK ((length(maintenance_message) <= 500)),
  CONSTRAINT "app_settings_maintenance_message_required" CHECK (((NOT maintenance_mode) OR (btrim(maintenance_message) <> ''::text))),
  CONSTRAINT "app_settings_match_refund_cutoff_hours_check" CHECK (((match_refund_cutoff_hours >= 0) AND (match_refund_cutoff_hours <= 720))),
  CONSTRAINT "app_settings_organizer_contact_mode_check" CHECK ((organizer_contact_mode = ANY (ARRAY['host'::text, 'algrass'::text]))),
  CONSTRAINT "app_settings_pkey" PRIMARY KEY (id),
  CONSTRAINT "app_settings_rental_cutoffs_ordered" CHECK ((rental_full_refund_cutoff_hours > rental_partial_refund_cutoff_hours)),
  CONSTRAINT "app_settings_rental_full_refund_cutoff_hours_check" CHECK (((rental_full_refund_cutoff_hours >= 0) AND (rental_full_refund_cutoff_hours <= 720))),
  CONSTRAINT "app_settings_rental_partial_refund_cutoff_hours_check" CHECK (((rental_partial_refund_cutoff_hours >= 0) AND (rental_partial_refund_cutoff_hours <= 720))),
  CONSTRAINT "app_settings_rental_partial_refund_percent_check" CHECK (((rental_partial_refund_percent >= 0) AND (rental_partial_refund_percent <= 100))),
  CONSTRAINT "app_settings_reward_referral_amounts_nonneg"
    CHECK (((reward_referral_player_amount >= (0)::numeric) AND (reward_referral_captain_amount >= (0)::numeric) AND (reward_referral_captain_gold_amount >= (0)::numeric)))
);

ALTER TABLE "public"."app_settings"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."app_settings" FROM "anon";

CREATE TABLE "public"."broadcasts" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "title"      text                     NOT NULL,
  "body"       text                     NOT NULL,
  "image_url"  text,
  "starts_at"  timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "broadcasts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."broadcasts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."captain_requests" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"             uuid                     NOT NULL,
  "group_size"          text                     NOT NULL,
  "status"              text                     NOT NULL DEFAULT 'pending_review'::text,
  "review_note"         text,
  "requested_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "reviewed_at"         timestamp with time zone,
  "reviewed_by_user_id" uuid,
  "assigned_role"       text,
  "management_notes"    text,
  CONSTRAINT "captain_requests_approved_has_role" CHECK (((status <> 'approved'::text) OR (assigned_role IS NOT NULL))),
  CONSTRAINT "captain_requests_assigned_role_check" CHECK (((assigned_role IS NULL) OR (assigned_role = ANY (ARRAY['captain'::text, 'captain_gold'::text])))),
  CONSTRAINT "captain_requests_group_size_check" CHECK ((group_size = ANY (ARRAY['6_plus'::text, '12_plus'::text, '16_plus'::text]))),
  CONSTRAINT "captain_requests_management_notes_len" CHECK (((management_notes IS NULL) OR (length(management_notes) <= 2000))),
  CONSTRAINT "captain_requests_open_clean"
    CHECK
    (((status <> ALL (ARRAY['pending_email_confirmation'::text, 'pending_review'::text])) OR ((reviewed_at IS NULL) AND (reviewed_by_user_id IS NULL) AND (assigned_role IS
    NULL)))),
  CONSTRAINT "captain_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "captain_requests_role_only_approved" CHECK (((assigned_role IS NULL) OR (status = 'approved'::text))),
  CONSTRAINT "captain_requests_status_check" CHECK ((status = ANY (ARRAY['pending_email_confirmation'::text, 'pending_review'::text, 'approved'::text, 'rejected'::text])))
);

ALTER TABLE "public"."captain_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."captain_welcome_emails" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid                     NOT NULL,
  "status"     text                     NOT NULL DEFAULT 'pending'::text,
  "attempts"   integer                  NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at"    timestamp with time zone,
  "claimed_at" timestamp with time zone,
  CONSTRAINT "captain_welcome_emails_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "captain_welcome_emails_pkey" PRIMARY KEY (id),
  CONSTRAINT "captain_welcome_emails_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))),
  CONSTRAINT "captain_welcome_emails_user_id_key" UNIQUE (user_id)
);

ALTER TABLE "public"."captain_welcome_emails"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."captain_welcome_emails" FROM "anon", "authenticated";

CREATE TABLE "public"."championship_goals" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "match_id"       uuid                     NOT NULL,
  "player_user_id" uuid                     NOT NULL,
  "team_id"        uuid                     NOT NULL,
  "goals"          integer                  NOT NULL DEFAULT 1,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "championship_goals_goals_check" CHECK ((goals > 0)),
  CONSTRAINT "championship_goals_match_id_player_user_id_key" UNIQUE (match_id, player_user_id),
  CONSTRAINT "championship_goals_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."championship_goals"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."championship_goals" FROM "anon", "authenticated";

CREATE TABLE "public"."championship_matches" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "championship_id"   uuid                     NOT NULL,
  "stage"             text                     NOT NULL,
  "group_code"        text,
  "home_team_id"      uuid,
  "away_team_id"      uuid,
  "home_score"        integer,
  "away_score"        integer,
  "qualified_team_id" uuid,
  "game_id"           uuid,
  "start_time"        time without time zone,
  "duration_min"      integer,
  "match_order"       integer,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "championship_matches_away_score_check" CHECK ((away_score >= 0)),
  CONSTRAINT "championship_matches_distinct_teams" CHECK (((home_team_id IS NULL) OR (away_team_id IS NULL) OR (home_team_id <> away_team_id))),
  CONSTRAINT "championship_matches_duration_min_check" CHECK (((duration_min IS NULL) OR (duration_min > 0))),
  CONSTRAINT "championship_matches_home_score_check" CHECK ((home_score >= 0)),
  CONSTRAINT "championship_matches_pkey" PRIMARY KEY (id),
  CONSTRAINT "championship_matches_qualified_in_pair" CHECK (((qualified_team_id IS NULL) OR (qualified_team_id = home_team_id) OR (qualified_team_id = away_team_id))),
  CONSTRAINT "championship_matches_score_pair" CHECK (((home_score IS NULL) = (away_score IS NULL))),
  CONSTRAINT "championship_matches_stage_check" CHECK ((stage = ANY (ARRAY['group'::text, 'semifinal'::text, 'final'::text, 'third_place'::text])))
);

ALTER TABLE "public"."championship_matches"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."championship_matches" FROM "anon", "authenticated";

CREATE TABLE "public"."championship_players" (
  "id"                    uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "championship_id"       uuid                     NOT NULL,
  "user_id"               uuid                     NOT NULL,
  "team_id"               uuid,
  "joined_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "registration_order_id" uuid,
  CONSTRAINT "championship_players_championship_id_user_id_key" UNIQUE (championship_id, user_id),
  CONSTRAINT "championship_players_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."championship_players"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."championship_players" FROM "anon", "authenticated";

CREATE TABLE "public"."championship_requests" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"              uuid                     NOT NULL,
  "contact_name"         text                     NOT NULL,
  "email"                text                     NOT NULL,
  "phone_country_code"   text,
  "contact_phone"        text,
  "company"              text,
  "job_title"            text,
  "message"              text,
  "championship_name"    text,
  "city"                 text,
  "districts"            text[],
  "format"               text,
  "participant_type"     text,
  "participant_quantity" integer,
  "tentative_date"       date,
  "tentative_start_date" date,
  "tentative_end_date"   date,
  "match_duration_min"   integer,
  "status"               text                     NOT NULL DEFAULT 'pending'::text,
  "internal_notes"       text,
  "contacted_at"         timestamp with time zone,
  "managed_by_user_id"   uuid,
  "created_at"           timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "championship_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "championship_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'contacted'::text, 'closed'::text])))
);

ALTER TABLE "public"."championship_requests"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."championship_requests" FROM "anon";

CREATE TABLE "public"."championship_reservation_games" (
  "championship_id" uuid                     NOT NULL,
  "game_id"         uuid                     NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "championship_reservation_games_pkey" PRIMARY KEY (championship_id, game_id)
);

ALTER TABLE "public"."championship_reservation_games"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."championship_settings" (
  "city"                    text                     NOT NULL,
  "currency"                text                     NOT NULL DEFAULT 'PEN'::text,
  "referee_hourly_rate"     numeric(12,2)            NOT NULL,
  "algrass_fee_hourly_rate" numeric(12,2)            NOT NULL,
  "booking_lead_rules"      jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "registration_close_days" integer                  NOT NULL,
  "extras"                  jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "availability_formats"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "active"                  boolean                  NOT NULL DEFAULT true,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "availability_blocks"     jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "championship_settings_algrass_fee_hourly_rate_check" CHECK ((algrass_fee_hourly_rate >= (0)::numeric)),
  CONSTRAINT "championship_settings_pkey" PRIMARY KEY (city),
  CONSTRAINT "championship_settings_referee_hourly_rate_check" CHECK ((referee_hourly_rate >= (0)::numeric)),
  CONSTRAINT "championship_settings_registration_close_days_check" CHECK ((registration_close_days >= 0))
);

ALTER TABLE "public"."championship_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."championship_teams" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "championship_id"    uuid                     NOT NULL,
  "name"               text                     NOT NULL,
  "color"              text,
  "design"             text,
  "created_by_user_id" uuid                     NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "join_secret_hash"   text,
  "join_token"         text,
  "order_id"           uuid,
  "join_secret"        text,
  CONSTRAINT "championship_teams_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."championship_teams"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."championship_teams" FROM "anon", "authenticated";

CREATE TABLE "public"."championships" (
  "id"                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id"           uuid                     NOT NULL,
  "status"                  text                     NOT NULL DEFAULT 'payment_validation'::text,
  "payment_method"          text,
  "name"                    text,
  "cover_theme"             text,
  "privacy"                 text                     NOT NULL DEFAULT 'private'::text,
  "registration_key"        text,
  "results_public"          boolean                  NOT NULL DEFAULT true,
  "event_date"              date,
  "start_time"              time without time zone,
  "end_time"                time without time zone,
  "venue_id"                uuid,
  "format_config"           jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "registration_closes_at"  timestamp with time zone,
  "published_at"            timestamp with time zone,
  "hold_expires_at"         timestamp with time zone,
  "order_id"                uuid,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "payment_voucher_ref"     text,
  "city"                    text,
  "cover_image_path"        text,
  "host_user_id"            uuid,
  "fixture_published_at"    timestamp with time zone,
  "live_started_at"         timestamp with time zone,
  "champion_team_id"        uuid,
  "public_individual_price" numeric(10,2),
  "public_team_price"       numeric(10,2),
  CONSTRAINT "championships_pkey" PRIMARY KEY (id),
  CONSTRAINT "championships_privacy_check" CHECK ((privacy = ANY (ARRAY['private'::text, 'public'::text]))),
  CONSTRAINT "championships_public_individual_price_check" CHECK (((public_individual_price IS NULL) OR (public_individual_price >= (0)::numeric))),
  CONSTRAINT "championships_public_team_price_check" CHECK (((public_team_price IS NULL) OR (public_team_price >= (0)::numeric))),
  CONSTRAINT "championships_status_check"
    CHECK
    ((status = ANY (ARRAY['transfer_hold'::text, 'gateway_hold'::text, 'payment_validation'::text, 'pending_publish'::text, 'registration_open'::text, 'registration_closed'::text,
    'in_progress'::text, 'completed'::text, 'canceled'::text])))
);

ALTER TABLE "public"."championships"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."fields" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"                 text                     NOT NULL,
  "created_at"           timestamp with time zone DEFAULT now(),
  "venue_id"             uuid,
  "format"               text,
  "amenities"            jsonb                    DEFAULT '{}'::jsonb,
  "total_spots"          integer,
  "duration_min"         integer                  NOT NULL DEFAULT 60,
  "default_host_user_id" uuid,
  "cover_image_path"     text,
  "cover_updated_at"     timestamp with time zone,
  CONSTRAINT "fields_duration_min_check" CHECK ((duration_min > 0)),
  CONSTRAINT "fields_format_check" CHECK (((format ~ '^(1[0-1]|[1-9])v(1[0-1]|[1-9])$'::text) AND (split_part(format, 'v'::text, 1) = split_part(format, 'v'::text, 2)))),
  CONSTRAINT "fields_pkey" PRIMARY KEY (id),
  CONSTRAINT "fields_total_spots_check" CHECK ((total_spots > 0))
);

ALTER TABLE "public"."fields"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."game_players" (
  "id"                           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "game_id"                      uuid                     NOT NULL,
  "user_id"                      uuid                     NOT NULL,
  "reservation_id"               uuid                     NOT NULL,
  "payer_id"                     uuid,
  "status"                       text                     NOT NULL DEFAULT 'confirmed'::text,
  "joined_at"                    timestamp with time zone NOT NULL DEFAULT now(),
  "canceled_at"                  timestamp with time zone,
  "amount"                       numeric(10,2)            NOT NULL,
  "created_at"                   timestamp with time zone DEFAULT now(),
  "updated_at"                   timestamp with time zone DEFAULT now(),
  "checked_in_at"                timestamp with time zone,
  "reservation_type"             text                     DEFAULT 'normal'::text,
  "invited_by_user_id"           uuid,
  "game_slot_reservation_id"     uuid,
  "counts_reserved_slot"         boolean                  DEFAULT false,
  "referred_by_user_id"          uuid,
  "referral_reward_evaluated_at" timestamp with time zone,
  CONSTRAINT "game_players_pkey" PRIMARY KEY (id),
  CONSTRAINT "game_players_status_check" CHECK ((status = ANY (ARRAY['confirmed'::text, 'canceled'::text]))),
  CONSTRAINT "game_players_unique_triplet" UNIQUE (game_id, user_id, payer_id)
);

ALTER TABLE "public"."game_players"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."game_slot_reservations" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "game_id"                uuid                     NOT NULL,
  "reserved_by_user_id"    uuid                     NOT NULL,
  "reserved_by_role"       text                     NOT NULL,
  "status"                 text                     NOT NULL DEFAULT 'inactive'::text,
  "reserved_slots_total"   integer                  NOT NULL,
  "reserved_slots_used"    integer                  NOT NULL DEFAULT 0,
  "expires_at"             timestamp with time zone,
  "released_at"            timestamp with time zone,
  "released_by_user_id"    uuid,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "released_reason"        text,
  "initial_reserved_slots" integer,
  "peak_reserved_slots"    integer,
  "last_released_slots"    integer,
  "expiry_notified_at"     timestamp with time zone,
  CONSTRAINT "game_slot_reservations_pkey" PRIMARY KEY (id),
  CONSTRAINT "game_slot_reservations_released_reason_check"
    CHECK (((released_reason IS NULL) OR (released_reason = ANY (ARRAY['automatic'::text, 'manual_cancel_slots'::text, 'manual_cancel_participation'::text, 'admin'::text])))),
  CONSTRAINT "game_slot_reservations_role_check"
    CHECK ((reserved_by_role = ANY (ARRAY['captain'::text, 'captain_gold'::text, 'algrass_staff'::text, 'algrass_admin'::text, 'venue_owner'::text]))),
  CONSTRAINT "game_slot_reservations_status_check" CHECK ((status = ANY (ARRAY['inactive'::text, 'active'::text, 'canceled'::text]))),
  CONSTRAINT "game_slot_reservations_total_positive" CHECK ((reserved_slots_total >= 0)),
  CONSTRAINT "game_slot_reservations_used_nonneg" CHECK ((reserved_slots_used >= 0))
);

ALTER TABLE "public"."game_slot_reservations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."game_slot_reservations" FROM "anon";

CREATE TABLE "public"."game_waitlist" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "game_id"    uuid                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "status"     text                     NOT NULL DEFAULT 'waiting'::text,
  "joined_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "left_at"    timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "game_waitlist_pkey" PRIMARY KEY (id),
  CONSTRAINT "game_waitlist_status_check" CHECK ((status = ANY (ARRAY['waiting'::text, 'reserved'::text, 'canceled'::text, 'expired'::text])))
);

ALTER TABLE "public"."game_waitlist"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."games" (
  "id"                   uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "field_id"             uuid                     NOT NULL,
  "date_key"             date,
  "time"                 time without time zone,
  "price_per_person"     numeric,
  "status"               text                     NOT NULL DEFAULT 'draft'::text,
  "created_at"           timestamp with time zone DEFAULT now(),
  "type"                 text,
  "price_total"          numeric,
  "current_players"      integer,
  "amenities"            jsonb                    DEFAULT '{}'::jsonb,
  "total_spots"          integer,
  "format"               text,
  "host_user_id"         uuid,
  "duration_min"         integer,
  "host_checked_in_at"   timestamp with time zone,
  "booked_by_user_id"    uuid,
  "cancel_reason"        text,
  "cancel_reason_detail" text,
  "cancelled_by_user_id" uuid,
  "cancelled_at"         timestamp with time zone,
  "alternative_game_id"  uuid,
  "overlap_group"        uuid,
  "blocked_from_status"  text,
  "booker_checked_in_at" timestamp with time zone,
  "championship_id"      uuid,
  "published_audience"   text                     NOT NULL DEFAULT 'public'::text,
  CONSTRAINT "duration_required_when_blocking" CHECK (((status <> ALL (ARRAY['draft'::text, 'published'::text, 'active'::text])) OR (duration_min IS NOT NULL))),
  CONSTRAINT "games_duration_min_check" CHECK ((duration_min > 0)),
  CONSTRAINT "games_format_check" CHECK (((format ~ '^(1[0-1]|[1-9])v(1[0-1]|[1-9])$'::text) AND (split_part(format, 'v'::text, 1) = split_part(format, 'v'::text, 2)))),
  CONSTRAINT "games_pkey" PRIMARY KEY (id),
  CONSTRAINT "games_published_audience_check" CHECK ((published_audience = ANY (ARRAY['public'::text, 'captain'::text]))),
  CONSTRAINT "games_status_check"
    CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'reserved'::text, 'completed'::text, 'expired'::text, 'canceled'::text, 'paused'::text, 'blocked'::text]))),
  CONSTRAINT "games_total_spots_check" CHECK ((total_spots > 0))
);

CREATE TABLE "public"."notifications" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "recipient_user_id" uuid                     NOT NULL,
  "template_key"      text                     NOT NULL,
  "custom_text"       text,
  "game_id"           uuid,
  "venue_id"          uuid,
  "created_by"        uuid,
  "scheduled_for"     timestamp with time zone,
  "sent_at"           timestamp with time zone,
  "read_at"           timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "reservation_id"    uuid,
  CONSTRAINT "notifications_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."notifications"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."orders" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "idempotency_key"        text                     NOT NULL,
  "status"                 text                     NOT NULL DEFAULT 'pending'::text,
  "terminal_reason"        text,
  "payer_user_id"          uuid                     NOT NULL,
  "resource_type"          text                     NOT NULL,
  "resource_id"            uuid                     NOT NULL,
  "claim_composition"      jsonb                    NOT NULL,
  "claimed_units"          integer                  NOT NULL,
  "pending_expires_at"     timestamp with time zone,
  "amount_total"           numeric(12,2)            NOT NULL,
  "currency"               text                     NOT NULL DEFAULT 'PEN'::text,
  "financial_snapshot"     jsonb                    NOT NULL,
  "snapshot_version"       smallint                 NOT NULL DEFAULT 1,
  "payment_provider"       text,
  "payment_binding"        jsonb,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at"            timestamp with time zone,
  "terminal_reason_detail" text,
  CONSTRAINT "orders_amount_total_check" CHECK ((amount_total >= (0)::numeric)),
  CONSTRAINT "orders_claimed_units_check" CHECK ((claimed_units >= 1)),
  CONSTRAINT "orders_payer_idempotency_unique" UNIQUE (payer_user_id, idempotency_key),
  CONSTRAINT "orders_pending_ttl_present" CHECK (((status <> 'pending'::text) OR (pending_expires_at IS NOT NULL))),
  CONSTRAINT "orders_pkey" PRIMARY KEY (id),
  CONSTRAINT "orders_resolved_at_consistency" CHECK (((status = ANY (ARRAY['pending'::text, 'validation'::text])) = (resolved_at IS NULL))),
  CONSTRAINT "orders_resource_type_check" CHECK ((resource_type = ANY (ARRAY['match'::text, 'rental'::text, 'championship'::text]))),
  CONSTRAINT "orders_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'validation'::text, 'confirmed'::text, 'failed'::text, 'expired'::text]))),
  CONSTRAINT "orders_terminal_reason_scope" CHECK (((terminal_reason IS NULL) OR (status = ANY (ARRAY['failed'::text, 'expired'::text]))))
);

ALTER TABLE "public"."orders"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."promo_codes" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"              text                     NOT NULL,
  "discount_percent"  numeric(5,2),
  "active"            boolean                  DEFAULT true,
  "expires_at"        timestamp with time zone,
  "created_at"        timestamp with time zone DEFAULT now(),
  "promo_games_type"  text                     NOT NULL DEFAULT 'all'::text,
  "discount_type"     text                     NOT NULL DEFAULT 'percent'::text,
  "discount_amount"   numeric(10,2),
  "starts_at"         timestamp with time zone,
  "max_uses_total"    integer,
  "max_uses_per_user" integer,
  "city"              text,
  CONSTRAINT "promo_codes_code_key" UNIQUE (code),
  CONSTRAINT "promo_codes_discount_coherence_check" CHECK ((((discount_type = 'percent'::text) AND (discount_percent IS
    NOT NULL) AND (discount_percent > (0)::numeric) AND (discount_percent <= (100)::numeric) AND (discount_amount IS NULL)) OR
    ((discount_type = 'fixed'::text) AND (discount_amount IS NOT NULL) AND (discount_amount > (0)::numeric) AND (discount_percent IS NULL)))),
  CONSTRAINT "promo_codes_discount_type_check" CHECK ((discount_type = ANY (ARRAY['percent'::text, 'fixed'::text]))),
  CONSTRAINT "promo_codes_games_type_check" CHECK ((promo_games_type = ANY (ARRAY['match'::text, 'rental'::text, 'all'::text]))),
  CONSTRAINT "promo_codes_max_uses_per_user_check" CHECK (((max_uses_per_user IS NULL) OR (max_uses_per_user > 0))),
  CONSTRAINT "promo_codes_max_uses_total_check" CHECK (((max_uses_total IS NULL) OR (max_uses_total > 0))),
  CONSTRAINT "promo_codes_pkey" PRIMARY KEY (id),
  CONSTRAINT "promo_codes_validity_window_check" CHECK (((starts_at IS NULL) OR (expires_at IS NULL) OR (starts_at < expires_at)))
);

ALTER TABLE "public"."promo_codes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."rating" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "game_id"        uuid                     NOT NULL,
  "user_id"        uuid,
  "stars"          smallint,
  "comment"        text,
  "created_at"     timestamp with time zone DEFAULT now(),
  "game_type"      text,
  "venue_id"       uuid,
  "field_id"       uuid,
  "host_user_id"   uuid,
  "popup_shown_at" timestamp with time zone,
  "rated_at"       timestamp with time zone,
  "event_ended_at" timestamp with time zone,
  CONSTRAINT "rating_game_type_check" CHECK ((game_type = ANY (ARRAY['match'::text, 'rental'::text]))),
  CONSTRAINT "rating_pkey" PRIMARY KEY (id),
  CONSTRAINT "rating_stars_check" CHECK (((stars >= 1) AND (stars <= 5)))
);

ALTER TABLE "public"."rating"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."rating" FROM "anon";

CREATE TABLE "public"."reservations" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "game_id"                  uuid,
  "user_id"                  uuid,
  "status"                   text,
  "unit_price"               numeric,
  "promo_code"               text,
  "promo_discount"           numeric,
  "credit_applied"           numeric,
  "total_amount"             numeric,
  "reserved_at"              timestamp with time zone DEFAULT now(),
  "canceled_at"              timestamp with time zone,
  "payment_method"           text,
  "source"                   text,
  "players_count"            integer,
  "guests_total"             numeric,
  "subtotal_amount"          numeric(10,2),
  "guest_total"              integer                  NOT NULL DEFAULT 0,
  "canceled_by"              uuid,
  "reservation_type"         text                     DEFAULT 'normal'::text,
  "invited_by_user_id"       uuid,
  "refund_of_reservation_id" uuid,
  "order_id"                 uuid,
  "promo_code_id"            uuid,
  "reward_applied"           numeric                  NOT NULL DEFAULT 0,
  "championship_id"          uuid,
  "refund_scope"             jsonb,
  CONSTRAINT "reservations_pkey" PRIMARY KEY (id),
  CONSTRAINT "reservations_reward_applied_nonneg" CHECK ((reward_applied >= (0)::numeric)),
  CONSTRAINT "reservations_status_check" CHECK ((status = ANY (ARRAY['spend'::text, 'refund'::text])))
);

ALTER TABLE "public"."reservations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reward_transactions" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"          uuid                     NOT NULL,
  "type"             text                     NOT NULL,
  "amount"           numeric                  NOT NULL,
  "reservation_id"   uuid,
  "granted_by"       uuid,
  "referred_user_id" uuid,
  "idempotency_key"  text,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "communicated_at"  timestamp with time zone,
  "reason"           text,
  CONSTRAINT "reward_transactions_amount_check" CHECK ((amount > (0)::numeric)),
  CONSTRAINT "reward_transactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "reward_transactions_reason_len" CHECK (((reason IS NULL) OR ((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 200)))),
  CONSTRAINT "reward_transactions_type_check" CHECK ((type = ANY (ARRAY['grant_manual'::text, 'grant_referral'::text, 'spend'::text]))),
  CONSTRAINT "reward_tx_provenance" CHECK ((((type = 'grant_manual'::text) AND (granted_by IS
    NOT NULL) AND (referred_user_id IS NULL) AND (reservation_id IS NULL)) OR ((type = 'grant_referral'::text) AND (referred_user_id IS
    NOT NULL) AND (granted_by IS NULL) AND (reservation_id IS NULL)) OR ((type = 'spend'::text) AND (reservation_id IS
    NOT NULL) AND (granted_by IS NULL) AND (referred_user_id IS NULL))))
);

ALTER TABLE "public"."reward_transactions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."reward_transactions" FROM "anon";

CREATE TABLE "public"."user_roles" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"            uuid                     NOT NULL,
  "role"               text                     NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_roles_pkey" PRIMARY KEY (id),
  CONSTRAINT "user_roles_role_check" CHECK ((role = ANY (ARRAY['captain'::text, 'captain_gold'::text, 'algrass_staff'::text, 'algrass_admin'::text]))),
  CONSTRAINT "user_roles_user_role_key" UNIQUE (user_id, ROLE),
  "granted_by_user_id" uuid                     DEFAULT auth.uid()
);

ALTER TABLE "public"."user_roles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."user_roles" FROM "anon";

CREATE TABLE "public"."users" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "full_name"          text                     NOT NULL,
  "email"              text,
  "role"               text                     DEFAULT ''::text,
  "organizer_status"   text                     DEFAULT ''::text,
  "credit_balance"     numeric                  DEFAULT '0'::numeric,
  "birth_date"         date,
  "sex"                text,
  "preferred_position" text[],
  "phone"              text,
  "nationality"        text,
  "occupation"         text,
  "user_code"          text,
  "avatar_hue"         smallint,
  "city"               text,
  "avatar_path"        text,
  "avatar_updated_at"  timestamp with time zone,
  "full_name_search"   text,
  "profile_private"    boolean                  DEFAULT false,
  "deleted_at"         timestamp with time zone,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "confirmed_email"    text,
  "address_city"       text,
  "address_line"       text,
  "district"           text,
  CONSTRAINT "users_avatar_hue_check" CHECK (((avatar_hue >= 0) AND (avatar_hue < 360))),
  CONSTRAINT "users_pkey" PRIMARY KEY (id),
  CONSTRAINT "users_user_code_key" UNIQUE (user_code)
);

ALTER TABLE "public"."users"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."venue_manager_requests" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"           uuid                     NOT NULL,
  "name"              text                     NOT NULL,
  "email"             text                     NOT NULL,
  "city"              text                     NOT NULL,
  "district"          text                     NOT NULL,
  "venue_name"        text                     NOT NULL,
  "website"           text,
  "status"            text                     NOT NULL DEFAULT 'pending'::text,
  "admin_notes"       text,
  "closed_comment"    text,
  "closed_by_user_id" uuid,
  "closed_at"         timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "venue_manager_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "venue_manager_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'contacted'::text, 'closed'::text]))),
  CONSTRAINT "vmr_closed_fields" CHECK ((((status = 'closed'::text) AND (closed_comment IS NOT NULL) AND (btrim(closed_comment) <> ''::text) AND (closed_at IS
    NOT NULL) AND (closed_by_user_id IS NOT NULL)) OR ((status <> 'closed'::text) AND (closed_comment IS NULL) AND (closed_at IS NULL) AND (closed_by_user_id IS NULL))))
);

ALTER TABLE "public"."venue_manager_requests"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."venue_manager_requests" FROM "anon";

CREATE TABLE "public"."venue_staff" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "venue_id"    uuid                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "status"      text                     NOT NULL DEFAULT 'pending'::text,
  "invited_by"  uuid,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "accepted_at" timestamp with time zone,
  CONSTRAINT "venue_hosts_pkey" PRIMARY KEY (id),
  CONSTRAINT "venue_hosts_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text, 'revoked'::text])))
);

ALTER TABLE "public"."venue_staff"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."venues" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"             text                     NOT NULL,
  "address"          text,
  "manager_user_id"  uuid,
  "created_at"       timestamp with time zone DEFAULT now(),
  "amenities"        jsonb                    DEFAULT '{}'::jsonb,
  "city"             text,
  "cover_image_path" text,
  "cover_updated_at" timestamp with time zone,
  "lat"              double precision,
  "lng"              double precision,
  "district"         text,
  CONSTRAINT "venues_name_city_unique" UNIQUE (name, city),
  CONSTRAINT "venues_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."venues"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."wallet_summary" (
  "user_id"          uuid                     NOT NULL,
  "total_amount"     numeric(10,2)            NOT NULL DEFAULT 0,
  "reserved_balance" numeric(10,2)            NOT NULL DEFAULT 0,
  "credit_balance"   numeric(10,2)            NOT NULL DEFAULT 0,
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "reward_balance"   numeric(10,2)            NOT NULL DEFAULT 0,
  CONSTRAINT "wallet_summary_pkey" PRIMARY KEY (user_id),
  CONSTRAINT "wallet_summary_reward_balance_nonneg" CHECK ((reward_balance >= (0)::numeric))
);

ALTER TABLE "public"."wallet_summary"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."welcome_emails" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"    uuid                     NOT NULL,
  "status"     text                     NOT NULL DEFAULT 'pending'::text,
  "attempts"   integer                  NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "claimed_at" timestamp with time zone,
  "sent_at"    timestamp with time zone,
  CONSTRAINT "welcome_emails_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "welcome_emails_pkey" PRIMARY KEY (id),
  CONSTRAINT "welcome_emails_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text]))),
  CONSTRAINT "welcome_emails_user_id_key" UNIQUE (user_id)
);

ALTER TABLE "public"."welcome_emails"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."welcome_emails" FROM "anon", "authenticated";

ALTER TABLE "public"."game_slot_reservations"
  ADD COLUMN "reserved_slots_remaining" integer GENERATED ALWAYS AS (GREATEST((reserved_slots_total - reserved_slots_used), 0)) STORED;

CREATE TYPE "public"."notification_category" AS ENUM (
  'reservation',
  'refund',
  'reminder',
  'invitation',
  'operational',
  'onboarding',
  'marketing'
);

ALTER TABLE "public"."notifications"
  ADD COLUMN "category" public.notification_category NOT NULL;

CREATE TYPE "public"."notification_delivery_type" AS ENUM (
  'automatic',
  'manual'
);

ALTER TABLE "public"."notifications"
  ADD COLUMN "delivery_type" public.notification_delivery_type NOT NULL;

CREATE TYPE "public"."notification_source_type" AS ENUM (
  'system',
  'venue',
  'algrass'
);

ALTER TABLE "public"."notifications"
  ADD COLUMN "source_type" public.notification_source_type NOT NULL;

CREATE OR REPLACE FUNCTION public._add_championship_courts_b2b (
  p_championship_id uuid,
  p_game_ids        uuid[],
  p_payment_method  text,
  p_credit_applied  numeric DEFAULT 0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_champ    public.championships%rowtype;
  v_ids      uuid[];   -- los elegidos, sin repetidos y ordenados
  v_id       uuid;
  v_game     public.games%rowtype;
  v_payer    uuid;
  v_order_id uuid;
  v_total    numeric := 0;
  v_items    jsonb   := '[]'::jsonb;
  -- El crédito del lote, lo que queda por repartir y lo que va a cada cancha.
  v_credito  numeric := round(coalesce(p_credit_applied, 0), 2);
  v_externo  numeric;
  v_resto    numeric;
  v_precio   numeric;
  v_c        numeric;
  v_e        numeric;
  v_metodo   text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Gente de AlGrass: admin o staff. Ni host, ni owner, ni jugador.
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;

  -- El medio, como en extras: sin crédito, la regla EXACTA de siempre; con
  -- crédito puede venir NULL porque quizá no quede nada por cobrar fuera, y eso
  -- se decide cuando se sabe el bruto.
  if v_credito = 0 then
    if p_payment_method is null or p_payment_method not in ('yape_direct', 'transfer') then
      raise exception 'INVALID_PAYMENT_METHOD';
    end if;
  elsif p_payment_method is not null
        and p_payment_method not in ('yape_direct', 'transfer') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  -- MISMA lock key que roster, resultados, transiciones y extras.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  if v_champ.status not in ('pending_publish','registration_open',
                            'registration_closed','in_progress') then
    raise exception 'CHAMPIONSHIP_NOT_ACCEPTING';
  end if;

  -- ── Las canchas, PRIMERO ──
  -- Antes de tocar el saldo: si una cancha ya no está, se aborta aquí y el
  -- crédito ni se ha mirado. Deduplicar, bloquear, revalidar y reclamar lo hace
  -- `_championship_claim_games`, el único sitio donde vive el sistema de reservas.
  v_ids := public._championship_claim_games(p_championship_id, p_game_ids);

  v_payer := public._championship_payer(p_championship_id);
  if v_payer is null then raise exception 'PAYER_UNKNOWN'; end if;

  -- ── El bruto, de los precios ya revalidados bajo el lock ──
  select coalesce(sum(round(g.price_total, 2)), 0) into v_total
    from public.games g where g.id = any(v_ids);

  if v_credito > v_total then
    raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total;
  end if;
  v_externo := round(v_total - v_credito, 2);
  if v_externo > 0
     and (p_payment_method is null or p_payment_method not in ('yape_direct', 'transfer')) then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  -- ── El crédito, gastado UNA vez por el lote ──
  -- Atómico y condicional; nunca a mano. Las claves de idempotencia de cada
  -- cancha se derivan del game, y un reintento ya muere en el reclamo —la cancha
  -- es del campeonato—, así que no hay segundo descuento posible.
  if v_credito > 0 then
    perform public.spend_wallet_credit(v_payer, v_credito);
  end if;

  -- ── Un order y un asiento por cancha, con su parte del crédito ──
  v_resto := v_credito;
  foreach v_id in array v_ids loop
    select * into v_game from public.games where id = v_id;

    v_precio := round(v_game.price_total, 2);
    v_c      := least(v_resto, v_precio);
    v_resto  := round(v_resto - v_c, 2);
    v_e      := round(v_precio - v_c, 2);
    -- Lo que esta cancha no cobró fuera, se apunta como `credit`; si hubo
    -- depósito, el medio manual que se certifica.
    v_metodo := case when v_e = 0 and (v_c > 0 or p_payment_method is null)
                     then 'credit' else p_payment_method end;

    -- Nace confirmado: se certifica un depósito que ya llegó, o no hubo depósito.
    insert into public.orders (
      idempotency_key, payer_user_id, resource_type, resource_id,
      claim_composition, claimed_units, pending_expires_at,
      amount_total, currency, financial_snapshot,
      payment_provider, status, resolved_at
    ) values (
      'champ_court:' || p_championship_id::text || ':' || v_id::text,
      v_payer, 'championship', p_championship_id,
      jsonb_build_object('kind', 'championship_extra_court',
                         'game_ids', jsonb_build_array(v_id)),
      1, now(),
      v_game.price_total, 'PEN',
      -- El snapshot de siempre, MÁS la memoria del pago de esta cancha: de
      -- `credit_applied` lee el trigger lo que NO entró de fuera.
      jsonb_build_object('source', 'championship_extra_court',
                         'game_id', v_id,
                         'price_total', v_game.price_total,
                         'confirmed_by', v_actor,
                         'payment_method', v_metodo,
                         'batch_size', array_length(v_ids, 1),
                         'credit_applied', v_c,
                         'external_amount', v_e),
      v_metodo, 'confirmed', now()
    ) returning id into v_order_id;

    -- `game_id` NULL a propósito (ver `cancel_rental`). total/subtotal = BRUTO:
    -- es el techo del reembolso. `reward_applied` 0: campeonatos no usan
    -- recompensas. El trigger contabiliza solo `v_e`.
    insert into public.reservations (
      game_id, championship_id, user_id, order_id,
      status, reservation_type, source, payment_method,
      total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
      reserved_at
    ) values (
      null, p_championship_id, v_payer, v_order_id,
      'spend', 'championship', 'championship', v_metodo,
      v_game.price_total, v_game.price_total, v_c, 0, 0, null,
      now()
    );

    v_items := v_items || jsonb_build_object(
      'game_id',         v_id,
      'order_id',        v_order_id,
      'amount',          v_game.price_total,
      'payer_user_id',   v_payer,
      'twin_game_id',    v_game.alternative_game_id,
      'payment_method',  v_metodo,
      'credit_applied',  v_c,
      'external_amount', v_e
    );
  end loop;

  -- Todo el crédito pedido quedó repartido. Si no, algo no cuadra: mejor romper.
  if v_resto <> 0 then
    raise exception 'CREDIT_SPLIT_MISMATCH: quedan % sin repartir', v_resto;
  end if;

  return jsonb_build_object(
    'championship_id', p_championship_id,
    'payer_user_id',   v_payer,
    'payment_method',  case when v_externo = 0 and v_credito > 0
                            then 'credit' else p_payment_method end,
    'total_amount',    v_total,
    'credit_applied',  v_credito,
    'external_amount', v_externo,
    'count',           array_length(v_ids, 1),
    'items',           v_items
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."_add_championship_courts_b2b"(uuid, uuid[], text, numeric) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._admin_cancel_championship_b2b (
  p_championship_id uuid,
  p_origin          text,
  p_reason          text,
  p_scope           text    DEFAULT 'full'::text,
  p_codes           text[]  DEFAULT NULL::text[],
  p_game_ids        uuid[]  DEFAULT NULL::uuid[],
  p_amount          numeric DEFAULT NULL::numeric,
  p_confirm_teams   boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_admin(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- El motivo interno, obligatorio SIEMPRE aquí. El núcleo solo lo exige al
  -- cancelar entero, y para una cancha o un extra sueltos eso dejaría retener
  -- importe sin justificarlo. Mismo error que usa el núcleo, para que el Back
  -- Office tenga un solo mensaje que traducir.
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'CANCEL_REASON_REQUIRED';
  end if;

  -- Un importe solo significa algo al cancelar canchas: en `full` se devuelve
  -- íntegro lo que reste de cada asiento, y en `extras` el importe congelado del
  -- concepto. El núcleo lo ignoraría en silencio, y un operador que escribe una
  -- cifra creyendo que retiene dinero habría devuelto todo. Así que se rechaza.
  -- Un alcance inválido no se toca aquí: ese error lo da el núcleo.
  if p_amount is not null
     and lower(btrim(coalesce(p_scope, ''))) in ('full', 'extras') then
    raise exception 'REFUND_AMOUNT_NOT_APPLICABLE: %', lower(btrim(p_scope));
  end if;

  -- El origen NO se deduce de quién pulsa: lo elige el operador, porque una
  -- cancelación que pidió el organizador por teléfono es de origen 'owner' aunque
  -- la ejecute AlGrass. Sin valor, el núcleo la rechaza —no hay defecto—.
  return public._championship_cancel_core(
    p_championship_id, p_scope, p_codes, p_game_ids, p_amount, p_origin, v_actor,
    p_confirm_teams, p_reason);
end $function$;

REVOKE ALL ON FUNCTION "public"."_admin_cancel_championship_b2b"(uuid, text, text, text, text[], uuid[], numeric, boolean) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._admin_championship_extras_b2b (
  p_championship_id uuid,
  p_items           jsonb,
  p_confirm         boolean DEFAULT false,
  p_payment_method  text    DEFAULT NULL::text,
  p_idempotency_key text    DEFAULT NULL::text,
  p_credit_applied  numeric DEFAULT 0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_champ  public.championships%rowtype;
  v_set    public.championship_settings%rowtype;
  -- La formula ya no vive aqui, asi que sus variables tampoco: solo queda lo que
  -- hace falta para leer lo que devuelve el helper.
  v_calc   jsonb;
  v_total  numeric := 0;
  v_lineas jsonb   := '[]'::jsonb;
  v_n      int     := 0;
  v_precio jsonb;
  v_key    text;
  v_payer  uuid;
  v_ya     public.orders%rowtype;
  v_order  uuid;
  -- El credito pedido, lo que queda por cobrar fuera y el medio que se apunta.
  v_credito numeric := round(coalesce(p_credit_applied, 0), 2);
  v_externo numeric;
  v_metodo  text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Gente de AlGrass: admin o staff. El mismo helper que el resto de escrituras del
  -- modulo. Ni host, ni owner, ni jugador. Tambien para cotizar: el desglose expone
  -- las tarifas, que no son publicas.
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_EXTRAS';
  end if;

  -- ── Antes de tarifar: si esto va a cobrar, que el campeonato quede fijo ──
  -- Cotizando no se bloquea nada: es una lectura y se llama en cada tecla.
  if p_confirm then
    -- El medio de pago lo dice quien cobra, y solo puede ser uno de los dos que se
    -- cobran A MANO. `card` y `yape` pertenecen a los flujos de la pasarela:
    -- elegirlos aqui diria que hubo un cobro automatico que nunca ocurrio.
    --
    -- Con credito de por medio el medio puede venir NULL, porque puede que no
    -- quede nada por cobrar fuera. Eso se decide cuando se sabe el bruto, mas
    -- abajo; aqui se conserva EXACTA la regla de siempre para el camino que no
    -- usa credito, que es el que no se toca.
    if v_credito <= 0 then
      if p_payment_method is null or p_payment_method not in ('yape_direct', 'transfer') then
        raise exception 'INVALID_PAYMENT_METHOD';
      end if;
    elsif p_payment_method is not null
          and p_payment_method not in ('yape_direct', 'transfer') then
      raise exception 'INVALID_PAYMENT_METHOD';
    end if;
    -- La clave la trae quien llama: es lo unico que distingue «lo intento otra vez»
    -- de «compro otra cosa». Sin ella no hay forma de saberlo.
    if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
      raise exception 'IDEMPOTENCY_KEY_REQUIRED';
    end if;
    v_key := 'champ_extras:' || p_championship_id::text || ':' || btrim(p_idempotency_key);

    -- MISMA lock key que roster, resultados, transiciones y canchas.
    perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
    select * into v_champ from public.championships where id = p_championship_id for update;
  else
    select * into v_champ from public.championships where id = p_championship_id;
  end if;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Las tarifas y el catalogo, de la MISMA fuente que usa el precio del App.
  select * into v_set from public.championship_settings
   where city = v_champ.city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- ══ LA FÓRMULA, EN UN SOLO SITIO ════════════════════════════════════════════
  -- Ya no vive aqui. La aplica `_championship_price_lines`, el MISMO helper que usa
  -- el precio de la compra inicial: antes habia una copia aqui y otra alli, y dos
  -- copias de una tarifa acaban cobrando cosas distintas.
  --
  -- Lo que esto conserva entero: el contrato de errores —DUPLICATE_EXTRA,
  -- EXTRA_CODE_REQUIRED, EXTRA_NOT_AVAILABLE, EXTRA_QUANTITY_REQUIRED,
  -- EXTRA_QUANTITY_OUT_OF_RANGE, EXTRA_DESCRIPTION_REQUIRED y EXTRA_AMOUNT_REQUIRED
  -- se levantan ahi dentro—, el total, las lineas y como se cobra.
  --
  -- Y sigue corriendo EN LOS DOS MODOS: cotizar es cobrar sin llegar al final.
  v_calc   := public._championship_price_lines(v_champ.city, p_items);
  v_lineas := v_calc->'lines';
  v_total  := coalesce((v_calc->>'amount')::numeric, 0);
  v_n      := coalesce(jsonb_array_length(v_lineas), 0);

  -- Un cobro de cero no es un cobro. Pasa si el catalogo tiene un precio en cero:
  -- mejor decirlo que crear un asiento vacio. Esta decision es de QUIEN COBRA y por
  -- eso se queda aqui: una compra INICIAL sin extras es perfectamente valida, y el
  -- helper devuelve cero sin protestar.
  if v_total <= 0 then raise exception 'NO_AMOUNT'; end if;

  v_precio := jsonb_build_object(
    'championship_id', p_championship_id,
    'city',            v_champ.city,
    'currency',        coalesce(v_set.currency, 'PEN'),
    'count',           v_n,
    'extras',          v_lineas,
    'extras_amount',   round(v_total, 2),
    'amount_total',    round(v_total, 2)
  );
  -- ══ fin de la fórmula ═══════════════════════════════════════════════════════

  -- ── Quién paga ──
  -- Pagador autoritativo: el del order original del campeonato, igual que en
  -- `approve_championship_transfer` y en las canchas. NO el owner por serlo, ni
  -- quien teclea.
  --
  -- Se resuelve ya, ANTES de la cotización, porque la pantalla necesita saber de
  -- quién es el saldo que va a gastar y la ficha del campeonato no lo lleva: solo
  -- trae el owner, que no siempre es el pagador. Que lo adivine el frontend es
  -- justo cómo se gasta el crédito de la persona equivocada.
  --
  -- Es una lectura: cotizando no bloquea nada y cobrando la fila del campeonato
  -- ya está tomada arriba.
  select o.payer_user_id into v_payer from public.orders o where o.id = v_champ.order_id;
  if v_payer is null then
    select r.user_id into v_payer
      from public.reservations r
     where r.championship_id = p_championship_id and r.status = 'spend'
     order by r.reserved_at
     limit 1;
  end if;
  v_payer := coalesce(v_payer, v_champ.owner_user_id);

  -- ── Modo cotización: aquí se acaba, y no se ha escrito nada ──
  -- Se añaden el pagador y SU crédito disponible. `reward_balance` no se expone:
  -- los campeonatos no usan recompensas, y devolverlo invitaría a gastarlas.
  --
  -- Aquí NO se levanta PAYER_UNKNOWN: cotizar es una lectura que se llama en cada
  -- tecla y romperla no ayuda a nadie. Si el pagador no se pudo resolver viaja
  -- NULL, el saldo es 0 y el corte está donde se cobra.
  if not p_confirm then
    return v_precio || jsonb_build_object(
      'confirmed',      false,
      'payer_user_id',  v_payer,
      'credit_balance', coalesce((select round(w.credit_balance, 2)
                                    from public.wallet_summary w
                                   where w.user_id = v_payer), 0)
    );
  end if;

  -- ── A partir de aquí se cobra ──
  -- Quien puede recibir una compra. Fuera quedan a proposito `transfer_hold` y
  -- `gateway_hold` —el campeonato todavia no existe para nadie y el hold puede
  -- expirar y llevarselo todo—, `payment_validation` —su pago esta en revision y
  -- puede acabar rechazado, dejando cobrado el extra de un campeonato que se
  -- cancela— y los terminales.
  if v_champ.status not in ('pending_publish','registration_open',
                            'registration_closed','in_progress') then
    raise exception 'CHAMPIONSHIP_NOT_ACCEPTING';
  end if;

  if v_payer is null then raise exception 'PAYER_UNKNOWN'; end if;

  -- ── El crédito, acotado ──
  -- Negativo no es un caso de negocio, y más que el bruto dejaría lo externo en
  -- negativo: el trigger restaría del wallet en vez de sumar. Se corta aquí.
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > round(v_total, 2) then
    raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, round(v_total, 2);
  end if;
  v_externo := round(round(v_total, 2) - v_credito, 2);

  -- Y ahora que se sabe cuánto queda por cobrar fuera, el medio. Si no queda nada
  -- el medio es el saldo, y no hace falta ninguno de los dos manuales; si queda
  -- algo, hay un depósito que certificar y el medio es obligatorio.
  if v_externo = 0 then
    v_metodo := 'credit';
  else
    if p_payment_method is null or p_payment_method not in ('yape_direct', 'transfer') then
      raise exception 'INVALID_PAYMENT_METHOD';
    end if;
    v_metodo := p_payment_method;
  end if;

  -- ── Ya estaba cobrada ──
  -- Se busca antes de escribir: el unique (payer, idempotency_key) tambien lo
  -- impediria, pero fallando. Un doble clic no es un error del operador, y
  -- responderle con la compra que ya existe es lo unico que no le hace dudar de si
  -- cobro una o dos veces.
  --
  -- Y va ANTES de gastar el crédito: un reintento no vuelve a descontar nada.
  select * into v_ya from public.orders o
   where o.payer_user_id = v_payer and o.idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'championship_id', p_championship_id,
      'order_id',        v_ya.id,
      'payer_user_id',   v_ya.payer_user_id,
      'payment_method',  v_ya.payment_provider,
      'total_amount',    v_ya.amount_total,
      'currency',        v_ya.currency,
      'extras',          coalesce(v_ya.financial_snapshot->'extras', '[]'::jsonb),
      -- Del snapshot de la compra que YA existe, no de lo que se acaba de pedir:
      -- lo que vale es lo que se cobró entonces.
      'credit_applied',  round(coalesce((v_ya.financial_snapshot->>'credit_applied')::numeric, 0), 2),
      'external_amount', round(coalesce((v_ya.financial_snapshot->>'external_amount')::numeric,
                                        v_ya.amount_total), 2),
      'confirmed',       true,
      'reused',          true
    );
  end if;

  -- ── El crédito, gastado ──
  -- Atómico y condicional: `spend_wallet_credit` mueve las dos columnas a la vez
  -- (`credit -= C`, `reserved += C`) y si el saldo no llega lanza
  -- INSUFFICIENT_CREDIT sin tocar nada. Aquí no se escribe en `wallet_summary` a
  -- mano, ni se lee el saldo para decidir: la condición va dentro del UPDATE, que
  -- es lo único que no se puede colar entre la comprobación y el descuento.
  if v_credito > 0 then
    perform public.spend_wallet_credit(v_payer, v_credito);
  end if;

  -- ── El order: nace confirmado ──
  -- No hay pago externo que esperar: se esta certificando un deposito que ya llego.
  -- `resolved_at` no es decorativo: la constraint `orders_resolved_at_consistency`
  -- exige que un order confirmado lo tenga.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot,
    payment_provider, status, resolved_at
  ) values (
    v_key, v_payer, 'championship', p_championship_id,
    jsonb_build_object('kind', 'championship_extras',
                       'codes', (select coalesce(jsonb_agg(e->>'code'), '[]'::jsonb)
                                   from jsonb_array_elements(v_lineas) e)),
    greatest(1, v_n), now(),
    -- El BRUTO contratado, no lo que entró de fuera: de aquí lee el total de
    -- compras de la ficha y el techo del reembolso.
    round(v_total, 2), coalesce(v_set.currency, 'PEN'),
    -- El desglose congelado ES la cotizacion, linea por linea, mas quien cobro y
    -- como. De aqui lee la ficha lo que se compro: no hay otra copia en ningun
    -- sitio, y por eso se guarda entera en vez de un resumen.
    --
    -- Y dos claves mas, que son la MEMORIA DEL PAGO: `credit_applied`, de donde
    -- lee el trigger lo que NO entró de fuera, y `external_amount`, que es lo que
    -- sí. El snapshot anterior se CONSERVA entero: estas se añaden.
    v_precio || jsonb_build_object(
      'source',          'championship_extras_manual',
      'payment_method',  v_metodo,
      'confirmed_by',    v_actor,
      'idempotency_key', v_key,
      'credit_applied',  v_credito,
      'external_amount', v_externo
    ),
    v_metodo, 'confirmed', now()
  ) returning id into v_order;

  -- ── El asiento ──
  -- `game_id` NULL a proposito, como el de las canchas: `cancel_rental` busca el
  -- asiento a reembolsar por `game_id`, y uno de campeonato colgado de un game se le
  -- presentaria como alquiler personal.
  --
  -- `total_amount` y `subtotal_amount` son el BRUTO, no lo externo: es el techo del
  -- reembolso, y rebajarlo convertiria el credito en dinero que no se devuelve.
  -- `credit_applied` deja escrito en el libro lo que salio del saldo, y el trigger
  -- `trg_championship_spend_wallet` contabiliza solo la otra mitad.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_payer, v_order,
    'spend', 'championship', 'championship', v_metodo,
    round(v_total, 2), round(v_total, 2), v_credito, 0, 0, null,
    now()
  );

  return v_precio || jsonb_build_object(
    'order_id',        v_order,
    'payer_user_id',   v_payer,
    'payment_method',  v_metodo,
    'total_amount',    round(v_total, 2),
    'credit_applied',  v_credito,
    'external_amount', v_externo,
    'confirmed',       true,
    'reused',          false
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."_admin_championship_extras_b2b"(uuid, jsonb, boolean, text, text, numeric) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._admin_create_championship_b2b (
  p_owner_user_id uuid,
  p_game_ids      uuid[],
  p_max_teams     integer,
  p_config        jsonb   DEFAULT '{}'::jsonb,
  p_items         jsonb   DEFAULT '[]'::jsonb
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_ids     uuid[];
  v_precio  jsonb;   -- el desglose, tal como lo vio el operador
  v_city    text;
  v_horas   numeric := 0;   -- horas-cancha REALES de lo elegido
  v_total   numeric := 0;
  v_order   uuid;
  v_config  jsonb;
  -- ── Pago con saldo ──
  v_credito numeric := 0;   -- crédito del usuario que se aplica
  v_externo numeric := 0;   -- lo que queda por cobrar fuera
  v_estado  text;           -- estado inicial del campeonato
  v_metodo  text;           -- método de pago del campeonato
  v_ostatus text;           -- estado inicial del order
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_owner_user_id is null then raise exception 'OWNER_REQUIRED'; end if;
  -- La capacidad es libre HACIA ARRIBA. Cero o negativa no es libertad, es un dato
  -- roto: no habria campeonato en el que inscribirse.
  if p_max_teams is null or p_max_teams < 1 then raise exception 'INVALID_TEAMS'; end if;
  if p_game_ids is null or array_length(p_game_ids, 1) is null then raise exception 'NO_GAMES'; end if;

  -- ── Precio ──
  -- Lo calcula `_championship_admin_price`, que es EL MISMO sitio del que salio el
  -- desglose que el operador vio antes de pulsar. Aqui no se recalcula nada: un
  -- segundo calculo, aunque hoy diera lo mismo, podria acabar cobrando algo distinto
  -- de lo que se enseño.
  --
  -- De ahi vienen tambien la ciudad —una sola, porque las tarifas van por ciudad—, el
  -- arbitro y los extras, y los cortes de NO_GAMES, MULTIPLE_CITIES, PRICE_UNKNOWN,
  -- CHAMPIONSHIP_CONFIG_UNAVAILABLE y los de las lineas: los errores del contrato no
  -- cambian, solo se levantan un nivel mas abajo.
  v_precio := public._championship_admin_price(p_game_ids, p_items);
  v_city   := v_precio->>'city';
  v_horas  := (v_precio->>'selected_court_hours')::numeric;
  v_total  := (v_precio->>'amount_total')::numeric;

  -- ── El crédito que se aplica ──
  -- Viaja en `p_config` para no cambiar la aridez. Sin la clave, 0: la función se
  -- comporta como antes de esta migración. Y se acota contra el total que acaba
  -- de decir la cotización, no contra un importe recalculado aquí.
  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_total then
    raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total;
  end if;
  v_externo := round(v_total - v_credito, 2);

  -- Si el saldo lo cubre todo no hay nada que validar, y no se finge que lo haya.
  if v_externo = 0 and v_total > 0 then
    v_estado  := 'pending_publish';
    v_metodo  := 'credit';
    v_ostatus := 'confirmed';
  else
    v_estado  := 'payment_validation';
    -- NULL: todavia no se sabe como pagara el resto, y ese hueco es lo que lo
    -- distingue de uno nacido en el App. Lo elige quien cobre.
    v_metodo  := null;
    v_ostatus := 'validation';
  end if;

  -- ── El campeonato ──
  -- `team_capacity` en el snapshot es lo que hace libre el techo de inscripcion.
  v_config := coalesce(p_config, '{}'::jsonb);
  v_config := jsonb_set(v_config, '{summary}', coalesce(v_config->'summary', '{}'::jsonb), true);
  v_config := jsonb_set(v_config, '{summary,team_capacity}', to_jsonb(p_max_teams), true);
  v_config := jsonb_set(v_config, '{summary,selected_court_hours}', to_jsonb(v_horas), true);

  insert into public.championships (
    owner_user_id, status, payment_method, city,
    name, cover_theme, privacy, registration_key, results_public,
    event_date, start_time, end_time, venue_id, format_config, registration_closes_at
  ) values (
    p_owner_user_id, v_estado, v_metodo, v_city,
    nullif(p_config->>'name', ''), nullif(p_config->>'cover_theme', ''),
    coalesce(nullif(p_config->>'privacy', ''), 'private'),
    nullif(p_config->>'registration_key', ''),
    coalesce((p_config->>'results_public')::boolean, true),
    -- La fecha y la sede de referencia salen de la PRIMERA cancha elegida. Son
    -- eso: una referencia para la ficha. El inventario real vive en los enlaces,
    -- y puede abarcar varias fechas y sedes.
    (select g.date_key from public.games g
      where g.id = any(p_game_ids) order by g.date_key, g.time limit 1),
    (select g.time from public.games g
      where g.id = any(p_game_ids) order by g.date_key, g.time limit 1),
    nullif(p_config->>'end_time', '')::time,
    (select f.venue_id from public.games g join public.fields f on f.id = g.field_id
      where g.id = any(p_game_ids) order by g.date_key, g.time limit 1),
    v_config,
    nullif(p_config->>'registration_closes_at', '')::timestamptz
  ) returning * into v_champ;

  -- ── Las canchas, con el UNICO sistema de reservas ──
  -- Aqui no se repite ni una linea del reclamo: lock ordenado, revalidacion,
  -- `published -> reserved` y enlaces los hace el helper, el mismo que usa
  -- `add_championship_courts`.
  v_ids := public._championship_claim_games(v_champ.id, p_game_ids);

  -- ── El crédito, DESPUÉS de que el campeonato y sus canchas existan ──
  -- Así un fallo del reclamo —una cancha que ya se llevó otro— no deja saldo
  -- descontado. Y si el débito falla, se va con el rollback todo lo de arriba.
  if v_credito > 0 then
    perform public.spend_wallet_credit(p_owner_user_id, v_credito);
  end if;

  -- ── UN order para todo ──
  -- `validation` es el estado NO terminal que la Fase 2 creo justo para esto: un
  -- pago que espera revision manual, sin TTL. Es el que `approve_championship_transfer`
  -- exige para confirmar, asi que el flujo de «Validando pago» funciona sin tocarlo.
  --
  -- Y SIN asiento: reservar no es cobrar. El spend nace al confirmar el deposito, y
  -- lo crea `approve_championship_transfer`, no esta funcion. La UNICA excepcion es
  -- el pago cubierto del todo con saldo: ahi no hay deposito que esperar, el order
  -- nace `confirmed` y el asiento se escribe mas abajo.
  --
  -- El pagador es el owner: se decidio asi, y se escribe explicito en vez de
  -- deducirlo de quien pulsa. Es tambien de quien sale el credito.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot,
    payment_provider, status, resolved_at
  ) values (
    'admin_champ:' || v_champ.id::text,
    p_owner_user_id, 'championship', v_champ.id,
    jsonb_build_object('kind', 'championship_admin_manual', 'game_ids', to_jsonb(v_ids)),
    array_length(v_ids, 1), now(),
    v_total, coalesce(v_precio->>'currency', 'PEN'),
    -- El desglose congelado ES la cotizacion que se enseño, no una copia hecha a
    -- mano de sus partes: se guarda entera —canchas, arbitro, extras linea a linea y
    -- fee— y se le añaden las tres cosas que la cotizacion no sabe: de donde viene,
    -- para cuantos equipos y quien pulso. Si manana alguien pregunta de donde salio
    -- el importe, esta aqui, y es lo que lee «Compras y comprobantes».
    --
    -- Y dos mas, que son la MEMORIA DEL PAGO: `credit_applied`, de donde lee el
    -- trigger de restitucion cuanto devolver si la orden muere, y `external_amount`,
    -- de donde lee el de contabilizacion cuanto entro de fuera. Se AÑADEN a la
    -- cotizacion; no la sustituyen. El bruto sigue siendo `amount_total`.
    v_precio || jsonb_build_object(
      'source', 'championship_admin_manual',
      'max_teams', p_max_teams,
      'created_by', v_actor,
      'credit_applied', v_credito,
      'external_amount', v_externo
    ),
    case when v_externo = 0 and v_total > 0 then 'credit' else null end,
    v_ostatus,
    case when v_ostatus = 'confirmed' then now() else null end
  ) returning id into v_order;

  update public.championships set order_id = v_order, updated_at = now()
   where id = v_champ.id
  returning * into v_champ;

  -- ── El asiento, solo si ya está pagado del todo ──
  -- Mismas columnas y mismos importes que escribe `approve_championship_transfer`:
  -- `total_amount` = BRUTO contratado, que es lo que la Fase 1 usa como techo de
  -- reembolso. El `credit_applied` lo deja escrito en el libro, y el trigger de
  -- contabilización hace el resto —aquí no entra nada de fuera, así que no mueve
  -- `total_amount` del wallet: el crédito ya se movió al descontarse—.
  if v_ostatus = 'confirmed' then
    insert into public.reservations (
      game_id, championship_id, user_id, order_id,
      status, reservation_type, source, payment_method,
      total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
      reserved_at
    ) values (
      null, v_champ.id, p_owner_user_id, v_order,
      'spend', 'championship', 'championship', 'credit',
      v_total, v_total, v_credito, 0, 0, null,
      now()
    );
  end if;

  return v_champ;
end $function$;

REVOKE ALL ON FUNCTION "public"."_admin_create_championship_b2b"(uuid, uuid[], integer, jsonb, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._champ_can_manage_results (
  p_championship_id uuid,
  p_actor           uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select case when p_actor is null then false else exists (
    select 1 from public.championships c
     where c.id = p_championship_id
       and (
         (public._is_algrass_staff(p_actor) and c.status in ('in_progress', 'completed'))
         or (c.host_user_id is not null and c.host_user_id = p_actor and c.status = 'in_progress')
       )
  ) end;
$function$;

REVOKE ALL ON FUNCTION "public"."_champ_can_manage_results"(uuid, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._champ_can_manage_roster (
  p_championship_id uuid,
  p_actor           uuid,
  p_action          text
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  c        public.championships%rowtype;
  v_algrass boolean;
  v_owner   boolean;
  v_host    boolean;
  ph        text;   -- fase efectiva
begin
  if p_actor is null then return false; end if;
  select * into c from public.championships where id = p_championship_id;
  if not found then return false; end if;

  v_algrass := public._is_algrass_staff(p_actor);
  v_owner   := (c.owner_user_id = p_actor);
  v_host    := (c.host_user_id is not null and c.host_user_id = p_actor);
  if not (v_algrass or v_owner or v_host) then return false; end if;

  ph := case
          when c.status = 'in_progress' and c.live_started_at is not null then 'in_progress_live'
          when c.status = 'in_progress'                                    then 'in_progress_prelive'
          else c.status
        end;

  -- add_player (tercero nuevo): host o AlGrass; y ADEMÁS el owner en campeonatos PRIVADOS (mismo rango que
  -- el host: RO/RC/PRE/LIVE). En públicos el owner NO entra. (Fase 29 + owner-privado.)
  if p_action = 'add_player' then
    return (v_host or v_algrass or (v_owner and c.privacy = 'private'))
       and ph in ('registration_open','registration_closed','in_progress_prelive','in_progress_live');
  end if;

  -- SELF administrativo: SOLO owner que NO sea Host. El Host NUNCA se auto-inscribe, aunque además sea owner
  -- y/o AlGrass (el rol Host tiene prioridad). Se evalúa ANTES de la rama genérica de AlGrass para que un
  -- actor Host+AlGrass no obtenga self=true por esa vía. Owner-no-Host: RO/RC/PRE/LIVE (+PP).
  if p_action = 'self' then
    return v_owner and not v_host
       and ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');
  end if;

  -- AlGrass: todas las operativas + completed (resto de acciones: create/edit/delete/move). [IDÉNTICO a fases previas.]
  if v_algrass then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live','completed');
  end if;

  -- Owner/Host.
  if p_action = 'create_team' or p_action = 'delete_team' then
    return ph in ('pending_publish','registration_open','registration_closed');
  elsif p_action = 'edit_team' then
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');   -- Fase 33
  elsif p_action = 'move_player' then
    -- Gestión de TERCEROS inscritos: owner/host. (Sin cambios.)
    return ph in ('pending_publish','registration_open','registration_closed','in_progress_prelive','in_progress_live');
  else
    return false;
  end if;
end; $function$;

REVOKE ALL ON FUNCTION "public"."_champ_can_manage_roster"(uuid, uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public._championship_admin_price (
  p_game_ids uuid[],
  p_items    jsonb  DEFAULT '[]'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_ciudades int;
  v_city     text;
  v_canchas  numeric := 0;
  v_horas    numeric := 0;   -- horas-cancha REALES de lo elegido
  v_n        int     := 0;
  v_set      public.championship_settings%rowtype;
  v_calc     jsonb;
  v_lineas   jsonb   := '[]'::jsonb;
  v_extras   numeric := 0;
  v_arbitro  numeric := 0;
  v_fee      numeric := 0;
begin
  if p_game_ids is null or array_length(p_game_ids, 1) is null then raise exception 'NO_GAMES'; end if;

  select count(distinct v.city), min(v.city), coalesce(sum(g.price_total), 0),
         coalesce(sum(g.duration_min), 0) / 60.0, count(distinct g.id)
    into v_ciudades, v_city, v_canchas, v_horas, v_n
    from public.games g
    join public.fields f on f.id = g.field_id
    join public.venues v on v.id = f.venue_id
   where g.id = any(p_game_ids);
  if v_ciudades is null or v_ciudades = 0 then raise exception 'NO_GAMES'; end if;
  if v_ciudades > 1 then raise exception 'MULTIPLE_CITIES'; end if;

  -- Una cancha sin precio no se puede cobrar, y adivinarlo seria inventar dinero.
  -- El corte va aqui y no mas abajo porque `sum()` ignora los nulos: sin el, el
  -- total saldria mal y pareceria correcto.
  if exists (select 1 from public.games where id = any(p_game_ids) and price_total is null) then
    raise exception 'PRICE_UNKNOWN:%',
      (select id from public.games where id = any(p_game_ids) and price_total is null limit 1);
  end if;

  -- Las tarifas, de la MISMA tabla que usa el precio del App.
  select * into v_set from public.championship_settings where city = v_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- ── BLOQUEOS OPERATIVOS (línea añadida) ──
  -- Admin tampoco cotiza sobre una fecha bloqueada: para contratar ahí hay que
  -- retirar antes el bloqueo. Misma regla y mismo validador que el App; los
  -- bloqueos se leen server-side, nunca del cliente.
  perform public._championship_assert_not_blocked(p_game_ids, v_set.availability_blocks);

  -- ── Árbitro y extras: la fórmula compartida, y nada mas ──
  -- Aqui no se multiplica ninguna tarifa: se delega. El arbitro sale de las lineas
  -- como cualquier otro extra, y si no viene, no se cobra.
  v_calc   := public._championship_price_lines(v_city, p_items);
  v_lineas := v_calc->'lines';
  v_extras := coalesce((v_calc->>'amount')::numeric, 0);

  -- El arbitro se separa del resto para la ficha: lo lleva su propia clave, que es
  -- la que el App tambien escribe, y asi el desglose se lee igual venga de donde
  -- venga. No se recalcula: se LEE de la linea que ya tarifo el helper.
  v_arbitro := coalesce((
    select (e->>'amount')::numeric
      from jsonb_array_elements(v_lineas) e
     where e->>'code' = 'referee'
     limit 1
  ), 0);

  -- El fee NO es opcional y NO va por lineas: va por las horas-cancha realmente
  -- elegidas, que es lo que describe el servicio.
  v_fee := round(v_horas * v_set.algrass_fee_hourly_rate, 2);

  return jsonb_build_object(
    'city',                    v_city,
    'currency',                coalesce(v_set.currency, 'PEN'),
    'court_count',             v_n,
    'courts_amount',           round(v_canchas, 2),
    'selected_court_hours',    v_horas,
    'referee_hourly_rate',     v_set.referee_hourly_rate,
    'referee_amount',          v_arbitro,
    'algrass_fee_hourly_rate', v_set.algrass_fee_hourly_rate,
    'algrass_fee_amount',      v_fee,
    -- Las lineas enteras, arbitro incluido: de aqui sale el desglose por concepto.
    'extras',                  v_lineas,
    -- Lo que suman las lineas MENOS el arbitro, que viaja en su propia clave. Asi
    -- `courts + referee + extras + fee` es el total, sin contar nada dos veces.
    'extras_amount',           round(v_extras - v_arbitro, 2),
    'amount_total',            round(v_canchas + v_extras + v_fee, 2)
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_admin_price"(uuid[], jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_assert_extras (
  p_extras jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  v_e      jsonb;
  v_codigos text[] := array[]::text[];
  v_code   text;
begin
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then
    raise exception 'INVALID_EXTRAS';
  end if;

  for v_e in select value from jsonb_array_elements(p_extras) as t(value) loop
    if jsonb_typeof(v_e) <> 'object' then raise exception 'INVALID_EXTRAS'; end if;

    v_code := btrim(coalesce(v_e->>'code', ''));
    if length(v_code) = 0 then raise exception 'INVALID_EXTRAS'; end if;
    -- `referee` y `other` son códigos del contrato de precios, no del catálogo:
    -- el árbitro se tarifa con su propia tarifa horaria y `other` lleva precio
    -- libre. Dejarlos entrar aquí crearía dos fuentes para el mismo concepto.
    if v_code in ('referee', 'other') then raise exception 'EXTRA_CODE_RESERVED'; end if;
    if v_code = any(v_codigos) then raise exception 'EXTRA_CODE_DUPLICATED'; end if;
    v_codigos := v_codigos || v_code;

    if length(btrim(coalesce(v_e->>'name', ''))) = 0 then raise exception 'INVALID_EXTRAS'; end if;
    if jsonb_typeof(v_e->'active')         <> 'boolean' then raise exception 'INVALID_EXTRAS'; end if;
    if jsonb_typeof(v_e->'unit_price')     <> 'number'  then raise exception 'INVALID_EXTRAS'; end if;
    if jsonb_typeof(v_e->'units_per_item') <> 'number'  then raise exception 'INVALID_EXTRAS'; end if;
    if jsonb_typeof(v_e->'min_quantity')   <> 'number'  then raise exception 'INVALID_EXTRAS'; end if;
    if jsonb_typeof(v_e->'max_quantity')   <> 'number'  then raise exception 'INVALID_EXTRAS'; end if;
    if jsonb_typeof(v_e->'sort_order')     <> 'number'  then raise exception 'INVALID_EXTRAS'; end if;

    -- `= 'NaN'` no es paranoia: en numeric, NaN pasa cualquier `>= 0`.
    if (v_e->>'unit_price')::numeric = 'NaN'::numeric
       or (v_e->>'unit_price')::numeric < 0 then
      raise exception 'INVALID_EXTRA_PRICE';
    end if;
    if (v_e->>'units_per_item')::numeric < 1
       or (v_e->>'min_quantity')::numeric < 1
       or (v_e->>'max_quantity')::numeric < (v_e->>'min_quantity')::numeric then
      raise exception 'INVALID_EXTRA_QUANTITY';
    end if;
  end loop;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_assert_extras"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_assert_formats (
  p_formats jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  v_key text;
  v_val jsonb;
begin
  if p_formats is null or jsonb_typeof(p_formats) <> 'object' then
    raise exception 'INVALID_FORMATS';
  end if;

  for v_key, v_val in select key, value from jsonb_each(p_formats) loop
    if length(btrim(v_key)) = 0 then raise exception 'INVALID_FORMATS'; end if;
    if jsonb_typeof(v_val) <> 'object'
       or jsonb_typeof(v_val->'min_teams')           <> 'number'
       or jsonb_typeof(v_val->'max_teams')           <> 'number'
       or jsonb_typeof(v_val->'service_court_hours') <> 'number' then
      raise exception 'INVALID_FORMATS';
    end if;
    if (v_val->>'min_teams')::numeric < 1
       or (v_val->>'max_teams')::numeric < (v_val->>'min_teams')::numeric
       -- Cero horas de servicio sería un campeonato que no se cobra. Si alguna vez
       -- hiciera falta, es una decisión de negocio y se cambia aquí.
       or (v_val->>'service_court_hours')::numeric <= 0 then
      raise exception 'INVALID_FORMATS';
    end if;
  end loop;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_assert_formats"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_assert_lead_rules (
  p_rules jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  v_a jsonb;
  v_b jsonb;
begin
  if p_rules is null or jsonb_typeof(p_rules) <> 'array' then
    raise exception 'INVALID_LEAD_RULES';
  end if;

  for v_a in select value from jsonb_array_elements(p_rules) as t(value) loop
    if jsonb_typeof(v_a) <> 'object'
       or jsonb_typeof(v_a->'min_teams') <> 'number'
       or jsonb_typeof(v_a->'max_teams') <> 'number'
       or jsonb_typeof(v_a->'days')      <> 'number' then
      raise exception 'INVALID_LEAD_RULES';
    end if;
    if (v_a->>'min_teams')::numeric < 1
       or (v_a->>'max_teams')::numeric < (v_a->>'min_teams')::numeric
       or (v_a->>'days')::numeric < 0 then
      raise exception 'INVALID_LEAD_RULES';
    end if;
  end loop;

  -- Sin solapes: dos tramos que contengan el mismo número de equipos dejarían al
  -- pricing con dos respuestas, y ahí aborta.
  for v_a, v_b in
    select a.value, b.value
      from jsonb_array_elements(p_rules) with ordinality a(value, i)
      join jsonb_array_elements(p_rules) with ordinality b(value, j) on j > i
  loop
    if (v_a->>'min_teams')::numeric <= (v_b->>'max_teams')::numeric
       and (v_b->>'min_teams')::numeric <= (v_a->>'max_teams')::numeric then
      raise exception 'LEAD_RULES_OVERLAP';
    end if;
  end loop;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_assert_lead_rules"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_assert_not_blocked (
  p_game_ids uuid[],
  p_blocks   jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_blk  jsonb;
  v_norm jsonb;
  v_ini  timestamptz;
  v_fin  timestamptz;
begin
  if p_game_ids is null or array_length(p_game_ids, 1) is null then return; end if;

  -- Columna rota → fail-safe: no se reserva.
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
  end if;
  if jsonb_array_length(p_blocks) = 0 then return; end if;

  -- Un game sin fecha o sin hora no se puede situar en el tiempo, así que no se
  -- puede saber si cae dentro de un bloqueo. No reservable de todas formas
  -- (`assert_game_reservable`), pero aquí se corta explícitamente antes que
  -- dejar que la comparación salga NULL y no bloquee nada.
  if exists (
    select 1 from public.games g
     where g.id = any(p_game_ids) and (g.date_key is null or g.time is null)
  ) then
    raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
  end if;

  for v_blk in select value from jsonb_array_elements(p_blocks) as t(value) loop
    begin
      -- Una sola interpretación del formato, la de `_championship_block_normalize`:
      -- entiende {date,all_day}, {date,from,to} y {starts_at,ends_at}.
      v_norm := public._championship_block_normalize(v_blk);
      v_ini  := (v_norm->>'starts_at')::timestamptz;
      v_fin  := (v_norm->>'ends_at')::timestamptz;

      -- Solapamiento por intervalo semiabierto contra CADA game elegido, con su
      -- fecha y su hora reales ancladas a Lima. Vale para una franja de un día,
      -- para un rango de varios y para uno que cruce la medianoche: aquí ya no
      -- hay «días», hay instantes.
      if exists (
        select 1
          from public.games g
         where g.id = any(p_game_ids)
           and ((g.date_key::date + g.time)::timestamp at time zone 'America/Lima') < v_fin
           and (((g.date_key::date + g.time)::timestamp at time zone 'America/Lima')
                + (coalesce(g.duration_min, 60) * interval '1 minute')) > v_ini
      ) then
        raise exception 'CHAMPIONSHIP_AVAILABILITY_BLOCKED';
      end if;
    exception
      when others then
        -- Propaga el bloqueo real; cualquier otra falla —BAD_BLOCK, un cast
        -- malformado, un date_key que no es una fecha— es fail-safe.
        if sqlerrm like 'CHAMPIONSHIP_AVAILABILITY_BLOCKED%' then raise;
        else raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
    end;
  end loop;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_assert_not_blocked (
  p_game_ids   uuid[],
  p_blocks     jsonb,
  p_event_date date
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_city   text;
  v_blocks jsonb;
  v_n      int := 0;
begin
  if p_game_ids is null or array_length(p_game_ids, 1) is null then return; end if;

  -- ── CAMINO READ ONLY (la cotización STABLE del App vía PostgREST) ──
  -- No se puede —ni hace falta— tomar un lock: FOR SHARE abortaría la transacción.
  -- Se valida contra los bloqueos que ya leyó y pasó _championship_compute_price
  -- (su MISMO snapshot, el que se usó para tarifar), delegando en el validador
  -- puro de dos argumentos. p_event_date se ignora igual que en M3: el validador
  -- sitúa cada game por su propia fecha/hora. El quote es previsualización; la
  -- autoridad frente a la carrera es el hold (camino read-write de abajo).
  if current_setting('transaction_read_only')::boolean then
    perform public._championship_assert_not_blocked(p_game_ids, p_blocks);
    return;
  end if;

  -- ── CAMINO READ WRITE (autoritativo: el hold del App y cualquier escritura) ──
  -- Relee los bloqueos VIGENTES de la ciudad de los games con `for share` sobre
  -- championship_settings —cerrando la carrera contra add/remove_championship_block—
  -- y delega en el validador de dos argumentos. El hold ya tomó los games con
  -- `order by id for update` antes de llegar aquí, así que el orden es
  -- games → championship_settings y la comprobación va bajo el lock de los games,
  -- antes de materializar la reserva.
  for v_city in
    select distinct v.city
      from public.games g
      join public.fields f on f.id = g.field_id
      join public.venues v on v.id = f.venue_id
     where g.id = any(p_game_ids)
     order by 1
  loop
    select availability_blocks into v_blocks
      from public.championship_settings
     where city = v_city
       for share;
    if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

    perform public._championship_assert_not_blocked(p_game_ids, v_blocks);
    v_n := v_n + 1;
  end loop;

  -- Games que no se pueden situar en ninguna ciudad: no se valida nada, así que no
  -- se da por bueno. Fail-safe, como el resto.
  if v_n = 0 then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb, date) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_block_normalize (
  p_block jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_date  date;
  v_from  time;
  v_to    time;
  v_ini   timestamptz;
  v_fin   timestamptz;
begin
  if p_block is null or jsonb_typeof(p_block) <> 'object' then
    raise exception 'BAD_BLOCK';
  end if;

  -- ── v2: el rango ya viene dado ──
  if p_block ? 'starts_at' or p_block ? 'ends_at' then
    if jsonb_typeof(p_block->'starts_at') <> 'string'
       or jsonb_typeof(p_block->'ends_at') <> 'string' then
      raise exception 'BAD_BLOCK';
    end if;
    v_ini := (p_block->>'starts_at')::timestamptz;
    v_fin := (p_block->>'ends_at')::timestamptz;

  -- ── v1: una fecha, con o sin franja. Hora de pared de Lima ──
  elsif p_block ? 'date' then
    v_date := (p_block->>'date')::date;

    if jsonb_typeof(p_block->'all_day') = 'boolean' and (p_block->>'all_day')::boolean = true then
      v_ini := (v_date::timestamp)                     at time zone 'America/Lima';
      v_fin := ((v_date + 1)::timestamp)               at time zone 'America/Lima';
    else
      -- Igual que el validador original: `from` y `to` son obligatorios y `to`
      -- tiene que ser posterior. Un bloqueo de un día con horas inválidas NO se
      -- interpreta como «todo el día»: es un bloqueo roto, y abortar es lo seguro.
      v_from := (p_block->>'from')::time;
      v_to   := (p_block->>'to')::time;
      if v_to <= v_from then raise exception 'BAD_BLOCK'; end if;
      v_ini := ((v_date + v_from)::timestamp) at time zone 'America/Lima';
      v_fin := ((v_date + v_to)::timestamp)   at time zone 'America/Lima';
    end if;

  else
    raise exception 'BAD_BLOCK';
  end if;

  if v_ini is null or v_fin is null or v_fin <= v_ini then raise exception 'BAD_BLOCK'; end if;

  return jsonb_build_object(
    'id',         p_block->>'id',          -- null en los v1: no se pueden borrar por id
    'starts_at',  to_char(v_ini at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at',    to_char(v_fin at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'reason',     p_block->>'reason',
    'created_by', p_block->>'created_by',
    'created_at', p_block->>'created_at',
    -- Para pintar en hora de Lima sin que la pantalla tenga que convertir.
    'starts_at_lima', to_char(v_ini at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI'),
    'ends_at_lima',   to_char(v_fin at time zone 'America/Lima', 'YYYY-MM-DD HH24:MI')
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_block_normalize"(jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_cancel_core (
  p_championship_id uuid,
  p_scope           text,
  p_codes           text[],
  p_game_ids        uuid[],
  p_amount          numeric,
  p_origin          text,
  p_actor           uuid,
  p_confirm_teams   boolean,
  p_reason          text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_champ     public.championships%rowtype;
  v_scope     text := lower(btrim(coalesce(p_scope, '')));
  v_mov       jsonb := '[]'::jsonb;
  v_total     numeric := 0;
  v_libres    uuid[] := '{}'::uuid[];
  v_c         record;
  v_id        uuid;
  v_payee     uuid;
  v_n         int;
  v_restan    int;
  v_code      text;
  v_gid       uuid;
  v_monto     numeric;
  v_techo     numeric;
  v_origen    text := lower(btrim(coalesce(p_origin, '')));
  v_motivo    text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_championship_id is null then raise exception 'INVALID_INPUT'; end if;
  if v_scope not in ('full', 'extras', 'courts') then raise exception 'INVALID_SCOPE'; end if;

  if v_origen not in ('owner', 'algrass') then raise exception 'INVALID_CANCELLATION_ORIGIN'; end if;

  if v_scope = 'full' and v_motivo is null then
    raise exception 'CANCEL_REASON_REQUIRED';
  end if;
  if v_motivo is not null and length(v_motivo) > 300 then
    raise exception 'CANCEL_REASON_TOO_LONG';
  end if;

  -- Serializa contra inscripciones, transiciones de estado, reclamo de canchas y
  -- contra otra cancelación: todos toman esta misma clave.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status = 'canceled' then raise exception 'CHAMPIONSHIP_ALREADY_CANCELED'; end if;

  if v_champ.status = 'payment_validation' then
    raise exception 'CHAMPIONSHIP_CANCEL_USE_REJECT_TRANSFER';
  end if;
  if v_champ.status = 'completed' then raise exception 'CHAMPIONSHIP_NOT_CANCELABLE'; end if;

  if not exists (
    select 1 from public.reservations
     where championship_id = p_championship_id and status = 'spend'
  ) then
    raise exception 'CHAMPIONSHIP_NOT_PAID';
  end if;

  -- ── 5a · Todo el campeonato ──
  if v_scope = 'full' then
    if v_champ.status in ('registration_closed', 'in_progress') then
      raise exception 'CHAMPIONSHIP_CANCEL_BLOCKED_FIXTURE';
    end if;
    if exists (select 1 from public.championship_matches where championship_id = p_championship_id) then
      raise exception 'CHAMPIONSHIP_CANCEL_BLOCKED_FIXTURE';
    end if;

    select count(*) into v_n from public.championship_teams where championship_id = p_championship_id;
    if v_n > 0 and not coalesce(p_confirm_teams, false) then
      raise exception 'CHAMPIONSHIP_HAS_TEAMS: % equipos inscritos', v_n;
    end if;

    -- Lo que queda por devolver, asiento por asiento. No se recalcula ningún
    -- precio: es lo que entró menos lo que ya salió. BRUTO = subtotal_amount.
    for v_c in
      select r.id as spend_id, r.order_id,
             round(coalesce(r.subtotal_amount, r.total_amount, 0)
                   - coalesce((select sum(coalesce(f.total_amount, 0)) from public.reservations f
                                where f.status = 'refund' and f.refund_of_reservation_id = r.id), 0), 2) as resta
        from public.reservations r
       where r.championship_id = p_championship_id and r.status = 'spend'
       order by r.reserved_at, r.id
    loop
      if v_c.resta > 0 then
        v_id := public._championship_refund_one(
          p_championship_id, v_c.spend_id, v_c.resta,
          jsonb_build_object(
            'key',      'full:' || v_c.spend_id::text,
            'kind',     'full',
            'order_id', v_c.order_id,
            'origin',   v_origen,
            'reason',   v_motivo,
            'teams_at_cancel', v_n),
          p_actor);
        v_total := v_total + v_c.resta;
        v_mov := v_mov || jsonb_build_object(
          'reservation_id', v_id, 'order_id', v_c.order_id,
          'kind', 'full', 'amount', v_c.resta);
      end if;
    end loop;

    v_libres := public._championship_release_courts(p_championship_id, null);

    update public.championships
       set status = 'canceled', hold_expires_at = null, updated_at = now()
     where id = p_championship_id;

  -- ── 5b · Extras completos, por código ──
  elsif v_scope = 'extras' then
    if p_codes is null or array_length(p_codes, 1) is null then raise exception 'NO_CODES'; end if;

    foreach v_code in array p_codes loop
      v_n := 0;
      for v_c in
        select * from public._championship_concepts(p_championship_id) c
         where c.kind = 'extra' and c.code = v_code
      loop
        v_n := v_n + 1;
        if v_c.refund_id is not null then raise exception 'ALREADY_REFUNDED: %', v_code; end if;

        v_id := public._championship_refund_one(
          p_championship_id, v_c.spend_id, v_c.amount,
          jsonb_build_object(
            'key',      v_c.refund_key,
            'kind',     'extra',
            'code',     v_code,
            'quantity', v_c.quantity,
            'order_id', v_c.order_id,
            'origin',   v_origen,
            'reason',   v_motivo),
          p_actor);
        v_total := v_total + v_c.amount;
        v_mov := v_mov || jsonb_build_object(
          'reservation_id', v_id, 'order_id', v_c.order_id,
          'kind', 'extra', 'code', v_code,
          'quantity', v_c.quantity, 'amount', v_c.amount);
      end loop;
      if v_n = 0 then raise exception 'EXTRA_NOT_FOUND: %', v_code; end if;
    end loop;

  -- ── 5c · Canchas sueltas ──
  else
    if p_game_ids is null or array_length(p_game_ids, 1) is null then raise exception 'NO_GAMES'; end if;

    select count(*) into v_restan
      from public.championship_reservation_games
     where championship_id = p_championship_id and not (game_id = any(p_game_ids));
    if v_restan = 0 then raise exception 'COURTS_WOULD_BE_EMPTY'; end if;

    foreach v_gid in array p_game_ids loop
      if exists (
        select 1 from public.championship_matches
         where championship_id = p_championship_id and game_id = v_gid
      ) then
        raise exception 'GAME_HAS_SCHEDULED_MATCHES: %', v_gid;
      end if;

      if not exists (
        select 1 from public.championship_reservation_games
         where championship_id = p_championship_id and game_id = v_gid
      ) then
        raise exception 'GAME_NOT_IN_CHAMPIONSHIP: %', v_gid;
      end if;

      select * into v_c from public._championship_concepts(p_championship_id) c
       where c.kind = 'court' and c.game_id = v_gid;

      if found then
        if v_c.refund_id is not null then raise exception 'ALREADY_REFUNDED: %', v_gid; end if;
        v_monto := coalesce(round(p_amount, 2), v_c.amount);
        if v_monto > v_c.amount then
          raise exception 'REFUND_EXCEEDS_CONCEPT: % > %', v_monto, v_c.amount;
        end if;
      else
        select * into v_c from public._championship_concepts(p_championship_id) c
         where c.kind = 'courts'
         order by c.order_id
         limit 1;
        if not found then raise exception 'COURT_CONCEPT_NOT_FOUND: %', v_gid; end if;
        if p_amount is null then raise exception 'REFUND_AMOUNT_REQUIRED: %', v_gid; end if;

        v_monto := round(p_amount, 2);
        select round(v_c.amount - coalesce(sum(coalesce(f.total_amount, 0)), 0), 2) into v_techo
          from public.reservations f
         where f.status = 'refund'
           and f.refund_of_reservation_id = v_c.spend_id
           and f.refund_scope->>'kind' = 'court';
        if v_monto > coalesce(v_techo, v_c.amount) then
          raise exception 'REFUND_EXCEEDS_CONCEPT: % > %', v_monto, coalesce(v_techo, v_c.amount);
        end if;
      end if;

      v_id := public._championship_refund_one(
        p_championship_id, v_c.spend_id, v_monto,
        jsonb_build_object(
          'key',      'court:' || p_championship_id::text || ':' || v_gid::text,
          'kind',     'court',
          'game_id',  v_gid,
          'quantity', 1,
          'order_id', v_c.order_id,
          'origin',   v_origen,
          'reason',   v_motivo),
        p_actor);
      v_total := v_total + v_monto;
      v_mov := v_mov || jsonb_build_object(
        'reservation_id', v_id, 'order_id', v_c.order_id,
        'kind', 'court', 'game_id', v_gid, 'amount', v_monto);

      v_libres := v_libres || public._championship_release_courts(p_championship_id, array[v_gid]);
    end loop;
  end if;

  if jsonb_array_length(v_mov) = 0 then raise exception 'NOTHING_TO_REFUND'; end if;

  select coalesce(o.payer_user_id, r.user_id) into v_payee
    from public.reservations r left join public.orders o on o.id = r.order_id
   where r.championship_id = p_championship_id and r.status = 'spend'
   order by r.reserved_at limit 1;

  return jsonb_build_object(
    'championship_id',  p_championship_id,
    'scope',            v_scope,
    'origin',           v_origen,
    'executed_by',      p_actor,
    'status',           (select status from public.championships where id = p_championship_id),
    'refunds',          v_mov,
    'refunded_total',   round(v_total, 2),
    'refund_method',    'wallet_credit',
    'credited_to',      v_payee,
    'released_game_ids', coalesce(to_jsonb(v_libres), '[]'::jsonb)
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_cancel_core"(uuid, text, text[], uuid[], numeric, text, uuid, boolean, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_claim_games (
  p_championship_id uuid,
  p_game_ids        uuid[]
)
  RETURNS uuid[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_ids   uuid[];
  v_lock  uuid[];
  v_id    uuid;
  v_game  public.games%rowtype;
  v_twin  uuid;
  v_t_alt uuid;
  v_taken uuid;
  v_city  text;     -- (nuevo) ciudad de lo elegido, para leer sus bloqueos
  v_n_cit int;      -- (nuevo)
  v_blocks jsonb;   -- (nuevo)
begin
  -- Sin repetidos y en orden: pulsar dos veces la misma cancha es UNA operacion,
  -- no dos, y el orden estable es la mitad de la defensa contra interbloqueos.
  select array_agg(x order by x) into v_ids
    from (select distinct unnest(p_game_ids) x) s
   where x is not null;
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'NO_GAMES'; end if;

  -- ── UN SOLO LOCK, sobre los elegidos MAS sus gemelos, en orden de id ──
  -- Este es el motivo principal de que el lote exista. Tres llamadas sueltas
  -- tomarian sus locks en tres ordenes distintos; aqui se toman todos de una vez
  -- y en el mismo orden que usan `create_order`, el gate de Match y
  -- `claim_rental_double_out_aware`.
  select array_agg(distinct z order by z) into v_lock
    from (
      select unnest(v_ids) as z
      union
      select g.alternative_game_id
        from public.games g
       where g.id = any(v_ids) and g.alternative_game_id is not null
    ) u;
  perform 1 from public.games where id = any(v_lock) order by id for update;

  -- ── BLOQUEOS OPERATIVOS (líneas añadidas) ──
  -- Aqui es donde manda: BAJO EL LOCK, asi que entre comprobar y reclamar no hay
  -- ventana. Si alguien puso un bloqueo mientras el operador elegia, esto aborta y
  -- no se reserva nada. Los bloqueos se leen server-side.
  --
  -- La fila de settings se busca SIN exigir `active`: este cambio es sobre
  -- bloqueos, y negar el reclamo porque la ciudad este desactivada seria otra
  -- regla distinta que ya aplican los dos pricings por su cuenta.
  select count(distinct v.city), min(v.city) into v_n_cit, v_city
    from public.games g
    join public.fields f on f.id = g.field_id
    join public.venues v on v.id = f.venue_id
   where g.id = any(v_ids);
  if v_n_cit is null or v_n_cit = 0 then raise exception 'NO_GAMES'; end if;
  if v_n_cit > 1 then raise exception 'MULTIPLE_CITIES'; end if;
  --
  -- `for share` sobre la fila de la ciudad: los games ya están bloqueados, así
  -- que el orden es games → championship_settings, el mismo que usa el hold del
  -- App. Esta lectura espera a cualquier alta o baja de bloqueo en vuelo y ve su
  -- resultado, y a partir de aquí ninguna puede colarse hasta que esta
  -- transacción termine. Sin esto, el lock de los games no protege de nada:
  -- `championship_settings` es otra fila y nadie la estaba mirando.
  select availability_blocks into v_blocks
    from public.championship_settings
   where city = v_city
     for share;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
  perform public._championship_assert_not_blocked(v_ids, v_blocks);

  -- ── Revalidar TODOS, bajo el lock, ANTES de escribir una sola fila ──
  foreach v_id in array v_ids loop
    select * into v_game from public.games where id = v_id;
    if not found then raise exception 'GAME_NOT_FOUND:%', v_id; end if;

    -- El gemelo que veiamos al bloquear tiene que seguir siendo el mismo. Si
    -- aparecio uno despues de leer y antes del lock, no esta bloqueado: abortar
    -- es mas seguro que tomarlo ahora fuera de orden.
    v_twin := v_game.alternative_game_id;
    if v_twin is not null and not (v_twin = any(v_lock)) then
      raise exception 'DOUBLE_OUT_RACE:%', v_id;
    end if;
    if v_twin is not null then
      select alternative_game_id into v_t_alt from public.games where id = v_twin;
      if v_t_alt is distinct from v_id then raise exception 'DOUBLE_OUT_LINK_BROKEN:%', v_id; end if;
      -- Los dos lados de una doble salida son LA MISMA hora fisica. Elegir los
      -- dos no es contratar dos bloques: es pedir el mismo dos veces. Se corta
      -- aqui, con un error que se entiende, en vez de dejar que el segundo
      -- fracase contra el gemelo que acaba de sellar el primero.
      if v_twin = any(v_ids) then raise exception 'TWIN_PAIR_SELECTED:%', v_id; end if;
    end if;

    -- La regla de reservabilidad es la del checkout, no una propia. Se
    -- re-etiqueta con el uuid para que la pantalla sepa que bloque señalar.
    begin
      perform public.assert_game_reservable(v_id, 'rental');
    exception
      when others then
        raise exception 'GAME_NOT_AVAILABLE:%', v_id using detail = sqlerrm;
    end;

    if v_game.status <> 'published'
       or v_game.booked_by_user_id is not null
       or v_game.championship_id is not null then
      raise exception 'GAME_NOT_AVAILABLE:%', v_id;
    end if;
    if exists (select 1 from public.championship_reservation_games l where l.game_id = v_id) then
      raise exception 'GAME_NOT_AVAILABLE:%', v_id;
    end if;

    -- Un pago en curso va por delante, aunque quien pulse sea Admin. El trigger
    -- de doble salida no ve pendings —solo estados—, asi que el del gemelo se
    -- mira aparte: es la misma hora.
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then
      raise exception 'PAYMENT_IN_PROGRESS:%', v_id;
    end if;
    if v_twin is not null and exists (
      select 1 from public.orders o
       where o.resource_id = v_twin and o.status = 'pending' and o.pending_expires_at > now()
    ) then
      raise exception 'PAYMENT_IN_PROGRESS:%', v_id;
    end if;

    if v_game.price_total is null then raise exception 'PRICE_UNKNOWN:%', v_id; end if;
  end loop;

  -- ── Reclamar ──
  foreach v_id in array v_ids loop
    -- `published -> reserved` + championship_id, con el CAS dentro de la propia
    -- sentencia. `booked_by_user_id` se queda NULL a proposito: la cancha es del
    -- campeonato, no el alquiler personal de nadie.
    --
    -- Este UPDATE dispara `trg_block_double_out_twin`, que sella el gemelo o
    -- aborta con ALTERNATIVE_TAKEN si ya estaba tomado.
    update public.games
       set status = 'reserved', championship_id = p_championship_id
     where id = v_id
       and status = 'published'
       and booked_by_user_id is null
       and championship_id is null
    returning id into v_taken;
    if v_taken is null then raise exception 'GAME_NOT_AVAILABLE:%', v_id; end if;

    insert into public.championship_reservation_games (championship_id, game_id)
    values (p_championship_id, v_id);
  end loop;

  return v_ids;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_claim_games"(uuid, uuid[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_compute_price (
  p_game_ids uuid[],
  p_group_id text,
  p_extras   jsonb  DEFAULT '[]'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_ids            uuid[];
  v_count          integer;   -- rental_count (informativo; NO participa en referee/fee)
  v_venue_id       uuid;
  v_venue_n        integer;
  v_city           text;
  v_event_date     date;
  v_date_n         integer;
  v_set            public.championship_settings%rowtype;
  v_fmt            jsonb;
  v_service_hours  integer;
  v_group_min      integer;
  v_group_max      integer;
  v_lead_rule      jsonb;
  v_lead_days      integer;
  v_lead_n         integer;
  v_r              jsonb;
  v_rmin           numeric;
  v_rmax           numeric;
  v_rdays          numeric;
  v_cat            jsonb;
  v_found          boolean;
  v_court_amount   numeric := 0;
  v_referee_amount numeric := 0;
  v_referee_sel    boolean := false;   -- ¿el cliente pidió árbitro? (p_extras contiene {code:'referee', quantity>=1})
  v_fee_amount     numeric := 0;
  v_extras_amount  numeric := 0;
  v_extras_out     jsonb   := '[]'::jsonb;
  v_ex             jsonb;
  v_code           text;
  v_qty            integer;
  v_unit_price     numeric;
  v_units          integer;
  v_min            integer;
  v_max            integer;
  v_name           text;
  v_amt            numeric;
  v_reg_close      timestamptz;
  v_today_lima     date := (now() at time zone 'America/Lima')::date;
begin
  -- Dedupe (game.id duplicados NO se cuentan dos veces).
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  -- Todos existen y son rentals. (NO se exige duration_min=60; los rentals van ENTEROS.)
  if (select count(*) from public.games where id = any(v_ids)) <> v_count then raise exception 'GAME_NOT_FOUND'; end if;
  if exists (select 1 from public.games where id = any(v_ids) and type <> 'rental') then raise exception 'NOT_RENTAL'; end if;

  -- Precio requerido (NULL → sin precio → abortar, sin subcotizar).
  if exists (select 1 from public.games where id = any(v_ids) and price_total is null) then
    raise exception 'CHAMPIONSHIP_PRICE_UNAVAILABLE';
  end if;

  -- Venue ÚNICO (games → fields → venues). city derivada del venue real (NO del cliente).
  -- FIX 42883: Postgres no tiene min()/max() para uuid → se toma el representante con array_agg(distinct)[1].
  -- La unicidad la garantiza el check v_venue_n>1 (MULTIPLE_VENUES) inmediatamente debajo.
  select count(distinct v.id), (array_agg(distinct v.id))[1]
    into v_venue_n, v_venue_id
    from public.games g
    join public.fields f on f.id = g.field_id
    join public.venues v on v.id = f.venue_id
   where g.id = any(v_ids);
  if v_venue_n is null or v_venue_n = 0 or v_venue_id is null then raise exception 'GAME_NOT_FOUND'; end if;
  if v_venue_n > 1 then raise exception 'MULTIPLE_VENUES'; end if;
  select city into v_city from public.venues where id = v_venue_id;
  if v_city is null then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- Fecha de evento única (derivada de games). date_key es text → min(text) es válido (no se toca).
  select count(distinct date_key), min(date_key) into v_date_n, v_event_date
    from public.games where id = any(v_ids);
  if v_date_n > 1 then raise exception 'MULTIPLE_DATES'; end if;

  -- Settings de la ciudad (SIN default oculto).
  select * into v_set from public.championship_settings where city = v_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- BLOQUEOS DE DISPONIBILIDAD (Championship): si algún game seleccionado se solapa con un availability_block
  -- vigente de la ciudad → aborta. Misma regla que la UX; los bloqueos se leen server-side (no del cliente).
  perform public._championship_assert_not_blocked(v_ids, v_set.availability_blocks, v_event_date);

  -- Perfil del FORMATO (AUTORIDAD BACKEND): service_court_hours + rango de equipos desde availability_formats[group_id].
  -- El cliente solo elige group_id; NUNCA envía service_court_hours ni min/max de equipos.
  -- Lectura DEFENSIVA (jsonb_typeof antes de castear → nunca un cast genérico de Postgres como error).
  v_fmt := v_set.availability_formats -> p_group_id;
  if v_fmt is null or jsonb_typeof(v_fmt) <> 'object'
     or jsonb_typeof(v_fmt->'service_court_hours') <> 'number'
     or jsonb_typeof(v_fmt->'min_teams') <> 'number'
     or jsonb_typeof(v_fmt->'max_teams') <> 'number' then
    raise exception 'CHAMPIONSHIP_FORMAT_UNAVAILABLE';
  end if;
  v_service_hours := floor((v_fmt->>'service_court_hours')::numeric)::int;
  v_group_min     := floor((v_fmt->>'min_teams')::numeric)::int;
  v_group_max     := floor((v_fmt->>'max_teams')::numeric)::int;
  if v_service_hours <= 0 or v_group_min < 1 or v_group_max < v_group_min then
    raise exception 'CHAMPIONSHIP_FORMAT_UNAVAILABLE';
  end if;

  -- Anticipación mínima POR RANGO DE EQUIPOS: EXACTAMENTE una booking_lead_rule bien formada que CONTENGA
  -- [group_min, group_max]. En esta etapa NO conocemos el nº final de equipos (se sabrá al cerrar inscripciones);
  -- se resuelve por el rango del formato, NO por team_count. Regla válida = object con min/max/days enteros,
  -- min≥1, max≥min, days≥0. Reglas malformadas se ignoran; 0 o ambigua → error explícito (nunca cast genérico).
  if v_set.booking_lead_rules is null or jsonb_typeof(v_set.booking_lead_rules) <> 'array' then
    raise exception 'CHAMPIONSHIP_BOOKING_LEAD_CONFIG_UNAVAILABLE';
  end if;
  v_lead_n := 0;
  v_lead_rule := null;
  for v_r in select value from jsonb_array_elements(v_set.booking_lead_rules) as t(value) loop
    if jsonb_typeof(v_r) <> 'object'
       or jsonb_typeof(v_r->'min_teams') <> 'number'
       or jsonb_typeof(v_r->'max_teams') <> 'number'
       or jsonb_typeof(v_r->'days') <> 'number' then
      continue;
    end if;
    v_rmin  := (v_r->>'min_teams')::numeric;
    v_rmax  := (v_r->>'max_teams')::numeric;
    v_rdays := (v_r->>'days')::numeric;
    if v_rmin <> trunc(v_rmin) or v_rmax <> trunc(v_rmax) or v_rdays <> trunc(v_rdays) then continue; end if;  -- enteros
    if v_rmin < 1 or v_rmax < v_rmin or v_rdays < 0 then continue; end if;
    if v_rmin <= v_group_min and v_group_max <= v_rmax then                                                   -- contiene el rango
      v_lead_n := v_lead_n + 1;
      v_lead_rule := jsonb_build_object('min_teams', v_rmin::int, 'max_teams', v_rmax::int, 'days', v_rdays::int);
    end if;
  end loop;
  if v_lead_n <> 1 or v_lead_rule is null then raise exception 'CHAMPIONSHIP_BOOKING_LEAD_CONFIG_UNAVAILABLE'; end if;
  v_lead_days := (v_lead_rule->>'days')::int;

  -- event_date >= HOY_LIMA + booking_lead_days (America/Lima).
  if v_event_date < v_today_lima + v_lead_days then raise exception 'BOOKING_LEAD_NOT_MET'; end if;

  -- COURT = Σ precio real de los rentals físicos únicos (ENTEROS, sin importar su duración).
  select coalesce(sum(price_total), 0) into v_court_amount from public.games where id = any(v_ids);
  -- FEE por HORAS-CANCHA DE SERVICIO del formato (NO por rental_count ni duración). Sigue siendo obligatorio.
  v_fee_amount := round(v_service_hours * v_set.algrass_fee_hourly_rate, 2);
  -- REFEREE: ahora OPCIONAL. Se calcula DESPUÉS del bucle de extras, según si se pidió {code:'referee'}.

  -- EXTRAS: catálogo en settings.extras. Sin duplicados por code; qty=0 se omite; qty≥1 dentro de [min,max];
  -- amount = quantity × unit_price. El cliente manda solo {code, quantity}; el precio/límites los pone el backend.
  -- ÁRBITRO ('referee') es un extra ESPECIAL por horas → se detecta aquí y se EXCLUYE del catálogo genérico.
  if p_extras is not null and jsonb_typeof(p_extras) = 'array' then
    if (select count(*) from jsonb_array_elements(p_extras) e) <>
       (select count(distinct e->>'code') from jsonb_array_elements(p_extras) e) then
      raise exception 'DUPLICATE_EXTRA';
    end if;
    for v_ex in select value from jsonb_array_elements(p_extras) as t(value) loop
      v_code := v_ex->>'code';
      -- quantity del cliente: si no es número → 0 (se omite), nunca cast genérico.
      v_qty  := case when jsonb_typeof(v_ex->'quantity') = 'number' then floor((v_ex->>'quantity')::numeric)::int else 0 end;
      if v_qty <= 0 then continue; end if;   -- quantity=0/inválida se omite
      -- ÁRBITRO: extra especial por horas → marca la selección y NO se busca en el catálogo genérico ni se
      -- cobra por unit_price × quantity (su monto se calcula abajo con service_court_hours × referee_hourly_rate).
      if v_code = 'referee' then v_referee_sel := true; continue; end if;
      -- Buscar en el catálogo un extra ACTIVO y BIEN FORMADO con ese code (defensivo: jsonb_typeof antes de castear).
      v_found := false;
      for v_cat in select value from jsonb_array_elements(v_set.extras) as t(value) loop
        if jsonb_typeof(v_cat) <> 'object' or (v_cat->>'code') is distinct from v_code then continue; end if;
        if jsonb_typeof(v_cat->'active') <> 'boolean' or (v_cat->>'active')::boolean is not true then continue; end if; -- inactivo/mal formado
        if jsonb_typeof(v_cat->'unit_price') <> 'number' or jsonb_typeof(v_cat->'units_per_item') <> 'number'
           or jsonb_typeof(v_cat->'min_quantity') <> 'number' or jsonb_typeof(v_cat->'max_quantity') <> 'number' then continue; end if;
        v_unit_price := (v_cat->>'unit_price')::numeric;
        v_units      := floor((v_cat->>'units_per_item')::numeric)::int;
        v_min        := floor((v_cat->>'min_quantity')::numeric)::int;
        v_max        := floor((v_cat->>'max_quantity')::numeric)::int;
        if v_unit_price < 0 or v_units < 1 or v_min < 1 or v_max < v_min then continue; end if;  -- config rota → no ofertable
        v_name := coalesce(v_cat->>'name', v_code);
        v_found := true;
        exit;
      end loop;
      -- Extra inexistente / inactivo / mal configurado → error explícito (NO subcotizar silenciosamente).
      if not v_found then raise exception 'EXTRA_NOT_AVAILABLE: %', coalesce(v_code, '(null)'); end if;
      if v_qty < v_min or v_qty > v_max then
        raise exception 'EXTRA_QUANTITY_OUT_OF_RANGE: % (%..%)', coalesce(v_code, '(null)'), v_min, v_max;
      end if;
      v_amt := round(v_qty * v_unit_price, 2);
      v_extras_amount := v_extras_amount + v_amt;
      v_extras_out := v_extras_out || jsonb_build_object(
        'code', v_code, 'name', v_name,
        'quantity', v_qty, 'units_per_item', v_units, 'total_units', v_qty * v_units,
        'unit_price', v_unit_price, 'amount', v_amt);
    end loop;
  end if;

  -- REFEREE (opcional): seleccionado → service_court_hours × referee_hourly_rate; no seleccionado → 0.
  v_referee_amount := case when v_referee_sel then round(v_service_hours * v_set.referee_hourly_rate, 2) else 0 end;

  -- Cierre de inscripciones = fin del día (23:59:59 Lima) de (event_date − registration_close_days).
  v_reg_close := ((v_event_date - v_set.registration_close_days)::timestamp at time zone 'America/Lima')
                 + interval '1 day' - interval '1 second';

  return jsonb_build_object(
    'city',                    v_city,
    'currency',                v_set.currency,
    'venue_id',                v_venue_id,
    'event_date',              to_char(v_event_date, 'YYYY-MM-DD'),
    'group_id',                p_group_id,
    'service_court_hours',     v_service_hours,
    'team_range',              jsonb_build_object('min_teams', v_group_min, 'max_teams', v_group_max),
    'booking_lead_rule',       jsonb_build_object('min_teams', (v_lead_rule->>'min_teams')::int, 'max_teams', (v_lead_rule->>'max_teams')::int, 'days', v_lead_days),
    'booking_lead_days',       v_lead_days,
    'registration_close_days', v_set.registration_close_days,
    'registration_closes_at',  v_reg_close,
    'court_amount',            round(v_court_amount, 2),
    'referee_hourly_rate',     v_set.referee_hourly_rate,
    'referee_amount',          v_referee_amount,
    'algrass_fee_hourly_rate', v_set.algrass_fee_hourly_rate,
    'algrass_fee_amount',      v_fee_amount,
    'extras',                  v_extras_out,
    'extras_amount',           round(v_extras_amount, 2),
    'amount_total',            round(v_court_amount + v_referee_amount + v_fee_amount + v_extras_amount, 2),
    'rental_count',            v_count,                      -- informativo (no participa en referee/fee)
    'game_ids',                to_jsonb(v_ids)
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."_championship_compute_price"(uuid[], text, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_concepts (
  p_championship_id uuid
)
  RETURNS TABLE (
    order_id        uuid,
    spend_id        uuid,
    payee_user_id   uuid,
    kind            text,
    code            text,
    game_id         uuid,
    quantity        numeric,
    amount          numeric,
    refund_key      text,
    refund_id       uuid,
    refunded_amount numeric,
    refunded_at     timestamp with time zone,
    settled_by      text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  return query
  with pagado as (
    -- La autoridad de «esto se cobró» es el asiento, no el order: un order sin
    -- asiento es un cobro que no llegó a ocurrir.
    select r.id                                   as spend_id,
           r.order_id                             as order_id,
           coalesce(o.payer_user_id, r.user_id)   as payee,
           coalesce(r.subtotal_amount, r.total_amount, 0) as pagado,   -- BRUTO = subtotal_amount
           coalesce(o.financial_snapshot, '{}'::jsonb)    as snap,
           coalesce(o.claim_composition, '{}'::jsonb)     as comp
      from public.reservations r
      left join public.orders o on o.id = r.order_id
     where r.championship_id = p_championship_id
       and r.status = 'spend'
  ),
  conceptos as (
    -- Una cancha comprada de una en una: su importe está congelado en su propio
    -- order, así que cancelarla no necesita que nadie decida cuánto.
    select p.order_id, p.spend_id, p.payee, 'court'::text as kind, null::text as code,
           nullif(p.snap->>'game_id', '')::uuid as game_id,
           1::numeric as quantity,
           round(coalesce((p.snap->>'price_total')::numeric, p.pagado), 2) as amount
      from pagado p
     where p.comp->>'kind' = 'championship_extra_court'

    union all

    -- El bloque de canchas de la contratación inicial. Va junto porque se cobró
    -- junto: `court_amount` en el desglose del App, `courts_amount` en el de
    -- Admin. Cancelar UNA de estas canchas necesita un importe explícito.
    select p.order_id, p.spend_id, p.payee, 'courts', null, null,
           coalesce(jsonb_array_length(
             case when jsonb_typeof(p.comp->'game_ids') = 'array'
                  then p.comp->'game_ids' else '[]'::jsonb end), 0)::numeric,
           round(coalesce((p.snap->>'court_amount')::numeric,
                          (p.snap->>'courts_amount')::numeric, 0), 2)
      from pagado p
     where coalesce(p.comp->>'kind', '') <> 'championship_extra_court'
       and coalesce((p.snap->>'court_amount')::numeric,
                    (p.snap->>'courts_amount')::numeric, 0) > 0

    union all

    -- Los extras, línea a línea, tal como quedaron congelados. El árbitro de
    -- Admin viene aquí dentro, como una línea más con `code='referee'`.
    select p.order_id, p.spend_id, p.payee, 'extra', e->>'code', null,
           coalesce((e->>'quantity')::numeric, 1),
           round(coalesce((e->>'amount')::numeric, 0), 2)
      from pagado p,
           jsonb_array_elements(
             case when jsonb_typeof(p.snap->'extras') = 'array'
                  then p.snap->'extras' else '[]'::jsonb end) e
     where coalesce((e->>'amount')::numeric, 0) > 0

    union all

    -- El árbitro del App, que viaja FUERA de `extras` y en su propia clave. Se
    -- añade solo si no hay ya una línea de árbitro, para no contarlo dos veces.
    select p.order_id, p.spend_id, p.payee, 'extra', 'referee', null,
           coalesce((p.snap->>'service_court_hours')::numeric, 1),
           round((p.snap->>'referee_amount')::numeric, 2)
      from pagado p
     where coalesce((p.snap->>'referee_amount')::numeric, 0) > 0
       and not exists (
         select 1 from jsonb_array_elements(
                        case when jsonb_typeof(p.snap->'extras') = 'array'
                             then p.snap->'extras' else '[]'::jsonb end) e
          where e->>'code' = 'referee')

    union all

    -- El fee de AlGrass. Se enseña porque forma parte de lo cobrado, y NO se
    -- cancela por separado: no es un servicio que se pueda quitar del pedido.
    -- Vuelve dentro de una cancelación completa, como todo lo demás.
    select p.order_id, p.spend_id, p.payee, 'fee', null, null, 1,
           round(coalesce((p.snap->>'algrass_fee_amount')::numeric, 0), 2)
      from pagado p
     where coalesce((p.snap->>'algrass_fee_amount')::numeric, 0) > 0
  ),
  con_clave as (
    select c.*,
           case c.kind
             when 'extra' then 'extra:' || c.order_id::text || ':' || coalesce(c.code, '?')
             when 'court' then 'court:' || p_championship_id::text || ':' || coalesce(c.game_id::text, '?')
             else c.kind || ':' || c.order_id::text
           end as refund_key
      from conceptos c
  )
  select k.order_id, k.spend_id, k.payee, k.kind, k.code, k.game_id,
         k.quantity, k.amount, k.refund_key,
         -- El movimiento que saldó este concepto: el suyo si lo hubo, y si no el
         -- de la cancelación completa de su asiento.
         coalesce(r.id, f.id),
         case when r.id is not null then coalesce(r.total_amount, 0)
              -- Barrido: la fila `full` no trae desglose, así que al concepto se
              -- le atribuye su propio importe congelado. Es lo que se devolvió de
              -- él, porque la completa cubrió todo el resto del asiento.
              when f.id is not null then k.amount
              else 0 end,
         coalesce(r.canceled_at, f.canceled_at),
         case when r.id is not null then 'self'
              when f.id is not null then 'full'
              else null end
    from con_clave k
    left join public.reservations r
           on r.status = 'refund'
          and r.refund_scope->>'key' = k.refund_key
    -- Una sola por asiento: la clave `full:<spend_id>` es única, así que este
    -- join no puede multiplicar filas.
    left join public.reservations f
           on f.status = 'refund'
          and f.refund_of_reservation_id = k.spend_id
          and f.refund_scope->>'kind' = 'full'
   order by k.order_id, k.kind, k.code nulls first, k.game_id;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_concepts"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_eligible_teams (
  p_championship_id uuid
)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select t.id
    from public.championship_teams t
   where t.championship_id = p_championship_id
   order by t.created_at, t.id;
$function$;

CREATE OR REPLACE FUNCTION public._championship_fixture_template (
  p_teams integer
)
  RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select case p_teams
    when 2 then '{"teams":2,"courts":1,"groups":[2],"max_courts":1,"span_min":15,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":null,"a":"A","b":"B"}]}'::jsonb
    when 3 then '{"teams":3,"courts":1,"groups":[3],"max_courts":1,"span_min":55,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":null,"a":"A","b":"B"},{"order":2,"court":0,"from":20,"to":35,"stage":"group","group_code":null,"a":"A","b":"C"},{"order":3,"court":0,"from":40,"to":55,"stage":"group","group_code":null,"a":"B","b":"C"}]}'::jsonb
    when 4 then '{"teams":4,"courts":2,"groups":[4],"max_courts":2,"span_min":105,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":null,"a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":null,"a":"C","b":"D"},{"order":3,"court":0,"from":20,"to":35,"stage":"group","group_code":null,"a":"A","b":"C"},{"order":4,"court":1,"from":20,"to":35,"stage":"group","group_code":null,"a":"B","b":"D"},{"order":5,"court":0,"from":40,"to":55,"stage":"group","group_code":null,"a":"A","b":"D"},{"order":6,"court":1,"from":40,"to":55,"stage":"group","group_code":null,"a":"B","b":"C"},{"order":7,"court":0,"from":70,"to":85,"stage":"third_place","group_code":null,"a":null,"b":null},{"order":8,"court":0,"from":90,"to":105,"stage":"final","group_code":null,"a":null,"b":null}]}'::jsonb
    when 5 then '{"teams":5,"courts":2,"groups":[5],"max_courts":2,"span_min":120,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":null,"a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":null,"a":"C","b":"D"},{"order":3,"court":0,"from":20,"to":35,"stage":"group","group_code":null,"a":"A","b":"E"},{"order":4,"court":1,"from":20,"to":35,"stage":"group","group_code":null,"a":"B","b":"C"},{"order":5,"court":0,"from":40,"to":55,"stage":"group","group_code":null,"a":"D","b":"E"},{"order":6,"court":1,"from":40,"to":55,"stage":"group","group_code":null,"a":"A","b":"C"},{"order":7,"court":0,"from":60,"to":75,"stage":"group","group_code":null,"a":"B","b":"D"},{"order":8,"court":1,"from":60,"to":75,"stage":"group","group_code":null,"a":"C","b":"E"},{"order":9,"court":0,"from":80,"to":95,"stage":"group","group_code":null,"a":"A","b":"D"},{"order":10,"court":1,"from":80,"to":95,"stage":"group","group_code":null,"a":"B","b":"E"},{"order":11,"court":0,"from":105,"to":120,"stage":"final","group_code":null,"a":null,"b":null},{"order":12,"court":1,"from":105,"to":120,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 6 then '{"teams":6,"courts":2,"groups":[6],"max_courts":2,"span_min":120,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":null,"a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":null,"a":"C","b":"D"},{"order":3,"court":0,"from":20,"to":35,"stage":"group","group_code":null,"a":"E","b":"F"},{"order":4,"court":1,"from":20,"to":35,"stage":"group","group_code":null,"a":"A","b":"C"},{"order":5,"court":0,"from":40,"to":55,"stage":"group","group_code":null,"a":"B","b":"E"},{"order":6,"court":1,"from":40,"to":55,"stage":"group","group_code":null,"a":"D","b":"F"},{"order":7,"court":0,"from":60,"to":75,"stage":"group","group_code":null,"a":"A","b":"D"},{"order":8,"court":1,"from":60,"to":75,"stage":"group","group_code":null,"a":"C","b":"E"},{"order":9,"court":0,"from":80,"to":95,"stage":"group","group_code":null,"a":"B","b":"F"},{"order":10,"court":0,"from":105,"to":120,"stage":"final","group_code":null,"a":null,"b":null},{"order":11,"court":1,"from":105,"to":120,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 7 then '{"teams":7,"courts":3,"groups":[7],"max_courts":3,"span_min":120,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":null,"a":"A","b":"C"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":null,"a":"B","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":null,"a":"E","b":"G"},{"order":4,"court":0,"from":20,"to":35,"stage":"group","group_code":null,"a":"A","b":"D"},{"order":5,"court":1,"from":20,"to":35,"stage":"group","group_code":null,"a":"B","b":"E"},{"order":6,"court":2,"from":20,"to":35,"stage":"group","group_code":null,"a":"C","b":"F"},{"order":7,"court":0,"from":40,"to":55,"stage":"group","group_code":null,"a":"A","b":"E"},{"order":8,"court":1,"from":40,"to":55,"stage":"group","group_code":null,"a":"B","b":"F"},{"order":9,"court":2,"from":40,"to":55,"stage":"group","group_code":null,"a":"D","b":"G"},{"order":10,"court":0,"from":60,"to":75,"stage":"group","group_code":null,"a":"A","b":"F"},{"order":11,"court":1,"from":60,"to":75,"stage":"group","group_code":null,"a":"B","b":"G"},{"order":12,"court":2,"from":60,"to":75,"stage":"group","group_code":null,"a":"C","b":"E"},{"order":13,"court":0,"from":80,"to":95,"stage":"group","group_code":null,"a":"C","b":"G"},{"order":14,"court":1,"from":80,"to":95,"stage":"group","group_code":null,"a":"D","b":"F"},{"order":15,"court":0,"from":105,"to":120,"stage":"final","group_code":null,"a":null,"b":null},{"order":16,"court":1,"from":105,"to":120,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 8 then '{"teams":8,"courts":3,"groups":[4,4],"max_courts":3,"span_min":120,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G2","a":"E","b":"F"},{"order":4,"court":0,"from":20,"to":35,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":5,"court":1,"from":20,"to":35,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":6,"court":2,"from":20,"to":35,"stage":"group","group_code":"G1","a":"B","b":"D"},{"order":7,"court":0,"from":40,"to":55,"stage":"group","group_code":"G2","a":"E","b":"G"},{"order":8,"court":1,"from":40,"to":55,"stage":"group","group_code":"G2","a":"F","b":"H"},{"order":9,"court":2,"from":40,"to":55,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":10,"court":0,"from":60,"to":75,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":11,"court":1,"from":60,"to":75,"stage":"group","group_code":"G2","a":"E","b":"H"},{"order":12,"court":2,"from":60,"to":75,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":13,"court":0,"from":80,"to":95,"stage":"semifinal","group_code":null,"a":null,"b":null},{"order":14,"court":1,"from":80,"to":95,"stage":"semifinal","group_code":null,"a":null,"b":null},{"order":15,"court":0,"from":105,"to":120,"stage":"final","group_code":null,"a":null,"b":null},{"order":16,"court":1,"from":105,"to":120,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 9 then '{"teams":9,"courts":3,"groups":[5,4],"max_courts":3,"span_min":145,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"B","b":"E"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G2","a":"F","b":"I"},{"order":4,"court":0,"from":20,"to":35,"stage":"group","group_code":"G1","a":"A","b":"E"},{"order":5,"court":1,"from":20,"to":35,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":6,"court":2,"from":20,"to":35,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":7,"court":0,"from":40,"to":55,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":8,"court":1,"from":40,"to":55,"stage":"group","group_code":"G1","a":"E","b":"C"},{"order":9,"court":2,"from":40,"to":55,"stage":"group","group_code":"G2","a":"F","b":"H"},{"order":10,"court":0,"from":60,"to":75,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":11,"court":1,"from":60,"to":75,"stage":"group","group_code":"G1","a":"D","b":"B"},{"order":12,"court":2,"from":60,"to":75,"stage":"group","group_code":"G2","a":"I","b":"G"},{"order":13,"court":0,"from":80,"to":95,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":14,"court":1,"from":80,"to":95,"stage":"group","group_code":"G1","a":"D","b":"E"},{"order":15,"court":0,"from":100,"to":115,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":16,"court":1,"from":100,"to":115,"stage":"group","group_code":"G2","a":"H","b":"I"},{"order":17,"court":0,"from":130,"to":145,"stage":"final","group_code":null,"a":null,"b":null},{"order":18,"court":1,"from":130,"to":145,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 10 then '{"teams":10,"courts":3,"groups":[5,5],"max_courts":3,"span_min":155,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":4,"court":0,"from":20,"to":35,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":5,"court":1,"from":20,"to":35,"stage":"group","group_code":"G1","a":"B","b":"E"},{"order":6,"court":2,"from":20,"to":35,"stage":"group","group_code":"G2","a":"H","b":"I"},{"order":7,"court":0,"from":40,"to":55,"stage":"group","group_code":"G1","a":"D","b":"E"},{"order":8,"court":1,"from":40,"to":55,"stage":"group","group_code":"G2","a":"F","b":"H"},{"order":9,"court":2,"from":40,"to":55,"stage":"group","group_code":"G2","a":"G","b":"J"},{"order":10,"court":0,"from":60,"to":75,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":11,"court":1,"from":60,"to":75,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":12,"court":2,"from":60,"to":75,"stage":"group","group_code":"G2","a":"I","b":"J"},{"order":13,"court":0,"from":80,"to":95,"stage":"group","group_code":"G2","a":"F","b":"I"},{"order":14,"court":1,"from":80,"to":95,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":15,"court":2,"from":80,"to":95,"stage":"group","group_code":"G1","a":"A","b":"E"},{"order":16,"court":0,"from":100,"to":115,"stage":"group","group_code":"G1","a":"B","b":"D"},{"order":17,"court":1,"from":100,"to":115,"stage":"group","group_code":"G2","a":"F","b":"J"},{"order":18,"court":2,"from":100,"to":115,"stage":"group","group_code":"G2","a":"G","b":"I"},{"order":19,"court":0,"from":120,"to":135,"stage":"group","group_code":"G1","a":"C","b":"E"},{"order":20,"court":1,"from":120,"to":135,"stage":"group","group_code":"G2","a":"H","b":"J"},{"order":21,"court":0,"from":140,"to":155,"stage":"final","group_code":null,"a":null,"b":null},{"order":22,"court":1,"from":140,"to":155,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 11 then '{"teams":11,"courts":3,"groups":[4,7],"max_courts":3,"span_min":165,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G2","a":"E","b":"F"},{"order":4,"court":0,"from":20,"to":35,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":5,"court":1,"from":20,"to":35,"stage":"group","group_code":"G1","a":"B","b":"D"},{"order":6,"court":2,"from":20,"to":35,"stage":"group","group_code":"G2","a":"E","b":"G"},{"order":7,"court":0,"from":40,"to":55,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":8,"court":1,"from":40,"to":55,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":9,"court":2,"from":40,"to":55,"stage":"group","group_code":"G2","a":"E","b":"H"},{"order":10,"court":0,"from":60,"to":75,"stage":"group","group_code":"G2","a":"E","b":"I"},{"order":11,"court":1,"from":60,"to":75,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":12,"court":2,"from":60,"to":75,"stage":"group","group_code":"G2","a":"J","b":"K"},{"order":13,"court":0,"from":80,"to":95,"stage":"group","group_code":"G2","a":"F","b":"J"},{"order":14,"court":1,"from":80,"to":95,"stage":"group","group_code":"G2","a":"G","b":"K"},{"order":15,"court":2,"from":80,"to":95,"stage":"group","group_code":"G2","a":"H","b":"I"},{"order":16,"court":0,"from":100,"to":115,"stage":"group","group_code":"G2","a":"F","b":"K"},{"order":17,"court":1,"from":100,"to":115,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":18,"court":2,"from":100,"to":115,"stage":"group","group_code":"G2","a":"I","b":"J"},{"order":19,"court":0,"from":120,"to":135,"stage":"group","group_code":"G2","a":"H","b":"J"},{"order":20,"court":1,"from":120,"to":135,"stage":"group","group_code":"G2","a":"I","b":"K"},{"order":21,"court":0,"from":150,"to":165,"stage":"final","group_code":null,"a":null,"b":null},{"order":22,"court":1,"from":150,"to":165,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 12 then '{"teams":12,"courts":3,"groups":[4,4,4],"max_courts":3,"span_min":175,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G2","a":"E","b":"F"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G3","a":"I","b":"J"},{"order":4,"court":0,"from":20,"to":35,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":5,"court":1,"from":20,"to":35,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":6,"court":2,"from":20,"to":35,"stage":"group","group_code":"G3","a":"K","b":"L"},{"order":7,"court":0,"from":40,"to":55,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":8,"court":1,"from":40,"to":55,"stage":"group","group_code":"G2","a":"E","b":"G"},{"order":9,"court":2,"from":40,"to":55,"stage":"group","group_code":"G3","a":"I","b":"K"},{"order":10,"court":0,"from":60,"to":75,"stage":"group","group_code":"G1","a":"B","b":"D"},{"order":11,"court":1,"from":60,"to":75,"stage":"group","group_code":"G2","a":"F","b":"H"},{"order":12,"court":2,"from":60,"to":75,"stage":"group","group_code":"G3","a":"J","b":"L"},{"order":13,"court":0,"from":80,"to":95,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":14,"court":1,"from":80,"to":95,"stage":"group","group_code":"G2","a":"E","b":"H"},{"order":15,"court":2,"from":80,"to":95,"stage":"group","group_code":"G3","a":"I","b":"L"},{"order":16,"court":0,"from":100,"to":115,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":17,"court":1,"from":100,"to":115,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":18,"court":2,"from":100,"to":115,"stage":"group","group_code":"G3","a":"J","b":"K"},{"order":19,"court":0,"from":130,"to":145,"stage":"semifinal","group_code":null,"a":null,"b":null},{"order":20,"court":1,"from":130,"to":145,"stage":"semifinal","group_code":null,"a":null,"b":null},{"order":21,"court":0,"from":160,"to":175,"stage":"final","group_code":null,"a":null,"b":null},{"order":22,"court":1,"from":160,"to":175,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 13 then '{"teams":13,"courts":4,"groups":[5,4,4],"max_courts":4,"span_min":165,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"B","b":"E"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":4,"court":3,"from":0,"to":15,"stage":"group","group_code":"G2","a":"H","b":"I"},{"order":5,"court":0,"from":20,"to":35,"stage":"group","group_code":"G1","a":"A","b":"E"},{"order":6,"court":1,"from":20,"to":35,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":7,"court":2,"from":20,"to":35,"stage":"group","group_code":"G3","a":"J","b":"K"},{"order":8,"court":3,"from":20,"to":35,"stage":"group","group_code":"G3","a":"L","b":"M"},{"order":9,"court":0,"from":40,"to":55,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":10,"court":1,"from":40,"to":55,"stage":"group","group_code":"G1","a":"C","b":"E"},{"order":11,"court":2,"from":40,"to":55,"stage":"group","group_code":"G2","a":"F","b":"H"},{"order":12,"court":3,"from":40,"to":55,"stage":"group","group_code":"G2","a":"G","b":"I"},{"order":13,"court":0,"from":60,"to":75,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":14,"court":1,"from":60,"to":75,"stage":"group","group_code":"G1","a":"B","b":"D"},{"order":15,"court":2,"from":60,"to":75,"stage":"group","group_code":"G3","a":"J","b":"L"},{"order":16,"court":3,"from":60,"to":75,"stage":"group","group_code":"G3","a":"K","b":"M"},{"order":17,"court":0,"from":80,"to":95,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":18,"court":1,"from":80,"to":95,"stage":"group","group_code":"G1","a":"D","b":"E"},{"order":19,"court":2,"from":80,"to":95,"stage":"group","group_code":"G2","a":"F","b":"I"},{"order":20,"court":3,"from":80,"to":95,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":21,"court":0,"from":100,"to":115,"stage":"group","group_code":"G3","a":"J","b":"M"},{"order":22,"court":1,"from":100,"to":115,"stage":"group","group_code":"G3","a":"K","b":"L"},{"order":23,"court":0,"from":130,"to":145,"stage":"third_place","group_code":null,"a":null,"b":null},{"order":24,"court":0,"from":150,"to":165,"stage":"final","group_code":null,"a":null,"b":null}]}'::jsonb
    when 14 then '{"teams":14,"courts":4,"groups":[4,4,6],"max_courts":4,"span_min":165,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G2","a":"E","b":"F"},{"order":4,"court":3,"from":0,"to":15,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":5,"court":0,"from":20,"to":35,"stage":"group","group_code":"G3","a":"I","b":"J"},{"order":6,"court":1,"from":20,"to":35,"stage":"group","group_code":"G3","a":"K","b":"L"},{"order":7,"court":2,"from":20,"to":35,"stage":"group","group_code":"G3","a":"M","b":"N"},{"order":8,"court":0,"from":40,"to":55,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":9,"court":1,"from":40,"to":55,"stage":"group","group_code":"G1","a":"B","b":"D"},{"order":10,"court":2,"from":40,"to":55,"stage":"group","group_code":"G2","a":"E","b":"G"},{"order":11,"court":3,"from":40,"to":55,"stage":"group","group_code":"G2","a":"F","b":"H"},{"order":12,"court":0,"from":60,"to":75,"stage":"group","group_code":"G3","a":"I","b":"K"},{"order":13,"court":1,"from":60,"to":75,"stage":"group","group_code":"G3","a":"J","b":"M"},{"order":14,"court":2,"from":60,"to":75,"stage":"group","group_code":"G3","a":"L","b":"N"},{"order":15,"court":0,"from":80,"to":95,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":16,"court":1,"from":80,"to":95,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":17,"court":2,"from":80,"to":95,"stage":"group","group_code":"G2","a":"E","b":"H"},{"order":18,"court":3,"from":80,"to":95,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":19,"court":0,"from":100,"to":115,"stage":"group","group_code":"G3","a":"I","b":"L"},{"order":20,"court":1,"from":100,"to":115,"stage":"group","group_code":"G3","a":"J","b":"N"},{"order":21,"court":2,"from":100,"to":115,"stage":"group","group_code":"G3","a":"K","b":"M"},{"order":22,"court":0,"from":130,"to":145,"stage":"third_place","group_code":null,"a":null,"b":null},{"order":23,"court":0,"from":150,"to":165,"stage":"final","group_code":null,"a":null,"b":null}]}'::jsonb
    when 15 then '{"teams":15,"courts":4,"groups":[4,5,6],"max_courts":4,"span_min":165,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G2","a":"E","b":"F"},{"order":4,"court":3,"from":0,"to":15,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":5,"court":0,"from":20,"to":35,"stage":"group","group_code":"G3","a":"J","b":"K"},{"order":6,"court":1,"from":20,"to":35,"stage":"group","group_code":"G3","a":"L","b":"M"},{"order":7,"court":2,"from":20,"to":35,"stage":"group","group_code":"G3","a":"N","b":"O"},{"order":8,"court":3,"from":20,"to":35,"stage":"group","group_code":"G2","a":"E","b":"I"},{"order":9,"court":0,"from":40,"to":55,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":10,"court":1,"from":40,"to":55,"stage":"group","group_code":"G1","a":"B","b":"D"},{"order":11,"court":2,"from":40,"to":55,"stage":"group","group_code":"G2","a":"F","b":"H"},{"order":12,"court":3,"from":40,"to":55,"stage":"group","group_code":"G2","a":"G","b":"I"},{"order":13,"court":0,"from":60,"to":75,"stage":"group","group_code":"G3","a":"J","b":"L"},{"order":14,"court":1,"from":60,"to":75,"stage":"group","group_code":"G3","a":"K","b":"N"},{"order":15,"court":2,"from":60,"to":75,"stage":"group","group_code":"G3","a":"M","b":"O"},{"order":16,"court":3,"from":60,"to":75,"stage":"group","group_code":"G2","a":"E","b":"H"},{"order":17,"court":0,"from":80,"to":95,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":18,"court":1,"from":80,"to":95,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":19,"court":2,"from":80,"to":95,"stage":"group","group_code":"G2","a":"F","b":"I"},{"order":20,"court":3,"from":80,"to":95,"stage":"group","group_code":"G2","a":"G","b":"E"},{"order":21,"court":0,"from":100,"to":115,"stage":"group","group_code":"G3","a":"J","b":"M"},{"order":22,"court":1,"from":100,"to":115,"stage":"group","group_code":"G3","a":"K","b":"O"},{"order":23,"court":2,"from":100,"to":115,"stage":"group","group_code":"G3","a":"L","b":"N"},{"order":24,"court":3,"from":100,"to":115,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":25,"court":0,"from":120,"to":135,"stage":"group","group_code":"G2","a":"H","b":"I"},{"order":26,"court":0,"from":150,"to":165,"stage":"final","group_code":null,"a":null,"b":null},{"order":27,"court":1,"from":150,"to":165,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    when 16 then '{"teams":16,"courts":4,"groups":[4,4,4,4],"max_courts":4,"span_min":175,"matches":[{"order":1,"court":0,"from":0,"to":15,"stage":"group","group_code":"G1","a":"A","b":"B"},{"order":2,"court":1,"from":0,"to":15,"stage":"group","group_code":"G1","a":"C","b":"D"},{"order":3,"court":2,"from":0,"to":15,"stage":"group","group_code":"G2","a":"E","b":"F"},{"order":4,"court":3,"from":0,"to":15,"stage":"group","group_code":"G2","a":"G","b":"H"},{"order":5,"court":0,"from":20,"to":35,"stage":"group","group_code":"G3","a":"I","b":"J"},{"order":6,"court":1,"from":20,"to":35,"stage":"group","group_code":"G3","a":"K","b":"L"},{"order":7,"court":2,"from":20,"to":35,"stage":"group","group_code":"G4","a":"M","b":"N"},{"order":8,"court":3,"from":20,"to":35,"stage":"group","group_code":"G4","a":"O","b":"P"},{"order":9,"court":0,"from":40,"to":55,"stage":"group","group_code":"G1","a":"A","b":"C"},{"order":10,"court":1,"from":40,"to":55,"stage":"group","group_code":"G1","a":"B","b":"D"},{"order":11,"court":2,"from":40,"to":55,"stage":"group","group_code":"G2","a":"E","b":"G"},{"order":12,"court":3,"from":40,"to":55,"stage":"group","group_code":"G2","a":"F","b":"H"},{"order":13,"court":0,"from":60,"to":75,"stage":"group","group_code":"G3","a":"I","b":"K"},{"order":14,"court":1,"from":60,"to":75,"stage":"group","group_code":"G3","a":"J","b":"L"},{"order":15,"court":2,"from":60,"to":75,"stage":"group","group_code":"G4","a":"M","b":"O"},{"order":16,"court":3,"from":60,"to":75,"stage":"group","group_code":"G4","a":"N","b":"P"},{"order":17,"court":0,"from":80,"to":95,"stage":"group","group_code":"G1","a":"A","b":"D"},{"order":18,"court":1,"from":80,"to":95,"stage":"group","group_code":"G1","a":"B","b":"C"},{"order":19,"court":2,"from":80,"to":95,"stage":"group","group_code":"G2","a":"E","b":"H"},{"order":20,"court":3,"from":80,"to":95,"stage":"group","group_code":"G2","a":"F","b":"G"},{"order":21,"court":0,"from":100,"to":115,"stage":"group","group_code":"G3","a":"I","b":"L"},{"order":22,"court":1,"from":100,"to":115,"stage":"group","group_code":"G3","a":"J","b":"K"},{"order":23,"court":2,"from":100,"to":115,"stage":"group","group_code":"G4","a":"M","b":"P"},{"order":24,"court":3,"from":100,"to":115,"stage":"group","group_code":"G4","a":"N","b":"O"},{"order":25,"court":0,"from":130,"to":145,"stage":"semifinal","group_code":null,"a":null,"b":null},{"order":26,"court":1,"from":130,"to":145,"stage":"semifinal","group_code":null,"a":null,"b":null},{"order":27,"court":0,"from":160,"to":175,"stage":"final","group_code":null,"a":null,"b":null},{"order":28,"court":1,"from":160,"to":175,"stage":"third_place","group_code":null,"a":null,"b":null}]}'::jsonb
    else null
  end;
$function$;

CREATE OR REPLACE FUNCTION public._championship_hash_secret (
  p_secret text
)
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
  select crypt(p_secret, gen_salt('bf'));
$function$;

REVOKE ALL ON FUNCTION "public"."_championship_hash_secret"(text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_is_algrass_public (
  p_championship_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select coalesce((
    select c.order_id is null and (c.public_individual_price is not null or c.public_team_price is not null)
      from public.championships c where c.id = p_championship_id
  ), false)
$function$;

REVOKE ALL ON FUNCTION "public"."_championship_is_algrass_public"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_match_played (
  p_match_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select exists (
    select 1 from public.championship_matches m
     where m.id = p_match_id
       and (m.home_score is not null
            or m.away_score is not null
            or m.qualified_team_id is not null
            or exists (select 1 from public.championship_goals g where g.match_id = m.id))
  );
$function$;

REVOKE ALL ON FUNCTION "public"."_championship_match_played"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_order_restore_credit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_credito numeric;
begin
  if new.resource_type is distinct from 'championship' then return new; end if;

  v_credito := round(coalesce((old.financial_snapshot->>'credit_applied')::numeric, 0), 2);
  if v_credito <= 0 then return new; end if;

  -- Ya devuelto: no se repite. La marca vive en la propia orden, así que el
  -- seguro sobrevive a cualquier camino nuevo.
  if old.financial_snapshot ? 'credit_restored_at' then return new; end if;

  -- El inverso exacto del débito: `credit += X`, `reserved -= X`.
  perform public.apply_wallet_refund(
    coalesce(old.payer_user_id, new.payer_user_id), v_credito);

  new.financial_snapshot := jsonb_set(
    new.financial_snapshot, '{credit_restored_at}', to_jsonb(now()), true);

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public._championship_participation (
  p_championship_id uuid,
  p_user_id         uuid
)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_has  boolean;
  v_team uuid;
  v_paid boolean;
  v_own  boolean;
begin
  select true, cp.team_id into v_has, v_team
    from public.championship_players cp
   where cp.championship_id = p_championship_id and cp.user_id = p_user_id;
  if not coalesce(v_has, false) then return 'none'; end if;

  select exists (
    select 1 from public.orders o
     where o.resource_type = 'championship' and o.resource_id = p_championship_id
       and o.status = 'confirmed'
       and coalesce(o.claim_composition->>'kind','') = 'championship_registration'
       and (o.claim_composition->'user_ids') ? p_user_id::text
  ) into v_paid;
  if v_paid then return 'paid_individual'; end if;

  if v_team is not null then
    select exists (
      select 1 from public.championship_teams t
       where t.id = v_team and t.created_by_user_id = p_user_id and t.order_id is not null
    ) into v_own;
    if v_own then return 'team_owner'; end if;
    return 'free_member';
  end if;

  return 'free_individual';
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_participation"(uuid, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_payer (
  p_championship_id uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_champ public.championships%rowtype;
  v_payer uuid;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then return null; end if;

  select o.payer_user_id into v_payer from public.orders o where o.id = v_champ.order_id;
  if v_payer is null then
    select r.user_id into v_payer
      from public.reservations r
     where r.championship_id = p_championship_id and r.status = 'spend'
     order by r.reserved_at
     limit 1;
  end if;
  return coalesce(v_payer, v_champ.owner_user_id);
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_payer"(uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_price_lines (
  p_city  text,
  p_items jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_set    public.championship_settings%rowtype;
  v_it     jsonb;
  v_cat    jsonb;
  v_code   text;
  v_desc   text;
  v_qty    numeric;
  v_unit   numeric;
  v_units  int;
  v_min    int;
  v_max    int;
  v_name   text;
  v_amount numeric;
  v_found  boolean;
  v_total  numeric := 0;
  v_lineas jsonb   := '[]'::jsonb;
begin
  -- Sin lineas no hay nada que tarifar, y eso NO es un error: se devuelve cero y
  -- quien llama decide si le sirve.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('lines', '[]'::jsonb, 'amount', 0);
  end if;

  -- Las tarifas van por ciudad, asi que sin ciudad no hay catalogo que aplicar.
  if p_city is null or btrim(p_city) = '' then raise exception 'CITY_REQUIRED'; end if;
  select * into v_set from public.championship_settings
   where city = p_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
  -- El mismo code dos veces es un error de la pantalla: son una linea con mas
  -- cantidad. `other` queda fuera de la regla —dos «otros» son dos cosas distintas,
  -- y repetirlo es justo lo que se pidio permitir—.
  if (select count(*) from jsonb_array_elements(p_items) e where e->>'code' is distinct from 'other')
     <> (select count(distinct e->>'code') from jsonb_array_elements(p_items) e
          where e->>'code' is distinct from 'other') then
    raise exception 'DUPLICATE_EXTRA';
  end if;

  for v_it in select value from jsonb_array_elements(p_items) as t(value) loop
    v_code := nullif(btrim(coalesce(v_it->>'code', '')), '');
    if v_code is null then raise exception 'EXTRA_CODE_REQUIRED'; end if;
    -- Cantidad del cliente: si no es numero, no hay cantidad. Nunca un cast a ciegas.
    v_qty := case when jsonb_typeof(v_it->'quantity') = 'number'
                  then (v_it->>'quantity')::numeric else null end;

    if v_code = 'other' then
      -- ── Lo que el catalogo no contempla ──
      -- Descripcion obligatoria: sin ella, dentro de un mes nadie sabra que se
      -- cobro. Precio libre, y es el TOTAL de la linea: no se divide entre la
      -- cantidad para inventar un unitario que nadie escribio.
      v_desc := nullif(btrim(coalesce(v_it->>'description', '')), '');
      if v_desc is null then raise exception 'EXTRA_DESCRIPTION_REQUIRED'; end if;
      if jsonb_typeof(v_it->'amount') <> 'number' then raise exception 'EXTRA_AMOUNT_REQUIRED'; end if;
      v_amount := round((v_it->>'amount')::numeric, 2);
      if v_amount <= 0 then raise exception 'EXTRA_AMOUNT_REQUIRED'; end if;
      -- Cantidad opcional: una, si no se dice otra cosa.
      v_qty := coalesce(floor(v_qty), 1);
      if v_qty < 1 then raise exception 'EXTRA_QUANTITY_OUT_OF_RANGE: other'; end if;

      v_lineas := v_lineas || jsonb_build_object(
        'code', 'other',
        'name', v_desc,
        'description', v_desc,
        'quantity', v_qty::int,
        'units_per_item', 1,
        'total_units', v_qty::int,
        'amount', v_amount);

    elsif v_code = 'referee' then
      -- ── Árbitro: la tarifa por hora que ya existe, por las horas compradas ──
      -- `hours` es una clave que el App no escribe, y por eso distingue «tres horas
      -- de arbitro» de su `{referee, quantity:1}`, que es una bandera y no horas.
      if v_qty is null or v_qty <= 0 then raise exception 'EXTRA_QUANTITY_REQUIRED: referee'; end if;
      v_amount := round(v_qty * v_set.referee_hourly_rate, 2);

      v_lineas := v_lineas || jsonb_build_object(
        'code', 'referee',
        'name', 'Arbitro',
        'hours', v_qty,
        'quantity', v_qty,
        'units_per_item', 1,
        'total_units', v_qty,
        'unit_price', v_set.referee_hourly_rate,
        'amount', v_amount);

    else
      -- ── Catalogo de la ciudad ──
      -- Lectura defensiva, la misma que hace el precio del App: `jsonb_typeof` antes
      -- de castear, y solo entradas activas y bien formadas.
      v_found := false;
      for v_cat in select value from jsonb_array_elements(coalesce(v_set.extras, '[]'::jsonb)) as t(value) loop
        if jsonb_typeof(v_cat) <> 'object' or (v_cat->>'code') is distinct from v_code then continue; end if;
        if jsonb_typeof(v_cat->'active') <> 'boolean' or (v_cat->>'active')::boolean is not true then continue; end if;
        if jsonb_typeof(v_cat->'unit_price') <> 'number' or jsonb_typeof(v_cat->'units_per_item') <> 'number'
           or jsonb_typeof(v_cat->'min_quantity') <> 'number' or jsonb_typeof(v_cat->'max_quantity') <> 'number' then
          continue;
        end if;
        v_unit  := (v_cat->>'unit_price')::numeric;
        v_units := floor((v_cat->>'units_per_item')::numeric)::int;
        v_min   := floor((v_cat->>'min_quantity')::numeric)::int;
        v_max   := floor((v_cat->>'max_quantity')::numeric)::int;
        if v_unit < 0 or v_units < 1 or v_min < 1 or v_max < v_min then continue; end if;
        v_name  := coalesce(v_cat->>'name', v_code);
        v_found := true;
        exit;
      end loop;
      if not v_found then raise exception 'EXTRA_NOT_AVAILABLE: %', v_code; end if;

      if v_qty is null then raise exception 'EXTRA_QUANTITY_REQUIRED: %', v_code; end if;
      v_qty := floor(v_qty);
      if v_qty < v_min or v_qty > v_max then
        raise exception 'EXTRA_QUANTITY_OUT_OF_RANGE: % (%..%)', v_code, v_min, v_max;
      end if;
      v_amount := round(v_qty * v_unit, 2);

      v_lineas := v_lineas || jsonb_build_object(
        'code', v_code,
        'name', v_name,
        'quantity', v_qty::int,
        'units_per_item', v_units,
        'total_units', (v_qty * v_units)::int,
        'unit_price', v_unit,
        'amount', v_amount);
    end if;

    v_total := v_total + v_amount;
  end loop;

  return jsonb_build_object('lines', v_lineas, 'amount', round(v_total, 2));
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_price_lines"(text, jsonb) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_refund_one (
  p_championship_id uuid,
  p_spend_id        uuid,
  p_amount          numeric,
  p_scope           jsonb,
  p_actor           uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_spend     public.reservations%rowtype;
  v_payee     uuid;
  v_devuelto  numeric;
  v_techo     numeric;
  v_amount    numeric := round(coalesce(p_amount, 0), 2);
  v_key       text    := p_scope->>'key';
  v_id        uuid;
begin
  if v_key is null or length(btrim(v_key)) = 0 then raise exception 'REFUND_SCOPE_REQUIRED'; end if;
  if v_amount <= 0 then raise exception 'REFUND_AMOUNT_INVALID'; end if;

  select * into v_spend from public.reservations
   where id = p_spend_id and championship_id = p_championship_id and status = 'spend'
     for update;
  if not found then raise exception 'SPEND_NOT_FOUND'; end if;

  -- El techo es de ESTE asiento: lo que entró por él menos lo que ya salió. Así
  -- un reembolso no puede comerse el saldo de otra compra.
  select coalesce(sum(coalesce(r.total_amount, 0)), 0) into v_devuelto
    from public.reservations r
   where r.status = 'refund' and r.refund_of_reservation_id = p_spend_id;

  v_techo := round(coalesce(v_spend.subtotal_amount, v_spend.total_amount, 0) - v_devuelto, 2);  -- BRUTO = subtotal_amount
  if v_techo <= 0 then raise exception 'ALREADY_FULLY_REFUNDED'; end if;
  if v_amount > v_techo then
    raise exception 'REFUND_EXCEEDS_REMAINING: % > %', v_amount, v_techo;
  end if;

  -- Quien cobró es quien recibe el crédito, y no quien pulsa.
  select coalesce(o.payer_user_id, v_spend.user_id) into v_payee
    from public.orders o where o.id = v_spend.order_id;
  v_payee := coalesce(v_payee, v_spend.user_id);
  if v_payee is null then raise exception 'PAYER_UNKNOWN'; end if;

  -- Una fila nueva. Ni una existente se actualiza: el libro es append-only y el
  -- enlace al asiento original es lo que hace auditable el movimiento.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id, canceled_by,
    status, reservation_type, source, payment_method,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount,
    refund_of_reservation_id, refund_scope, canceled_at
  ) values (
    null, p_championship_id, v_payee, v_spend.order_id, p_actor,
    'refund', 'championship', 'championship', v_spend.payment_method,
    v_amount, v_amount, 0, 0, 0,
    p_spend_id, p_scope, now()
  ) returning id into v_id;

  -- Y el crédito. Si esto falla, la fila de arriba se va con el rollback: no
  -- puede quedar un apunte sin su crédito ni un crédito sin su apunte.
  perform public.apply_wallet_refund(v_payee, v_amount);

  return v_id;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_refund_one"(uuid, uuid, numeric, jsonb, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_release_courts (
  p_championship_id uuid,
  p_game_ids        uuid[] DEFAULT NULL::uuid[]
)
  RETURNS uuid[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_ids    uuid[];
  v_libres uuid[];
begin
  select array_agg(l.game_id order by l.game_id) into v_ids
    from public.championship_reservation_games l
   where l.championship_id = p_championship_id
     and (p_game_ids is null or l.game_id = any(p_game_ids));
  if v_ids is null or array_length(v_ids, 1) is null then return '{}'::uuid[]; end if;

  -- En orden de id, el mismo que toman el reclamo y `create_order`.
  perform 1 from public.games where id = any(v_ids) order by id for update;

  -- Lo que se pidió liberar tiene que seguir siendo del campeonato y estar
  -- reservado. Si no, se aborta entero: nunca una liberación a medias.
  if exists (
    select 1 from unnest(v_ids) gid
     where not exists (
       select 1 from public.games g
        where g.id = gid and g.championship_id = p_championship_id and g.status = 'reserved')
  ) then
    raise exception 'CHAMPIONSHIP_RELEASE_COMPOSITION_MISMATCH';
  end if;

  update public.games
     set status = 'published', championship_id = null
   where id = any(v_ids) and championship_id = p_championship_id and status = 'reserved';

  delete from public.championship_reservation_games
   where championship_id = p_championship_id and game_id = any(v_ids);

  select array_agg(x order by x) into v_libres from unnest(v_ids) x;
  return v_libres;
end $function$;

REVOKE ALL ON FUNCTION "public"."_championship_release_courts"(uuid, uuid[]) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_release_hold (
  p_championship_id uuid,
  p_reason          text DEFAULT 'timeout'::text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_order        uuid;
  v_order_status text;   -- estado terminal del order según la causa
begin
  -- Whitelist de causas (no se aceptan valores arbitrarios). Mapea causa → estado terminal del order.
  if p_reason not in ('timeout','user_canceled') then
    raise exception 'INVALID_RELEASE_REASON: %', p_reason;
  end if;
  v_order_status := case when p_reason = 'user_canceled' then 'failed' else 'expired' end;

  -- Solo games que TODAVÍA pertenezcan a este campeonato y sigan 'reserved'.
  -- reserved → published dispara trg_reopen_double_out_twin (reabre gemelo). booked_by permanece NULL.
  update public.games g
     set status = 'published', championship_id = null
   where g.championship_id = p_championship_id
     and g.status = 'reserved';

  delete from public.championship_reservation_games where championship_id = p_championship_id;

  select order_id into v_order from public.championships where id = p_championship_id;
  if v_order is not null then
    -- Solo un order 'pending' es liberable aquí (el hold sigue vivo). Un 'validation' NO llega a este
    -- helper porque release/expire exigen championship en 'transfer_hold' antes de invocarlo.
    update public.orders
       set status = v_order_status, terminal_reason = p_reason, resolved_at = now(), updated_at = now()
     where id = v_order and status = 'pending';
  end if;

  update public.championships
     set status = 'canceled', hold_expires_at = null, updated_at = now()
   where id = p_championship_id;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."_championship_release_hold"(uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_spend_to_wallet()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_snap   jsonb;
  v_payer  uuid;
  v_bruto  numeric := round(coalesce(new.subtotal_amount, new.total_amount, 0), 2);  -- BRUTO = subtotal_amount
  v_credito numeric := 0;
  v_externo numeric;
begin
  -- Lo que la orden dijo al nacer. Es la única fuente del crédito aplicado: el
  -- asiento todavía no lo sabe, y el snapshot está congelado.
  if new.order_id is not null then
    select o.financial_snapshot, coalesce(o.payer_user_id, new.user_id)
      into v_snap, v_payer
      from public.orders o where o.id = new.order_id;
    if not found then
      raise exception 'SPEND_ORDER_NOT_FOUND: el asiento apunta a la orden %, que no existe',
        new.order_id;
    end if;
    v_credito := round(coalesce((v_snap->>'credit_applied')::numeric, 0), 2);
  elsif coalesce(new.credit_applied, 0) <> 0 then
    raise exception 'CREDIT_APPLIED_WITHOUT_ORDER: % sin orden que lo congele',
      new.credit_applied;
  end if;
  v_payer := coalesce(v_payer, new.user_id);

  -- ── El crédito congelado tiene que ser creíble ──
  if v_credito < 0 then
    raise exception 'CREDIT_APPLIED_INVALID: % en la orden %', v_credito, new.order_id;
  end if;
  if v_credito > v_bruto then
    raise exception 'CREDIT_APPLIED_EXCEEDS_SPEND: % > % en la orden %',
      v_credito, v_bruto, new.order_id;
  end if;

  -- ── Y el apunte tiene que decir lo MISMO que la orden ──
  if coalesce(new.credit_applied, 0) = 0 then
    new.credit_applied := v_credito;
  elsif round(new.credit_applied, 2) <> v_credito then
    raise exception 'CREDIT_APPLIED_MISMATCH: el asiento dice % y la orden %',
      round(new.credit_applied, 2), v_credito;
  end if;

  if v_payer is null or v_bruto <= 0 then return new; end if;

  -- Lo externo es lo único que ENTRA ahora: el crédito ya se movió al crear la orden.
  v_externo := round(v_bruto - v_credito, 2);
  if v_externo = 0 then return new; end if;

  insert into public.wallet_summary (user_id, total_amount, reserved_balance, credit_balance)
  values (v_payer, v_externo, v_externo, 0)
  on conflict (user_id) do update
     set total_amount     = wallet_summary.total_amount + v_externo,
         reserved_balance = wallet_summary.reserved_balance + v_externo;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public._championship_team_capacity (
  p_config jsonb
)
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'public'
  AS $function$
  select case
    -- NUEVO: techo explícito. Un campeonato vendido para 30 equipos admite 30.
    when coalesce((p_config->'summary'->>'team_capacity')::int, 0) > 0
      then (p_config->'summary'->>'team_capacity')::int
    -- Liga = capacidad 1, EXACTAMENTE como el frontend (realSlotCount = isLiga ? 1 : ...). Sin
    -- leagueEstimate.quantity ni default silencioso 64.
    when (p_config->'summary'->>'mode') = 'liga' then 1
    else case
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 4  then 4
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 6  then 6
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 8  then 8
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 12 then 12
      when coalesce((p_config->'summary'->'group'->>'max')::int, 0) <= 14 then 14
      else 16 end
  end;
$function$;

CREATE OR REPLACE FUNCTION public._championship_team_roster (
  p_championship_id uuid,
  p_team_id         uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.user_id,
           'full_name', u.full_name,
           'user_code', u.user_code,
           'avatar_path', u.avatar_path,
           'avatar_hue', u.avatar_hue,
           'avatar_updated_at', u.avatar_updated_at)
         order by lower(coalesce(u.full_name, '')), p.user_id), '[]'::jsonb)
    from public.championship_players p
    left join public.users_public u on u.id = p.user_id
   where p_team_id is not null
     and p.championship_id = p_championship_id
     and p.team_id = p_team_id;
$function$;

REVOKE ALL ON FUNCTION "public"."_championship_team_roster"(uuid, uuid) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._championship_verify_secret (
  p_secret text,
  p_hash   text
)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
  AS $function$
  select p_hash is not null and p_secret is not null and p_hash = crypt(p_secret, p_hash);
$function$;

REVOKE ALL ON FUNCTION "public"."_championship_verify_secret"(text, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._eligible_championship_hosts()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  -- A1 · host de un complejo
  select distinct vs.user_id
    from public.venue_staff vs
   where vs.status = 'accepted' and vs.user_id is not null
  union
  -- A2 · host por defecto de una cancha
  select distinct f.default_host_user_id
    from public.fields f
   where f.default_host_user_id is not null
  union
  -- B · personal de AlGrass
  select distinct r.user_id
    from public.user_roles r
   where r.role in ('algrass_admin', 'algrass_staff') and r.user_id is not null
$function$;

REVOKE ALL ON FUNCTION "public"."_eligible_championship_hosts"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public._is_algrass_admin (
  p_user uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select exists (
    select 1 from public.user_roles
     where user_id = p_user and role::text = 'algrass_admin'
  );
$function$;

REVOKE ALL ON FUNCTION "public"."_is_algrass_admin"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public._is_algrass_staff (
  p_user uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.user_roles
     where user_id = p_user and role in ('algrass_admin', 'algrass_staff')
  );
$function$;

REVOKE ALL ON FUNCTION "public"."_is_algrass_staff"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.add_championship_block (
  p_city      text,
  p_starts_at timestamp with time zone,
  p_ends_at   timestamp with time zone,
  p_reason    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_reason text;
  v_nuevo  jsonb;
  v_set    public.championship_settings%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_write_app_settings() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;

  if p_starts_at is null or p_ends_at is null then raise exception 'INVALID_BLOCK_RANGE'; end if;
  -- Semiabierto: un bloqueo de duración cero no bloquea nada y sería un bloqueo
  -- fantasma en la lista.
  if p_ends_at <= p_starts_at then raise exception 'INVALID_BLOCK_RANGE'; end if;

  -- El motivo es obligatorio: un bloqueo sin explicación es imposible de revisar
  -- dentro de tres semanas. Es interno; la App nunca lo ve.
  v_reason := btrim(coalesce(p_reason, ''));
  if length(v_reason) = 0 then raise exception 'BLOCK_REASON_REQUIRED'; end if;
  if length(v_reason) > 300 then raise exception 'BLOCK_REASON_TOO_LONG'; end if;

  v_nuevo := jsonb_build_object(
    'id',         gen_random_uuid()::text,
    'starts_at',  to_char(p_starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at',    to_char(p_ends_at   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'reason',     v_reason,
    'created_by', v_actor::text,
    'created_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  -- Que lo que se guarda sea legible por el validador se comprueba ANTES de
  -- guardarlo: escribir un bloqueo que luego hiciera abortar toda contratación de
  -- la ciudad sería el peor fallo posible de esta función.
  perform public._championship_block_normalize(v_nuevo);

  -- Se lee la fila y se BLOQUEA antes de tocarla. Dos cosas a la vez:
  --
  --   1. añadir es leer-modificar-escribir sobre un jsonb, así que dos altas
  --      simultáneas sin lock se pisarían y una de las dos desaparecería;
  --   2. si el array está roto, esto ABORTA. Reemplazarlo por uno nuevo —lo que
  --      hacía antes— borraría los bloqueos que hubiera dentro, y esa columna es
  --      la única copia que existe de ellos. Que lo arregle una persona mirando
  --      lo que hay; mientras, el validador sigue abortando toda contratación de
  --      la ciudad, que es lo seguro.
  select * into v_set from public.championship_settings
   where city = btrim(p_city)
     for update;
  if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;
  if jsonb_typeof(v_set.availability_blocks) <> 'array' then
    raise exception 'CHAMPIONSHIP_BLOCKS_MALFORMED';
  end if;

  update public.championship_settings
     set availability_blocks = v_set.availability_blocks || jsonb_build_array(v_nuevo),
         updated_at          = now()
   where city = v_set.city;

  return public.list_championship_blocks(btrim(p_city));
end $function$;

REVOKE ALL ON FUNCTION "public"."add_championship_block"(text, timestamp WITH time zone, timestamp WITH time zone, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.add_championship_court (
  p_championship_id uuid,
  p_game_id         uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_res jsonb;
begin
  v_res := public.add_championship_courts(p_championship_id, array[p_game_id]);
  -- El item ya trae game_id, order_id, amount, payer_user_id y twin_game_id:
  -- exactamente las claves que devolvia antes. Se le añade el campeonato.
  return (v_res->'items'->0) || jsonb_build_object('championship_id', p_championship_id);
end $function$;

REVOKE ALL ON FUNCTION "public"."add_championship_court"(uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.add_championship_court (
  p_championship_id uuid,
  p_game_id         uuid,
  p_payment_method  text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_res jsonb;
begin
  v_res := public.add_championship_courts(p_championship_id, array[p_game_id], p_payment_method);
  -- El item ya trae game_id, order_id, amount, payer_user_id y twin_game_id:
  -- las mismas claves que devuelve la firma de dos argumentos.
  return (v_res->'items'->0) || jsonb_build_object('championship_id', p_championship_id);
end $function$;

REVOKE ALL ON FUNCTION "public"."add_championship_court"(uuid, uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.add_championship_courts (
  p_championship_id uuid,
  p_game_ids        uuid[]
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_champ    public.championships%rowtype;
  v_ids      uuid[];   -- los elegidos, sin repetidos y ordenados
  v_lock     uuid[];   -- los elegidos MAS sus gemelos: lo que hay que bloquear
  v_id       uuid;
  v_game     public.games%rowtype;
  v_twin     uuid;
  v_t_alt    uuid;
  v_taken    uuid;
  v_payer    uuid;
  v_method   text;
  v_order_id uuid;
  v_total    numeric := 0;
  v_items    jsonb   := '[]'::jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Gente de AlGrass: admin o staff. El mismo helper que el resto de escrituras
  -- del modulo. Ni host, ni owner, ni jugador.
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Sin repetidos y en orden: pulsar dos veces la misma cancha es UNA operacion,
  -- no dos, y el orden estable es la mitad de la defensa contra interbloqueos.
  select array_agg(x order by x) into v_ids
    from (select distinct unnest(p_game_ids) x) s
   where x is not null;
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'NO_GAMES'; end if;

  -- MISMA lock key que roster, resultados y transiciones. Se toma ANTES que los
  -- locks de fila, igual que en el resto del modulo.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Quien puede recibir mas canchas. Fuera quedan, a proposito:
  --   transfer_hold / payment_validation → su composicion fisica la gobierna el
  --     flujo de pago, que la revalida entera.
  --   completed / canceled → terminales.
  if v_champ.status not in ('pending_publish','registration_open',
                            'registration_closed','in_progress') then
    raise exception 'CHAMPIONSHIP_NOT_ACCEPTING';
  end if;

  -- ── UN SOLO LOCK, sobre los elegidos MAS sus gemelos, en orden de id ──
  -- Este es el motivo principal de que el lote exista. Tres llamadas sueltas
  -- tomarian sus locks en tres ordenes distintos; aqui se toman todos de una vez
  -- y en el mismo orden que usan `create_order`, el gate de Match y
  -- `claim_rental_double_out_aware`.
  select array_agg(distinct z order by z) into v_lock
    from (
      select unnest(v_ids) as z
      union
      select g.alternative_game_id
        from public.games g
       where g.id = any(v_ids) and g.alternative_game_id is not null
    ) u;
  perform 1 from public.games where id = any(v_lock) order by id for update;

  -- ── Revalidar TODOS, bajo el lock, ANTES de escribir una sola fila ──
  foreach v_id in array v_ids loop
    select * into v_game from public.games where id = v_id;
    if not found then raise exception 'GAME_NOT_FOUND:%', v_id; end if;

    -- El gemelo que veiamos al bloquear tiene que seguir siendo el mismo. Si
    -- aparecio uno despues de leer y antes del lock, no esta bloqueado: abortar
    -- es mas seguro que tomarlo ahora fuera de orden.
    v_twin := v_game.alternative_game_id;
    if v_twin is not null and not (v_twin = any(v_lock)) then
      raise exception 'DOUBLE_OUT_RACE:%', v_id;
    end if;
    if v_twin is not null then
      select alternative_game_id into v_t_alt from public.games where id = v_twin;
      if v_t_alt is distinct from v_id then raise exception 'DOUBLE_OUT_LINK_BROKEN:%', v_id; end if;
      -- Los dos lados de una doble salida son LA MISMA hora fisica. Elegir los
      -- dos no es contratar dos bloques: es pedir el mismo dos veces. Se corta
      -- aqui, con un error que se entiende, en vez de dejar que el segundo
      -- fracase contra el gemelo que acaba de sellar el primero.
      if v_twin = any(v_ids) then raise exception 'TWIN_PAIR_SELECTED:%', v_id; end if;
    end if;

    -- La regla de reservabilidad es la del checkout, no una propia. Se
    -- re-etiqueta con el uuid para que la pantalla sepa que bloque señalar.
    begin
      perform public.assert_game_reservable(v_id, 'rental');
    exception
      when others then
        raise exception 'GAME_NOT_AVAILABLE:%', v_id using detail = sqlerrm;
    end;

    if v_game.status <> 'published'
       or v_game.booked_by_user_id is not null
       or v_game.championship_id is not null then
      raise exception 'GAME_NOT_AVAILABLE:%', v_id;
    end if;
    if exists (select 1 from public.championship_reservation_games l where l.game_id = v_id) then
      raise exception 'GAME_NOT_AVAILABLE:%', v_id;
    end if;

    -- Un pago en curso va por delante, aunque quien pulse sea Admin. El trigger
    -- de doble salida no ve pendings —solo estados—, asi que el del gemelo se
    -- mira aparte: es la misma hora.
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then
      raise exception 'PAYMENT_IN_PROGRESS:%', v_id;
    end if;
    if v_twin is not null and exists (
      select 1 from public.orders o
       where o.resource_id = v_twin and o.status = 'pending' and o.pending_expires_at > now()
    ) then
      raise exception 'PAYMENT_IN_PROGRESS:%', v_id;
    end if;

    if v_game.price_total is null then raise exception 'PRICE_UNKNOWN:%', v_id; end if;
  end loop;

  -- ── A nombre de quien ──
  -- Pagador autoritativo: el del order original del campeonato, igual que en
  -- `approve_championship_transfer`. NO el owner por serlo.
  select o.payer_user_id into v_payer from public.orders o where o.id = v_champ.order_id;
  if v_payer is null then
    select r.user_id into v_payer
      from public.reservations r
     where r.championship_id = p_championship_id and r.status = 'spend'
     order by r.reserved_at
     limit 1;
  end if;
  v_payer := coalesce(v_payer, v_champ.owner_user_id);
  if v_payer is null then raise exception 'PAYER_UNKNOWN'; end if;

  v_method := coalesce(v_champ.payment_method, 'transfer');

  -- ── Escribir: ganar cada cancha y despues cobrarla ──
  -- Todo esto vive en la MISMA transaccion que las validaciones de arriba. Un
  -- fallo aqui —el CAS que no encuentra fila, el trigger que aborta, el unique
  -- del enlace o el de la clave de idempotencia— deshace el lote entero.
  foreach v_id in array v_ids loop
    select * into v_game from public.games where id = v_id;

    -- `published -> reserved` + championship_id, con el CAS dentro de la propia
    -- sentencia. `booked_by_user_id` se queda NULL a proposito: la cancha es del
    -- campeonato, no el alquiler personal de nadie.
    --
    -- Este UPDATE dispara `trg_block_double_out_twin`, que sella el gemelo o
    -- aborta con ALTERNATIVE_TAKEN si ya estaba tomado.
    update public.games
       set status = 'reserved', championship_id = p_championship_id
     where id = v_id
       and status = 'published'
       and booked_by_user_id is null
       and championship_id is null
    returning id into v_taken;
    if v_taken is null then raise exception 'GAME_NOT_AVAILABLE:%', v_id; end if;

    -- El order de ESTA cancha. Nace confirmado porque no hay pago externo que
    -- esperar: se esta certificando un deposito que ya llego. La clave se deriva
    -- de la operacion, asi que reintentar el lote no puede cobrar dos veces.
    insert into public.orders (
      idempotency_key, payer_user_id, resource_type, resource_id,
      claim_composition, claimed_units, pending_expires_at,
      amount_total, currency, financial_snapshot,
      payment_provider, status, resolved_at
    ) values (
      'champ_court:' || p_championship_id::text || ':' || v_id::text,
      v_payer, 'championship', p_championship_id,
      jsonb_build_object('kind', 'championship_extra_court',
                         'game_ids', jsonb_build_array(v_id)),
      1, now(),
      v_game.price_total, 'PEN',
      jsonb_build_object('source', 'championship_extra_court',
                         'game_id', v_id,
                         'price_total', v_game.price_total,
                         'confirmed_by', v_actor,
                         'payment_method', v_method,
                         'batch_size', array_length(v_ids, 1)),
      v_method, 'confirmed', now()
    ) returning id into v_order_id;

    -- El asiento de ESA cancha. `game_id` NULL a proposito, como el original:
    -- `cancel_rental` busca el asiento a reembolsar por `game_id`, y uno de
    -- campeonato colgado de un game se le presentaria como alquiler personal.
    insert into public.reservations (
      game_id, championship_id, user_id, order_id,
      status, reservation_type, source, payment_method,
      total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
      reserved_at
    ) values (
      null, p_championship_id, v_payer, v_order_id,
      'spend', 'championship', 'championship', v_method,
      v_game.price_total, v_game.price_total, 0, 0, 0, null,
      now()
    );

    insert into public.championship_reservation_games (championship_id, game_id)
    values (p_championship_id, v_id);

    v_total := v_total + v_game.price_total;
    v_items := v_items || jsonb_build_object(
      'game_id',       v_id,
      'order_id',      v_order_id,
      'amount',        v_game.price_total,
      'payer_user_id', v_payer,
      'twin_game_id',  v_game.alternative_game_id
    );
  end loop;

  return jsonb_build_object(
    'championship_id', p_championship_id,
    'total_amount',    v_total,
    'count',           array_length(v_ids, 1),
    'items',           v_items
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."add_championship_courts"(uuid, uuid[]) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.add_championship_courts (
  p_championship_id uuid,
  p_game_ids        uuid[],
  p_payment_method  text,
  p_credit_applied  numeric DEFAULT 0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_ids   uuid[];
begin
  if not public._championship_is_algrass_public(p_championship_id) then
    return public._add_championship_courts_b2b(p_championship_id, p_game_ids, p_payment_method, p_credit_applied);
  end if;

  -- ── Público: solo la reserva del game ──
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if coalesce(p_credit_applied, 0) <> 0 then raise exception 'PUBLIC_CREDIT_NOT_ALLOWED'; end if;

  -- Misma lock key y mismos estados que el privado.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status not in ('pending_publish','registration_open',
                            'registration_closed','in_progress') then
    raise exception 'CHAMPIONSHIP_NOT_ACCEPTING';
  end if;

  v_ids := public._championship_claim_games(p_championship_id, p_game_ids);

  return jsonb_build_object(
    'championship_id', p_championship_id,
    'organized_by',    'algrass',
    'total_amount',    0,
    'credit_applied',  0,
    'external_amount', 0,
    'count',           array_length(v_ids, 1),
    'items',           (select coalesce(jsonb_agg(jsonb_build_object(
                                 'game_id',      g.id,
                                 'order_id',     null,
                                 'twin_game_id', g.alternative_game_id)), '[]'::jsonb)
                          from public.games g where g.id = any(v_ids))
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."add_championship_courts"(uuid, uuid[], text, numeric) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.add_championship_team_member (
  p_team_id uuid,
  p_user_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_team  public.championship_teams%rowtype;
  v_champ public.championships%rowtype;
  v_part  text;
  v_cur   uuid;
  v_has   boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)) then
    raise exception 'NOT_PUBLIC';
  end if;
  -- Owner agrega gratis: abierto Y cerrado (NO abre compras ni cancelaciones).
  if v_champ.status not in ('registration_open', 'registration_closed') then raise exception 'NOT_OPEN'; end if;

  if p_user_id is null or not exists (select 1 from public.users_public where id = p_user_id) then
    raise exception 'INVALID_INPUT';
  end if;
  if v_champ.host_user_id is not null and v_champ.host_user_id = p_user_id then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_part := public._championship_participation(v_team.championship_id, p_user_id);
  select true, cp.team_id into v_has, v_cur
    from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = p_user_id;

  if coalesce(v_has, false) and v_cur = p_team_id then
    return jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id, 'already', true);
  end if;
  if v_part in ('paid_individual','team_owner') then raise exception 'ALREADY_ENROLLED'; end if;
  if v_part = 'free_member' then raise exception 'ALREADY_IN_OTHER_TEAM'; end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (v_team.championship_id, p_user_id, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('team_id', p_team_id, 'user_id', p_user_id, 'already', false);
end $function$;

REVOKE ALL ON FUNCTION "public"."add_championship_team_member"(uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_attach_championship_voucher (
  p_order_id uuid,
  p_filename text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_order  public.orders%rowtype;
  v_source text;
  v_name   text;
  v_ref    text;
  v_previo text;
  v_lista  jsonb;
  v_ya     boolean;
  v_stored boolean;
  -- El campeonato del order, para saber si este cobro es su compra INICIAL.
  v_champ   public.championships%rowtype;
  v_inicial boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- El nombre, y SOLO un nombre. Una barra o un `..` aqui saldria del prefijo del
  -- pagador y escribiria en el de otro: la policy de Storage autoriza al rol, no al
  -- prefijo, asi que este corte es la unica defensa del path.
  v_name := btrim(coalesce(p_filename, ''));
  if v_name = '' then raise exception 'VOUCHER_FILENAME_REQUIRED'; end if;
  if v_name ~ '[/\\]' or v_name ~ '\.\.' or length(v_name) > 200 then
    raise exception 'VOUCHER_FILENAME_INVALID';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_order.resource_type <> 'championship' then raise exception 'ORDER_NOT_MANUAL'; end if;

  -- ¿Es la compra INICIAL? Lo dice el campeonato, no el `source`: su `order_id` apunta
  -- a uno solo. De ahi salen las dos diferencias de trato -los estados admitidos y la
  -- columna- sin inventar ninguna bandera.
  select * into v_champ from public.championships where id = v_order.resource_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_inicial := v_champ.order_id is not null and v_champ.order_id = v_order.id;

  -- Las TRES fuentes que Admin cobra a mano: las canchas añadidas, los extras, y la
  -- compra INICIAL de un campeonato creado desde el Back Office.
  --
  -- Un campeonato del App queda fuera sin necesidad de una condicion que lo nombre:
  -- su snapshot es la cotizacion de `_championship_compute_price` y NO lleva clave
  -- `source`, asi que esto lo corta. Su comprobante lo sube el cliente y lo escribe
  -- `confirm_championship_transfer`; esto no lo roza.
  v_source := v_order.financial_snapshot->>'source';
  if v_source is null
     or v_source not in ('championship_extra_court', 'championship_extras_manual',
                         'championship_admin_manual') then
    raise exception 'ORDER_NOT_MANUAL';
  end if;

  -- ── Los estados ──
  -- La compra INICIAL admite `validation`: el cliente puede ir mandando comprobantes
  -- mientras su pago se revisa, y adjuntar NO aprueba nada -el `confirmed` y el
  -- asiento siguen saliendo solo de `approve_championship_transfer`-.
  --
  -- Las POSTERIORES siguen exigiendo `confirmed`, que es como nacen: una cancha
  -- añadida o unos extras se certifican en el acto.
  if v_inicial then
    if v_order.status not in ('validation', 'confirmed') then
      raise exception 'ORDER_NOT_MANUAL';
    end if;
  elsif v_order.status <> 'confirmed' then
    raise exception 'ORDER_NOT_MANUAL';
  end if;

  -- {payer}/{championship}/{order}/{filename}. Los tres primeros salen del order:
  -- el operador no interviene en el path. Y el nombre entra TAL CUAL, asi que dos
  -- archivos distintos del mismo cobro son dos paths distintos.
  v_ref := v_order.payer_user_id::text || '/'
        || v_order.resource_id::text   || '/'
        || v_order.id::text            || '/'
        || v_name;

  -- ── El historico, normalizado SIN tocarlo ──
  -- Un cobro de antes solo tiene el escalar. Se convierte en lista aqui, en
  -- memoria, para poder añadirle el segundo; la fila no se reescribe hasta que de
  -- verdad hay algo nuevo que apuntar.
  v_previo := nullif(btrim(coalesce(v_order.financial_snapshot->>'voucher_ref', '')), '');
  v_lista := case
    when jsonb_typeof(v_order.financial_snapshot->'vouchers') = 'array'
      then v_order.financial_snapshot->'vouchers'
    when v_previo is not null
      then jsonb_build_array(jsonb_build_object(
             'ref',      v_previo,
             'filename', v_order.financial_snapshot->>'voucher_filename',
             'by',       v_order.financial_snapshot->'voucher_by',
             'at',       v_order.financial_snapshot->'voucher_at'))
    else '[]'::jsonb
  end;

  -- ¿Este MISMO path ya esta enganchado? Entonces no hay nada que hacer: un
  -- comprobante subido no se reemplaza ni se duplica en la lista.
  v_ya := exists (
    select 1 from jsonb_array_elements(v_lista) e where e->>'ref' = v_ref
  );

  -- ── El hecho ──
  -- Aqui se decide todo: el archivo esta o no esta. Se pregunta ANTES de escribir,
  -- que es la regla de 20261022 y se conserva entera.
  v_stored := exists (
    select 1 from storage.objects
     where bucket_id = 'championship-payment-proofs'
       and name = v_ref
  );

  -- Se apunta SOLO si el archivo ya esta subido y si no estaba ya en la lista. Con
  -- `v_stored` falso no se escribe nada, asi que ningun comprobante apunta a un
  -- objeto que no existe y la subida se puede reintentar.
  if v_stored and not v_ya then
    /* ── La columna, referencia historica del PRIMERO ──
       `championships.payment_voucher_ref` guarda uno y lo escribe tambien el App. Se
       le pone el PRIMER comprobante de la compra inicial y no se toca mas: el
       `where ... is null` es la inmutabilidad -nunca pisa el del App ni el que ya
       hubiera- y, a la vez, el desempate si dos operadores suben a la vez.

       Los N comprobantes viven en `vouchers` del propio order, que es lo que la ficha
       enseña; esta columna se mantiene porque de ella leen el modal de validacion y
       todo lo que ya existia. */
    if v_inicial then
      update public.championships
         set payment_voucher_ref = v_ref, updated_at = now()
       where id = v_champ.id and payment_voucher_ref is null;
    end if;

    update public.orders
       set financial_snapshot = financial_snapshot
             -- El escalar se escribe UNA vez, la primera, y se queda congelado:
             -- `voucher_ref` siempre es el PRIMER comprobante del cobro. Es lo que
             -- hace que todo lo que ya leia esa clave siga leyendo lo mismo.
             || case when v_previo is null then jsonb_build_object(
                  'voucher_ref',      v_ref,
                  'voucher_filename', v_name,
                  'voucher_by',       v_actor,
                  'voucher_at',       now()
                ) else '{}'::jsonb end
             -- Y la lista crece. Nada se sustituye: `||` sobre un array añade.
             || jsonb_build_object('vouchers', v_lista || jsonb_build_array(jsonb_build_object(
                  'ref',      v_ref,
                  'filename', v_name,
                  'by',       v_actor,
                  'at',       now()
                ))),
           updated_at = now()
     where id = v_order.id;
  end if;

  return jsonb_build_object(
    'order_id',    v_order.id,
    -- El path de ESTE archivo: es donde la pantalla tiene que subirlo.
    'voucher_ref', v_ref,
    -- `reused` es ahora POR PATH: este comprobante concreto ya estaba enganchado.
    'reused',      v_ya,
    -- false = falta subir el archivo a `voucher_ref`; true = esta subido.
    'stored',      v_stored,
    -- Cuantos comprobantes tiene el cobro contando este. Que esta clave exista es
    -- ademas como la pantalla sabe que la base ya admite varios.
    -- Que es la compra inicial. La pantalla no lo necesita para limitar nada -ya no
    -- hay limite- pero si para saber en que bloque cae lo que acaba de subir.
    'initial',     v_inicial,
    'vouchers',    case when v_stored and not v_ya
                        then v_lista || jsonb_build_array(jsonb_build_object('ref', v_ref, 'filename', v_name))
                        else v_lista end
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_attach_championship_voucher"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_cancel_championship (
  p_championship_id uuid,
  p_origin          text,
  p_reason          text,
  p_scope           text    DEFAULT 'full'::text,
  p_codes           text[]  DEFAULT NULL::text[],
  p_game_ids        uuid[]  DEFAULT NULL::uuid[],
  p_amount          numeric DEFAULT NULL::numeric,
  p_confirm_teams   boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_scope  text := lower(btrim(coalesce(p_scope, '')));
  v_champ  public.championships%rowtype;
  v_restan int;
  v_gid    uuid;
  v_libres uuid[];
  v_antes  jsonb;
  v_despues jsonb;
  v_code   text;
  -- (nuevo) cancelación completa pública
  v_origen  text := lower(btrim(coalesce(p_origin, '')));
  v_equipos int;
  v_res     jsonb;
begin
  -- Privado: la ruta de siempre, en todos los alcances. (cambia: `full` entra.)
  if v_scope not in ('courts', 'extras', 'full')
     or not public._championship_is_algrass_public(p_championship_id) then
    return public._admin_cancel_championship_b2b(
      p_championship_id, p_origin, p_reason, p_scope, p_codes, p_game_ids, p_amount, p_confirm_teams);
  end if;

  -- ── Público: quitar, sin devolver nada ──
  -- Mismos permisos y mismo motivo obligatorio que la versión B2B.
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_admin(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'CANCEL_REASON_REQUIRED'; end if;
  if length(btrim(p_reason)) > 300 then raise exception 'CANCEL_REASON_TOO_LONG'; end if;
  -- No hay nada que devolver: un importe aquí es un error de quien llama.
  if p_amount is not null then raise exception 'REFUND_AMOUNT_NOT_APPLICABLE: %', v_scope; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status = 'canceled' then raise exception 'CHAMPIONSHIP_ALREADY_CANCELED'; end if;
  if v_champ.status = 'completed' then raise exception 'CHAMPIONSHIP_NOT_CANCELABLE'; end if;

  -- ── (nuevo) El campeonato entero ──
  if v_scope = 'full' then
    -- El origen, con la regla del núcleo: no hay defecto. Queda en la auditoría.
    if v_origen not in ('owner', 'algrass') then raise exception 'INVALID_CANCELLATION_ORIGIN'; end if;

    -- ── Con inscripciones pagadas pendientes de devolver: el núcleo ──
    -- Misma lectura del BRUTO que el núcleo tras 20261107120000. Si TODO ya se
    -- devolvió, no se delega: el núcleo respondería NOTHING_TO_REFUND y el
    -- campeonato no se podría cancelar.
    if exists (
      select 1 from public.reservations r
       where r.championship_id = p_championship_id and r.status = 'spend'
         and round(coalesce(r.subtotal_amount, r.total_amount, 0)
                   - coalesce((select sum(coalesce(f.total_amount, 0)) from public.reservations f
                                where f.status = 'refund' and f.refund_of_reservation_id = r.id), 0), 2) > 0
    ) then
      -- Los equipos, contados ANTES: después de cancelar es el dato de auditoría.
      select count(*) into v_equipos
        from public.championship_teams where championship_id = p_championship_id;

      -- Fixture, equipos, reembolsos al pagador, liberación y `canceled`: todo
      -- del núcleo, en esta misma transacción.
      v_res := public._admin_cancel_championship_b2b(
        p_championship_id, p_origin, p_reason, p_scope, p_codes, p_game_ids, p_amount, p_confirm_teams);

      -- Y la auditoría pública, igual que sin dinero. `extras` no se toca.
      update public.championships
         set format_config = jsonb_set(
               coalesce(format_config, '{}'::jsonb), '{cancellation}',
               jsonb_build_object(
                 'origin',            v_origen,
                 'reason',            btrim(p_reason),
                 'canceled_by',       v_actor,
                 'canceled_at',       now(),
                 'team_count',        v_equipos,
                 'released_game_ids', coalesce(v_res->'released_game_ids', '[]'::jsonb),
                 'refunded_total',    coalesce(v_res->'refunded_total', '0'::jsonb)),
               true),
             updated_at = now()
       where id = p_championship_id;

      return v_res || jsonb_build_object('organized_by', 'algrass');
    end if;

    -- ── Sin nada que devolver: la ruta operativa ──
    -- El fixture manda, igual que en el núcleo: con partidos programados, o
    -- pasado el cierre de inscripciones, liberar canchas dejaría el calendario
    -- apuntando a inventario ajeno.
    if v_champ.status in ('registration_closed', 'in_progress') then
      raise exception 'CHAMPIONSHIP_CANCEL_BLOCKED_FIXTURE';
    end if;
    if exists (select 1 from public.championship_matches where championship_id = p_championship_id) then
      raise exception 'CHAMPIONSHIP_CANCEL_BLOCKED_FIXTURE';
    end if;

    -- Equipos dentro sin nada pagado pendiente: la gente sí se ve afectada. Misma
    -- confirmación explícita que el núcleo.
    select count(*) into v_equipos
      from public.championship_teams where championship_id = p_championship_id;
    if v_equipos > 0 and not coalesce(p_confirm_teams, false) then
      raise exception 'CHAMPIONSHIP_HAS_TEAMS: % equipos inscritos', v_equipos;
    end if;

    -- TODAS las canchas, con la misma liberación; los gemelos los reabre su trigger.
    v_libres := public._championship_release_courts(p_championship_id, null);

    -- Cancelado, con su auditoría. `extras` no se toca: queda como histórico.
    update public.championships
       set status          = 'canceled',
           hold_expires_at = null,
           format_config   = jsonb_set(
             coalesce(format_config, '{}'::jsonb), '{cancellation}',
             jsonb_build_object(
               'origin',            v_origen,
               'reason',            btrim(p_reason),
               'canceled_by',       v_actor,
               'canceled_at',       now(),
               'team_count',        v_equipos,
               'released_game_ids', coalesce(to_jsonb(v_libres), '[]'::jsonb)),
             true),
           updated_at      = now()
     where id = p_championship_id;

  elsif v_scope = 'courts' then
    if p_game_ids is null or array_length(p_game_ids, 1) is null then raise exception 'NO_GAMES'; end if;

    -- Las mismas comprobaciones que el núcleo, en el mismo orden.
    select count(*) into v_restan
      from public.championship_reservation_games
     where championship_id = p_championship_id and not (game_id = any(p_game_ids));
    if v_restan = 0 then raise exception 'COURTS_WOULD_BE_EMPTY'; end if;

    foreach v_gid in array p_game_ids loop
      if exists (
        select 1 from public.championship_matches
         where championship_id = p_championship_id and game_id = v_gid
      ) then
        raise exception 'GAME_HAS_SCHEDULED_MATCHES: %', v_gid;
      end if;
      if not exists (
        select 1 from public.championship_reservation_games
         where championship_id = p_championship_id and game_id = v_gid
      ) then
        raise exception 'GAME_NOT_IN_CHAMPIONSHIP: %', v_gid;
      end if;
    end loop;

    -- La MISMA liberación que la cancelación: reserved → published, sin
    -- championship_id, enlace borrado y gemelo reabierto por su trigger.
    v_libres := public._championship_release_courts(p_championship_id, p_game_ids);

  else
    if p_codes is null or array_length(p_codes, 1) is null then raise exception 'NO_CODES'; end if;

    v_antes := coalesce(v_champ.format_config->'extras', '[]'::jsonb);
    foreach v_code in array p_codes loop
      if not exists (select 1 from jsonb_array_elements(v_antes) e where e->>'code' = v_code) then
        raise exception 'EXTRA_NOT_FOUND: %', v_code;
      end if;
    end loop;

    -- Un código se quita entero, como en la versión B2B.
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_despues
      from jsonb_array_elements(v_antes) e
     where not (e->>'code' = any(p_codes));

    update public.championships
       set format_config = jsonb_set(coalesce(format_config, '{}'::jsonb), '{extras}', v_despues, true),
           updated_at = now()
     where id = p_championship_id;
  end if;

  return jsonb_build_object(
    'championship_id',   p_championship_id,
    'scope',             v_scope,
    'origin',            lower(btrim(coalesce(p_origin, ''))),
    'executed_by',       v_actor,
    'organized_by',      'algrass',
    'status',            (select status from public.championships where id = p_championship_id),
    'refunds',           '[]'::jsonb,
    'refunded_total',    0,
    'refund_method',     null,
    'credited_to',       null,
    'released_game_ids', coalesce(to_jsonb(v_libres), '[]'::jsonb)
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_cancel_championship"(uuid, text, text, text, text[], uuid[], numeric, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_championship_extras (
  p_championship_id uuid,
  p_items           jsonb,
  p_confirm         boolean DEFAULT false,
  p_payment_method  text    DEFAULT NULL::text,
  p_idempotency_key text    DEFAULT NULL::text,
  p_credit_applied  numeric DEFAULT 0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_champ  public.championships%rowtype;
  v_calc   jsonb;
  v_key    text;
  v_lineas jsonb;
begin
  -- Cotizar es leer, en los dos tipos: la ruta de siempre.
  if not p_confirm or not public._championship_is_algrass_public(p_championship_id) then
    return public._admin_championship_extras_b2b(
      p_championship_id, p_items, p_confirm, p_payment_method, p_idempotency_key, p_credit_applied);
  end if;

  -- ── Público: guardar la configuración, sin cobrar ──
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_EXTRAS';
  end if;
  if coalesce(p_credit_applied, 0) <> 0 then raise exception 'PUBLIC_CREDIT_NOT_ALLOWED'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  v_key := 'champ_extras:' || p_championship_id::text || ':' || btrim(p_idempotency_key);

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status not in ('pending_publish','registration_open',
                            'registration_closed','in_progress') then
    raise exception 'CHAMPIONSHIP_NOT_ACCEPTING';
  end if;

  -- Un doble clic no añade dos veces: la clave queda en cada línea guardada.
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_champ.format_config->'extras', '[]'::jsonb)) e
     where e->>'idempotency_key' = v_key
  ) then
    return jsonb_build_object('championship_id', p_championship_id, 'organized_by', 'algrass',
                              'confirmed', true, 'reused', true,
                              'total_amount', 0, 'credit_applied', 0, 'external_amount', 0);
  end if;

  -- La misma tarifa y los mismos errores de línea de siempre. El importe es coste
  -- interno de referencia.
  v_calc := public._championship_price_lines(v_champ.city, p_items);
  select coalesce(jsonb_agg(e || jsonb_build_object('idempotency_key', v_key)), '[]'::jsonb)
    into v_lineas
    from jsonb_array_elements(coalesce(v_calc->'lines', '[]'::jsonb)) e;

  update public.championships
     set format_config = jsonb_set(
           coalesce(format_config, '{}'::jsonb), '{extras}',
           coalesce(format_config->'extras', '[]'::jsonb) || v_lineas, true),
         updated_at = now()
   where id = p_championship_id;

  return jsonb_build_object(
    'championship_id', p_championship_id,
    'organized_by',    'algrass',
    'extras',          v_lineas,
    'confirmed',       true,
    'reused',          false,
    'total_amount',    0,
    'credit_applied',  0,
    'external_amount', 0
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_championship_extras"(uuid, jsonb, boolean, text, text, numeric) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_championship_payer_credit (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_payer uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if not exists (select 1 from public.championships where id = p_championship_id) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  v_payer := public._championship_payer(p_championship_id);
  return jsonb_build_object(
    'championship_id', p_championship_id,
    'payer_user_id',   v_payer,
    'credit_balance',  coalesce((select round(w.credit_balance, 2)
                                   from public.wallet_summary w
                                  where w.user_id = v_payer), 0)
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_championship_payer_credit"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_confirm_championship_payment (
  p_championship_id uuid,
  p_payment_method  text
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_payment_method is null or p_payment_method not in ('yape_direct', 'transfer') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  -- MISMA lock key del modulo: escribir el medio no puede cruzarse con otra
  -- operacion del mismo campeonato.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Solo se escribe si estaba por decidir. Un campeonato del App ya dice como se
  -- pago, y reescribirlo seria cambiar un hecho.
  if v_champ.payment_method is null then
    update public.championships
       set payment_method = p_payment_method, updated_at = now()
     where id = p_championship_id;
  end if;

  -- Y el estado final lo produce la de siempre: order confirmed + spend +
  -- pending_publish. Aqui no se replica ni una linea de eso.
  return public.approve_championship_transfer(p_championship_id);
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_confirm_championship_payment"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_create_championship (
  p_owner_user_id uuid,
  p_game_ids      uuid[],
  p_max_teams     integer,
  p_config        jsonb   DEFAULT '{}'::jsonb,
  p_items         jsonb   DEFAULT '[]'::jsonb
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_champ  public.championships%rowtype;
  v_precio jsonb;
  v_config jsonb;
  v_p_ind  numeric;
  v_p_eq   numeric;
begin
  -- ── Privado: la ruta de siempre, intacta ──
  if coalesce(nullif(p_config->>'privacy', ''), 'private') <> 'public' then
    return public._admin_create_championship_b2b(p_owner_user_id, p_game_ids, p_max_teams, p_config, p_items);
  end if;

  -- ── Público: operativo ──
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  begin
    v_p_ind := round((p_config->>'public_individual_price')::numeric, 2);
    v_p_eq  := round((p_config->>'public_team_price')::numeric, 2);
  exception
    when others then raise exception 'INVALID_PUBLIC_PRICE';
  end;
  if v_p_ind is null or v_p_ind < 0 or v_p_eq is null or v_p_eq < 0 then
    raise exception 'INVALID_PUBLIC_PRICE';
  end if;
  -- Nadie paga, así que no hay saldo que aplicar.
  if coalesce((p_config->>'credit_applied')::numeric, 0) <> 0 then
    raise exception 'PUBLIC_CREDIT_NOT_ALLOWED';
  end if;

  if p_max_teams is null or p_max_teams < 1 then raise exception 'INVALID_TEAMS'; end if;
  if p_game_ids is null or array_length(p_game_ids, 1) is null then raise exception 'NO_GAMES'; end if;

  -- El MISMO helper que el privado, por lo que da además de importes: la ciudad
  -- —una sola—, las horas reales, las líneas de extras tarifadas y todos sus
  -- cortes (NO_GAMES, MULTIPLE_CITIES, PRICE_UNKNOWN, CHAMPIONSHIP_CONFIG_UNAVAILABLE,
  -- bloqueos y los de las líneas). Aquí no se cobra: es coste interno.
  v_precio := public._championship_admin_price(p_game_ids, p_items);

  v_config := coalesce(p_config, '{}'::jsonb)
              - 'public_individual_price' - 'public_team_price' - 'credit_applied';
  v_config := jsonb_set(v_config, '{summary}', coalesce(v_config->'summary', '{}'::jsonb), true);
  v_config := jsonb_set(v_config, '{summary,team_capacity}', to_jsonb(p_max_teams), true);
  v_config := jsonb_set(v_config, '{summary,selected_court_hours}', v_precio->'selected_court_hours', true);
  -- Los extras, en la estructura que la ficha lee cuando no hay snapshot.
  v_config := jsonb_set(v_config, '{extras}', coalesce(v_precio->'extras', '[]'::jsonb), true);
  -- Marca de origen, para que la pantalla sepa que no hay dinero que enseñar.
  v_config := jsonb_set(v_config, '{organized_by}', '"algrass"'::jsonb, true);

  insert into public.championships (
    owner_user_id, status, payment_method, city,
    name, cover_theme, privacy, registration_key, results_public,
    event_date, start_time, end_time, venue_id, format_config, registration_closes_at,
    public_individual_price, public_team_price
  ) values (
    -- El dueño lo pone el servidor: quien lo crea. `p_owner_user_id` no cuenta.
    v_actor, 'pending_publish', null, v_precio->>'city',
    nullif(p_config->>'name', ''), nullif(p_config->>'cover_theme', ''),
    'public',
    nullif(p_config->>'registration_key', ''),
    coalesce((p_config->>'results_public')::boolean, true),
    (select g.date_key from public.games g
      where g.id = any(p_game_ids) order by g.date_key, g.time limit 1),
    (select g.time from public.games g
      where g.id = any(p_game_ids) order by g.date_key, g.time limit 1),
    nullif(p_config->>'end_time', '')::time,
    (select f.venue_id from public.games g join public.fields f on f.id = g.field_id
      where g.id = any(p_game_ids) order by g.date_key, g.time limit 1),
    v_config,
    nullif(p_config->>'registration_closes_at', '')::timestamptz,
    v_p_ind, v_p_eq
  ) returning * into v_champ;

  -- Las canchas, con el UNICO sistema de reservas. Nada más: sin order, sin asiento.
  perform public._championship_claim_games(v_champ.id, p_game_ids);

  return v_champ;
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_create_championship"(uuid, uuid[], integer, jsonb, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_get_user_rewards (
  p_user_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_balance numeric;
  v_total   integer;
  v_tx      jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.user_roles r
     where r.user_id = auth.uid() and r.role::text = 'algrass_admin'
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_user_id is null then
    raise exception 'INVALID_USER';
  end if;

  select coalesce(w.reward_balance, 0) into v_balance
    from public.wallet_summary w
   where w.user_id = p_user_id;

  select count(*) into v_total
    from public.reward_transactions t
   where t.user_id = p_user_id;

  -- Las ultimas 100. Mas que eso no se mira en un drawer, y el total va aparte
  -- para que la pantalla pueda decir que hay mas.
  select coalesce(jsonb_agg(fila order by fila->>'created_at' desc), '[]'::jsonb)
    into v_tx
    from (
      select jsonb_build_object(
               'id',              t.id,
               'amount',          t.amount,
               'type',            t.type,
               'reason',          t.reason,
               'granted_by',      t.granted_by,
               'granted_by_name', g.full_name,
               'created_at',      t.created_at,
               'communicated_at', t.communicated_at
             ) as fila
        from public.reward_transactions t
        left join public.users g on g.id = t.granted_by
       where t.user_id = p_user_id
       order by t.created_at desc
       limit 100
    ) s;

  return jsonb_build_object(
    'user_id',        p_user_id,
    'reward_balance', coalesce(v_balance, 0),
    'total',          coalesce(v_total, 0),
    'transactions',   v_tx
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_get_user_rewards"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_list_rewards (
  p_user_id uuid                     DEFAULT NULL::uuid,
  p_type    text                     DEFAULT NULL::text,
  p_from    timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_to      timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_limit   integer                  DEFAULT 200,
  p_offset  integer                  DEFAULT 0
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_limit  integer;
  v_offset integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- El Back Office entero: administrador y staff. Esta funcion SOLO LEE, y leer
  -- el libro es trabajo de soporte. Otorgar es otra cosa y vive en otra funcion:
  -- grant_manual_reward() sigue pidiendo algrass_admin y no se toca aqui.
  --
  -- Cualquier otro rol —capitan, complejo, jugador— se queda fuera aunque tenga
  -- sesion abierta.
  if not exists (
    select 1 from public.user_roles r
     where r.user_id = auth.uid()
       and r.role::text in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_type is not null and p_type not in ('grant_referral', 'grant_manual') then
    raise exception 'INVALID_TYPE';
  end if;

  -- Un tope duro por si alguien pide la tabla entera de una vez.
  v_limit  := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  -- Los filtros, UNA vez. Las filas, el conteo y las tres sumas salen de aqui.
  return (
    with alcance as (
      select t.id,
             t.created_at,
             t.user_id,
             t.amount,
             t.type,
             t.reason,
             t.referred_user_id,
             t.granted_by
        from public.reward_transactions t
       where t.type in ('grant_referral', 'grant_manual')
         and (p_type    is null or t.type    = p_type)
         and (p_user_id is null or t.user_id = p_user_id)
         and (p_from    is null or t.created_at >= p_from)
         and (p_to      is null or t.created_at <  p_to)
    ),
    pagina as (
      select a.*
        from alcance a
       order by a.created_at desc, a.id desc
       limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'rows', coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'id',                 p.id,
                    'created_at',         p.created_at,
                    'amount',             p.amount,
                    'type',               p.type,
                    'reason',             p.reason,
                    'user_id',            p.user_id,
                    'user_name',          u.full_name,
                    'referred_user_id',   p.referred_user_id,
                    'referred_user_name', ref.full_name,
                    'granted_by',         p.granted_by,
                    'granted_by_name',    adm.full_name
                  )
                  order by p.created_at desc, p.id desc)
           from pagina p
           left join public.users u   on u.id   = p.user_id
           left join public.users ref on ref.id = p.referred_user_id
           left join public.users adm on adm.id = p.granted_by),
        '[]'::jsonb),
      'total_count', (select count(*) from alcance),
      'totals', jsonb_build_object(
        'total_granted', (select coalesce(sum(a.amount), 0) from alcance a),
        'automatic',     (select coalesce(sum(a.amount), 0) from alcance a
                           where a.type = 'grant_referral'),
        'manual',        (select coalesce(sum(a.amount), 0) from alcance a
                           where a.type = 'grant_manual')
      ),
      'limit',  v_limit,
      'offset', v_offset
    )
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_list_rewards"(uuid, text, timestamp WITH time zone, timestamp WITH time zone, integer, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_move_championship_player (
  p_championship_id uuid,
  p_player_user_id  uuid,
  p_team_id         uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor   uuid := auth.uid();
  v_status  text;
  v_updated int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Rol comprobado DENTRO, con el mismo helper que ya usan las RPC de equipos:
  -- no se confía en que la pantalla haya escondido el menú.
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Mismo cerrojo que usan las RPC de inscripción de la App, con la misma clave:
  -- así un movimiento del Admin y una inscripción del jugador no se cruzan.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select status into v_status from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Aqui decia que reorganizar era trabajo PREVIO al fixture. No lo es: los
  -- equipos descuadrados se descubren el dia del torneo, con los partidos ya
  -- empezados, y es entonces cuando hay que repartir gente.
  --
  -- `in_progress` cubre PRE-LIVE y EN VIVO —en la base son el mismo estado—, y
  -- `live_started_at` no se mira a proposito: empezar a jugar no impide corregir
  -- una plantilla. `completed` y `canceled` siguen fuera: ahi el roster ya es
  -- historia, y moverlo cambiaria la lectura de lo que paso.
  if v_status not in ('pending_publish', 'registration_open', 'registration_closed', 'in_progress') then
    raise exception 'NOT_OPEN';
  end if;

  -- El equipo destino tiene que existir Y ser de ESTE campeonato: sin esta
  -- comprobación, un id de otro campeonato movería al jugador fuera del suyo.
  if p_team_id is not null
     and not exists (
       select 1 from public.championship_teams
        where id = p_team_id and championship_id = p_championship_id
     ) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  -- UPDATE, nunca delete+insert: la inscripción es la misma fila de siempre.
  -- El WHERE por campeonato + usuario es lo que comprueba que está inscrito;
  -- si no lo está, no hay fila que tocar y se aborta sin cambiar nada.
  update public.championship_players
     set team_id = p_team_id
   where championship_id = p_championship_id
     and user_id = p_player_user_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then raise exception 'PLAYER_NOT_ENROLLED'; end if;

  return jsonb_build_object(
    'championship_id', p_championship_id,
    'user_id', p_player_user_id,
    'team_id', p_team_id
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_move_championship_player"(uuid, uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_quote_championship (
  p_game_ids uuid[],
  p_items    jsonb  DEFAULT '[]'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  return public._championship_admin_price(p_game_ids, p_items);
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_quote_championship"(uuid[], jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.admin_set_championship_registration_close (
  p_championship_id uuid,
  p_closes_at       timestamp with time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Gente de AlGrass, el mismo helper que el resto de escrituras del módulo.
  -- No pide el guard de admin: cambiar una fecha informativa no destruye nada y
  -- se deshace cambiándola otra vez.
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- MISMA lock key que el roster, los resultados y las transiciones de estado.
  -- Mientras el App siga cerrando por fecha, esta escritura puede cambiar lo que
  -- otra transacción está a punto de comprobar, y serializarlas evita que una
  -- inscripción se decida con una fecha a medio cambiar.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Lo único que queda fuera es lo terminado: en un campeonato completado o
  -- cancelado, una fecha PREVISTA de inscripción no significa nada, y cambiarla
  -- reescribiría el historial de algo que ya pasó.
  --
  -- El resto sí entra, incluidos `transfer_hold` y `payment_validation`, al revés
  -- que en `set_championship_team_format`: el tramo de equipos es configuración
  -- CONTRATADA y la gobierna el flujo de pago, mientras esto es un dato
  -- informativo que el operador tiene que poder corregir desde el primer momento.
  if v_champ.status in ('completed', 'canceled') then
    raise exception 'CHAMPIONSHIP_NOT_EDITABLE';
  end if;

  update public.championships
     set registration_closes_at = p_closes_at,
         updated_at             = now()
   where id = p_championship_id;

  return jsonb_build_object(
    'championship_id',        p_championship_id,
    'registration_closes_at', p_closes_at
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."admin_set_championship_registration_close"(uuid, timestamp WITH time zone) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.algrass_cancel_free_invite (
  p_game_player_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor     uuid := auth.uid();
  v_game_id   uuid;
  v_game      record;
  v_player    record;
  v_r1        uuid;
  v_confirmed integer;
  v_published boolean := false;
  v_refund_id uuid;
begin
  -- ── 1 · Quién ─────────────────────────────────────────────────────────────
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor
       and role::text in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_game_player_id is null then
    raise exception 'INVALID_GAME_PLAYER_ID';
  end if;

  -- ── 2 · Qué partido ───────────────────────────────────────────────────────
  --
  -- Se bloquea la fila del partido antes que la del jugador, el mismo orden que
  -- toma `algrass_add_free_player`. Dos operaciones que bloquean en el mismo
  -- orden no pueden abrazarse. Y deja el recuento del final —¿queda alguien?— a
  -- salvo de un alta simultánea.
  select gp.game_id into v_game_id
    from public.game_players gp
   where gp.id = p_game_player_id;

  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  select g.id, g.status, g.host_user_id, g.date_key, g.time
    into v_game
    from public.games g
   where g.id = v_game_id
   for update;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  -- ── 3 · Qué fila ──────────────────────────────────────────────────────────
  --
  -- Se relee ya con el partido bloqueado, y se bloquea la fila del jugador: a
  -- partir de aquí nadie más puede cambiarla hasta que esta transacción acabe.
  -- El LEFT JOIN es a propósito: si la fila no tuviera reserva, en vez de
  -- desaparecer del resultado llega con el origen nulo y cae en
  -- NOT_A_FREE_INVITE, que es lo que hay que responder.
  select gp.id, gp.user_id, gp.status, gp.amount, gp.reservation_type,
         gp.reservation_id,
         r.source            as r_source,
         r.status            as r_status,
         r.reservation_type  as r_type,
         r.total_amount      as r_total,
         r.user_id           as r_user_id,
         r.invited_by_user_id as r_invited_by
    into v_player
    from public.game_players gp
    left join public.reservations r on r.id = gp.reservation_id
   where gp.id = p_game_player_id
   for update of gp;

  if not found then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  -- El organizador no está en el roster como invitado de nadie. Si algún día
  -- apareciera ahí, no se saca por esta puerta.
  if v_player.user_id = v_game.host_user_id then
    raise exception 'IS_THE_HOST';
  end if;

  -- ── 4 · ¿Es de verdad una invitación gratuita? ────────────────────────────
  --
  -- Las siete condiciones juntas. El origen es la que identifica; las demás
  -- corroboran, cada una tapando un agujero distinto: que el asiento no cobrara
  -- nada, que el libro tampoco, y que ambos se declaren invitación. Que el
  -- importe sea cero nunca decide por sí solo.
  if v_player.reservation_id is null
     or v_player.r_source is null
     or v_player.r_source not in ('organizer_invite', 'algrass_invite')
     or v_player.r_type is distinct from 'invited'
     or v_player.r_status is distinct from 'spend'
     or coalesce(v_player.r_total, 0) <> 0
     or v_player.reservation_type is distinct from 'invited'
     or coalesce(v_player.amount, 0) <> 0
  then
    raise exception 'NOT_A_FREE_INVITE';
  end if;

  -- ── 5 · ¿Sigue dentro? ────────────────────────────────────────────────────
  if v_player.status = 'canceled' then
    raise exception 'ALREADY_CANCELED';
  end if;

  if v_player.status is distinct from 'confirmed' then
    raise exception 'NOT_CONFIRMED';
  end if;

  -- ── 6 · Cuándo ────────────────────────────────────────────────────────────
  --
  -- Ni un segundo después del inicio. A partir de ahí el roster es el registro
  -- de quién estaba citado a jugar, y sirve para seguir la asistencia: vaciarlo
  -- a posteriori borraría la prueba.
  --
  -- `date_key` es date y `time` es time: juntos forman un reloj de pared, y ese
  -- reloj es el de Lima. La conversión no depende de la zona del navegador ni de
  -- la del servidor.
  if v_game.date_key is null or v_game.time is null then
    raise exception 'GAME_WITHOUT_SCHEDULE';
  end if;

  if ((v_game.date_key + v_game.time) at time zone 'America/Lima') <= now() then
    raise exception 'GAME_ALREADY_STARTED';
  end if;

  -- ── 7 · Sus propios cupos reservados ──────────────────────────────────────
  --
  -- Si al jugador que se retira le quedaban cupos reservados a su nombre para
  -- este partido, se sueltan con él: no tiene sentido dejar plazas apartadas para
  -- un grupo cuyo dueño ya no está en el partido. Es la misma regla que la App ya
  -- aplica cuando el jugador se cancela solo y cuando el titular retira a un
  -- invitado; lo único distinto es el motivo.
  --
  -- SE BUSCA POR EL DUEÑO, y por nada más. `game_players.game_slot_reservation_id`
  -- NO sirve para esto y no se mira: esa columna dice de qué grupo salió su cupo,
  -- que puede ser el de otra persona. Aquí interesa el grupo que él mismo creó.
  -- Son dos cosas distintas y confundirlas soltaría los cupos de un tercero.
  --
  -- El índice único (game_id, reserved_by_user_id) garantiza que hay como mucho
  -- una, así que esto no puede elegir mal entre varias.
  --
  -- `for update` para que dos operaciones simultáneas sobre el mismo grupo no se
  -- pisen.
  select gsr.id into v_r1
    from public.game_slot_reservations gsr
   where gsr.game_id = v_game.id
     and gsr.reserved_by_user_id = v_player.user_id
     and gsr.status = 'active'
   for update;

  -- La liberación NO se escribe aquí. Se delega en la primitiva que ya usan la
  -- liberación manual del capitán, la expiración automática del cron y la
  -- cancelación del partido entero: ella pone el grupo en 'inactive', guarda
  -- cuántos cupos tenía, deja los contadores en cero, anota motivo y fecha, y baja
  -- el `counts_reserved_slot` de quienes consumían ese grupo —sin cancelarlos ni
  -- borrarlos—. Duplicar aquí ese UPDATE sería crear una segunda verdad.
  --
  -- 'admin' es el motivo que el CHECK ya admite y que `cancel_match` ya usa.
  --
  -- Si no tenía grupo propio activo, no pasa nada más: `v_r1` queda nulo y la
  -- cancelación sigue siendo exactamente la de antes.
  if v_r1 is not null then
    perform public.release_slot_reservation(v_r1, 'admin');
  end if;

  -- ── 8 · La cancelación ────────────────────────────────────────────────────
  --
  -- Una fila, tres campos: los mismos que escribe `cancelInvitedPlayers` en la
  -- App, ni uno más. `game_slot_reservation_id` no se toca —se conserva tal cual
  -- vino, como hace la App—, y lo que los triggers existentes hagan a raíz de
  -- este UPDATE es cosa suya y sigue siendo lo que ya hacen hoy.
  --
  -- La guarda `and status = 'confirmed'` es redundante con el bloqueo de arriba,
  -- y se queda: es lo que convierte esto en un claim atómico el día que alguien
  -- reordene el código.
  update public.game_players
     set status               = 'canceled',
         canceled_at          = now(),
         counts_reserved_slot = false
   where id = p_game_player_id
     and status = 'confirmed';

  if not found then
    raise exception 'ALREADY_CANCELED';
  end if;

  -- ── 8 bis · El asiento de la baja ────────────────────────────────
  --
  -- Único cambio funcional de esta versión. El libro registraba la entrada
  -- —el `spend` de la invitación— y no la salida; ahora las dos quedan escritas.
  --
  -- NO MUEVE DINERO: la invitación valió cero y su devolución vale cero. Es un
  -- apunte de trazabilidad, no una devolución. Por eso todos los importes van a
  -- cero explícitamente en vez de copiarse del original.
  --
  -- VA DESPUÉS DEL CLAIM Y SOLO SI EL CLAIM ENTRÓ. El `update ... and status =
  -- 'confirmed'` de arriba es lo que reclama la fila, y su `if not found` corta
  -- la función. Un segundo intento no llega hasta aquí: o lo para el
  -- ALREADY_CANCELED del bloque 5, o lo para ese mismo claim. Y como todo ocurre
  -- en una transacción, no hay hueco entre reclamar e inscribir.
  --
  -- QUIÉN INVITÓ SE CONSERVA. `invited_by_user_id` es el del asiento original,
  -- no el de quien cancela: el apunte dice de quién era la invitación, y
  -- `canceled_by` dice quién la retiró. Son dos datos distintos y hacen falta
  -- los dos. El `source` también se hereda, para que la baja se lea junto a su
  -- alta sin tener que cruzarlas.
  --
  -- Y EL JUGADOR SIGUE APUNTANDO AL SPEND. `game_players.reservation_id` no se
  -- toca: sustituirlo por el refund borraría el rastro de por qué entró y
  -- rompería el reconocimiento de la invitación.
  insert into public.reservations (
    game_id, user_id, status, unit_price, promo_code, promo_discount,
    credit_applied, total_amount, subtotal_amount, players_count, guest_total,
    payment_method, source, reserved_at, reservation_type,
    invited_by_user_id, canceled_by
  ) values (
    v_game.id, v_player.r_user_id, 'refund', 0, null, 0,
    0, 0, 0, 1, 0,
    null, v_player.r_source, now(), 'invited',
    v_player.r_invited_by, v_actor
  )
  returning id into v_refund_id;

  -- ── 9 · El estado del partido ─────────────────────────────────────────────
  --
  -- El equivalente exacto de `setMatchPublishedIfEmpty` en la App: contar los
  -- confirmados que quedan y, si no queda ninguno, devolver el partido de
  -- `reserved` a `published`. Misma condición y misma guarda que allí; la única
  -- diferencia es que aquí ocurre dentro de la misma transacción. Es también el
  -- reflejo del `published → reserved` que hace el alta al entrar el primero.
  select count(*) into v_confirmed
    from public.game_players
   where game_id = v_game.id
     and status = 'confirmed';

  if v_confirmed = 0 then
    update public.games
       set status = 'published'
     where id = v_game.id
       and status = 'reserved';

    v_published := found;
  end if;

  -- ── 10 · El aviso ─────────────────────────────────────────────────────────
  --
  -- Exactamente la notificación que ya manda la App al cancelar una invitación:
  -- misma tabla, misma categoría y la misma plantilla
  -- `guest_invitation_cancelled_by_owner` —«Invitación cancelada»—. No se
  -- inventa ningún texto: se reutiliza la frase existente cambiando solo quién
  -- canceló, que es la única adaptación necesaria para no atribuirlo a alguien
  -- que no lo hizo:
  --
  --     titular → «Pedro canceló tu invitación.»
  --     AlGrass → «AlGrass canceló tu invitación.»
  --
  -- Vale igual para los dos orígenes: cancele Admin una invitación suya o una
  -- del organizador, quien la canceló fue AlGrass, así que el texto es verdad en
  -- ambos casos y no acusa al host de nada.
  --
  -- Conservar la plantilla importa más que el texto: la App tiene registrado que
  -- esta es la cancelación de `invited_by_player`, y de ahí saca el
  -- comportamiento al pulsar la invitación vieja.
  --
  -- `reservation_id` sí se guarda aquí, igual que en la cancelación de la App.
  --
  -- Solo la recibe el jugador retirado. Ni el administrador, ni el organizador,
  -- ni el resto del roster, ni quienes consumían sus cupos.
  insert into public.notifications (
    recipient_user_id, source_type, delivery_type, category, template_key,
    custom_text, game_id, reservation_id, created_by, sent_at
  ) values (
    v_player.user_id, 'venue', 'automatic', 'invitation',
    'guest_invitation_cancelled_by_owner',
    'AlGrass canceló tu invitación.',
    v_game.id, v_player.reservation_id, v_actor, now()
  );

  return jsonb_build_object(
    'game_player_id', v_player.id,
    'game_id',        v_game.id,
    'user_id',        v_player.user_id,
    'source',         v_player.r_source,
    'confirmed_left', v_confirmed,
    'game_published', v_published,
    'released_r1',    v_r1,
    'refund_id',      v_refund_id
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."algrass_cancel_free_invite"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.apply_default_host_to_game()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  if new.host_user_id is null then
    select default_host_user_id
    into new.host_user_id
    from fields
    where id = new.field_id;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_double_out_mode_system (
  p_game_id uuid,
  p_mode    text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_alt uuid;
  v_a public.games%rowtype;
  v_b public.games%rowtype;
  v_match_id uuid;
  v_rental_id uuid;
begin
  if p_mode not in ('double','match_only','rental_only','none') then
    raise exception 'INVALID_MODE';
  end if;

  select alternative_game_id into v_alt
  from public.games
  where id = p_game_id;

  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_alt is null then raise exception 'NOT_PAIRED'; end if;

  perform 1
  from public.games
  where id in (p_game_id, v_alt)
  order by id
  for update;

  select * into v_a
  from public.games
  where id = p_game_id;

  select * into v_b
  from public.games
  where id = v_alt;

  if not found then raise exception 'TWIN_NOT_FOUND'; end if;

  if v_a.status not in ('published','paused')
     or v_b.status not in ('published','paused') then
    raise exception 'PAIR_NOT_FREE';
  end if;

  if v_a.type = 'match' then
    v_match_id := v_a.id;
    v_rental_id := v_b.id;
  else
    v_match_id := v_b.id;
    v_rental_id := v_a.id;
  end if;

  if p_mode = 'double' then
    update public.games
    set status = 'published'
    where id in (v_match_id, v_rental_id);

  elsif p_mode = 'match_only' then
    update public.games set status = 'published' where id = v_match_id;
    update public.games set status = 'paused' where id = v_rental_id;

  elsif p_mode = 'rental_only' then
    update public.games set status = 'paused' where id = v_match_id;
    update public.games set status = 'published' where id = v_rental_id;

  else
    update public.games
    set status = 'paused'
    where id in (v_match_id, v_rental_id);
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."apply_double_out_mode_system"(uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.apply_wallet_refund (
  p_user_id uuid,
  p_amount  numeric
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
BEGIN
  INSERT INTO wallet_summary (user_id, total_amount, reserved_balance, credit_balance)
  VALUES (p_user_id, 0, 0, p_amount)
  ON CONFLICT (user_id) DO UPDATE SET
    reserved_balance = GREATEST(0, wallet_summary.reserved_balance - p_amount),
    credit_balance   = wallet_summary.credit_balance + p_amount;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_captain_request (
  p_request_id uuid,
  p_role       text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_user  uuid;
  v_estado text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_platform_admin_or_staff(v_actor) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_role is null or p_role not in ('captain', 'captain_gold') then
    raise exception 'INVALID_ROLE';
  end if;

  -- El candado. `for update` retiene la fila hasta el fin de la transacción.
  select user_id, status
    into v_user, v_estado
    from public.captain_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_estado <> 'pending_review' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  -- Ni siquiera un administrador se aprueba a sí mismo: quien concede y quien
  -- recibe tienen que ser dos personas.
  if v_user = v_actor then
    raise exception 'SELF_ASSIGN';
  end if;

  -- Este flujo NO asciende ni degrada. Si ya es capitán, se para aquí sin tocar
  -- roles y sin cerrar la solicitud: el cambio captain ↔ captain_gold pertenece
  -- a la gestión normal de Capitanes.
  if exists (
    select 1 from public.user_roles r
     where r.user_id = v_user and r.role::text in ('captain', 'captain_gold')
  ) then
    raise exception 'ALREADY_CAPTAIN';
  end if;

  -- `granted_by_user_id` se escribe explícito y no se deja al DEFAULT: dentro de
  -- una función SECURITY DEFINER conviene que quién concedió el rol esté a la
  -- vista de quien lea esto, no escondido en el esquema.
  begin
    insert into public.user_roles (user_id, role, granted_by_user_id)
    values (v_user, p_role, v_actor);
  exception when unique_violation then
    -- Alguien le dio el rol por el otro camino entre el paso 7 y éste. La
    -- transacción se deshace entera; el mensaje es el mismo que vería antes.
    raise exception 'ALREADY_CAPTAIN';
  end;

  update public.captain_requests
     set status              = 'approved',
         assigned_role       = p_role,
         reviewed_at         = now(),
         reviewed_by_user_id = v_actor
   where id = p_request_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'user_id',    v_user,
    'role',       p_role
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."approve_captain_request"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.approve_championship_transfer (
  p_championship_id uuid
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_order public.orders%rowtype;
  v_snap    jsonb;
  v_bruto   numeric;
  v_credito numeric;
  v_externo numeric;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Lock championship PRIMERO (mismo orden que reject → mutuamente excluyentes, sin deadlock).
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Idempotencia VERIFICADA: 'pending_publish' es no-op SOLO si la operación financiera quedó COMPLETA.
  if v_champ.status = 'pending_publish' then
    if v_champ.order_id is null then raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.orders where id = v_champ.order_id and status = 'confirmed') then
      raise exception 'INVALID_STATE';
    end if;
    if not exists (select 1 from public.reservations where championship_id = p_championship_id and status = 'spend') then
      raise exception 'INVALID_STATE';
    end if;
    return v_champ;
  end if;
  if v_champ.status <> 'payment_validation' then raise exception 'INVALID_STATE'; end if;
  if v_champ.order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  -- Lock order y validar transición.
  select * into v_order from public.orders where id = v_champ.order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'validation' then raise exception 'INVALID_STATE'; end if;

  -- orders: validation → confirmed (terminal, fija resolved_at).
  update public.orders
     set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  -- championships: payment_validation → pending_publish (puede publicar; NO se auto-publica).
  update public.championships
     set status = 'pending_publish', updated_at = now()
   where id = p_championship_id
  returning * into v_champ;

  -- games: NO se tocan (siguen reserved + championship_id). championship_reservation_games: NO se tocan.

  -- Breakdown congelado (fuente única del dinero). bruto = amount_total; credit/external del snapshot.
  v_snap    := coalesce(v_order.financial_snapshot, '{}'::jsonb);
  v_bruto   := round(coalesce((v_snap->>'amount_total')::numeric, v_order.amount_total, 0), 2);
  v_credito := round(coalesce((v_snap->>'credit_applied')::numeric, 0), 2);
  v_externo := round(coalesce((v_snap->>'external_amount')::numeric, v_bruto - v_credito), 2);

  -- Asiento financiero (spend) — 1 por campeonato. unit_price=subtotal=bruto; total=externo; credit del snapshot.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, v_champ.id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship', coalesce(v_champ.payment_method, 'transfer'),
    v_bruto, v_externo, v_bruto, v_credito, 0, 0, null,
    now()
  );

  return v_champ;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."approve_championship_transfer"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.assert_game_reservable (
  p_game_id       uuid,
  p_expected_type text
)
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_type     text;
  v_status   text;
  v_date_key date;
  v_time     time;
  v_start    timestamptz;
begin
  select g.type, g.status, g.date_key, g.time
    into v_type, v_status, v_date_key, v_time
    from public.games g
   where g.id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  -- Mismo orden que reserve_slots: tipo → canceled → estado → (start null) → iniciado.
  if v_type is distinct from p_expected_type then raise exception 'GAME_NOT_RESERVABLE'; end if;
  if v_status = 'canceled' then raise exception 'GAME_CANCELED'; end if;
  if v_status not in ('published','reserved') then raise exception 'GAME_NOT_RESERVABLE'; end if;

  v_start := (v_date_key + v_time) at time zone 'America/Lima';
  if v_start is null then raise exception 'GAME_NOT_RESERVABLE'; end if;
  if now() >= v_start then raise exception 'GAME_ALREADY_STARTED'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.block_double_out_twin_on_reserve()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_twin public.games%rowtype;
begin
  -- Gemelo (lock de fila para lectura/escritura consistente dentro de la tx).
  select * into v_twin
    from public.games
   where id = new.alternative_game_id
   for update;

  -- Vínculo roto (gemelo inexistente o relación NO bidireccional): fallo
  -- explícito. Preferimos abortar A antes que bloquear una fila incorrecta.
  if not found or v_twin.alternative_game_id is distinct from new.id then
    raise exception 'DOUBLE_OUT_LINK_BROKEN';
  end if;

  -- Estado peligroso: el gemelo ya ganó el inventario físico → nunca permitir
  -- que A quede reserved a la vez (doble reserva del mismo slot). Aborta A.
  if v_twin.status = 'reserved' or v_twin.booked_by_user_id is not null then
    raise exception 'ALTERNATIVE_TAKEN';

  -- Estados "libres/aún ofertables": se sellan a 'blocked' recordando el previo.
  elsif v_twin.status in ('published', 'paused', 'draft') then
    update public.games
       set blocked_from_status = v_twin.status,
           status              = 'blocked'
     where id = v_twin.id;

  -- 'blocked' (ya sellado por una victoria previa de A) y terminales
  -- (canceled/completed/expired) → NO-OP: no se re-escribe blocked_from_status
  -- ni se toca el histórico.
  end if;

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$function$;

CREATE OR REPLACE FUNCTION public.can_delete_user_roles()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
        select exists (
          select 1 from public.user_roles r
           where r.user_id = auth.uid() and r.role::text = 'algrass_admin'
        );
      $function$;

CREATE OR REPLACE FUNCTION public.can_manage_championship_requests()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select exists (
    select 1 from public.user_roles
     where user_id = auth.uid()
       and role::text in ('algrass_admin', 'algrass_staff')
  );
$function$;

REVOKE ALL ON FUNCTION "public"."can_manage_championship_requests"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.can_manage_venue_manager_requests()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select exists (
    select 1
      from public.user_roles r
     where r.user_id = auth.uid()
       and r.role::text in ('algrass_admin', 'algrass_staff')
  );
$function$;

REVOKE ALL ON FUNCTION "public"."can_manage_venue_manager_requests"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.can_read_backoffice()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select exists (
    select 1
      from public.user_roles r
     where r.user_id = auth.uid()
       -- ::text para que funcione tanto si `role` es text como si es un enum.
       and r.role::text in ('algrass_admin', 'algrass_staff')
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_write_app_settings()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select exists (
    select 1
      from public.user_roles r
     where r.user_id = auth.uid()
       and r.role::text = 'algrass_admin'
  );
$function$;

REVOKE ALL ON FUNCTION "public"."can_write_app_settings"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.can_write_user_roles (
  p_role text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select exists (
    select 1
      from public.user_roles r
     where r.user_id = auth.uid()
       and (
         r.role::text = 'algrass_admin'
         or (
           r.role::text = 'algrass_staff'
           and p_role in ('captain', 'captain_gold')
         )
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.cancel_championship_contract (
  p_championship_id uuid,
  p_scope           text    DEFAULT 'full'::text,
  p_codes           text[]  DEFAULT NULL::text[],
  p_confirm_teams   boolean DEFAULT false,
  p_reason          text    DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_scope text := lower(btrim(coalesce(p_scope, '')));
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- El organizador no elige canchas: la cancha es inventario del campeonato y
  -- quitar una cambia lo contratado. Eso es una decisión de AlGrass.
  if v_scope not in ('full', 'extras') then raise exception 'INVALID_SCOPE'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- Con la fila tomada: el nucleo la vuelve a tomar —misma transaccion, sin coste—
  -- y asi el estado que se comprueba aqui no puede cambiar entre esta lectura y la suya.
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from v_actor then raise exception 'NOT_OWNER'; end if;

  -- La regla: solo con el pago confirmado y antes de publicar. En
  -- `payment_validation` no hay nada que devolver; publicado, ya no es solo suyo.
  if v_champ.status <> 'pending_publish' then
    raise exception 'CHAMPIONSHIP_NOT_CANCELABLE_BY_OWNER: %', v_champ.status;
  end if;

  -- El origen no se pregunta: si cancela el organizador desde el App, la
  -- cancelación es a su solicitud por definición. Lo que sí se exige, y lo exige
  -- el núcleo, es el motivo cuando se cancela todo.
  return public._championship_cancel_core(
    p_championship_id, v_scope, p_codes, null, null, 'owner', v_actor,
    p_confirm_teams, p_reason);
end $function$;

REVOKE ALL ON FUNCTION "public"."cancel_championship_contract"(uuid, text, text[], boolean, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.cancel_championship_registration_plaza (
  p_championship_id uuid,
  p_user_ids        uuid[]
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_cp    public.championship_players%rowtype;
  v_order public.orders%rowtype;
  v_spend public.reservations%rowtype;
  v_snap  jsonb;
  v_unit  numeric;
  v_reward numeric;
  v_oid   uuid;
  v_ids   uuid[];
  v_uid   uuid;
  v_amount numeric;
  v_key   text;
  v_refunded_total numeric := 0;
  v_canceled uuid[] := '{}';
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) x where x is not null;
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'NO_PLAYERS'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'CANCEL_WINDOW_CLOSED'; end if;

  foreach v_uid in array v_ids loop
    -- Fila VIVA de la plaza; si ya no está, idempotente → siguiente.
    select * into v_cp from public.championship_players
     where championship_id = p_championship_id and user_id = v_uid;
    if not found then continue; end if;
    v_oid := v_cp.registration_order_id;
    if v_oid is null then raise exception 'PLAYER_NOT_IN_ORDER'; end if;   -- plaza gratis no se cancela por aquí

    select * into v_order from public.orders where id = v_oid;
    if not found or v_order.status <> 'confirmed'
       or v_order.resource_id <> p_championship_id
       or coalesce(v_order.claim_composition->>'kind','') <> 'championship_registration' then
      raise exception 'INVALID_STATE';
    end if;

    -- Autorización: el PAYER de esa order puede cancelar cualquier plaza suya; un invitado solo la propia.
    if v_actor <> v_order.payer_user_id and v_actor <> v_uid then raise exception 'NOT_AUTHORIZED'; end if;

    select * into v_spend from public.reservations where order_id = v_oid and status = 'spend' limit 1;
    if not found then raise exception 'SPEND_NOT_FOUND'; end if;
    v_snap   := coalesce(v_order.financial_snapshot, '{}'::jsonb);
    v_unit   := coalesce((v_snap->>'unit_price')::numeric, 0);
    v_reward := coalesce((v_snap->>'reward_applied')::numeric, 0);
    v_key    := 'plaza:' || v_oid::text || ':' || v_uid::text;

    -- Retira la fila VIVA (fuente de participación). El histórico queda en el ledger (refund_scope).
    delete from public.championship_players where championship_id = p_championship_id and user_id = v_uid;

    -- Refund económico SOLO si hay importe (reward NUNCA vuelve). Idempotente por refund_scope key.
    v_amount := case when v_uid = v_order.payer_user_id then round(v_unit - v_reward, 2) else round(v_unit, 2) end;
    if v_amount > 0 and not exists (select 1 from public.reservations rr
                                     where rr.status = 'refund' and rr.refund_scope->>'key' = v_key) then
      perform public._championship_refund_one(p_championship_id, v_spend.id, v_amount,
        jsonb_build_object('kind', 'plaza', 'key', v_key, 'user_id', v_uid), v_actor);
      v_refunded_total := v_refunded_total + v_amount;
    end if;
    v_canceled := array_append(v_canceled, v_uid);
  end loop;

  return jsonb_build_object('championship_id', p_championship_id,
    'canceled', to_jsonb(v_canceled), 'refunded_total', round(v_refunded_total, 2));
end $function$;

REVOKE ALL ON FUNCTION "public"."cancel_championship_registration_plaza"(uuid, uuid[]) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.cancel_championship_team_registration (
  p_championship_id uuid,
  p_team_id         uuid,
  p_confirm         boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_team  public.championship_teams%rowtype;
  v_spend public.reservations%rowtype;
  v_refunded numeric;
  v_techo numeric := 0;
  v_others int;
  v_removed int;
  v_key   text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'CANCEL_WINDOW_CLOSED'; end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor or v_team.order_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select count(*) into v_others from public.championship_players
   where team_id = p_team_id and user_id <> v_actor;
  if v_others > 0 and not coalesce(p_confirm, false) then raise exception 'TEAM_HAS_MEMBERS'; end if;

  select * into v_spend from public.reservations where order_id = v_team.order_id and status = 'spend' limit 1;
  if not found then raise exception 'SPEND_NOT_FOUND'; end if;

  v_key := 'teamreg:' || v_team.order_id::text;
  if not exists (select 1 from public.reservations rr
                  where rr.status = 'refund' and rr.refund_scope->>'key' = v_key) then
    select coalesce(sum(coalesce(total_amount, 0)), 0) into v_refunded
      from public.reservations where status = 'refund' and refund_of_reservation_id = v_spend.id;
    v_techo := round(greatest(0, coalesce(v_spend.subtotal_amount, v_spend.total_amount, 0) - v_refunded), 2);
    if v_techo > 0 then
      perform public._championship_refund_one(p_championship_id, v_spend.id, v_techo,
        jsonb_build_object('kind', 'team', 'key', v_key, 'team_id', p_team_id), v_actor);
    end if;
  end if;

  delete from public.championship_players where team_id = p_team_id;
  get diagnostics v_removed = row_count;
  delete from public.championship_teams where id = p_team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id,
    'members_removed', v_removed, 'refunded', v_techo);
end $function$;

REVOKE ALL ON FUNCTION "public"."cancel_championship_team_registration"(uuid, uuid, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.cancel_double_out (
  p_game_id              uuid,
  p_cancel_reason        text,
  p_cancel_reason_detail text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor       uuid := auth.uid();
  v_a           public.games%rowtype;   -- game entrante (re-leído bajo lock)
  v_b           public.games%rowtype;   -- gemelo
  v_committed_a boolean;
  v_committed_b boolean;
  v_m_id        uuid;    -- miembro COMPROMETIDO (economía real)
  v_m_type      text;
  v_e_id        uuid;    -- gemelo VACÍO (cancelación directa)
  v_result      jsonb;
begin
  -- 1) Auth + autorización + parámetros (mismo patrón que cancel_match).
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_game_id is null then raise exception 'INVALID_GAME_ID'; end if;
  if p_cancel_reason is null or btrim(p_cancel_reason) = '' then raise exception 'CANCEL_REASON_REQUIRED'; end if;

  -- 2) Cargar A (sin lock) para decidir singleton vs par.
  select * into v_a from public.games where id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_a.status = 'canceled' then raise exception 'ALREADY_CANCELED'; end if;

  -- 3) SINGLETON → delega tal cual (comportamiento actual intacto).
  if v_a.alternative_game_id is null then
    if v_a.type = 'rental'
      then return public.cancel_rental(p_game_id, p_cancel_reason, p_cancel_reason_detail);
      else return public.cancel_match (p_game_id, p_cancel_reason, p_cancel_reason_detail);
    end if;
  end if;

  -- 4) PAR · Lock A+B por id (orden determinista compatible con gate/claim_rental).
  perform 1 from public.games
    where id in (v_a.id, v_a.alternative_game_id) order by id for update;
  -- Re-leer bajo lock.
  select * into v_a from public.games where id = p_game_id;
  select * into v_b from public.games where id = v_a.alternative_game_id;
  if not found then raise exception 'DOUBLE_OUT_LINK_BROKEN'; end if;

  -- 5) Reciprocidad + idempotencia bajo lock.
  if v_b.alternative_game_id is distinct from v_a.id then raise exception 'DOUBLE_OUT_LINK_BROKEN'; end if;
  if v_a.status = 'canceled' then raise exception 'ALREADY_CANCELED'; end if;

  -- 6) Guard de Orders PENDING vivas sobre AMBOS (prioridad del PENDING; aparte).
  if exists (
    select 1 from public.orders o
     where o.resource_id in (v_a.id, v_b.id)
       and o.status = 'pending'
       and o.pending_expires_at > now()
  ) then raise exception 'PAYMENT_IN_PROGRESS'; end if;

  -- 7) Compromiso DURABLE autoritativo por miembro (NO solo status='reserved').
  v_committed_a :=
       v_a.status = 'reserved'
    or exists (select 1 from public.game_players gp where gp.game_id = v_a.id and gp.status = 'confirmed')
    or exists (select 1 from public.game_slot_reservations r where r.game_id = v_a.id and r.reserved_slots_total > 0)
    or (v_a.type = 'rental' and v_a.booked_by_user_id is not null);
  v_committed_b :=
       v_b.status = 'reserved'
    or exists (select 1 from public.game_players gp where gp.game_id = v_b.id and gp.status = 'confirmed')
    or exists (select 1 from public.game_slot_reservations r where r.game_id = v_b.id and r.reserved_slots_total > 0)
    or (v_b.type = 'rental' and v_b.booked_by_user_id is not null);

  -- 8) Invariante: nunca compromiso real en AMBOS. Fail seguro (sin refunds).
  if v_committed_a and v_committed_b then raise exception 'DOUBLE_OUT_BOTH_COMMITTED'; end if;

  -- 9) Elegir comprometido (M) y vacío (E).
  if    v_committed_a then v_m_id := v_a.id; v_m_type := v_a.type; v_e_id := v_b.id;
  elsif v_committed_b then v_m_id := v_b.id; v_m_type := v_b.type; v_e_id := v_a.id;
  else  v_m_id := null;   -- ninguno comprometido (ambos published)
  end if;

  if v_m_id is not null then
    -- 10) Gemelo VACÍO PRIMERO (directo, sin 2ª economía). blocked/published→canceled
    --     NO dispara reopen → el reserved→canceled del comprometido no lo resucita.
    update public.games
       set status = 'canceled', blocked_from_status = null,
           cancel_reason = p_cancel_reason, cancel_reason_detail = p_cancel_reason_detail,
           cancelled_by_user_id = v_actor, cancelled_at = now()
     where id = v_e_id and status <> 'canceled';

    -- 11) Miembro COMPROMETIDO con la economía real existente (sin duplicar).
    if v_m_type = 'rental'
      then v_result := public.cancel_rental(v_m_id, p_cancel_reason, p_cancel_reason_detail);
      else v_result := public.cancel_match (v_m_id, p_cancel_reason, p_cancel_reason_detail);
    end if;
  else
    -- Ninguno comprometido: ambos published → cancelar ambos directo (sin economía).
    update public.games
       set status = 'canceled', blocked_from_status = null,
           cancel_reason = p_cancel_reason, cancel_reason_detail = p_cancel_reason_detail,
           cancelled_by_user_id = v_actor, cancelled_at = now()
     where id in (v_a.id, v_b.id) and status <> 'canceled';
    v_result := jsonb_build_object('ok', true, 'both_empty', true);
  end if;

  return coalesce(v_result, jsonb_build_object('ok', true));
end;
$function$;

REVOKE ALL ON FUNCTION "public"."cancel_double_out"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.cancel_guest_players (
  p_game_id  uuid,
  p_user_ids uuid[]
)
  RETURNS TABLE (
    id             uuid,
    user_id        uuid,
    amount         numeric,
    reservation_id uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  r       record;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  create temp table _cancelled_guests (
    id             uuid,
    user_id        uuid,
    amount         numeric,
    reservation_id uuid
  ) on commit drop;

  with upd as (
    update public.game_players gp
       set status               = 'canceled',
           canceled_at          = now(),
           counts_reserved_slot = false
     where gp.game_id  = p_game_id
       and gp.user_id  = any (coalesce(p_user_ids, '{}'::uuid[]))
       and gp.payer_id = v_actor
       and gp.status   = 'confirmed'
    returning gp.id, gp.user_id, gp.amount, gp.reservation_id
  )
  insert into _cancelled_guests (id, user_id, amount, reservation_id)
  select upd.id, upd.user_id, upd.amount, upd.reservation_id from upd;

  for r in
    select gsr.id
      from _cancelled_guests c
      join public.game_slot_reservations gsr
        on gsr.game_id             = p_game_id
       and gsr.reserved_by_user_id = c.user_id
       and gsr.status              = 'active'
  loop
    perform public.release_slot_reservation(r.id, 'manual_cancel_participation');
  end loop;

  return query
    select c.id, c.user_id, c.amount, c.reservation_id from _cancelled_guests c;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."cancel_guest_players"(uuid, uuid[]) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.cancel_match (
  p_game_id              uuid,
  p_cancel_reason        text,
  p_cancel_reason_detail text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_game  public.games%rowtype;   -- fila del partido BLOQUEADA (bloque 2); se reutiliza, games no se re-lee
  v_r1_ids            uuid[];     -- ids de R1 activas (bloque 4) → consumido por el bloque 5
  v_waitlist_user_ids uuid[];     -- user_id en waitlist 'waiting' (bloque 4) → audiencia del bloque 10
  v_r1_id             uuid;       -- iterador de v_r1_ids (bloque 5)
  v_pay               record;     -- iterador (payer_id, total) del bloque 8
  v_canceled_waitlist integer := 0;  -- nº de filas waitlist 'waiting'→'canceled' (bloque 6b) → resumen
  v_reason_text       text;          -- primera frase del custom_text según p_cancel_reason (bloque 10)
begin
  -- ── BLOQUE 1 · Validaciones iniciales ──────────────────────────────────────
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
      from public.user_roles
     where user_id = v_actor
       and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_game_id is null then
    raise exception 'INVALID_GAME_ID';
  end if;
  if p_cancel_reason is null or btrim(p_cancel_reason) = '' then
    raise exception 'CANCEL_REASON_REQUIRED';
  end if;

  -- ── BLOQUE 2 · Lock autoritativo del partido ───────────────────────────────
  select * into v_game
    from public.games g
   where g.id = p_game_id
   for update of g;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  if v_game.type is distinct from 'match' then
    raise exception 'NOT_A_MATCH';
  end if;
  if v_game.status = 'canceled' then
    raise exception 'ALREADY_CANCELED';
  end if;

  -- ── BLOQUE 3 · Guard de Orders PENDING vigentes ────────────────────────────
  if exists (
    select 1
      from public.orders o
     where o.resource_id = p_game_id
       and o.status = 'pending'
       and o.pending_expires_at > now()
  ) then
    raise exception 'PAYMENT_IN_PROGRESS';
  end if;

  -- ── BLOQUE 4 · Carga de datos auxiliares (bajo el lock) ─────────────────────
  select coalesce(array_agg(gsr.id), '{}'::uuid[])
    into v_r1_ids
    from public.game_slot_reservations gsr
   where gsr.game_id = p_game_id
     and gsr.status = 'active';

  select coalesce(array_agg(gw.user_id), '{}'::uuid[])
    into v_waitlist_user_ids
    from public.game_waitlist gw
   where gw.game_id = p_game_id
     and gw.status = 'waiting';

  -- ── BLOQUE 5 · Liberación de R1 (vía primitiva) ────────────────────────────
  foreach v_r1_id in array v_r1_ids loop
    perform public.release_slot_reservation(v_r1_id, 'admin');
  end loop;

  -- ── BLOQUE 6 · Cancelación de game_players (fuente autoritativa) ────────────
  create temp table _cancelled_players (
    id                 uuid,
    user_id            uuid,
    payer_id           uuid,
    amount             numeric,
    reservation_type   text,
    invited_by_user_id uuid
  ) on commit drop;

  with upd as (
    update public.game_players
       set status               = 'canceled',
           canceled_at          = now(),
           counts_reserved_slot = false
     where game_id = p_game_id
       and status = 'confirmed'
    returning id, user_id, payer_id, amount, reservation_type, invited_by_user_id
  )
  insert into _cancelled_players (id, user_id, payer_id, amount, reservation_type, invited_by_user_id)
  select id, user_id, payer_id, amount, reservation_type, invited_by_user_id
    from upd;

  -- ── BLOQUE 6b · Cancelación de game_waitlist ───────────────────────────────
  with wl as (
    update public.game_waitlist
       set status  = 'canceled',
           left_at = now()
     where game_id = p_game_id
       and status  = 'waiting'
    returning 1
  )
  select count(*)::integer into v_canceled_waitlist from wl;

  -- ── BLOQUE 7 · Construcción del ledger refund (append-only) ─────────────────

  -- 7a) PAGADOS (reservation_type='normal', amount>0): UNA fila por payer. SIN CAMBIOS.
  insert into public.reservations
    (game_id, user_id, canceled_by, status, unit_price, subtotal_amount,
     players_count, guest_total, canceled_at)
  select
    p_game_id,
    cp.payer_id,
    v_actor,
    'refund',
    min(cp.amount),
    sum(cp.amount),
    count(*),
    sum(case when cp.user_id is distinct from cp.payer_id then cp.amount else 0 end),
    now()
  from _cancelled_players cp
  where cp.reservation_type = 'normal'
    and cp.amount > 0
  group by cp.payer_id;

  -- 7b) INVITADOS (reservation_type='invited'): fila ANALÍTICA por invited_by. CAMBIO:
  --     economía TODO-0 (una invitación gratis vale 0 al crearla y al cancelarla). Sin
  --     wallet (neto 0), sin descuento ficticio. players_count = nº slots (conservado).
  insert into public.reservations
    (game_id, user_id, canceled_by, status, unit_price, promo_discount,
     subtotal_amount, total_amount, players_count, guest_total, canceled_at,
     reservation_type, invited_by_user_id)
  select
    p_game_id,
    cp.invited_by_user_id,
    v_actor,
    'refund',
    0,            -- unit_price
    0,            -- promo_discount
    0,            -- subtotal_amount
    0,            -- total_amount
    count(*),     -- players_count (nº slots invitados cancelados)
    0,            -- guest_total
    now(),
    'invited',
    cp.invited_by_user_id
  from _cancelled_players cp
  where cp.reservation_type = 'invited'
  group by cp.invited_by_user_id;

  -- ── BLOQUE 8 · Wallet refunds (vía primitiva) ──────────────────────────────
  for v_pay in
    select cp.payer_id as payer_id, sum(cp.amount) as total
      from _cancelled_players cp
     where cp.reservation_type = 'normal'
       and cp.amount > 0
     group by cp.payer_id
    having sum(cp.amount) > 0
  loop
    perform public.apply_wallet_refund(v_pay.payer_id, v_pay.total);
  end loop;

  -- ── BLOQUE 9 · Actualización del partido (estado terminal) ─────────────────
  update public.games
     set status               = 'canceled',
         cancel_reason        = p_cancel_reason,
         cancel_reason_detail = p_cancel_reason_detail,
         cancelled_by_user_id = v_actor,
         cancelled_at         = now()
   where id = p_game_id;

  -- ── BLOQUE 10 · Notificaciones "Partido cancelado" ─────────────────────────
  v_reason_text := 'Lamentamos informarte que el partido fue cancelado '
    || case p_cancel_reason
         when 'weather'        then 'por condiciones climáticas'
         when 'low_attendance' then 'por falta de jugadores'
         else                       'por un problema operativo'
       end
    || '.';

  insert into public.notifications
    (recipient_user_id, source_type, delivery_type, category, template_key,
     custom_text, game_id, created_by, sent_at)
  select
    aud.user_id,
    'venue', 'automatic', 'reservation', 'PARTIDO_CANCELADO',
    case when aud.paid
           then v_reason_text || E'\n\nEl crédito fue añadido a tu billetera.'
           else v_reason_text
         end,
    p_game_id, v_actor, now()
  from (
    select a.user_id, bool_or(a.credited) as paid
    from (
      select user_id,  false as credited from _cancelled_players
      union all
      select payer_id, false              from _cancelled_players
      union all
      select unnest(v_waitlist_user_ids), false
      union all
      select payer_id, true
        from _cancelled_players
       where reservation_type = 'normal' and amount > 0
    ) a
    where a.user_id is not null
    group by a.user_id
  ) aud;

  -- ── BLOQUE 11 · Return (resumen de observabilidad) ─────────────────────────
  return jsonb_build_object(
    'game_id',           p_game_id,
    'cancelled_players', (select count(*) from _cancelled_players),
    'refunded_payers',   (select count(distinct cp.payer_id)
                            from _cancelled_players cp
                           where cp.reservation_type = 'normal' and cp.amount > 0),
    'total_refunded',    (select coalesce(sum(cp.amount), 0)
                            from _cancelled_players cp
                           where cp.reservation_type = 'normal' and cp.amount > 0),
    'released_r1',       cardinality(v_r1_ids),
    'canceled_waitlist', v_canceled_waitlist,
    'notified',          (select count(*) from (
                            select user_id  from _cancelled_players
                            union
                            select payer_id from _cancelled_players
                            union
                            select unnest(v_waitlist_user_ids)
                          ) aud(user_id)
                          where aud.user_id is not null)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_rental (
  p_game_id              uuid,
  p_cancel_reason        text,
  p_cancel_reason_detail text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor       uuid := auth.uid();
  v_game        public.games%rowtype;   -- fila del rental BLOQUEADA (bloque 2); se reutiliza
  v_booker      uuid;                    -- booked_by_user_id (reserva vigente; solo para limpiar)
  v_spend_id    uuid;                    -- id del spend a reembolsar (bloque 4)
  v_refund_user uuid;                    -- user_id DUEÑO del spend = destinatario real del refund
  v_refund      numeric := 0;            -- monto del refund (subtotal ?? total del spend)
  v_notify_user uuid;                    -- destinatario de la notificación (spend, o booker si no hay spend)
  v_reason_text text;                    -- custom_text construido por el backend (bloque 8)
  v_notified    integer := 0;            -- 1 si se notificó; 0 si no
begin
  -- ── BLOQUE 1 · Validaciones iniciales ──────────────────────────────────────
  -- Misma filosofía que cancel_match: autenticar + autorizar + validar parámetros
  -- ANTES de tocar nada. Solo lee user_roles.
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
      from public.user_roles
     where user_id = v_actor
       and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_game_id is null then
    raise exception 'INVALID_GAME_ID';
  end if;
  if p_cancel_reason is null or btrim(p_cancel_reason) = '' then
    raise exception 'CANCEL_REASON_REQUIRED';
  end if;
  -- Motivos VÁLIDOS para rentals (contrato congelado). No existe low_attendance. Un
  -- token fuera de este conjunto es un error de integración: falla el RPC, no se
  -- absorbe como "problema operativo".
  if p_cancel_reason not in ('weather', 'venue_unavailable', 'venue_request', 'other') then
    raise exception 'INVALID_CANCEL_REASON';
  end if;

  -- ── BLOQUE 2 · Lock autoritativo del rental ────────────────────────────────
  -- Serializa contra create_order (que también bloquea games FOR UPDATE). Se captura
  -- la fila COMPLETA en v_game; games NO se vuelve a leer.
  select * into v_game
    from public.games g
   where g.id = p_game_id
   for update of g;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;
  if v_game.type is distinct from 'rental' then
    raise exception 'NOT_A_RENTAL';       -- los partidos van por cancel_match
  end if;
  if v_game.status = 'canceled' then
    raise exception 'ALREADY_CANCELED';   -- estado terminal; idempotente
  end if;

  -- ── BLOQUE 3 · Guard de Orders PENDING vigentes ────────────────────────────
  -- Idéntico a cancel_match: no cancelar mientras haya un pago externo REALMENTE en
  -- curso (pending con HOLD no vencido). Solo LEE orders.
  if exists (
    select 1
      from public.orders o
     where o.resource_id = p_game_id
       and o.status = 'pending'
       and o.pending_expires_at > now()
  ) then
    raise exception 'PAYMENT_IN_PROGRESS';
  end if;

  -- ── BLOQUE 4 · Carga spend + booker (bajo el lock) ─────────────────────────
  -- FUENTE DE VERDAD del refund = el spend, NO booked_by_user_id. Se busca el spend
  -- MÁS RECIENTE del GAME (no se filtra por booked_by: éste puede estar desincronizado
  -- en rentals pre-migración) y se captura su user_id DUEÑO → ese es quien recibe el
  -- refund/wallet/notificación. v_booker solo representa la reserva vigente (se limpia
  -- en el bloque 7). Sin spend → v_refund 0 y los bloques 5/6 se omiten.
  v_booker := v_game.booked_by_user_id;
  select r.id, r.user_id, coalesce(r.subtotal_amount, r.total_amount, 0)
    into v_spend_id, v_refund_user, v_refund
    from public.reservations r
   where r.game_id = p_game_id
     and r.status  = 'spend'
   order by r.reserved_at desc
   limit 1;
  if not found then
    v_spend_id    := null;
    v_refund_user := null;
    v_refund      := 0;
  end if;

  -- ── BLOQUE 5 · Refund ledger (append-only, forma EXACTA de cancelRental) ────
  -- Solo si hay spend con monto>0. user_id = DUEÑO del spend (v_refund_user), NO el
  -- booker. canceled_by = admin.
  if v_spend_id is not null and v_refund > 0 then
    insert into public.reservations
      (game_id, user_id, canceled_by, status, unit_price, subtotal_amount,
       players_count, guest_total, source, refund_of_reservation_id, canceled_at)
    values
      (p_game_id, v_refund_user, v_actor, 'refund', v_refund, v_refund,
       1, 0, 'rental', v_spend_id, now());

    -- ── BLOQUE 6 · Wallet refund (primitiva existente) ───────────────────────
    perform public.apply_wallet_refund(v_refund_user, v_refund);
  end if;

  -- ── BLOQUE 7 · Actualización del rental (estado terminal) ──────────────────
  -- NUNCA vuelve a 'published' (queda terminal 'canceled'). Se limpia
  -- booked_by_user_id (igual que la cancelación normal) para que la reserva deje de
  -- estar vigente: el usuario deja de verla en su perfil y el Back Office no muestra
  -- reservante. Un solo UPDATE sobre la fila ya bloqueada.
  update public.games
     set status               = 'canceled',
         booked_by_user_id    = null,
         cancel_reason        = p_cancel_reason,
         cancel_reason_detail = p_cancel_reason_detail,
         cancelled_by_user_id = v_actor,
         cancelled_at         = now()
   where id = p_game_id;

  -- ── BLOQUE 8 · Notificación "Reserva cancelada" ────────────────────────────
  -- Destinatario = DUEÑO del spend (v_refund_user); si por inconsistencia no hubiera
  -- spend, fallback al booker para no dejar la reserva cancelada sin aviso. La línea del
  -- crédito se añade solo si hubo refund real (v_refund>0); si no, el MISMO mensaje sin
  -- esa última línea. Mismo patrón que PARTIDO_CANCELADO pero template PROPIO
  -- 'RESERVA_CANCELADA'; TODA la lógica del texto vive AQUÍ. Motivo → frase: 'weather'
  -- → condiciones climáticas; el resto → problema operativo (los rentals NO usan
  -- low_attendance).
  v_notify_user := coalesce(v_refund_user, v_booker);
  if v_notify_user is not null then
    v_reason_text := 'Lamentamos informarte que la reserva fue cancelada '
      || case p_cancel_reason
           when 'weather'           then 'por condiciones climáticas'
           when 'venue_unavailable' then 'por un problema operativo'
           when 'venue_request'     then 'por un problema operativo'
           when 'other'             then 'por un problema operativo'
         end
      || '.'
      || case when v_refund > 0 then E'\n\nEl crédito fue añadido a tu billetera.' else '' end;

    insert into public.notifications
      (recipient_user_id, source_type, delivery_type, category, template_key,
       custom_text, game_id, created_by, sent_at)
    values
      (v_notify_user, 'venue', 'automatic', 'reservation', 'RESERVA_CANCELADA',
       v_reason_text, p_game_id, v_actor, now());
    v_notified := 1;
  end if;

  -- ── BLOQUE 9 · Return (resumen de observabilidad) ──────────────────────────
  return jsonb_build_object(
    'game_id',        p_game_id,
    'booker_user_id', v_booker,
    'refund_user_id', v_refund_user,
    'refunded',       (v_refund > 0),
    'total_refunded', v_refund,
    'notified',       v_notified
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_rental_self (
  p_game_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_game     public.games%rowtype;
  v_start    timestamptz;
  v_now      timestamptz := now();
  v_pct      integer;
  v_spend_id uuid;
  v_gross    numeric := 0;
  v_refund   numeric := 0;
  v_tpl      text;
  v_full_h   integer;    -- rental_full_refund_cutoff_hours
  v_part_h   integer;    -- rental_partial_refund_cutoff_hours
  v_part_pct integer;    -- rental_partial_refund_percent
begin
  -- 1) Autenticación (nunca se acepta user_id del cliente).
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_id is null then raise exception 'INVALID_GAME_ID'; end if;

  -- 2) Lock autoritativo del game.
  select * into v_game
    from public.games g
   where g.id = p_game_id
   for update of g;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  -- 3) Propiedad y estado.
  if v_game.type is distinct from 'rental' then raise exception 'NOT_A_RENTAL'; end if;
  if v_game.status is distinct from 'reserved' then raise exception 'RENTAL_NOT_ACTIVE'; end if;
  if v_game.booked_by_user_id is distinct from v_actor then raise exception 'NOT_BOOKER'; end if;
  if v_game.date_key is null or v_game.time is null then raise exception 'GAME_START_UNAVAILABLE'; end if;

  -- 4) Recalcular el tramo AQUÍ con now() autoritativo (mismo criterio que la ventana).
  v_start := (v_game.date_key + v_game.time) at time zone 'America/Lima';

  -- Guard temporal: rental ya iniciado NO puede autocancelarse (antes de cualquier escritura).
  if v_start <= v_now then raise exception 'RENTAL_ALREADY_STARTED'; end if;

  -- Política desde app_settings id=1 (MISMA fuente que la ventana). SIN default oculto:
  -- si falta/NULL/inválido → ABORTAR aquí, ANTES de ledger/wallet/update/notificación.
  select s.rental_full_refund_cutoff_hours, s.rental_partial_refund_cutoff_hours, s.rental_partial_refund_percent
    into v_full_h, v_part_h, v_part_pct
    from public.app_settings s
   where s.id = 1;
  if v_full_h is null or v_part_h is null or v_part_pct is null
     or v_full_h < 0 or v_part_h < 0 or v_part_pct < 0 or v_part_pct > 100
     or v_full_h <= v_part_h then   -- coincide con el constraint: full > partial (estricto)
    raise exception 'CANCELLATION_CONFIG_UNAVAILABLE';
  end if;

  v_pct := case
             when v_now < v_start - v_full_h * interval '1 hour' then 100          -- tope estructural
             when v_now < v_start - v_part_h * interval '1 hour' then v_part_pct   -- antes: 50
             else 0                                                                -- piso estructural
           end;

  -- 5) Spend histórico autoritativo: el más reciente de ESTE game por el propio usuario.
  select r.id, coalesce(r.subtotal_amount, r.total_amount, 0)
    into v_spend_id, v_gross
    from public.reservations r
   where r.game_id = p_game_id
     and r.user_id = v_actor
     and r.status  = 'spend'
   order by r.reserved_at desc
   limit 1;

  -- 6) Refund definitivo = pago histórico × tramo, redondeado a 2 decimales.
  if v_spend_id is not null and v_pct > 0 then
    v_refund := round(v_gross * v_pct / 100.0, 2);
  else
    v_refund := 0;
  end if;

  -- 7) Refund > 0 → ledger (enlazado al spend original) + wallet, EXACTAMENTE una vez.
  if v_refund > 0 then
    insert into public.reservations
      (game_id, user_id, canceled_by, status, unit_price, subtotal_amount,
       players_count, guest_total, source, refund_of_reservation_id, canceled_at)
    values
      (p_game_id, v_actor, v_actor, 'refund', v_refund, v_refund,
       1, 0, 'rental', v_spend_id, now());

    perform public.apply_wallet_refund(v_actor, v_refund);
  end if;
  -- 8) refund = 0 → NO se crea ningún movimiento monetario/refund cero.

  -- 9) Liberar el horario (semántica de auto-cancelación Rental, idéntica a la actual).
  update public.games
     set status            = 'published',
         booked_by_user_id = null
   where id = p_game_id;

  -- 10) Notificación SIEMPRE. Tramo PARCIAL (antes v_pct=50) → plantilla dedicada.
  v_tpl := case
             when v_refund > 0 and v_pct = v_part_pct then 'reservation_cancelled_credit_partial'
             when v_refund > 0                        then 'reservation_cancelled_credit_self'
             else                                          'reservation_cancelled_no_refund'
           end;
  insert into public.notifications
    (recipient_user_id, source_type, delivery_type, category, template_key,
     reservation_id, game_id, created_by, sent_at)
  values
    (v_actor, 'venue', 'automatic',
     (case when v_refund > 0 then 'refund' else 'reservation' end)::public.notification_category,
     v_tpl, v_spend_id, p_game_id, v_actor, now());

  -- 11) Resultado autoritativo para la confirmación posterior de la UI.
  return jsonb_build_object(
    'ok',            true,
    'refund_pct',    v_pct,
    'refund_amount', v_refund,
    'game_id',       p_game_id
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."cancel_rental_self"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.captain_welcome_enqueue()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  -- Convertirse en Capitan, no serlo ya. En un UPDATE, si antes YA tenia uno de
  -- los dos roles, no hay evento que celebrar: ni se intenta encolar.
  --
  -- En INSERT no se mira nada: OLD no existe, y una fila nueva con rol de
  -- capitan siempre es alguien entrando.
  if tg_op = 'UPDATE' and old.role::text in ('captain', 'captain_gold') then
    return null;
  end if;

  begin
    insert into public.captain_welcome_emails (user_id)
    values (new.user_id)
    on conflict (user_id) do nothing;
  exception when others then
    -- Que no salga el correo es malo. Que no se conceda el rol es peor.
    raise warning 'captain_welcome_enqueue: no se pudo encolar la bienvenida de % [%]: %',
      new.user_id, sqlstate, sqlerrm;
  end;

  return null;   -- AFTER trigger: el valor devuelto se ignora
end $function$;

REVOKE ALL ON FUNCTION "public"."captain_welcome_enqueue"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.championship_requests_touch()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."championship_requests_touch"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.check_private_access (
  p_password text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
begin
  return p_password = 'algrass20261.';
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_captain_welcome_email (
  p_id           uuid,
  p_max_attempts integer DEFAULT 5
)
  RETURNS TABLE (
    id       uuid,
    user_id  uuid,
    attempts integer
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  update public.captain_welcome_emails e
     set status     = 'sending',
         claimed_at = now(),
         attempts   = e.attempts + 1
   where e.id = p_id
     and e.status in ('pending', 'failed')
     and e.attempts < p_max_attempts
  returning e.id, e.user_id, e.attempts;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_captain_welcome_email"(uuid, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.claim_rental_double_out_aware (
  p_game_id uuid,
  p_actor   uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor    uuid := coalesce(auth.uid(), p_actor);  -- browser: auth.uid(); confirm_order (service-role): p_actor
  v_alt      uuid;
  v_r_alt    uuid;
  v_twin_alt uuid;
  v_claimed  uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 1) Leer alternative_game_id SIN lock para decidir el conjunto a lockear en orden id.
  select alternative_game_id into v_alt from public.games where id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  if v_alt is null then
    -- SINGLETON: lockear SOLO R y REVALIDAR alternative_game_id bajo el lock.
    perform 1 from public.games where id = p_game_id for update;
    select alternative_game_id into v_alt from public.games where id = p_game_id;
    if v_alt is not null then
      raise exception 'DOUBLE_OUT_RACE';
    end if;
    -- Sigue singleton → claim normal (R ya lockeado; re-entrante en el UPDATE).
  else
    -- PAREJA: lockear R+gemelo en ORDER BY id FOR UPDATE (mismo orden que gate/create_order).
    perform 1 from public.games where id in (p_game_id, v_alt) order by id for update;
    -- Revalidar bajo el lock: la relación sigue siendo la misma y bidireccional.
    select alternative_game_id into v_r_alt    from public.games where id = p_game_id;
    select alternative_game_id into v_twin_alt from public.games where id = v_alt;
    if v_r_alt is distinct from v_alt or v_twin_alt is distinct from p_game_id then
      raise exception 'DOUBLE_OUT_LINK_BROKEN';
    end if;
  end if;

  -- 2) CLAIM idéntico al actual (con pareja dispara Paso 1 → sella el gemelo, re-entrante).
  update public.games
     set status = 'reserved', booked_by_user_id = v_actor
   where id = p_game_id
     and (status = 'published' or (status = 'reserved' and booked_by_user_id is null))
  returning id into v_claimed;

  -- 3) id si reclamó; NULL si 0 filas (RENTAL_TAKEN, semántica idéntica).
  return v_claimed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_welcome_email (
  p_id           uuid,
  p_max_attempts integer DEFAULT 5
)
  RETURNS TABLE (
    id       uuid,
    user_id  uuid,
    attempts integer
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  update public.welcome_emails e
     set status     = 'sending',
         claimed_at = now(),
         attempts   = e.attempts + 1
   where e.id = p_id
     and e.status in ('pending', 'failed')
     and e.attempts < p_max_attempts
  returning e.id, e.user_id, e.attempts;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_welcome_email"(uuid, integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.clear_double_out_on_delete()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  -- Solo si el game borrado pertenecía a una pareja. Actualiza EXCLUSIVAMENTE al
  -- gemelo superviviente (OLD.alternative_game_id); no toca type/status/precios/
  -- slot ni ningún otro dato. Idempotente: si ya están en NULL, es un no-op.
  -- alternative_game_id se incluye por robustez (la FK ya lo deja en NULL; aquí
  -- es redundante e inofensivo). Un game normal sin pareja: no hace nada.
  if old.alternative_game_id is not null then
    update public.games
       set alternative_game_id = null,
           overlap_group       = null,
           blocked_from_status = null
     where id = old.alternative_game_id;
  end if;
  return old;  -- AFTER DELETE: el valor de retorno se ignora.
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_venue_manager_request (
  p_request_id uuid,
  p_comment    text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_estado   text;
  v_comment  text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_manage_venue_manager_requests() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_comment := nullif(btrim(coalesce(p_comment, '')), '');

  if v_comment is null then
    raise exception 'CLOSE_COMMENT_REQUIRED';
  end if;
  if length(v_comment) > 2000 then
    raise exception 'CLOSE_COMMENT_TOO_LONG';
  end if;

  select status into v_estado
    from public.venue_manager_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  -- Ya cerrada: no se vuelve a cerrar ni se le cambia el comentario. Quien lo
  -- intente esta viendo una pantalla vieja.
  if v_estado = 'closed' then
    raise exception 'REQUEST_CLOSED';
  end if;

  update public.venue_manager_requests
     set status            = 'closed',
         closed_comment    = v_comment,
         closed_at         = now(),
         closed_by_user_id = v_actor
   where id = p_request_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'status',     'closed',
    'closed_by',  v_actor
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."close_venue_manager_request"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.confirm_championship_gateway_payment (
  p_championship_id uuid
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_order   public.orders%rowtype;
  v_ids     uuid[];
  v_lockset uuid[];
  v_n       integer;
  v_snap    jsonb;
  v_bruto   numeric;
  v_credito numeric;
  v_externo numeric;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;

  -- Idempotencia VERIFICADA: 'pending_publish' no-op solo si order confirmed + spend existente.
  if v_champ.status = 'pending_publish' then
    if v_champ.order_id is null then raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.orders where id = v_champ.order_id and status = 'confirmed') then
      raise exception 'INVALID_STATE'; end if;
    if not exists (select 1 from public.reservations where championship_id = p_championship_id and status = 'spend') then
      raise exception 'INVALID_STATE'; end if;
    return v_champ;
  end if;
  if v_champ.status <> 'gateway_hold' then raise exception 'INVALID_STATE'; end if;
  if v_champ.order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_order from public.orders where id = v_champ.order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  -- Composición autoritativa = CRG. Lock de {games ∪ gemelos} ORDER BY id.
  select array_agg(game_id order by game_id) into v_ids
    from public.championship_reservation_games where championship_id = p_championship_id;
  if v_ids is null or array_length(v_ids, 1) is null then raise exception 'CHAMPIONSHIP_NO_GAMES'; end if;
  v_n := array_length(v_ids, 1);
  select array_agg(distinct x order by x) into v_lockset
    from (
      select unnest(v_ids) as x
      union
      select g.alternative_game_id from public.games g where g.id = any(v_ids) and g.alternative_game_id is not null
    ) s;
  perform 1 from public.games where id = any(v_lockset) order by id for update;

  -- Revalidar TODAS: siguen rentals published, libres y sin championship_id (all-or-none).
  if (select count(*) from public.games
        where id = any(v_ids) and type = 'rental' and status = 'published'
          and booked_by_user_id is null and championship_id is null) <> v_n then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  -- MATERIALIZAR (una sola sentencia atómica): published→reserved + championship_id. Dispara
  -- trg_block_double_out_twin por cada rental → sus gemelos Match pasan a 'blocked' (mecanismo existente).
  -- Si algún gemelo ya estaba tomado → el trigger lanza ALTERNATIVE_TAKEN → rollback TOTAL (ninguna reserved).
  update public.games set status = 'reserved', championship_id = v_champ.id where id = any(v_ids);

  -- order → confirmed; championship → pending_publish.
  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now() where id = v_order.id;
  update public.championships set status = 'pending_publish', updated_at = now()
   where id = p_championship_id returning * into v_champ;

  -- Breakdown congelado (fuente única del dinero). bruto = amount_total; credit/external del snapshot.
  v_snap    := coalesce(v_order.financial_snapshot, '{}'::jsonb);
  v_bruto   := round(coalesce((v_snap->>'amount_total')::numeric, v_order.amount_total, 0), 2);
  v_credito := round(coalesce((v_snap->>'credit_applied')::numeric, 0), 2);
  v_externo := round(coalesce((v_snap->>'external_amount')::numeric, v_bruto - v_credito), 2);

  -- Asiento financiero: 1 spend (UNIQUE parcial reservations_championship_spend_uq = última barrera).
  -- unit_price=subtotal=bruto; total=externo; credit del snapshot (semántica del flujo público).
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, v_champ.id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship', coalesce(v_champ.payment_method, 'gateway'),
    v_bruto, v_externo, v_bruto, v_credito, 0, 0, null,
    now()
  );

  return v_champ;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."confirm_championship_gateway_payment"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.confirm_championship_registration (
  p_championship_id uuid,
  p_idempotency_key text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_order  public.orders%rowtype;
  v_champ  public.championships%rowtype;
  v_ids    uuid[];
  v_uid    uuid;
  v_snap   jsonb;
  v_unit   numeric;
  v_count  integer;
  v_guests numeric;
  v_reward numeric;
  v_subtotal numeric;
  v_credito  numeric;
  v_external numeric;
  v_method text;
  v_resv_id uuid;
  v_applied boolean;
  v_reason  text;
  v_part   text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.resource_type <> 'championship' or v_order.resource_id <> p_championship_id
     or coalesce(v_order.claim_composition->>'kind','') <> 'championship_registration' then
    raise exception 'INVALID_STATE';
  end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  if v_order.status = 'confirmed' then
    if exists (select 1 from public.reservations where order_id = v_order.id and status = 'spend') then
      return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed', 'already', true);
    end if;
    raise exception 'INVALID_STATE';
  end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'AVAILABILITY_CHANGED'; end if;

  select array(select jsonb_array_elements_text(v_order.claim_composition->'user_ids'))::uuid[] into v_ids;
  if v_ids is null or array_length(v_ids,1) is null then raise exception 'INVALID_STATE'; end if;

  foreach v_uid in array v_ids loop
    v_part := public._championship_participation(p_championship_id, v_uid);
    if v_part in ('paid_individual','team_owner') then raise exception 'AVAILABILITY_CHANGED'; end if;
    if v_uid <> v_actor and v_part = 'free_member' then raise exception 'AVAILABILITY_CHANGED'; end if;
  end loop;

  -- Materializar: cada jugador queda como inscripción individual (team_id null) de ESTA order.
  -- registration_order_id = v_order.id → fuente viva order↔plaza (reinscripción pisa con la order nueva).
  foreach v_uid in array v_ids loop
    insert into public.championship_players (championship_id, user_id, team_id, registration_order_id)
    values (p_championship_id, v_uid, null, v_order.id)
    on conflict (championship_id, user_id) do update set team_id = null, registration_order_id = v_order.id;
  end loop;

  v_snap     := v_order.financial_snapshot;
  v_unit     := round(coalesce((v_snap->>'unit_price')::numeric, v_order.amount_total), 2);
  v_count    := coalesce((v_snap->>'player_count')::int, array_length(v_ids,1));
  v_guests   := round(coalesce((v_snap->>'guest_total')::numeric, 0), 2);
  v_reward   := round(coalesce((v_snap->>'reward_applied')::numeric, 0), 2);
  v_subtotal := round(coalesce((v_snap->>'subtotal_amount')::numeric, v_order.amount_total), 2);
  v_credito  := round(coalesce((v_snap->>'credit_applied')::numeric, 0), 2);
  v_external := round(coalesce((v_snap->>'external_amount')::numeric, v_subtotal - v_credito), 2);

  v_method := case when coalesce((v_snap->>'external_amount')::numeric, v_order.amount_total) = 0
                        and v_order.amount_total > 0
                   then 'credit' else coalesce(v_order.payment_provider, 'gateway') end;

  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, players_count, guest_total,
    total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship_registration', v_method,
    v_unit, v_count, v_guests,
    v_external, v_subtotal, v_credito, v_reward, 0, null,
    now()
  ) returning id into v_resv_id;

  if v_reward > 0 then
    select applied, reason into v_applied, v_reason
      from public.consume_reward(v_order.payer_user_id, v_resv_id, v_reward);
    if not coalesce(v_applied, false) then
      raise exception 'REWARD_%', coalesce(v_reason, 'UNAVAILABLE');
    end if;
  end if;

  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
    'players', array_length(v_ids,1), 'subtotal_amount', v_subtotal,
    'external_amount', round(coalesce((v_snap->>'external_amount')::numeric, v_subtotal - v_credito), 2),
    'reward_applied', v_reward, 'already', false);
end $function$;

REVOKE ALL ON FUNCTION "public"."confirm_championship_registration"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.confirm_championship_team_registration (
  p_championship_id uuid,
  p_idempotency_key text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor   uuid := auth.uid();
  v_order   public.orders%rowtype;
  v_champ   public.championships%rowtype;
  v_cc      jsonb;
  v_team_id uuid;
  v_token   text;
  v_method  text;
  v_reward  numeric;
  v_unit    numeric;
  v_subtotal numeric;
  v_credito  numeric;
  v_external numeric;
  v_resv_id uuid;
  v_applied boolean;
  v_reason  text;
  v_existing_team public.championship_teams%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.resource_type <> 'championship' or v_order.resource_id <> p_championship_id
     or coalesce(v_order.claim_composition->>'kind','') <> 'championship_team_registration' then
    raise exception 'INVALID_STATE';
  end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  if v_order.status = 'confirmed' then
    select * into v_existing_team from public.championship_teams where order_id = v_order.id;
    if found then
      return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
        'team_id', v_existing_team.id, 'team_name', v_existing_team.name,
        'join_token', v_existing_team.join_token, 'already', true);
    end if;
    raise exception 'INVALID_STATE';
  end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  if v_order.pending_expires_at <= now() then raise exception 'ORDER_EXPIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.status <> 'registration_open' then raise exception 'AVAILABILITY_CHANGED'; end if;

  -- Revalidar bajo lock SOLO incompatibilidades PAGADAS (A/B/C). NO bloquear por existir en championship_players:
  -- un free_member/free_individual puede comprar equipo (su fila se MUEVE con el UPSERT de abajo).
  if public._championship_participation(p_championship_id, v_order.payer_user_id) = 'team_owner' then
    raise exception 'AVAILABILITY_CHANGED';
  end if;
  if exists (
    select 1 from public.championship_players cp
    join public.orders o2 on o2.id = cp.registration_order_id
    where cp.championship_id = p_championship_id
      and o2.payer_user_id = v_order.payer_user_id
      and o2.status = 'confirmed'
      and coalesce(o2.claim_composition->>'kind','') = 'championship_registration'
  ) then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  v_cc := v_order.claim_composition;

  -- 1) Crear el equipo (creator = payer; CLAVE EN TEXTO + token opaco del link + vínculo a la order).
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id, join_secret, join_token, order_id)
  values (p_championship_id,
          v_cc->>'team_name', nullif(v_cc->>'team_color',''), nullif(v_cc->>'team_design',''),
          v_order.payer_user_id, nullif(v_cc->>'join_secret',''), v_token, v_order.id)
  returning id into v_team_id;

  -- 2) Inscribir/MOVER al creador a SU equipo. UPSERT: si ya tenía fila gratuita (p.ej. free_member de otro
  --    equipo), su ÚNICA fila championship_players pasa al nuevo team_id (sin duplicado ni violación UNIQUE).
  --    registration_order_id = NULL EXPLÍCITO (invariante: owner de equipo pagado NO lleva order individual; la
  --    fuente del pago del equipo es championship_teams.order_id). Así un free_member que compra equipo no arrastra
  --    una registration_order_id individual.
  insert into public.championship_players (championship_id, user_id, team_id, registration_order_id)
  values (p_championship_id, v_order.payer_user_id, v_team_id, null)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id, registration_order_id = null;

  v_method := case when coalesce((v_order.financial_snapshot->>'external_amount')::numeric, v_order.amount_total) = 0
                   then 'credit' else coalesce(v_order.payment_provider, 'gateway') end;
  v_reward   := round(coalesce((v_order.financial_snapshot->>'reward_applied')::numeric, 0), 2);
  v_subtotal := round(coalesce((v_order.financial_snapshot->>'subtotal_amount')::numeric, v_order.amount_total), 2);
  v_credito  := round(coalesce((v_order.financial_snapshot->>'credit_applied')::numeric, 0), 2);
  v_external := round(coalesce((v_order.financial_snapshot->>'external_amount')::numeric, v_subtotal - v_credito), 2);
  v_unit     := round(coalesce((v_order.financial_snapshot->>'unit_price')::numeric, v_subtotal), 2);

  -- 3) Asiento financiero (1 spend por order). subtotal=bruto, total=externo, credit del snapshot, unit_price base.
  insert into public.reservations (
    game_id, championship_id, user_id, order_id,
    status, reservation_type, source, payment_method,
    unit_price, total_amount, subtotal_amount, credit_applied, reward_applied, promo_discount, promo_code_id,
    reserved_at
  ) values (
    null, p_championship_id, v_order.payer_user_id, v_order.id,
    'spend', 'championship', 'championship_team_registration', v_method,
    v_unit, v_external, v_subtotal, v_credito, v_reward, 0, null,
    now()
  ) returning id into v_resv_id;

  -- 4) Consumo de Reward (solo en éxito, contra la reserva spend).
  if v_reward > 0 then
    select applied, reason into v_applied, v_reason
      from public.consume_reward(v_order.payer_user_id, v_resv_id, v_reward);
    if not coalesce(v_applied, false) then
      raise exception 'REWARD_%', coalesce(v_reason, 'UNAVAILABLE');
    end if;
  end if;

  -- 5) Order → confirmed.
  update public.orders set status = 'confirmed', resolved_at = now(), updated_at = now()
   where id = v_order.id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'confirmed',
    'team_id', v_team_id, 'team_name', v_cc->>'team_name', 'join_token', v_token,
    'reward_applied', v_reward, 'already', false);
end $function$;

REVOKE ALL ON FUNCTION "public"."confirm_championship_team_registration"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.confirm_championship_transfer (
  p_championship_id uuid,
  p_voucher_ref     text DEFAULT NULL::text
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_order public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Lock de la fila (serializa contra el cron de expiración — carrera del 00:00).
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status = 'payment_validation' then return v_champ; end if;  -- idempotente (order ya en 'validation')
  if v_champ.status = 'canceled' then raise exception 'HOLD_EXPIRED'; end if; -- el cron ganó la carrera
  if v_champ.status <> 'transfer_hold' then raise exception 'INVALID_STATE'; end if;
  if v_champ.hold_expires_at is null or v_champ.hold_expires_at <= now() then raise exception 'HOLD_EXPIRED'; end if;

  -- Transición ATÓMICA del order asociado: pending → validation (NO terminal, SIN TTL).
  -- Se bloquea la fila del order (mismo lock lógico que el cron, que lo expira vía _release_hold).
  if v_champ.order_id is not null then
    select * into v_order from public.orders where id = v_champ.order_id for update;
    if not found then raise exception 'ORDER_NOT_FOUND'; end if;
    if v_order.status = 'validation' then
      null;  -- idempotente: ya confirmado en una llamada previa dentro de la misma tx lógica
    elsif v_order.status <> 'pending' then
      raise exception 'HOLD_EXPIRED';  -- expired/failed → el cron/otro terminal ganó; no confirmable
    else
      update public.orders
         set status             = 'validation',
             pending_expires_at = null,   -- 'validation' no expira automáticamente
             resolved_at        = null,   -- sigue NO terminal
             updated_at         = now()
       where id = v_champ.order_id;
    end if;
  end if;

  update public.championships
     set status = 'payment_validation',
         hold_expires_at = null,
         payment_voucher_ref = coalesce(p_voucher_ref, payment_voucher_ref),
         updated_at = now()
   where id = p_championship_id
  returning * into v_champ;
  return v_champ;
end;
$function$;

CREATE OR REPLACE FUNCTION public.consume_reward (
  p_user_id        uuid,
  p_reservation_id uuid,
  p_amount         numeric
)
  RETURNS TABLE (
    applied            boolean,
    reason             text,
    new_reward_balance numeric
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_key   text := 'spend:' || p_reservation_id::text;
  v_tx    public.reward_transactions%rowtype;
  v_new   numeric;
  v_owner uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_reservation_id is null then raise exception 'INVALID_RESERVATION'; end if;

  if auth.role() = 'service_role' then
    null;
  elsif auth.uid() is not null and auth.uid() = p_user_id then
    null;
  else
    raise exception 'NOT_AUTHORIZED';
  end if;

  select user_id into v_owner from public.reservations where id = p_reservation_id;
  if v_owner is null or v_owner <> p_user_id then raise exception 'RESERVATION_MISMATCH'; end if;

  insert into public.reward_transactions (user_id, type, amount, reservation_id, idempotency_key)
  values (p_user_id, 'spend', p_amount, p_reservation_id, v_key)
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning * into v_tx;

  if v_tx.id is null then
    select * into v_tx from public.reward_transactions where idempotency_key = v_key;
    if v_tx.id is not null
       and v_tx.user_id        = p_user_id
       and v_tx.reservation_id = p_reservation_id
       and v_tx.amount         = p_amount
       and v_tx.type           = 'spend' then
      select reward_balance into v_new from public.wallet_summary where user_id = p_user_id;
      return query select true, 'ALREADY_CONSUMED', coalesce(v_new, 0::numeric);
    else
      select reward_balance into v_new from public.wallet_summary where user_id = p_user_id;
      return query select false, 'REWARD_CONFLICT', coalesce(v_new, 0::numeric);
    end if;
    return;
  end if;

  update public.wallet_summary
     set reward_balance = reward_balance - p_amount
   where user_id = p_user_id and reward_balance >= p_amount
  returning reward_balance into v_new;

  if not found then
    delete from public.reward_transactions where id = v_tx.id;
    select reward_balance into v_new from public.wallet_summary where user_id = p_user_id;
    return query select false, 'INSUFFICIENT_REWARD', coalesce(v_new, 0::numeric);
    return;
  end if;

  return query select true, 'CONSUMED', v_new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."consume_reward"(uuid, uuid, numeric) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.count_promo_uses (
  p_promo_id uuid
)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select count(*)::integer
    from public.reservations
   where status = 'spend'
     and promo_code_id = p_promo_id;
$function$;

CREATE OR REPLACE FUNCTION public.create_championship_gateway_order (
  p_game_ids        uuid[],
  p_idempotency_key text,
  p_config          jsonb
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor     uuid := auth.uid();
  v_existing  public.orders%rowtype;
  v_champ     public.championships%rowtype;
  v_order     public.orders%rowtype;
  v_ids       uuid[];
  v_lockset   uuid[];
  v_count     integer;
  v_id        uuid;
  v_twin      uuid;
  v_rec       record;
  v_price     jsonb;
  v_total     numeric;
  v_city      text;
  v_reg_close timestamptz;
  v_hold_exp  timestamptz := now() + interval '10 minutes';
  -- ── Pago con saldo ──
  v_credito   numeric := 0;   -- crédito del usuario que se aplica (p_config.credit_applied)
  v_externo   numeric;        -- lo que queda por cobrar fuera (bruto − crédito)
  v_method    text;           -- método de pago: 'credit' si el saldo lo cubre todo
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Idempotencia (payer, key): reintentos devuelven el mismo hold. NUNCA se debita
  -- crédito aquí: el débito vive SOLO en la rama de creación, más abajo.
  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    select * into v_champ from public.championships where order_id = v_existing.id;
    if found then return v_champ; end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  -- Dedupe + orden determinista.
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  -- Conjunto a lockear = N rentals ∪ sus gemelos (double-out). Lock ORDER BY id (serializa carreras
  -- Championship↔Rental, Championship↔Match double-out y Championship↔Championship).
  select array_agg(distinct x order by x) into v_lockset
    from (
      select unnest(v_ids) as x
      union
      select g.alternative_game_id from public.games g
       where g.id = any(v_ids) and g.alternative_game_id is not null
    ) s;
  perform 1 from public.games where id = any(v_lockset) order by id for update;

  -- Revalidar TODAS las rentals bajo lock.
  if (select count(*) from public.games where id = any(v_ids)) <> v_count then
    raise exception 'AVAILABILITY_CHANGED';
  end if;
  foreach v_id in array v_ids loop
    perform public.assert_game_reservable(v_id, 'rental');
    -- rental, published, libre, sin championship_id (published_audience NO se usa para rechazar).
    if not exists (
      select 1 from public.games g
       where g.id = v_id and g.type = 'rental'
         and g.status = 'published' and g.booked_by_user_id is null and g.championship_id is null
    ) then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
    -- Rental pending vivo (Match/Rental normal) sobre esta rental → conflicto.
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
    -- CRG: ¿ya reclamada por otro Championship?  (UNIQUE(game_id) → 0/1 fila)
    --   canceled            → CRG huérfana: lazy reclaim (borrar) bajo lock.
    --   gateway_hold        → si su order sigue pending vivo → conflicto; si muerto → lazy reclaim.
    --   cualquier otro vivo → conflicto (transfer/payment_validation/pending_publish/registration_*/…).
    select c.status as cstatus, c.order_id as corder into v_rec
      from public.championship_reservation_games crg
      join public.championships c on c.id = crg.championship_id
     where crg.game_id = v_id;
    if found then
      if v_rec.cstatus = 'canceled' then
        delete from public.championship_reservation_games where game_id = v_id;
      elsif v_rec.cstatus = 'gateway_hold' then
        if exists (select 1 from public.orders o
                    where o.id = v_rec.corder and o.status = 'pending' and o.pending_expires_at > now()) then
          raise exception 'AVAILABILITY_CHANGED';
        else
          delete from public.championship_reservation_games where game_id = v_id;   -- gateway muerto → reclaim
        end if;
      else
        raise exception 'AVAILABILITY_CHANGED';
      end if;
    end if;
    -- Double-out: si la rental tiene gemelo (match), el gemelo no puede haber ganado ni tener pending vivo.
    select alternative_game_id into v_twin from public.games where id = v_id;
    if v_twin is not null then
      if exists (select 1 from public.games g
                  where g.id = v_twin and (g.status in ('reserved','blocked') or g.booked_by_user_id is not null)) then
        raise exception 'AVAILABILITY_CHANGED';
      end if;
      if exists (select 1 from public.orders o
                  where o.resource_id = v_twin and o.status = 'pending' and o.pending_expires_at > now()) then
        raise exception 'AVAILABILITY_CHANGED';
      end if;
    end if;
  end loop;

  -- PRECIO REAL (autoridad backend; misma función que quote/transfer). Valida ciudad/formato/lead/blocks.
  v_price     := public._championship_compute_price(v_ids, p_config->>'group_id', coalesce(p_config->'extras', '[]'::jsonb));
  v_total     := (v_price->>'amount_total')::numeric;
  v_city      := v_price->>'city';
  v_reg_close := (v_price->>'registration_closes_at')::timestamptz;

  -- ── El crédito que se aplica ──
  -- Viaja en p_config para no cambiar la aridez. Sin la clave, 0: comportamiento de
  -- siempre. Se acota contra el total que acaba de decir la cotización, no contra un
  -- importe recalculado aquí.
  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_total then
    raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total;
  end if;
  v_externo := round(v_total - v_credito, 2);
  -- Si el saldo lo cubre todo, el método es 'credit' (no habrá cobro externo); si no,
  -- se conserva EXACTAMENTE el método de hoy ('gateway' por defecto).
  v_method  := case when v_externo = 0 and v_total > 0 then 'credit'
                    else coalesce(nullif(p_config->>'payment_method',''), 'gateway') end;

  -- Championship en 'gateway_hold'. city/event_date/venue_id/registration_closes_at = autoridad backend.
  insert into public.championships (
    owner_user_id, status, payment_method, hold_expires_at, city,
    name, cover_theme, privacy, registration_key, results_public,
    event_date, start_time, end_time, venue_id, format_config, registration_closes_at
  ) values (
    v_actor, 'gateway_hold', v_method, v_hold_exp, v_city,
    p_config->>'name', p_config->>'cover_theme',
    coalesce(p_config->>'privacy', 'private'), p_config->>'registration_key',
    coalesce((p_config->>'results_public')::boolean, true),
    (v_price->>'event_date')::date, nullif(p_config->>'start_time','')::time,
    nullif(p_config->>'end_time','')::time, (v_price->>'venue_id')::uuid,
    coalesce(p_config->'format_config', '{}'::jsonb), v_reg_close
  ) returning * into v_champ;

  -- Order del campeonato — pending (TTL = hold). financial_snapshot = breakdown congelado
  -- + la memoria del pago (credit_applied, external_amount), de donde leen los dos triggers del núcleo.
  -- amount_total = EXTERNO (bruto − crédito), paridad con el flujo público. El BRUTO vive en
  -- financial_snapshot.amount_total (cotización) y en reservations.subtotal_amount (techo de reembolso).
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', v_champ.id,
    jsonb_build_object('kind', 'championship_gateway_hold', 'game_ids', to_jsonb(v_ids)),
    v_count, v_hold_exp,
    v_externo, coalesce(v_price->>'currency', 'PEN'),
    v_price || jsonb_build_object('credit_applied', v_credito, 'external_amount', v_externo),
    case when v_externo = 0 and v_total > 0 then 'credit' else nullif(p_config->>'payment_method','') end,
    'pending'
  ) returning * into v_order;

  update public.championships set order_id = v_order.id, updated_at = now() where id = v_champ.id;

  -- Claim LÓGICO: N filas CRG. LAS GAMES NO SE TOCAN (siguen published, championship_id NULL, twins intactos).
  insert into public.championship_reservation_games (championship_id, game_id)
  select v_champ.id, unnest(v_ids);

  -- ── El crédito, DESPUÉS de crear la order (de donde cuelga la restitución) ──
  -- SOLO en la rama de creación: el retorno idempotente de arriba no llega aquí, así
  -- que un reintento con la misma key no descuenta dos veces. Condicional: sin saldo
  -- lanza INSUFFICIENT_CREDIT y toda la transacción (champ+order+CRG) se revierte.
  if v_credito > 0 then
    perform public.spend_wallet_credit(v_actor, v_credito);
  end if;

  select * into v_champ from public.championships where id = v_champ.id;
  return v_champ;

exception
  when unique_violation then
    -- Carrera de idempotencia O choque de CRG.UNIQUE(game_id): otro ganó → sin claim parcial (rollback).
    select * into v_existing from public.orders where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    if found then
      select * into v_champ from public.championships where order_id = v_existing.id;
      if found then return v_champ; end if;
    end if;
    raise exception 'AVAILABILITY_CHANGED';
end;
$function$;

REVOKE ALL ON FUNCTION "public"."create_championship_gateway_order"(uuid[], text, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.create_championship_registration_order (
  p_championship_id uuid,
  p_idempotency_key text,
  p_user_ids        uuid[],
  p_config          jsonb  DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_existing public.orders%rowtype;
  v_champ    public.championships%rowtype;
  v_ids      uuid[];
  v_count    integer;
  v_unit     numeric;
  v_reward   numeric := 0;
  v_titular  numeric;
  v_guests   numeric;
  v_subtotal numeric;
  v_credito  numeric := 0;
  v_externo  numeric;
  v_method   text;
  v_order    public.orders%rowtype;
  v_uid      uuid;
  v_part     text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'amount_total', v_existing.amount_total,
      'external_amount', coalesce((v_existing.financial_snapshot->>'external_amount')::numeric, v_existing.amount_total),
      'status', v_existing.status);
  end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and v_champ.public_individual_price is not null) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_user_ids, '{}'::uuid[])) x where x is not null;
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then raise exception 'NO_PLAYERS'; end if;
  if not (v_actor = any(v_ids)) then raise exception 'PAYER_NOT_INCLUDED'; end if;
  if (select count(*) from public.users_public u where u.id = any(v_ids)) <> v_count then
    raise exception 'INVALID_INPUT';
  end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- Regla por persona (NO se toca championship_players aquí):
  --   · PAGADO ('paid_individual'/'team_owner') → bloqueado para TODOS (debe cancelar primero).
  --   · PAYER (v_uid = v_actor): permitido none/free_member/free_individual. Si es free_member,
  --     pasará Team→Sin equipo SOLO al confirmar SU propio pago (self-service, lo inicia él).
  --   · INVITADO (v_uid <> v_actor): 'free_member' BLOQUEADO — moverlo a team_id=NULL lo sacaría
  --     de su equipo sin que él lo inicie. 'free_individual' permitido (no está en ningún equipo:
  --     el upsert a NULL es no-op; solo pasa de sin-equipo gratis a pagado). 'none' permitido.
  foreach v_uid in array v_ids loop
    v_part := public._championship_participation(p_championship_id, v_uid);
    if v_part in ('paid_individual','team_owner') then
      raise exception 'ALREADY_ENROLLED';
    end if;
    if v_uid <> v_actor and v_part = 'free_member' then
      raise exception 'ALREADY_ENROLLED';
    end if;
  end loop;

  -- DESGLOSE (autoridad backend). unit = precio individual del campeonato.
  v_unit := v_champ.public_individual_price;
  -- REWARD: SOLO el titular, tope = unit_price (clamp inline; nunca confía en el monto crudo).
  v_reward   := least(greatest(0, round(coalesce((p_config->>'reward_applied')::numeric, 0), 2)), round(v_unit, 2));
  v_titular  := round(v_unit - v_reward, 2);                 -- titularNet (reward solo aquí)
  v_guests   := round((v_count - 1) * v_unit, 2);            -- guestsTotal (NUNCA descontado)
  v_subtotal := round(v_titular + v_guests, 2);              -- == unit*N - reward

  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_subtotal then raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_subtotal; end if;
  v_externo := round(v_subtotal - v_credito, 2);
  v_method  := case when v_externo = 0 then 'credit' else 'gateway' end;

  -- amount_total = EXTERNO (post-crédito) = contrato único. El bruto va en snapshot.subtotal_amount
  -- y en reservation.subtotal_amount; el trigger lo usa como v_bruto.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', p_championship_id,
    jsonb_build_object('kind', 'championship_registration', 'user_ids', to_jsonb(v_ids)),
    v_count, now() + interval '10 minutes',
    v_externo, 'PEN',
    jsonb_build_object('source','championship_registration',
      'unit_price', v_unit, 'player_count', v_count, 'guest_total', v_guests,
      'user_ids', to_jsonb(v_ids),
      'reward_applied', v_reward, 'subtotal_amount', v_subtotal,
      'credit_applied', v_credito, 'external_amount', v_externo),
    v_method,
    'pending'
  ) returning * into v_order;

  if v_credito > 0 then perform public.spend_wallet_credit(v_actor, v_credito); end if;

  return jsonb_build_object('order_id', v_order.id, 'amount_total', v_externo,
    'subtotal_amount', v_subtotal, 'external_amount', v_externo, 'reward_applied', v_reward,
    'credit_applied', v_credito, 'status', 'pending', 'payment_method', v_method);
end $function$;

REVOKE ALL ON FUNCTION "public"."create_championship_registration_order"(uuid, text, uuid[], jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.create_championship_team (
  p_championship_id uuid,
  p_name            text,
  p_color           text DEFAULT NULL::text,
  p_design          text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_cap   int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)
     and not public._is_algrass_staff(v_actor) then
    raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  v_cap := public._championship_team_capacity(v_champ.format_config);
  select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
  if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

  insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
    values (p_championship_id, v_name, nullif(btrim(coalesce(p_color, '')), ''), nullif(btrim(coalesce(p_design, '')), ''), v_actor)
    returning id into v_team_id;

  return jsonb_build_object('team_id', v_team_id, 'name', v_name);
end; $function$;

REVOKE ALL ON FUNCTION "public"."create_championship_team"(uuid, text, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.create_championship_team_registration_order (
  p_championship_id uuid,
  p_idempotency_key text,
  p_config          jsonb DEFAULT '{}'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_existing public.orders%rowtype;
  v_champ    public.championships%rowtype;
  v_name     text;
  v_color    text;
  v_design   text;
  v_secret   text;
  v_unit     numeric;
  v_reward   numeric := 0;
  v_total    numeric;
  v_credito  numeric := 0;
  v_externo  numeric;
  v_method   text;
  v_order    public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id, 'amount_total', v_existing.amount_total,
      'external_amount', coalesce((v_existing.financial_snapshot->>'external_amount')::numeric, v_existing.amount_total),
      'status', v_existing.status);
  end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and v_champ.public_team_price is not null) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  v_name   := nullif(btrim(coalesce(p_config->>'team_name', '')), '');
  v_color  := nullif(btrim(coalesce(p_config->>'team_color', '')), '');
  v_design := nullif(btrim(coalesce(p_config->>'team_design', '')), '');
  v_secret := nullif(btrim(coalesce(p_config->>'team_secret', '')), '');
  if v_name is null then raise exception 'TEAM_NAME_REQUIRED'; end if;
  if v_secret is null or length(v_secret) < 4 then raise exception 'TEAM_SECRET_REQUIRED'; end if;   -- mínimo 4

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  -- SIN guard genérico por championship_players: una participación GRATIS no bloquea (gratis → pagado permitido).
  -- (C) team_owner pagado ya existente → no comprar OTRO equipo. (A/B los cubre ACTIVE_INDIVIDUAL_RESERVATION.)
  if public._championship_participation(p_championship_id, v_actor) = 'team_owner' then
    raise exception 'ALREADY_ENROLLED';
  end if;
  -- (A/B) el actor es PAYER de una inscripción individual confirmada con ≥1 plaza VIVA (propia o de invitados).
  -- Fuente viva: championship_players.registration_order_id → orders. Si la plaza se canceló, la fila viva se borró
  -- (deja de contar); una reinscripción apunta a otra order. Las participaciones GRATIS tienen registration_order_id
  -- NULL → no entran al JOIN → no bloquean.
  if exists (
    select 1 from public.championship_players cp
    join public.orders o on o.id = cp.registration_order_id
    where cp.championship_id = p_championship_id
      and o.payer_user_id = v_actor
      and o.status = 'confirmed'
      and coalesce(o.claim_composition->>'kind','') = 'championship_registration'
  ) then
    raise exception 'ACTIVE_INDIVIDUAL_RESERVATION';
  end if;

  v_unit  := v_champ.public_team_price;
  v_reward := least(greatest(0, round(coalesce((p_config->>'reward_applied')::numeric, 0), 2)), round(v_unit, 2));
  v_total  := round(v_unit - v_reward, 2);

  v_credito := round(coalesce((p_config->>'credit_applied')::numeric, 0), 2);
  if v_credito < 0 then raise exception 'INVALID_CREDIT'; end if;
  if v_credito > v_total then raise exception 'CREDIT_EXCEEDS_TOTAL: % > %', v_credito, v_total; end if;
  v_externo := round(v_total - v_credito, 2);
  v_method  := case when v_externo = 0 then 'credit' else 'gateway' end;

  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, 'championship', p_championship_id,
    jsonb_build_object('kind', 'championship_team_registration',
      'team_name', v_name, 'team_color', v_color, 'team_design', v_design, 'join_secret', v_secret),
    1, now() + interval '10 minutes',
    v_externo, 'PEN',
    jsonb_build_object('source','championship_team_registration','unit_price',v_unit,
      'reward_applied', v_reward, 'subtotal_amount', v_total,
      'credit_applied', v_credito, 'external_amount', v_externo),
    v_method,
    'pending'
  ) returning * into v_order;

  if v_credito > 0 then perform public.spend_wallet_credit(v_actor, v_credito); end if;

  return jsonb_build_object('order_id', v_order.id, 'amount_total', v_externo,
    'subtotal_amount', v_total, 'external_amount', v_externo, 'reward_applied', v_reward,
    'credit_applied', v_credito, 'status', 'pending', 'payment_method', v_method);
end $function$;

REVOKE ALL ON FUNCTION "public"."create_championship_team_registration_order"(uuid, text, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.create_championship_transfer_hold (
  p_game_ids        uuid[],
  p_idempotency_key text,
  p_config          jsonb  DEFAULT '{}'::jsonb
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor        uuid := auth.uid();
  v_hold_expires timestamptz := now() + interval '10 minutes';
  v_existing     public.orders%rowtype;
  v_champ        public.championships%rowtype;
  v_order        public.orders%rowtype;
  v_ids          uuid[];
  v_lockset      uuid[];   -- N rentals ∪ twins → lock determinista
  v_id           uuid;
  v_twin         uuid;     -- gemelo Match de una rental (o null)
  v_count        integer;
  v_price        jsonb;
  v_total        numeric;
  v_city         text;
  v_reg_close    timestamptz;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_ids is null or array_length(p_game_ids, 1) is null then raise exception 'NO_GAMES'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then raise exception 'MISSING_IDEMPOTENCY_KEY'; end if;

  -- Idempotencia (payer, idempotency_key). Reintentos devuelven el mismo hold.
  select * into v_existing from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    select * into v_champ from public.championships where order_id = v_existing.id;
    if found then return v_champ; end if;
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  -- Dedupe + orden determinista (id asc).
  select array_agg(x order by x) into v_ids from (select distinct unnest(p_game_ids) x) s;
  v_count := array_length(v_ids, 1);
  if v_count is null or v_count < 1 then raise exception 'NO_GAMES'; end if;

  -- Conjunto a lockear = N rentals ∪ sus gemelos (double-out). Lock ORDER BY id (orden determinista,
  -- compatible con create_order → sin deadlock entre flujos).
  select array_agg(distinct x order by x) into v_lockset
    from (
      select unnest(v_ids) as x
      union
      select g.alternative_game_id from public.games g
       where g.id = any(v_ids) and g.alternative_game_id is not null
    ) s;
  perform 1 from public.games where id = any(v_lockset) order by id for update;

  -- Revalidar TODOS bajo lock: existen, rentals no empezados, publicados, sin booker y sin campeonato.
  if (select count(*) from public.games where id = any(v_ids)) <> v_count then
    raise exception 'AVAILABILITY_CHANGED';
  end if;
  foreach v_id in array v_ids loop
    perform public.assert_game_reservable(v_id, 'rental');
    -- order 'pending' vivo sobre ESTA rental (hold de pasarela/crédito de Match/Rental) → conflicto.
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
    -- [CAMBIO GATEWAY] esta rental reclamada por un Championship en 'gateway_hold' con order pending
    -- VIVO (pago por pasarela en curso). CRG.game_id es UNIQUE → sonda O(1). CRG histórico/huérfano
    -- (champ no gateway_hold, u order no pending / expirado) NO bloquea.
    if exists (
      select 1
        from public.championship_reservation_games crg
        join public.championships c on c.id = crg.championship_id
        join public.orders o on o.id = c.order_id
       where crg.game_id = v_id
         and c.status = 'gateway_hold'
         and o.status = 'pending'
         and o.pending_expires_at > now()
    ) then
      raise exception 'AVAILABILITY_CHANGED';
    end if;
    -- si la rental tiene gemelo double-out (Match), su twin no puede tener order 'pending' vivo.
    -- (La detección FÍSICA del twin ya ganado —reserved/blocked/booked— la sigue haciendo el trigger
    --  trg_block_double_out_twin al reservar; aquí SOLO se añade el pending vivo, que el trigger no ve.)
    select alternative_game_id into v_twin from public.games where id = v_id;
    if v_twin is not null then
      if exists (
        select 1 from public.orders o
         where o.resource_id = v_twin and o.status = 'pending' and o.pending_expires_at > now()
      ) then
        raise exception 'AVAILABILITY_CHANGED';
      end if;
    end if;
  end loop;
  if exists (
    select 1 from public.games
     where id = any(v_ids)
       and (status <> 'published' or booked_by_user_id is not null or championship_id is not null)
  ) then
    raise exception 'AVAILABILITY_CHANGED';
  end if;

  -- PRECIO REAL (autoridad final) con la MISMA función que quote. group_id lo elige el cliente (p_config),
  -- pero service_court_hours/tarifas los posee el backend. Valida formato/ciudad/settings/lead-days/extras.
  v_price     := public._championship_compute_price(v_ids, p_config->>'group_id', coalesce(p_config->'extras', '[]'::jsonb));
  v_total     := (v_price->>'amount_total')::numeric;
  v_city      := v_price->>'city';
  v_reg_close := (v_price->>'registration_closes_at')::timestamptz;

  -- Crear el championship en 'transfer_hold'. city/event_date/venue_id/registration_closes_at = autoridad backend.
  insert into public.championships (
    owner_user_id, status, payment_method, hold_expires_at, city,
    name, cover_theme, privacy, registration_key, results_public,
    event_date, start_time, end_time, venue_id, format_config, registration_closes_at
  ) values (
    v_actor, 'transfer_hold', 'transfer', v_hold_expires, v_city,
    p_config->>'name', p_config->>'cover_theme',
    coalesce(p_config->>'privacy', 'private'), p_config->>'registration_key',
    coalesce((p_config->>'results_public')::boolean, true),
    (v_price->>'event_date')::date, nullif(p_config->>'start_time','')::time,
    nullif(p_config->>'end_time','')::time, (v_price->>'venue_id')::uuid,
    coalesce(p_config->'format_config', '{}'::jsonb), v_reg_close
  ) returning * into v_champ;

  -- Order del campeonato — amount_total = TOTAL REAL; financial_snapshot = breakdown congelado.
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, status
  ) values (
    p_idempotency_key, v_actor, 'championship', v_champ.id,
    jsonb_build_object('kind', 'championship_transfer_hold', 'game_ids', to_jsonb(v_ids)),
    v_count, v_hold_expires,
    v_total, coalesce(v_price->>'currency', 'PEN'), v_price,
    'pending'
  ) returning * into v_order;

  update public.championships set order_id = v_order.id, updated_at = now() where id = v_champ.id;

  -- Adquirir: published → reserved + championship_id (booked_by permanece NULL). Dispara double-out block.
  update public.games set status = 'reserved', championship_id = v_champ.id where id = any(v_ids);

  insert into public.championship_reservation_games (championship_id, game_id)
  select v_champ.id, unnest(v_ids);

  select * into v_champ from public.championships where id = v_champ.id;
  return v_champ;

exception
  when unique_violation then
    select * into v_existing from public.orders where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    if found then
      select * into v_champ from public.championships where order_id = v_existing.id;
      if found then return v_champ; end if;
    end if;
    raise exception 'AVAILABILITY_CHANGED';
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_double_out (
  p_source_id     uuid,
  p_price         numeric,
  p_twin_audience text    DEFAULT 'public'::text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_src   public.games%rowtype;
  v_twin_type text;
  v_twin_id   uuid;
  v_players   integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_twin_audience not in ('public', 'captain') then raise exception 'INVALID_AUDIENCE'; end if;

  select * into v_src from public.games where id = p_source_id for update;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_src.alternative_game_id is not null then raise exception 'ALREADY_PAIRED'; end if;
  if v_src.status <> 'published' then raise exception 'SOURCE_NOT_PUBLISHED'; end if;
  if v_src.type not in ('match','rental') then raise exception 'INVALID_TYPE'; end if;
  if p_price is null or p_price <= 0 then raise exception 'INVALID_PRICE'; end if;

  v_twin_type := case when v_src.type = 'match' then 'rental' else 'match' end;
  v_players   := coalesce(split_part(lower(v_src.format), 'v', 1)::int * 2, 0);

  insert into public.games (
    field_id, type, status, format, total_spots, duration_min,
    date_key, time, host_user_id,
    price_per_person, price_total,
    alternative_game_id, overlap_group, published_audience
  ) values (
    v_src.field_id, v_twin_type, 'published', v_src.format,
    v_players, v_src.duration_min,
    v_src.date_key, v_src.time, v_src.host_user_id,
    case when v_twin_type = 'match'  then p_price else null end,
    case when v_twin_type = 'rental' then p_price else null end,
    v_src.id, v_src.id, p_twin_audience
  )
  returning id into v_twin_id;

  update public.games
     set alternative_game_id = v_twin_id,
         overlap_group       = v_src.id
   where id = v_src.id;

  return v_twin_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order (
  p_idempotency_key    text,
  p_resource_type      text,
  p_resource_id        uuid,
  p_claim_composition  jsonb,
  p_amount_total       numeric,
  p_currency           text,
  p_financial_snapshot jsonb,
  p_pending_expires_at timestamp with time zone,
  p_payment_provider   text                     DEFAULT NULL::text
)
  RETURNS public.orders
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor      uuid := auth.uid();
  v_existing   public.orders%rowtype;
  v_units      integer;
  v_host       uuid;
  v_booked_by  uuid;
  v_champ_id   uuid;   -- [CHAMPIONSHIP GUARD] championship_id del game (Fase 2)
  v_avail      integer;
  v_holds      integer;
  v_referral          uuid;
  v_referral_reserved integer := 0;
  v_titular    boolean;
  v_order      public.orders%rowtype;
  v_alt          uuid;                     -- [DOUBLE-OUT] gemelo (o null)
  v_twin         public.games%rowtype;     -- [DOUBLE-OUT] fila del gemelo B (si pareja válida)
  v_status       text;                     -- [DOUBLE-OUT] status del game solicitado (solo rama con pareja)
  v_twin_paired  boolean := false;         -- [DOUBLE-OUT] true solo si A↔B es bidireccional
begin
  -- 1) Sesión
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 2) Idempotencia
  select * into v_existing
    from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  -- 3) Entrada mínima (amount_total=0 válido para HOLD de crédito/invitado; solo < 0 se rechaza).
  if p_amount_total is null or p_amount_total < 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_pending_expires_at is null or p_pending_expires_at <= now() then raise exception 'INVALID_TTL'; end if;
  if p_resource_type not in ('match','rental') then raise exception 'INVALID_RESOURCE_TYPE'; end if;

  -- 4) Unidades del HOLD
  v_titular := coalesce((p_claim_composition->>'titular')::boolean, false);
  if p_resource_type = 'rental' then
    v_units := 1;
  else
    v_units := (case when v_titular then 1 else 0 end)
             + coalesce(jsonb_array_length(p_claim_composition->'guests'), 0)
             + coalesce((p_claim_composition->>'reserved_slots')::integer, 0);
  end if;
  if v_units < 1 then raise exception 'EMPTY_CLAIM'; end if;

  -- 5) Bloqueo DETERMINISTA (double-out): leer alternative_game_id y lockear A+B ORDER BY id.
  select g.alternative_game_id into v_alt
    from public.games g
   where g.id = p_resource_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  if v_alt is null then
    select g.host_user_id, g.booked_by_user_id, g.championship_id, g.alternative_game_id
      into v_host, v_booked_by, v_champ_id, v_alt
      from public.games g
     where g.id = p_resource_id
     for update of g;
    if v_alt is not null then
      raise exception 'NO_CAPACITY';
    end if;
  else
    perform 1 from public.games
     where id in (p_resource_id, v_alt)
     order by id
     for update;
    select g.host_user_id, g.booked_by_user_id, g.championship_id, g.status
      into v_host, v_booked_by, v_champ_id, v_status
      from public.games g
     where g.id = p_resource_id;
    select * into v_twin from public.games where id = v_alt;
    if not found or v_twin.alternative_game_id is distinct from p_resource_id then
      raise exception 'NO_CAPACITY';
    end if;
    v_twin_paired := true;
  end if;

  -- 6) Precondiciones
  perform public.assert_game_reservable(p_resource_id, p_resource_type);
  if p_resource_type = 'match' and v_titular and v_host is not null and v_host = v_actor then
    raise exception 'HOST_CANNOT_RESERVE';
  end if;

  -- 7) Capacidad OFICIAL (INTACTA)
  if p_resource_type = 'match' then
    v_avail := public.public_availability(p_resource_id);
    v_referral := nullif(p_financial_snapshot->>'referral', '')::uuid;
    if v_referral is not null then
      select coalesce(gsr.effective_reserved_slots_remaining, 0)
        into v_referral_reserved
        from public.get_slot_reservation_for_user(p_resource_id, v_referral) gsr;
    end if;
    select coalesce(sum(o.claimed_units), 0)::integer
      into v_holds
      from public.orders o
     where o.resource_id = p_resource_id
       and o.status = 'pending'
       and o.pending_expires_at > now();
    if coalesce((p_claim_composition->>'reserved_slots')::integer, 0) > greatest(v_avail - v_holds, 0) then
      raise exception 'INSUFFICIENT_PUBLIC_SLOTS';
    end if;
    if (v_avail + v_referral_reserved - v_holds) < v_units then raise exception 'NO_CAPACITY'; end if;
  else
    -- rental: 1 unidad.
    if v_booked_by is not null then raise exception 'NO_CAPACITY'; end if;
    if v_champ_id is not null then raise exception 'NO_CAPACITY'; end if;   -- [CHAMPIONSHIP GUARD, Fase 2]
    if exists (
      select 1 from public.orders o
       where o.resource_id = p_resource_id and o.status = 'pending' and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
    -- ── CAMBIO 1 [CHAMPIONSHIP GATEWAY] ──────────────────────────────────────────────
    -- Esta Rental reclamada por un Championship en 'gateway_hold' con order pending vivo → NO_CAPACITY.
    -- CRG.game_id es UNIQUE (sonda O(1)); NO JSON, NO GIN, NO tabla nueva.
    if exists (
      select 1
        from public.championship_reservation_games crg
        join public.championships c on c.id = crg.championship_id
        join public.orders o on o.id = c.order_id
       where crg.game_id = p_resource_id
         and c.status = 'gateway_hold'
         and o.status = 'pending'
         and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
  end if;

  -- 7b) DOUBLE-OUT (INTACTO): el gemelo es incompatible mientras el game solicitado sigue 'published'.
  if v_twin_paired and v_status = 'published' then
    if v_twin.status in ('reserved','blocked') or v_twin.booked_by_user_id is not null then
      raise exception 'NO_CAPACITY';
    end if;
    if exists (
      select 1 from public.orders o
       where o.resource_id = v_alt
         and o.status = 'pending'
         and o.pending_expires_at > now()
    ) then
      raise exception 'NO_CAPACITY';
    end if;
    -- ── CAMBIO 2 [CHAMPIONSHIP GATEWAY] ──────────────────────────────────────────────
    -- El Rental GEMELO (v_alt) reclamado por un Championship 'gateway_hold' con order pending vivo →
    -- NO_CAPACITY. (Para un match-order v_alt es su Rental gemelo; para un rental-order v_alt es un
    -- match, que nunca está en CRG → no-op. Championship jamás reclama Matches directamente.)
    if exists (
      select 1
        from public.championship_reservation_games crg
        join public.championships c on c.id = crg.championship_id
        join public.orders o on o.id = c.order_id
       where crg.game_id = v_alt
         and c.status = 'gateway_hold'
         and o.status = 'pending'
         and o.pending_expires_at > now()
    ) then raise exception 'NO_CAPACITY'; end if;
  end if;

  -- 8) Adquirir el HOLD (única escritura)
  insert into public.orders (
    idempotency_key, payer_user_id, resource_type, resource_id,
    claim_composition, claimed_units, pending_expires_at,
    amount_total, currency, financial_snapshot, payment_provider, status
  ) values (
    p_idempotency_key, v_actor, p_resource_type, p_resource_id,
    p_claim_composition, v_units, p_pending_expires_at,
    p_amount_total, coalesce(p_currency, 'PEN'), p_financial_snapshot, p_payment_provider, 'pending'
  )
  returning * into v_order;

  return v_order;

exception
  when unique_violation then
    select * into v_existing
      from public.orders
     where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
    return v_existing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_auth_user()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  DELETE FROM auth.users
  WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.delete_championship_fixture (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_deleted int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- La MISMA llave que usan las operaciones de roster: mover un jugador y tirar
  -- el calendario no pueden cruzarse a mitad.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Rol comprobado DENTRO, y ADMIN: esconder el botón no es una protección, y
  -- aquí no vale con ser staff.
  if not public._is_algrass_admin(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Con el calendario publicado hay gente mirándolo. Para borrarlo hay que
  -- volver antes a inscripciones cerradas, que es otra decisión y se toma
  -- aparte.
  if v_champ.status <> 'registration_closed' then raise exception 'INVALID_STATUS'; end if;

  -- Cualquier rastro de haberse jugado lo impide: marcador —el 0 incluido—,
  -- clasificado o un solo gol. Y lo impide ENTERO: no se borra «lo que no tiene
  -- resultado», porque un calendario a medias no es un calendario.
  if exists (
    select 1 from public.championship_matches m
     where m.championship_id = p_championship_id
       and public._championship_match_played(m.id)
  ) then
    raise exception 'FIXTURE_HAS_RESULTS';
  end if;

  -- Solo los partidos. El `cascade` hacia `championship_goals` no llega a
  -- disparar nunca: si hubiera un gol, ya se habría cortado arriba.
  delete from public.championship_matches where championship_id = p_championship_id;
  get diagnostics v_deleted = row_count;

  -- El campeonato se queda donde estaba. Borrar el calendario no es avanzar ni
  -- retroceder de fase.
  return jsonb_build_object('championship_id', p_championship_id, 'deleted', v_deleted);
end $function$;

REVOKE ALL ON FUNCTION "public"."delete_championship_fixture"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.delete_championship_team (
  p_championship_id uuid,
  p_team_id         uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_team    public.championship_teams%rowtype;
  v_is_owner   boolean;
  v_is_algrass boolean;
  v_can_delete boolean;
  v_creator_priv boolean;
  v_count int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  -- Regla universal: solo borrable con roster ACTUAL = 0 (recontado BAJO LOCK).
  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  if v_count > 0 then raise exception 'TEAM_HAS_PLAYERS'; end if;

  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);
  v_can_delete := public._champ_can_manage_roster(p_championship_id, v_actor, 'delete_team');

  if v_can_delete then
    null;  -- owner/host/AlGrass en ventana delete_team (PP/RO/RC; AlGrass +CAL/IP/CO)
  elsif v_champ.status = 'registration_open' then
    -- Jugador normal (Phase 11, REVERTIDO): cualquier equipo VACÍO NO privilegiado; NO requiere ser el creador.
    -- Equipo del owner/AlGrass (privilegiado) → solo owner/AlGrass (aquí v_can_delete ya lo cubrió).
    if v_creator_priv then raise exception 'NOT_AUTHORIZED'; end if;
  else
    raise exception 'NOT_OPEN';
  end if;

  delete from public.championship_teams where id = p_team_id;
  return jsonb_build_object('deleted', true);
end; $function$;

REVOKE ALL ON FUNCTION "public"."delete_championship_team"(uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.enforce_adult_birth_date()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  lima_today date;
begin
  -- Día calendario actual en Perú
  lima_today := (now() at time zone 'America/Lima')::date;

  -- NULL sigue permitido.
  -- Solo validamos cuando existe fecha de nacimiento.
  if new.birth_date is not null
     and new.birth_date > (lima_today - interval '18 years')::date then
    raise exception 'User must be at least 18 years old'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_capacity()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_spots INTEGER;
  v_count INTEGER;
  v_held  INTEGER;
BEGIN
  IF NEW.status IS DISTINCT FROM 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(total_spots, 0)
  INTO v_spots
  FROM games
  WHERE id = NEW.game_id
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_count
  FROM game_players
  WHERE game_id = NEW.game_id
    AND status = 'confirmed'
    AND id IS DISTINCT FROM NEW.id;

  -- held: capacidad garantizada aún NO usada por grupos que RETIENEN cupos
  -- (SOLO status='active'; released/expired/canceled no retienen), excluyendo el
  -- propio grupo del jugador. Con game_slot_reservation_id NULL (público),
  -- "id IS DISTINCT FROM NULL" es TRUE para todos → held de todos los grupos activos.
  SELECT COALESCE(SUM(reserved_slots_remaining), 0)
  INTO v_held
  FROM game_slot_reservations
  WHERE game_id = NEW.game_id
    AND status = 'active'
    AND id IS DISTINCT FROM NEW.game_slot_reservation_id;

  IF v_count + v_held >= v_spots THEN
    RAISE EXCEPTION 'GAME_FULL game_id=% current=% capacity=%',
      NEW.game_id, v_count, v_spots;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_championship_gateway_holds()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_id     uuid;
  v_status text;
  v_exp    timestamptz;
  v_order  uuid;
  v_n      integer := 0;
begin
  for v_id in
    select id from public.championships
     where status = 'gateway_hold' and hold_expires_at is not null and hold_expires_at <= now()
     order by id
  loop
    select status, hold_expires_at, order_id into v_status, v_exp, v_order
      from public.championships where id = v_id for update;
    if v_status = 'gateway_hold' and v_exp is not null and v_exp <= now() then
      if v_order is not null then
        update public.orders set status = 'expired', terminal_reason = 'timeout',
               resolved_at = now(), updated_at = now()
         where id = v_order and status = 'pending';
      end if;
      delete from public.championship_reservation_games where championship_id = v_id;
      update public.championships set status = 'canceled', updated_at = now() where id = v_id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."expire_championship_gateway_holds"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.expire_championship_transfer_holds()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_id     uuid;
  v_status text;
  v_exp    timestamptz;
  v_n      integer := 0;
begin
  for v_id in
    select id from public.championships
     where status = 'transfer_hold' and hold_expires_at is not null and hold_expires_at <= now()
     order by id
  loop
    -- Re-check BAJO lock (carrera vs confirm_championship_transfer): solo si sigue vencido.
    select status, hold_expires_at into v_status, v_exp
      from public.championships where id = v_id for update;
    if v_status = 'transfer_hold' and v_exp is not null and v_exp <= now() then
      -- Causa fijada por el cron (no por el frontend): vencimiento real → order 'expired'/timeout.
      perform public._championship_release_hold(v_id, 'timeout');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."expire_championship_transfer_holds"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.expire_orders()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_count integer;
begin
  update public.orders
     set status          = 'expired',
         terminal_reason = 'timeout',
         resolved_at     = now(),
         updated_at      = now()
   where status = 'pending'
     and pending_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;   -- nº de HOLDs liberados
end;
$function$;

CREATE OR REPLACE FUNCTION public.expire_slot_reservations()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  r       record;
  v_count integer := 0;
begin
  for r in
    select id
      from public.game_slot_reservations
     where status = 'active'
       and expires_at is not null
       and expires_at <= now()
     for update skip locked
  loop
    perform public.release_slot_reservation(r.id, 'automatic');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."expire_slot_reservations"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.expire_waitlists()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  update game_waitlist w
     set status  = 'expired',
         left_at = ((g.date_key::date + g.time) at time zone 'America/Lima')
    from games g
   where w.game_id = g.id
     and w.status  = 'waiting'
     and ((g.date_key::date + g.time) at time zone 'America/Lima') <= now();
$function$;

CREATE OR REPLACE FUNCTION public.fail_championship_gateway (
  p_championship_id uuid,
  p_reason          text DEFAULT NULL::text
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status = 'canceled' then return v_champ; end if;             -- idempotente
  if v_champ.status <> 'gateway_hold' then raise exception 'INVALID_STATE'; end if;

  if v_champ.order_id is not null then
    update public.orders
       set status = 'failed', terminal_reason = coalesce(nullif(btrim(p_reason), ''), 'payment_failed'),
           resolved_at = now(), updated_at = now()
     where id = v_champ.order_id and status = 'pending';
  end if;
  delete from public.championship_reservation_games where championship_id = p_championship_id;
  update public.championships set status = 'canceled', hold_expires_at = null, updated_at = now()
   where id = p_championship_id returning * into v_champ;
  return v_champ;   -- games siguen published, championship_id NULL, twins intactos; sin spend/refund/wallet
end;
$function$;

REVOKE ALL ON FUNCTION "public"."fail_championship_gateway"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.fail_championship_registration (
  p_championship_id uuid,
  p_idempotency_key text,
  p_reason          text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'failed' then return jsonb_build_object('order_id', v_order.id, 'status', 'failed'); end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  -- pending → failed: trg_orders_credit_restore devuelve el crédito aplicado. Sin games que liberar.
  update public.orders
     set status = 'failed', terminal_reason = coalesce(nullif(btrim(p_reason),''),'payment_failed'),
         resolved_at = now(), updated_at = now()
   where id = v_order.id and status = 'pending';
  return jsonb_build_object('order_id', v_order.id, 'status', 'failed');
end $function$;

REVOKE ALL ON FUNCTION "public"."fail_championship_registration"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.fail_championship_team_registration (
  p_championship_id uuid,
  p_idempotency_key text,
  p_reason          text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_order from public.orders
   where payer_user_id = v_actor and idempotency_key = p_idempotency_key;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status = 'failed' then return jsonb_build_object('order_id', v_order.id, 'status', 'failed'); end if;
  if v_order.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
  update public.orders
     set status = 'failed', terminal_reason = coalesce(nullif(btrim(p_reason),''),'payment_failed'),
         resolved_at = now(), updated_at = now()
   where id = v_order.id and status = 'pending';
  return jsonb_build_object('order_id', v_order.id, 'status', 'failed');
end $function$;

REVOKE ALL ON FUNCTION "public"."fail_championship_team_registration"(uuid, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.fail_order (
  p_order_id uuid,
  p_reason   text DEFAULT 'payment_rejected'::text
)
  RETURNS public.orders
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- CAS pending → failed (una sola transición). Solo el propio payer.
  update public.orders
     set status          = 'failed',
         terminal_reason = coalesce(p_reason, 'payment_rejected'),
         resolved_at     = now(),
         updated_at      = now()
   where id = p_order_id
     and payer_user_id = v_actor
     and status = 'pending'
  returning * into v_order;
  if found then return v_order; end if;

  -- No estaba 'pending' (ya terminal) o no pertenece al actor → idempotente:
  -- devolver el estado actual; si no existe/ajena → error.
  select * into v_order
    from public.orders
   where id = p_order_id and payer_user_id = v_actor;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  return v_order;   -- ya terminal (idempotente): se devuelve tal cual
end;
$function$;

CREATE OR REPLACE FUNCTION public.gate_match_double_out_commit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_game public.games%rowtype;
  v_twin public.games%rowtype;
begin
  -- Solo actúa sobre el COMPROMISO real (fila que queda 'confirmed').
  if new.status is distinct from 'confirmed' then
    return new;
  end if;
  -- Reactivación/idempotencia: si ya estaba 'confirmed', no es compromiso nuevo
  -- (cubre las UPDATE de adopción de R1, que mantienen status='confirmed').
  if tg_op = 'UPDATE' and old.status = 'confirmed' then
    return new;
  end if;

  -- Game del player.
  select * into v_game from public.games where id = new.game_id;
  if not found then
    return new;  -- sin game (no debería ocurrir); no interferir.
  end if;

  -- Defensa secundaria (commit tardío) · FAST-PATH: game ya CANCELADO antes de que corra
  -- el gate (cancelación completada). 'canceled' es terminal → la lectura sin lock basta;
  -- además es el ÚNICO punto que ataja un DOBLE SALIDA ya cancelado (que si no retornaría
  -- NEW en '<> published' antes de tomar lock). La CARRERA published→cancel→commit se
  -- cierra con las re-validaciones BAJO LOCK de más abajo (singleton y par). No altera
  -- paused/draft/blocked/reserved/published.
  if v_game.status = 'canceled' then
    raise exception 'GAME_CANCELED';
  end if;

  -- ── FAST PATHS ───────────────────────────────────────────────────────────
  if v_game.alternative_game_id is null then
    -- Re-validación conservadora BAJO lock (misma garantía que create_order): A pudo
    -- emparejarse (create_double_out) entre el SELECT sin lock de arriba y aquí. Se
    -- lockea y re-lee SOLO A — NUNCA el gemelo, para no romper el orden determinista
    -- A+B del primer compromiso (mantendríamos A y pediríamos B, invirtiendo el orden).
    select * into v_game from public.games where id = new.game_id for update;
    -- Re-validación BAJO lock: cierra published→cancel→commit (singleton). El game pudo
    -- cancelarse entre el SELECT sin lock y este FOR UPDATE; ahora la lectura es autoritativa.
    if v_game.status = 'canceled' then
      raise exception 'GAME_CANCELED';
    end if;
    if v_game.alternative_game_id is null then
      return new;                         -- sigue singleton: comportamiento actual intacto.
    end if;
    -- Apareció un gemelo bajo el lock → NO continuar como singleton. Abortar conservador
    -- (rollback del INSERT/UPDATE, sin huérfano); el reintento leerá la pareja desde el
    -- inicio y la adjudicará por el camino de primer compromiso.
    raise exception 'ALTERNATIVE_TAKEN';
  end if;
  if v_game.status = 'reserved' then
    return new;                           -- jugadores 2/3/4… del Match ya ganador.
  end if;
  if v_game.status = 'blocked' then
    raise exception 'ALTERNATIVE_TAKEN';  -- perdedor: nunca un confirmed dentro.
  end if;
  if v_game.status <> 'published' then
    return new;                           -- draft/paused/canceled/… no es el 1er compromiso Doble salida.
  end if;

  -- ── PRIMER COMPROMISO: A published + con pareja ──────────────────────────
  -- Lock determinista A+B por id (dentro de la tx del INSERT/UPDATE).
  perform 1 from public.games
   where id in (new.game_id, v_game.alternative_game_id)
   order by id
   for update;

  -- Re-leer estados DESPUÉS del lock (pudieron cambiar antes de obtenerlo).
  select * into v_game from public.games where id = new.game_id;
  select * into v_twin from public.games where id = v_game.alternative_game_id;

  -- Relación bidireccional válida.
  if not found or v_twin.alternative_game_id is distinct from new.game_id then
    raise exception 'DOUBLE_OUT_LINK_BROKEN';
  end if;

  -- Re-validación BAJO lock A+B: cierra published→cancel→commit (par Doble salida). A pudo
  -- pasar a 'canceled' (cancel_double_out) mientras este gate esperaba el lock; el re-read
  -- ya es autoritativo. Debe ir ANTES del '<> published → return new' para no dejar pasar
  -- el insert a un game cancelado.
  if v_game.status = 'canceled' then
    raise exception 'GAME_CANCELED';
  end if;

  -- Re-evaluar A tras el lock.
  if v_game.status = 'reserved' then
    return new;                           -- otro insert del propio A ya lo adjudicó.
  end if;
  if v_game.status = 'blocked' then
    raise exception 'ALTERNATIVE_TAKEN';  -- el gemelo ganó entre medias.
  end if;
  if v_game.status <> 'published' then
    return new;
  end if;

  -- El gemelo ya comprometido físicamente → nunca doble compromiso.
  if v_twin.status in ('reserved', 'blocked')
     or v_twin.booked_by_user_id is not null then
    raise exception 'ALTERNATIVE_TAKEN';
  end if;

  -- DEFENSA AÑADIDA (Paso 3): el gemelo tiene un Order PENDING VIVO → ese lado ya
  -- ganó TEMPORALMENTE la carrera. A no puede adjudicarse el compromiso todavía.
  -- Bajo el lock A+B (consistente con create_order, que lockea A+B antes de insertar
  -- su PENDING). Inocuo en Match-confirm (B no puede tener PENDING mientras A tiene el
  -- suyo, por el 7b); relevante solo para inserciones sin Order (p.ej. Admin).
  if exists (
    select 1 from public.orders o
     where o.resource_id = v_twin.id
       and o.status = 'pending'
       and o.pending_expires_at > now()
  ) then
    raise exception 'ALTERNATIVE_TAKEN';
  end if;

  -- Adjudicación atómica: A published→reserved. Dispara trg_block_double_out_twin
  -- (Paso 1), que sella B a 'blocked' guardando blocked_from_status. Después, al
  -- retornar NEW, el INSERT/UPDATE del game_player se materializa en la misma tx.
  update public.games
     set status = 'reserved'
   where id = new.game_id and status = 'published';

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_championship_fixture (
  p_championship_id uuid,
  p_replace         boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_champ    public.championships%rowtype;
  v_n        int;
  v_tpl      jsonb;
  v_previos  int;
  v_ventana  timestamp;
  v_carriles int;
  v_draw     jsonb;
  v_plan     jsonb;
  v_sin_sitio int;
  v_detalle  text;
  v_bloques  jsonb;     -- las reservas, en minutos relativos a la ventana
  v_asignados jsonb;    -- el plan que se va construyendo, partido a partido
  v_m        record;    -- el partido de la plantilla que toca colocar
  v_game     uuid;      -- el bloque elegido para ese partido
  v_field    uuid;      -- y su cancha
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Mismo cerrojo que el roster y el lifecycle: generar no puede cruzarse con
  -- alguien creando un equipo ni con una transición de fase.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Solo con las inscripciones cerradas. En PRE-LIVE el calendario ya está
  -- publicado y la gente lo está mirando; regenerarlo ahí sería cambiárselo
  -- debajo. Antes de cerrar, los equipos aún pueden cambiar.
  if v_champ.status <> 'registration_closed' then raise exception 'NOT_OPEN'; end if;

  -- ── Fixture previo: reemplazar es explícito, y nunca a costa de resultados ──
  select count(*) into v_previos
    from public.championship_matches where championship_id = p_championship_id;

  if v_previos > 0 and not coalesce(p_replace, false) then
    raise exception 'FIXTURE_EXISTS';
  end if;

  if v_previos > 0 then
    -- Un solo marcador, un solo clasificado o un solo gol bastan para negarse:
    -- regenerar los borraría, y eso no se hace en silencio.
    if exists (
      select 1 from public.championship_matches
       where championship_id = p_championship_id
         and (home_score is not null or away_score is not null or qualified_team_id is not null)
    ) or exists (
      select 1 from public.championship_goals g
        join public.championship_matches m on m.id = g.match_id
       where m.championship_id = p_championship_id
    ) then
      raise exception 'FIXTURE_HAS_RESULTS';
    end if;
  end if;

  -- ── Equipos ELEGIBLES, no la capacidad contratada ni las filas a secas ─────
  -- Compiten los que tienen al menos un jugador (ver el helper). Un equipo vacío
  -- no entra: jugaría contra nadie y falsearía la tabla de posiciones.
  select count(*) into v_n from public._championship_eligible_teams(p_championship_id);
  -- Con cero o un equipo no hay enfrentamiento posible. No se inventa un partido
  -- contra nadie: se dice que faltan equipos.
  if v_n < 2 then raise exception 'NOT_ENOUGH_TEAMS'; end if;

  v_tpl := public._championship_fixture_template(v_n);
  if v_tpl is null then
    raise exception 'FIXTURE_NO_TEMPLATE: no hay plantilla para % equipos (el catalogo cubre 2-16)', v_n;
  end if;

  -- ── La ventana física: el primer bloque reservado ──────────────────────────
  select min(g.date_key + g.time) into v_ventana
    from public.championship_reservation_games l
    join public.games g on g.id = l.game_id
   where l.championship_id = p_championship_id
     and g.date_key is not null and g.time is not null
     and coalesce(g.duration_min, 0) > 0;
  if v_ventana is null then raise exception 'NO_RESERVED_BLOCKS'; end if;

  -- ── El sorteo: letras A,B,C… → equipos reales, una sola vez ────────────────
  select jsonb_object_agg(s.letra, s.id) into v_draw
    from (
      select substr('ABCDEFGHIJKLMNOP', (row_number() over (order by random()))::int, 1) as letra,
             e.id
        -- Alias de COLUMNA explicito: la funcion devuelve `setof uuid`, no un
        -- registro, asi que sin `(id)` la columna se llama como la funcion y
        -- `e.id` no existe. Ese fue el fallo.
        from public._championship_eligible_teams(p_championship_id) as e(id)
    ) s;

  -- ── Las reservas, en minutos relativos a la ventana ───────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'game_id', g.id,
           'field_id', g.field_id,
           'inicio', (extract(epoch from ((g.date_key + g.time) - v_ventana)) / 60)::int,
           'fin',    (extract(epoch from ((g.date_key + g.time) - v_ventana)) / 60)::int
                     + g.duration_min
         ) order by (g.date_key + g.time), g.id), '[]'::jsonb)
    into v_bloques
    from public.championship_reservation_games l
    join public.games g on g.id = l.game_id
   where l.championship_id = p_championship_id
     and g.date_key is not null and g.time is not null
     and coalesce(g.duration_min, 0) > 0;

  -- ── El plan: a cada partido, una cancha que lo albergue ENTERO ─────────────
  -- La regla de negocio es por PARTIDO, no por columna: la cancha tiene que estar
  -- libre mientras dura ese partido, y nada más. El `court` de la plantilla dice
  -- cuántos partidos van a la vez —simultaneidad—, no qué cancha física los
  -- alberga, así que dos partidos de la misma columna pueden acabar en canchas
  -- distintas, y eso es correcto.
  --
  -- Lo que NO se admite es partir un partido entre dos bloques: tiene que caber
  -- entero en uno. Los DESCANSOS no consumen cancha, así que un hueco entre dos
  -- partidos puede cruzar de una reserva a otra sin que pase nada.
  --
  -- El emparejamiento es voraz y DETERMINISTA: los partidos se colocan en orden
  -- cronológico y, entre las canchas que pueden albergarlos, se elige la que
  -- termina ANTES —así los bloques largos quedan libres para los partidos
  -- tardíos— y, a igualdad, la que empieza antes y el id menor.
  v_asignados := '[]'::jsonb;

  for v_m in
    select (e->>'order')::int as ord, (e->>'court')::int as carril,
           (e->>'from')::int  as desde, (e->>'to')::int as hasta,
           e->>'stage' as stage, e->>'group_code' as grupo,
           e->>'a' as la, e->>'b' as lb
      from jsonb_array_elements(v_tpl->'matches') e
     order by 1
  loop
    v_game  := null;
    v_field := null;

    select (b->>'game_id')::uuid, (b->>'field_id')::uuid
      into v_game, v_field
      from jsonb_array_elements(v_bloques) b
     where (b->>'inicio')::int <= v_m.desde      -- el bloque ya ha empezado
       and (b->>'fin')::int    >= v_m.hasta      -- y no termina antes que el partido
       -- Y esa cancha no está ocupada por un partido ya colocado que se solape.
       -- Los que quedaron sin sitio tienen `field_id` nulo y no bloquean nada.
       and not exists (
         select 1 from jsonb_array_elements(v_asignados) a
          where a->>'field_id' = b->>'field_id'
            and (a->>'desde')::int < v_m.hasta
            and v_m.desde < (a->>'hasta')::int
       )
     order by (b->>'fin')::int, (b->>'inicio')::int, b->>'game_id'
     limit 1;

    -- Se apunta SIEMPRE, con o sin cancha: un partido sin sitio tiene que llegar
    -- al recuento de abajo para que el error diga cuántos son.
    v_asignados := v_asignados || jsonb_build_object(
      'ord',   v_m.ord,   'carril', v_m.carril,
      'desde', v_m.desde, 'hasta',  v_m.hasta,
      'stage', v_m.stage, 'grupo',  v_m.grupo,
      'la',    v_m.la,    'lb',     v_m.lb,
      'game_id', v_game,  'field_id', v_field
    );
  end loop;

  v_plan := v_asignados;

  select count(*) into v_carriles from (
    select 1 from public.championship_reservation_games l
      join public.games g on g.id = l.game_id
     where l.championship_id = p_championship_id
       and g.date_key is not null and g.time is not null and coalesce(g.duration_min, 0) > 0
     group by g.field_id
  ) s;

  -- ── ¿Cabe? ────────────────────────────────────────────────────────────────
  select count(*) into v_sin_sitio
    from jsonb_array_elements(v_plan) e where e->>'game_id' is null;

  if v_sin_sitio > 0 then
    -- El detalle es para que Admin sepa QUÉ falta, no solo que falta algo.
    v_detalle := format(
      'la plantilla de %s equipos necesita %s canchas simultaneas y %s minutos; la reserva tiene %s canchas. %s de %s partidos no caben',
      v_n, v_tpl->>'max_courts', v_tpl->>'span_min', v_carriles,
      v_sin_sitio, jsonb_array_length(v_tpl->'matches'));
    raise exception 'FIXTURE_CAPACITY_MISMATCH: %', v_detalle;
  end if;

  -- Ninguna CANCHA con dos partidos a la vez. El emparejamiento ya lo impide al
  -- elegir, pero se vuelve a comprobar sobre el plan entero: es la garantía de
  -- que no se reserva dos veces el mismo sitio, y sobrevive a que alguien cambie
  -- el criterio de elección.
  if exists (
    select 1
      from jsonb_array_elements(v_plan) x, jsonb_array_elements(v_plan) y
     where (x->>'ord')::int < (y->>'ord')::int
       and x->>'field_id' is not null
       and x->>'field_id' = y->>'field_id'
       and (x->>'desde')::int < (y->>'hasta')::int
       and (y->>'desde')::int < (x->>'hasta')::int
  ) then
    raise exception 'FIXTURE_COURT_OVERLAP';
  end if;

  -- Ningún equipo en dos partidos a la vez. Las plantillas ya lo garantizan, pero
  -- se comprueba: si mañana una se edita mal, aquí se para.
  if exists (
    select 1
      from jsonb_array_elements(v_plan) x, jsonb_array_elements(v_plan) y
     where (x->>'ord')::int < (y->>'ord')::int
       and (x->>'desde')::int < (y->>'hasta')::int
       and (y->>'desde')::int < (x->>'hasta')::int
       and x->>'la' is not null and y->>'la' is not null
       and array[x->>'la', x->>'lb'] && array[y->>'la', y->>'lb']
  ) then
    raise exception 'FIXTURE_TEAM_OVERLAP';
  end if;

  -- ── Escribir. A partir de aquí ya está todo validado ──────────────────────
  -- El borrado va DESPUÉS de las validaciones y en la misma transacción: si algo
  -- fallara, el fixture anterior sigue intacto.
  if v_previos > 0 then
    delete from public.championship_matches where championship_id = p_championship_id;
  end if;

  insert into public.championship_matches (
    championship_id, stage, group_code, home_team_id, away_team_id,
    game_id, start_time, duration_min, match_order
  )
  select p_championship_id,
         e->>'stage',
         e->>'grupo',
         (v_draw->>(e->>'la'))::uuid,
         (v_draw->>(e->>'lb'))::uuid,
         (e->>'game_id')::uuid,
         (v_ventana + make_interval(mins => (e->>'desde')::int))::time,
         (e->>'hasta')::int - (e->>'desde')::int,
         (e->>'ord')::int
    from jsonb_array_elements(v_plan) e;

  return jsonb_build_object(
    'championship_id', p_championship_id,
    'teams', v_n,
    'replaced', v_previos > 0,
    'matches', jsonb_array_length(v_plan),
    'courts_used', v_carriles,
    'window_start', v_ventana
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."generate_championship_fixture"(uuid, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.generate_user_code (
  p_full_name text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
DECLARE
  parts      text[];
  first_part text;
  last_part  text;
  candidate  text;
  attempts   int := 0;
BEGIN
  parts := regexp_split_to_array(trim(lower(unaccent(p_full_name))), '\s+');

  first_part := substring(
    regexp_replace(parts[1], '[^a-z]', '', 'g'),
    1,
    8
  );

  last_part := substring(
    regexp_replace(
      coalesce(array_to_string(parts[2:array_length(parts,1)], ''), ''),
      '[^a-z]',
      '',
      'g'
    ),
    1,
    3
  );

  LOOP
    candidate := first_part || last_part || (floor(random() * 999 + 1))::int::text;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM users WHERE user_code = candidate
    );

    attempts := attempts + 1;

    IF attempts > 50 THEN
      candidate := first_part || last_part ||
                   (extract(epoch from now())::int % 9999)::text;
      EXIT;
    END IF;
  END LOOP;

  RETURN candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_championship (
  p_championship_id uuid
)
  RETURNS TABLE (
    id                           uuid,
    name                         text,
    city                         text,
    status                       text,
    payment_method               text,
    payment_voucher_ref          text,
    order_id                     uuid,
    event_date                   date,
    start_time                   time without time zone,
    end_time                     time without time zone,
    venue_id                     uuid,
    owner_user_id                uuid,
    format_config                jsonb,
    privacy                      text,
    registration_key             text,
    results_public               boolean,
    registration_closes_at       timestamp with time zone,
    published_at                 timestamp with time zone,
    created_at                   timestamp with time zone,
    order_status                 text,
    order_terminal_reason        text,
    order_terminal_reason_detail text,
    financial_snapshot           jsonb,
    extras_purchases             jsonb,
    payment_vouchers             jsonb,
    team_capacity                integer,
    fixture_published_at         timestamp with time zone,
    live_started_at              timestamp with time zone,
    host_user_id                 uuid,
    host_full_name               text,
    host_user_code               text,
    host_city                    text,
    host_avatar_path             text,
    host_avatar_hue              integer,
    host_avatar_updated_at       timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.can_read_backoffice() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
    select c.id, c.name, c.city, c.status, c.payment_method,
           c.payment_voucher_ref, c.order_id,
           c.event_date, c.start_time, c.end_time, c.venue_id, c.owner_user_id,
           c.format_config, c.privacy, c.registration_key, c.results_public,
           c.registration_closes_at, c.published_at, c.created_at,
           o.status, o.terminal_reason, o.terminal_reason_detail,
           o.financial_snapshot,
           /* Las compras MANUALES de extras de este campeonato, y solo esas. Cuatro
              cosas quedan fuera a proposito:

                · el order principal —sus extras ya van en `financial_snapshot`, y
                  contarlos aqui los pintaria dos veces—;
                · los orders de canchas, que son del mismo campeonato;
                · los que estan en `validation`, que todavia no son un cobro;
                · y cualquier order futuro que lleve `extras` por otro motivo.

              Los dos ultimos son la razon de filtrar por `source` y no por «tiene un
              array de extras»: el marcador dice QUE ES la compra, no que forma
              tiene, y es lo unico que no envejece cuando aparezca otro flujo que
              guarde lineas parecidas. */
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'order_id',       o2.id,
                     'status',         o2.status,
                     'payment_method', coalesce(o2.financial_snapshot->>'payment_method', o2.payment_provider),
                     'amount_total',   o2.amount_total,
                     'purchased_at',   coalesce(o2.resolved_at, o2.created_at),
                     'extras',         o2.financial_snapshot->'extras')
                     order by coalesce(o2.resolved_at, o2.created_at), o2.id), '[]'::jsonb)
              from public.orders o2
             where o2.resource_type = 'championship'
               and o2.resource_id = c.id
               and (c.order_id is null or o2.id <> c.order_id)
               and o2.status = 'confirmed'
               and o2.financial_snapshot->>'source' = 'championship_extras_manual'),
           /* Los cobros manuales de este campeonato, de los DOS tipos: canchas
              añadidas y extras. Cada uno con su comprobante, si lo tiene —se
              devuelven también los que no lo tienen: saber que un cobro se registró
              sin comprobante es justo lo que hay que poder ver—.

              Del order principal no: su comprobante es `payment_voucher_ref`, y lo
              escribe el flujo del App. */
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'order_id',       o3.id,
                     'source',         o3.financial_snapshot->>'source',
                     'payment_method', coalesce(o3.financial_snapshot->>'payment_method', o3.payment_provider),
                     'amount_total',   o3.amount_total,
                     'voucher_ref',    o3.financial_snapshot->>'voucher_ref',
                     /* TODOS los comprobantes del cobro, y sin duplicados: la lista
                        que escribe el enganche. Un cobro ANTIGUO no la tiene -solo el
                        escalar- y se normaliza aqui, en la lectura: asi ni una fila
                        historica se reescribe para que la pantalla pueda pintarla. */
                     'vouchers',       case
                       when jsonb_typeof(o3.financial_snapshot->'vouchers') = 'array'
                         then o3.financial_snapshot->'vouchers'
                       when nullif(btrim(coalesce(o3.financial_snapshot->>'voucher_ref', '')), '') is not null
                         then jsonb_build_array(jsonb_build_object(
                              'ref',      o3.financial_snapshot->>'voucher_ref',
                              'filename', o3.financial_snapshot->>'voucher_filename',
                              'by',       o3.financial_snapshot->'voucher_by',
                              'at',       o3.financial_snapshot->'voucher_at'))
                       else '[]'::jsonb end,
                     /* El desglose CONGELADO de esta compra: lo que permite enseñar
                        QUE se compro -canchas, arbitro, trofeos- y no solo cuanto
                        costo. Ya estaba en la tabla; solo faltaba traerlo. */
                     'snapshot',       o3.financial_snapshot,
                     'purchased_at',   coalesce(o3.resolved_at, o3.created_at))
                     order by coalesce(o3.resolved_at, o3.created_at), o3.id), '[]'::jsonb)
              from public.orders o3
             where o3.resource_type = 'championship'
               and o3.resource_id = c.id
               -- El order PRINCIPAL ya no se excluye: la compra inicial creada desde el
               -- Back Office tambien acumula comprobantes, y de aqui los lee la ficha.
               -- Quien reparte los dos bloques es la pantalla, por `order_id`: asi el
               -- total contratado no cuenta la inicial dos veces.
               --
               -- `validation` entra porque la compra inicial se puede documentar
               -- mientras su pago se revisa. Las posteriores nacen `confirmed`, asi que
               -- para ellas esto no cambia nada.
               and o3.status in ('validation', 'confirmed')
               -- Y el campeonato del App sigue fuera: su snapshot no lleva `source`.
               and o3.financial_snapshot->>'source'
                     in ('championship_extra_court', 'championship_extras_manual',
                         'championship_admin_manual')),
           public._championship_team_capacity(c.format_config),
           c.fixture_published_at,
           c.live_started_at,
           c.host_user_id, h.full_name::text, h.user_code::text, h.city::text,
           h.avatar_path::text, h.avatar_hue::int, h.avatar_updated_at
      from public.championships c
      left join public.orders o on o.id = c.order_id
      -- LEFT JOIN: sin host, o con un host cuya cuenta ya no exista, el
      -- campeonato sigue apareciendo con esos campos vacíos.
      left join public.users_public h on h.id = c.host_user_id
     where c.id = p_championship_id;
end $function$;

REVOKE ALL ON FUNCTION "public"."get_admin_championship"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_admin_championship_fixture (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_read_backoffice() then raise exception 'NOT_AUTHORIZED'; end if;
  if not exists (select 1 from public.championships where id = p_championship_id) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  select jsonb_build_object(
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'stage', m.stage,
               'group_code', m.group_code,
               'match_order', m.match_order,
               'home_team_id', m.home_team_id,
               'away_team_id', m.away_team_id,
               -- La CANCHA y el DÍA en que está puesto ahora, resueltos desde
               -- su bloque: es lo que la pantalla enseña y lo que se devolverá
               -- al guardar. El `game_id` viaja solo como referencia; no es lo
               -- que se edita.
               'game_id', gm.id,
               'field_id', gm.field_id,
               'date_key', gm.date_key,
               'start_time', m.start_time,
               'duration_min', m.duration_min,
               -- Para que la pantalla sepa qué NO debe dejar tocar. El marcador
               -- y los goles no se editan aquí, pero condicionan qué se puede
               -- cambiar del partido.
               'has_score', (m.home_score is not null and m.away_score is not null),
               'has_qualified', (m.qualified_team_id is not null),
               'goals', (select count(*) from public.championship_goals g where g.match_id = m.id),
               -- El testigo de concurrencia. Viaja tal cual y vuelve tal cual.
               'updated_at', m.updated_at)
             order by m.match_order, m.start_time, m.id)
        from public.championship_matches m
        left join public.games gm on gm.id = m.game_id
       where m.championship_id = p_championship_id
    ), '[]'::jsonb),

    -- Los bloques contratados: el único sitio del que puede salir una cancha.
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'game_id', g.id,
               'date_key', g.date_key,
               'start_time', g.time,
               'duration_min', g.duration_min,
               'status', g.status,
               'field_id', g.field_id,
               'field_name', f.name,
               'venue_name', v.name)
             order by g.date_key, g.time, f.name, g.id)
        from public.championship_reservation_games l
        join public.games  g on g.id = l.game_id
        left join public.fields f on f.id = g.field_id
        left join public.venues v on v.id = f.venue_id
       where l.championship_id = p_championship_id
    ), '[]'::jsonb),

    -- Y los equipos que pueden jugar. Es la MISMA regla que usa el generador y
    -- la misma contra la que `set_championship_status` mide si el calendario se
    -- quedó viejo: compite todo equipo REAL del campeonato, tenga jugadores o
    -- no. `player_count` viaja como INFORMACIÓN —para poder enseñar «0
    -- jugadores» al elegirlo—, nunca como una puerta.
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'color', t.color,
               'player_count', (select count(*) from public.championship_players p
                                 where p.team_id = t.id))
             order by t.created_at, t.id)
        from public.championship_teams t
       where t.id in (select e.id from public._championship_eligible_teams(p_championship_id) as e(id))
    ), '[]'::jsonb),

    -- Los grupos que este calendario usa de verdad, para poder elegir uno al
    -- crear un partido de fase de grupos. Salen de los propios partidos, no de
    -- una lista inventada: si el campeonato no tiene grupos, no hay nada que
    -- elegir y la pantalla no ofrece el campo.
    'group_codes', coalesce((
      select jsonb_agg(distinct m.group_code order by m.group_code)
        from public.championship_matches m
       where m.championship_id = p_championship_id and m.group_code is not null
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $function$;

REVOKE ALL ON FUNCTION "public"."get_admin_championship_fixture"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_admin_championship_match (
  p_match_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_m     public.championship_matches%rowtype;
  v_out   jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_read_backoffice() then raise exception 'NOT_AUTHORIZED'; end if;

  select * into v_m from public.championship_matches where id = p_match_id;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  select jsonb_build_object(
    'id', v_m.id,
    'championship_id', v_m.championship_id,
    'stage', v_m.stage,
    'group_code', v_m.group_code,
    'match_order', v_m.match_order,
    'home_score', v_m.home_score,
    'away_score', v_m.away_score,
    -- Se devuelve para que la pantalla lo sepa, no para que lo cambie: esta
    -- función no lo escribe y la de guardar tampoco.
    'qualified_team_id', v_m.qualified_team_id,
    'start_time', v_m.start_time,
    'duration_min', v_m.duration_min,
    'updated_at', v_m.updated_at,

    -- Dónde y cuándo: todo derivado del bloque físico, como en el resto del
    -- módulo. La hora de FIN no se guarda en ninguna parte: es el inicio más la
    -- duración, y se calcula al pintar. El verify de abajo comprueba que no se
    -- haya colado una columna para ella.
    'date_key',   (select g.date_key from public.games g where g.id = v_m.game_id),
    'field_name', (select f.name from public.games g
                     join public.fields f on f.id = g.field_id where g.id = v_m.game_id),
    'venue_name', (select v.name from public.games g
                     join public.fields f on f.id = g.field_id
                     join public.venues v on v.id = f.venue_id where g.id = v_m.game_id),

    'home_team', (select jsonb_build_object('id', t.id, 'name', t.name,
                           'color', t.color, 'design', t.design)
                    from public.championship_teams t where t.id = v_m.home_team_id),
    'away_team', (select jsonb_build_object('id', t.id, 'name', t.name,
                           'color', t.color, 'design', t.design)
                    from public.championship_teams t where t.id = v_m.away_team_id),

    -- Las plantillas de AHORA. Quien esté hoy en el equipo es quien puede
    -- recibir goles; no hay titulares, ni suplentes, ni asistencia: eso no
    -- existe en el modelo y aquí no se inventa.
    'home_roster', public._championship_team_roster(v_m.championship_id, v_m.home_team_id),
    'away_roster', public._championship_team_roster(v_m.championship_id, v_m.away_team_id),

    -- Los goles ya registrados en ESTE partido.
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'player_user_id', gl.player_user_id, 'team_id', gl.team_id, 'goals', gl.goals)
             order by gl.goals desc, gl.player_user_id)
        from public.championship_goals gl where gl.match_id = v_m.id
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $function$;

REVOKE ALL ON FUNCTION "public"."get_admin_championship_match"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_admin_championship_reservations (
  p_championship_id uuid
)
  RETURNS TABLE (
    game_id      uuid,
    date_key     date,
    start_time   time without time zone,
    duration_min integer,
    status       text,
    field_id     uuid,
    field_name   text,
    venue_name   text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_read_backoffice() then raise exception 'NOT_AUTHORIZED'; end if;

  return query
    select g.id, g.date_key, g.time, g.duration_min, g.status::text,
           g.field_id, f.name::text, v.name::text
      from public.championship_reservation_games l
      join public.games g on g.id = l.game_id
      -- LEFT: un bloque cuya cancha o cuyo complejo falten sigue siendo una
      -- reserva real del campeonato, y esconderlo sería peor que enseñarlo sin
      -- nombre.
      left join public.fields f on f.id = g.field_id
      left join public.venues v on v.id = f.venue_id
     where l.championship_id = p_championship_id
     -- Fecha, hora y cancha: el orden en que se lee un día de campeonato.
     order by g.date_key, g.time, f.name nulls last, g.id;
end $function$;

REVOKE ALL ON FUNCTION "public"."get_admin_championship_reservations"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_championship_availability_restrictions (
  p_city text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_set    public.championship_settings%rowtype;
  v_blocks jsonb := '[]'::jsonb;
  v_r      jsonb;
  v_rmin   numeric;
  v_rmax   numeric;
  v_rdays  numeric;
  v_b      jsonb;
  v_ts1    timestamptz;
  v_ts2    timestamptz;
  v_date   date;
  v_tf     time;
  v_tt     time;
begin
  -- Ciudad inválida o sin settings activa → ERROR explícito (el App NO debe presentar fechas como libres;
  -- distingue "sin restricciones" de "no pude leer la configuración").
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
  select * into v_set from public.championship_settings where city = p_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- ── booking_lead_rules: array OBLIGATORIO; cada regla bien formada (min/max/days enteros, min≥1, max≥min,
  --    days≥0). Cualquier cosa fuera de forma → CONFIG_UNAVAILABLE (no se descarta en silencio). ──
  if v_set.booking_lead_rules is null or jsonb_typeof(v_set.booking_lead_rules) <> 'array' then
    raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
  end if;
  for v_r in select value from jsonb_array_elements(v_set.booking_lead_rules) as t(value) loop
    if jsonb_typeof(v_r) <> 'object'
       or jsonb_typeof(v_r->'min_teams') <> 'number'
       or jsonb_typeof(v_r->'max_teams') <> 'number'
       or jsonb_typeof(v_r->'days') <> 'number' then
      raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
    end if;
    v_rmin := (v_r->>'min_teams')::numeric;
    v_rmax := (v_r->>'max_teams')::numeric;
    v_rdays := (v_r->>'days')::numeric;
    if v_rmin <> trunc(v_rmin) or v_rmax <> trunc(v_rmax) or v_rdays <> trunc(v_rdays)
       or v_rmin < 1 or v_rmax < v_rmin or v_rdays < 0 then
      raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
    end if;
  end loop;

  -- ── availability_blocks: array OBLIGATORIO; cada bloque bien formado y proyectado a claves UI-safe.
  --    Malformado (no-objeto, instantes/fechas/horas inválidos, fin≤inicio) → CONFIG_UNAVAILABLE. ──
  if v_set.availability_blocks is null or jsonb_typeof(v_set.availability_blocks) <> 'array' then
    raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE';
  end if;
  for v_b in select value from jsonb_array_elements(v_set.availability_blocks) as t(value) loop
    if jsonb_typeof(v_b) <> 'object' then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

    if (v_b ? 'starts_at') or (v_b ? 'ends_at') then
      -- v2: ambos instantes presentes, parseables como timestamptz y fin > inicio.
      begin
        v_ts1 := (v_b->>'starts_at')::timestamptz;
        v_ts2 := (v_b->>'ends_at')::timestamptz;
      exception when others then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end;
      if v_ts1 is null or v_ts2 is null or v_ts2 <= v_ts1 then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
      v_blocks := v_blocks || jsonb_build_object('starts_at', v_b->'starts_at', 'ends_at', v_b->'ends_at');
    else
      -- v1: date válida; all_day=true → día completo; si no, from/to válidos con from<to.
      begin
        v_date := (v_b->>'date')::date;
      exception when others then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end;
      if v_date is null then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
      if jsonb_typeof(v_b->'all_day') = 'boolean' and (v_b->>'all_day')::boolean = true then
        v_blocks := v_blocks || jsonb_build_object('date', v_b->'date', 'all_day', true);
      else
        begin
          v_tf := (v_b->>'from')::time;
          v_tt := (v_b->>'to')::time;
        exception when others then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end;
        if v_tf is null or v_tt is null or v_tt <= v_tf then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;
        v_blocks := v_blocks || jsonb_build_object('date', v_b->'date', 'from', v_b->'from', 'to', v_b->'to');
      end if;
    end if;
  end loop;

  -- SOLO lo necesario para las restricciones: antelación mínima por rango de equipos + bloqueos operativos.
  return jsonb_build_object(
    'booking_lead_rules',  v_set.booking_lead_rules,
    'availability_blocks', v_blocks
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_championship_competition (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor      uuid := auth.uid();
  v_champ      public.championships%rowtype;
  v_is_algrass boolean := public._is_algrass_staff(v_actor);
  v_matches    jsonb;
  v_standings  jsonb;
  v_scorers    jsonb;
  v_champion   jsonb;
  v_teams      jsonb;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- Mismo gate de lectura que get_championship_registration_state.
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = v_actor or v_is_algrass) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  -- ── MATCHES: campos crudos + display resuelto (equipos, cancha/venue/fecha vía game_id) + goleadores del match.
  select coalesce(jsonb_agg(s.j order by s.dk nulls last, s.st nulls last, s.mo nulls last, s.created_at), '[]'::jsonb)
    into v_matches
    from (
      select
        jsonb_build_object(
          'id', m.id, 'championship_id', m.championship_id,
          'stage', m.stage, 'group_code', m.group_code,
          'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
          'home_score', m.home_score, 'away_score', m.away_score,
          'qualified_team_id', m.qualified_team_id,
          'game_id', m.game_id, 'start_time', m.start_time, 'duration_min', m.duration_min, 'match_order', m.match_order,
          'updated_at', m.updated_at,   -- Fase 32: testigo de concurrencia para set_championship_match_team
          -- Display de equipos (null si aún no sorteado).
          'home_team', case when ht.id is null then null
                            else jsonb_build_object('id', ht.id, 'name', ht.name, 'color', ht.color, 'design', ht.design) end,
          'away_team', case when at.id is null then null
                            else jsonb_build_object('id', at.id, 'name', at.name, 'color', at.color, 'design', at.design) end,
          -- Cancha/venue/fecha DERIVADOS de game_id → games → fields → venues (no duplicados en la tabla).
          'field_id', g.field_id, 'field_name', f.name, 'venue_name', v.name, 'date_key', g.date_key,
          -- Goleadores registrados en ESTE match (la suma NO tiene que igualar el marcador).
          'goals', (
            select coalesce(jsonb_agg(jsonb_build_object(
                     'player_user_id', gl.player_user_id, 'team_id', gl.team_id, 'goals', gl.goals,
                     'full_name', u.full_name, 'avatar_path', u.avatar_path, 'avatar_hue', u.avatar_hue
                   ) order by gl.goals desc), '[]'::jsonb)
            from public.championship_goals gl
            left join public.users_public u on u.id = gl.player_user_id
            where gl.match_id = m.id
          )
        ) as j,
        g.date_key as dk, m.start_time as st, m.match_order as mo, m.created_at
      from public.championship_matches m
      left join public.championship_teams ht on ht.id = m.home_team_id
      left join public.championship_teams at on at.id = m.away_team_id
      left join public.games   g on g.id = m.game_id
      left join public.fields  f on f.id = g.field_id
      left join public.venues  v on v.id = f.venue_id
      where m.championship_id = p_championship_id
    ) s;

  -- ── STANDINGS: la TABLA incluye TODOS los equipos del grupo (aunque no hayan jugado); las estadísticas
  -- solo se calculan de partidos jugados (ambos scores no null) y se COALESCE a 0 para los demás.
  with teams_in_group as (
    select group_code, home_team_id as team_id
      from public.championship_matches
     where championship_id = p_championship_id and stage = 'group' and home_team_id is not null
    union
    select group_code, away_team_id as team_id
      from public.championship_matches
     where championship_id = p_championship_id and stage = 'group' and away_team_id is not null
  ),
  played as (
    select group_code, home_team_id as team_id, home_score as gf, away_score as gc
      from public.championship_matches
     where championship_id = p_championship_id and stage = 'group'
       and home_team_id is not null and away_team_id is not null
       and home_score is not null and away_score is not null
    union all
    select group_code, away_team_id as team_id, away_score as gf, home_score as gc
      from public.championship_matches
     where championship_id = p_championship_id and stage = 'group'
       and home_team_id is not null and away_team_id is not null
       and home_score is not null and away_score is not null
  ),
  agg as (
    select group_code, team_id,
           count(*)                                              as pj,
           count(*) filter (where gf > gc)                       as pg,
           count(*) filter (where gf = gc)                       as pe,
           count(*) filter (where gf < gc)                       as pp,
           sum(gf)                                               as gf,
           sum(gc)                                               as gc,
           sum(gf) - sum(gc)                                     as dg,
           sum(case when gf > gc then 3 when gf = gc then 1 else 0 end) as pts
      from played
     group by group_code, team_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'group_code', ug.group_code, 'team_id', ug.team_id,
           'team', case when t.id is null then null
                        else jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color, 'design', t.design) end,
           'pj', coalesce(a.pj, 0), 'pg', coalesce(a.pg, 0), 'pe', coalesce(a.pe, 0), 'pp', coalesce(a.pp, 0),
           'gf', coalesce(a.gf, 0), 'gc', coalesce(a.gc, 0), 'dg', coalesce(a.dg, 0), 'pts', coalesce(a.pts, 0)
         ) order by ug.group_code nulls last,
                    coalesce(a.pts, 0) desc, coalesce(a.dg, 0) desc, coalesce(a.gf, 0) desc), '[]'::jsonb)
    into v_standings
    from teams_in_group ug
    left join agg a on a.group_code is not distinct from ug.group_code and a.team_id = ug.team_id
    left join public.championship_teams t on t.id = ug.team_id;

  -- ── GOLEADORES del campeonato: SOLO goles del equipo ACTUAL del jugador.
  select coalesce(jsonb_agg(jsonb_build_object(
           'player_user_id', s.player_user_id, 'goals', s.goals, 'team_id', s.team_id,
           'full_name', u.full_name, 'avatar_path', u.avatar_path, 'avatar_hue', u.avatar_hue
         ) order by s.goals desc, lower(u.full_name)), '[]'::jsonb)
    into v_scorers
    from (
      select gl.player_user_id,
             cp.team_id                                               as team_id,
             sum(gl.goals)                                            as goals
        from public.championship_goals gl
        join public.championship_matches m on m.id = gl.match_id
        join public.championship_players cp on cp.championship_id = p_championship_id
                                           and cp.user_id  = gl.player_user_id
                                           and cp.team_id  = gl.team_id
       where m.championship_id = p_championship_id
       group by gl.player_user_id, cp.team_id
    ) s
    left join public.users_public u on u.id = s.player_user_id;

  -- ── CAMPEON: el dato EXPLICITO, nunca deducido de la final ──────────────────
  -- `championships.champion_team_id` es la unica fuente. Un campeonato puede
  -- terminar sin jugar la final —lluvia, tiempo, una decision de organizacion— y
  -- tener campeon igual; y una final jugada no nombra campeon por su cuenta.
  select case when v_champ.champion_team_id is null then null else
           jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color, 'design', t.design)
         end
    into v_champion
    from (select 1) s
    left join public.championship_teams t on t.id = v_champ.champion_team_id;

  -- ── EQUIPOS: todos los del campeonato ───────────────────────────────
  -- Para poder ELEGIR campeon hace falta la lista entera, no solo los que
  -- aparecen en la tabla: un equipo sin partidos sigue siendo del campeonato.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'color', t.color, 'design', t.design)
         order by t.created_at, t.id), '[]'::jsonb)
    into v_teams
    from public.championship_teams t
   where t.championship_id = p_championship_id;

  return jsonb_build_object(
    'matches',   v_matches,
    'standings', v_standings,
    'scorers',   v_scorers,
    -- Claves NUEVAS: quien ya leia las tres de arriba sigue igual.
    'champion_team_id', v_champ.champion_team_id,
    'champion',  v_champion,
    'teams',     v_teams
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_championship_config (
  p_city text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_set        public.championship_settings%rowtype;
  v_extras_out jsonb := '[]'::jsonb;
  v_blocks_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  select * into v_set from public.championship_settings where city = p_city and active = true;
  if not found then raise exception 'CHAMPIONSHIP_CONFIG_UNAVAILABLE'; end if;

  -- Extras para la UX: SOLO active=true y bien formados (jsonb_typeof antes de castear), ordenados por sort_order.
  -- Campos mínimos (no se expone toda la fila). unit_price es solo para PINTAR; NO es autoridad de precio.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'code',           e->>'code',
             'name',           e->>'name',
             'unit_price',     (e->>'unit_price')::numeric,
             'units_per_item', floor((e->>'units_per_item')::numeric)::int,
             'min_quantity',   floor((e->>'min_quantity')::numeric)::int,
             'max_quantity',   floor((e->>'max_quantity')::numeric)::int,
             'sort_order',     floor((e->>'sort_order')::numeric)::int
           )
           order by floor((e->>'sort_order')::numeric)::int, e->>'code'
         ), '[]'::jsonb)
    into v_extras_out
    from jsonb_array_elements(v_set.extras) e
   where jsonb_typeof(e) = 'object'
     and jsonb_typeof(e->'active') = 'boolean' and (e->>'active')::boolean = true
     and jsonb_typeof(e->'unit_price') = 'number'
     and jsonb_typeof(e->'units_per_item') = 'number'
     and jsonb_typeof(e->'min_quantity') = 'number'
     and jsonb_typeof(e->'max_quantity') = 'number'
     and jsonb_typeof(e->'sort_order') = 'number';

  -- Los bloqueos, reducidos a las claves de disponibilidad y en el mismo orden
  -- que tienen en la columna (`with ordinality`). No se interpreta nada aquí: se
  -- copia la clave que haya, tal cual. Un elemento que no sea un objeto pasa sin
  -- tocar, como hasta ahora: no puede llevar metadatos dentro.
  if jsonb_typeof(v_set.availability_blocks) = 'array' then
    select coalesce(jsonb_agg(
             case when jsonb_typeof(b) = 'object'
                  then jsonb_strip_nulls(jsonb_build_object(
                         'starts_at', b->'starts_at',
                         'ends_at',   b->'ends_at',
                         'date',      b->'date',
                         'all_day',   b->'all_day',
                         'from',      b->'from',
                         'to',        b->'to'))
                  else b end
             order by ord
           ), '[]'::jsonb)
      into v_blocks_out
      from jsonb_array_elements(v_set.availability_blocks) with ordinality as t(b, ord);
  end if;

  return jsonb_build_object(
    'city',                    v_set.city,
    'currency',                v_set.currency,
    'registration_close_days', v_set.registration_close_days,
    'booking_lead_rules',      v_set.booking_lead_rules,
    'availability_formats',    v_set.availability_formats,
    -- Bloqueos para que la UX filtre disponibilidad ANTES de armar el grid. Lectura defensiva: si la columna
    -- no es un array (config rota), se devuelve '[]' aquí (la UX no puede sub-bloquear a ciegas), PERO la
    -- autoridad es el hold: _championship_assert_not_blocked aborta con CHAMPIONSHIP_CONFIG_UNAVAILABLE.
    'availability_blocks',     v_blocks_out,
    'extras',                  v_extras_out
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_championship_my_reservation (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_open  boolean;
  v_order public.orders%rowtype;
  v_spend public.reservations%rowtype;
  v_team  public.championship_teams%rowtype;
  v_snap  jsonb;
  v_unit  numeric;
  v_reward numeric;
  v_oid   uuid;
  v_refunded numeric;
  v_plazas jsonb;
  v_orders jsonb;
begin
  if v_actor is null then return null; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then return null; end if;
  v_open := (v_champ.status = 'registration_open');

  -- ── team_owner (fuente: championship_teams.order_id; registration_order_id NO aplica al owner) ──
  select * into v_team from public.championship_teams
   where championship_id = p_championship_id and created_by_user_id = v_actor and order_id is not null
   limit 1;
  if found then
    select * into v_order from public.orders where id = v_team.order_id;
    select * into v_spend from public.reservations where order_id = v_team.order_id and status = 'spend' limit 1;
    v_snap := coalesce(v_order.financial_snapshot, '{}'::jsonb);
    select coalesce(sum(coalesce(total_amount, 0)), 0) into v_refunded
      from public.reservations where status = 'refund' and refund_of_reservation_id = v_spend.id;
    return jsonb_build_object(
      'kind', 'team_owner',
      'championship_id', p_championship_id, 'championship_status', v_champ.status,
      'currency', coalesce(v_order.currency, 'PEN'), 'order_id', v_order.id,
      'team_id', v_team.id, 'team_name', v_team.name,
      'member_count', (select count(*) from public.championship_players where team_id = v_team.id),
      'other_member_count', (select count(*) from public.championship_players where team_id = v_team.id and user_id <> v_actor),
      'unit_price', coalesce((v_snap->>'unit_price')::numeric, v_spend.unit_price),
      'reward_applied', coalesce((v_snap->>'reward_applied')::numeric, 0),
      'subtotal_amount', coalesce((v_snap->>'subtotal_amount')::numeric, v_spend.subtotal_amount),
      'credit_applied', coalesce((v_snap->>'credit_applied')::numeric, 0),
      'external_amount', coalesce((v_snap->>'external_amount')::numeric, v_spend.total_amount),
      'payment_method', v_spend.payment_method,
      'refundable_total', round(greatest(0, coalesce(v_spend.subtotal_amount, v_spend.total_amount, 0) - v_refunded), 2),
      'cancelable', v_open
    );
  end if;

  -- ── paid individual · order CABECERA (fuente viva) ──
  -- (a) mi propia plaza viva → su registration_order_id; (b) sin plaza propia pero soy payer de órdenes con
  --     plazas vivas (gestiono invitados) → la order propia más reciente con plazas vivas.
  select cp.registration_order_id into v_oid
    from public.championship_players cp
   where cp.championship_id = p_championship_id and cp.user_id = v_actor
     and cp.registration_order_id is not null
   limit 1;
  if v_oid is not null then
    select * into v_order from public.orders where id = v_oid;
  else
    select o.* into v_order
      from public.orders o
     where o.resource_type = 'championship' and o.resource_id = p_championship_id and o.status = 'confirmed'
       and coalesce(o.claim_composition->>'kind','') = 'championship_registration'
       and o.payer_user_id = v_actor
       and exists (select 1 from public.championship_players cp
                    where cp.championship_id = p_championship_id and cp.registration_order_id = o.id)
     order by o.resolved_at desc nulls last
     limit 1;
    if not found then return null; end if;
  end if;

  select * into v_spend from public.reservations where order_id = v_order.id and status = 'spend' limit 1;
  v_snap   := coalesce(v_order.financial_snapshot, '{}'::jsonb);
  v_unit   := coalesce((v_snap->>'unit_price')::numeric, 0);
  v_reward := coalesce((v_snap->>'reward_applied')::numeric, 0);

  if v_order.payer_user_id = v_actor then
    -- PAYER: plazas de TODAS mis órdenes individuales confirmadas en este campeonato (multi-order por reinscripción).
    -- Se muestra cada (order, user); se oculta un (order,user) cancelado si ese user ya tiene plaza VIVA en otra
    -- de mis órdenes (evita duplicar al titular tras reinscribirse). `canceled` = sin fila viva para esa (order,user).
    select jsonb_agg(x order by (x->>'is_payer')::boolean desc, x->>'full_name')
      into v_plazas
      from (
        select jsonb_build_object(
          'user_id', base.uid,
          'full_name', coalesce(up.full_name, 'Jugador'),
          'is_payer', (base.uid = v_actor),
          'order_id', base.oid,
          'amount', case when base.uid = v_actor
                         then round(coalesce((base.snap->>'unit_price')::numeric,0) - coalesce((base.snap->>'reward_applied')::numeric,0), 2)
                         else round(coalesce((base.snap->>'unit_price')::numeric,0), 2) end,
          'canceled', not l.live
        ) as x
        from (
          select o2.id as oid, o2.financial_snapshot as snap,
                 (jsonb_array_elements_text(o2.claim_composition->'user_ids'))::uuid as uid
          from public.orders o2
          where o2.resource_type='championship' and o2.resource_id=p_championship_id and o2.status='confirmed'
            and coalesce(o2.claim_composition->>'kind','')='championship_registration'
            and o2.payer_user_id = v_actor
        ) base
        cross join lateral (
          select exists (select 1 from public.championship_players cp
                          where cp.championship_id=p_championship_id and cp.user_id=base.uid
                            and cp.registration_order_id=base.oid) as live,
                 exists (select 1 from public.championship_players cp
                          where cp.championship_id=p_championship_id and cp.user_id=base.uid) as live_any
        ) l
        left join public.users_public up on up.id = base.uid
        where l.live or not l.live_any   -- viva, o cancelada sin plaza viva en otra order (no duplicar titular)
      ) agg;
    -- Detalle financiero POR order: una entrada por cada order mía con ≥1 plaza VIVA (cada una conserva su propio
    -- snapshot; NUNCA se suman reward/crédito entre orders). El front muestra un bloque por order si hay >1.
    select jsonb_agg(jsonb_build_object(
        'order_id', q.oid,
        'unit_price', coalesce((q.snap->>'unit_price')::numeric, 0),
        'reward_applied', coalesce((q.snap->>'reward_applied')::numeric, 0),
        'player_count', coalesce((q.snap->>'player_count')::int, 1),
        'guest_total', coalesce((q.snap->>'guest_total')::numeric, 0),
        'subtotal_amount', coalesce((q.snap->>'subtotal_amount')::numeric, 0),
        'credit_applied', coalesce((q.snap->>'credit_applied')::numeric, 0),
        'external_amount', coalesce((q.snap->>'external_amount')::numeric, 0),
        'payment_method', q.pm
      ) order by q.resolved asc nulls first)
      into v_orders
      from (
        select o3.id as oid, o3.financial_snapshot as snap, o3.resolved_at as resolved,
               (select r.payment_method from public.reservations r where r.order_id = o3.id and r.status = 'spend' limit 1) as pm
        from public.orders o3
        where o3.resource_type='championship' and o3.resource_id=p_championship_id and o3.status='confirmed'
          and coalesce(o3.claim_composition->>'kind','')='championship_registration'
          and o3.payer_user_id = v_actor
          and exists (select 1 from public.championship_players cp
                       where cp.championship_id = p_championship_id and cp.registration_order_id = o3.id)
      ) q;
    return jsonb_build_object(
      'kind', 'paid_individual_payer',
      'orders', coalesce(v_orders, '[]'::jsonb),
      'championship_id', p_championship_id, 'championship_status', v_champ.status,
      'currency', coalesce(v_order.currency, 'PEN'), 'order_id', v_order.id,
      'unit_price', v_unit, 'reward_applied', v_reward,
      'player_count', coalesce((v_snap->>'player_count')::int, 1),
      'guest_total', coalesce((v_snap->>'guest_total')::numeric, 0),
      'subtotal_amount', coalesce((v_snap->>'subtotal_amount')::numeric, v_spend.subtotal_amount),
      'credit_applied', coalesce((v_snap->>'credit_applied')::numeric, 0),
      'external_amount', coalesce((v_snap->>'external_amount')::numeric, v_spend.total_amount),
      'payment_method', v_spend.payment_method,
      'plazas', coalesce(v_plazas, '[]'::jsonb),
      'cancelable', v_open
    );
  end if;

  -- INVITADO (plaza propia financiada por otro): solo su plaza; `my_canceled` = ya no tiene fila viva de esa order.
  return jsonb_build_object(
    'kind', 'paid_individual_guest',
    'championship_id', p_championship_id, 'championship_status', v_champ.status,
    'currency', coalesce(v_order.currency, 'PEN'), 'order_id', v_order.id,
    'unit_price', v_unit, 'my_amount', round(v_unit, 2),
    'payer_user_id', v_order.payer_user_id,
    'payer_name', (select full_name from public.users_public where id = v_order.payer_user_id),
    'my_canceled', not exists (select 1 from public.championship_players cp
                                where cp.championship_id = p_championship_id and cp.user_id = v_actor
                                  and cp.registration_order_id = v_order.id),
    'cancelable', v_open
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."get_championship_my_reservation"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_championship_organizer_contact (
  p_championship_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_mode    text;
  v_algrass text;
  v_phone   text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_championship_id is null then raise exception 'INVALID_INPUT'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- OWNER-GATING estricto: el ÚNICO interlocutor es el pagador/owner. Cualquier otro actor (jugador
  -- inscrito, capitán, miembro de equipo, incluso AlGrass no-owner) → NULL: no se revela ningún teléfono.
  -- Espeja el `return null` de get_game_host_contact para "sin legitimidad" (no lanza excepción por rol).
  if v_champ.owner_user_id is distinct from v_actor then
    return null;
  end if;

  -- Config GLOBAL (misma fuente/fila que match/rental). Sin fila legible → NULL (CTA deshabilitado).
  select organizer_contact_mode, algrass_operational_phone
    into v_mode, v_algrass
    from public.app_settings where id = 1;

  -- Resolución EXPLÍCITA: solo 'algrass' y 'host' son válidos. NULL, sin fila app_settings, o cualquier
  -- valor inesperado → NULL (nunca cae por defecto a la rama host).
  if v_mode = 'algrass' then
    -- Teléfono operativo de AlGrass (Admin lo guarda ya con código de país).
    return nullif(btrim(coalesce(v_algrass, '')), '');
  elsif v_mode = 'host' then
    -- Teléfono del HOST operativo del campeonato (users.phone crudo; la App normaliza a WhatsApp-válido).
    -- FALLBACK a AlGrass cuando no hay host asignado, el host no existe o no tiene teléfono → el CTA nunca
    -- queda inutilizado si AlGrass sí tiene número. El fallback SOLO ocurre en modo 'host'.
    if v_champ.host_user_id is not null then
      select u.phone into v_phone from public.users u where u.id = v_champ.host_user_id;
      v_phone := nullif(btrim(coalesce(v_phone, '')), '');
      if v_phone is not null then return v_phone; end if;
    end if;
    return nullif(btrim(coalesce(v_algrass, '')), '');   -- fallback AlGrass (host ausente/sin teléfono)
  else
    return null;   -- NULL o modo no reconocido → no se entrega teléfono (SIN fallback)
  end if;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_championship_organizer_contact"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_championship_payment_detail (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_champ    public.championships%rowtype;
  v_staff    boolean;
  v_pagado   numeric;
  v_devuelto numeric;
  v_payee    uuid;
  v_moneda   text;
  v_items    jsonb;
  v_refunds  jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_staff := public._is_algrass_staff(v_actor);
  if not v_staff and v_champ.owner_user_id is distinct from v_actor then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if not v_staff and v_champ.status = 'payment_validation' then
    raise exception 'CHAMPIONSHIP_PAYMENT_NOT_VALIDATED';
  end if;

  select coalesce(sum(coalesce(r.subtotal_amount, r.total_amount, 0)), 0),   -- BRUTO = subtotal_amount
         coalesce(max(o.currency), 'PEN'),
         (array_agg(coalesce(o.payer_user_id, r.user_id) order by r.reserved_at))[1]
    into v_pagado, v_moneda, v_payee
    from public.reservations r
    left join public.orders o on o.id = r.order_id
   where r.championship_id = p_championship_id and r.status = 'spend';

  select coalesce(sum(coalesce(r.total_amount, 0)), 0) into v_devuelto
    from public.reservations r
   where r.championship_id = p_championship_id and r.status = 'refund';

  -- Los conceptos originales, con lo devuelto de cada uno al lado.
  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id',        c.order_id,
           'kind',            c.kind,
           'code',            c.code,
           'game_id',         c.game_id,
           'quantity',        c.quantity,
           'amount',          c.amount,
           'refunded',        (c.settled_by is not null),
           'refunded_amount', c.refunded_amount,
           'refunded_at',     c.refunded_at,
           'settled_by',      c.settled_by,
           'cancelable',      (c.kind in ('extra', 'court', 'courts')
                               and c.settled_by is null)
         ) order by c.order_id, c.kind, c.code nulls first), '[]'::jsonb)
    into v_items
    from public._championship_concepts(p_championship_id) c;

  -- Y los movimientos de devolución, tal como quedaron en el libro.
  select coalesce(jsonb_agg(jsonb_build_object(
           'reservation_id', r.id,
           'order_id',       r.order_id,
           'amount',         r.total_amount,
           'scope',          case when v_staff then r.refund_scope
                                  else r.refund_scope - 'reason' end,
           'canceled_at',    r.canceled_at,
           'method',         'wallet_credit'
         ) order by r.canceled_at), '[]'::jsonb)
    into v_refunds
    from public.reservations r
   where r.championship_id = p_championship_id and r.status = 'refund';

  return jsonb_build_object(
    'championship_id', p_championship_id,
    'status',          v_champ.status,
    'currency',        v_moneda,
    'payer_user_id',   v_payee,
    'paid_total',      round(v_pagado, 2),
    'refunded_total',  round(v_devuelto, 2),
    'remaining_total', round(v_pagado - v_devuelto, 2),
    'items',           v_items,
    'refunds',         v_refunds,
    'viewer',          case when v_staff then 'staff' else 'owner' end,
    'owner_can_cancel', (v_champ.status = 'pending_publish' and v_pagado > v_devuelto)
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."get_championship_payment_detail"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_championship_public (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_champ public.championships%rowtype;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = auth.uid()
          or (v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid())) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'id', v_champ.id, 'status', v_champ.status, 'name', v_champ.name,
    'cover_theme', v_champ.cover_theme, 'cover_image_path', v_champ.cover_image_path,
    'event_date', v_champ.event_date, 'start_time', v_champ.start_time, 'end_time', v_champ.end_time,
    'venue_id', v_champ.venue_id, 'format_config', v_champ.format_config,
    'registration_closes_at', v_champ.registration_closes_at, 'published_at', v_champ.published_at,
    'fixture_published_at', v_champ.fixture_published_at,
    'live_started_at', v_champ.live_started_at,
    'champion_team_id', v_champ.champion_team_id,   -- Fase 36
    'privacy', v_champ.privacy, 'results_public', v_champ.results_public,
    'owner_user_id', v_champ.owner_user_id,
    'is_host', (auth.uid() is not null and v_champ.host_user_id is not null and v_champ.host_user_id = auth.uid()),
    'has_registration_key', (nullif(btrim(coalesce(v_champ.registration_key, '')), '') is not null),
    'is_member', (auth.uid() is not null and exists (
        select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
      )),
    -- Fase 40: RESERVAS FÍSICAS (fuente del rango de fecha/hora del resumen). DERIVADO de
    -- championship_reservation_games → games → fields. El cliente ordena por date_key+time y toma primera/última.
    'reservation_games', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'game_id', g.id, 'date_key', g.date_key,
               'time', to_char(g.time, 'HH24:MI'), 'duration_min', g.duration_min,
               'field_id', g.field_id, 'venue_id', f.venue_id
             ) order by g.date_key asc, g.time asc), '[]'::jsonb)
      from public.championship_reservation_games crg
      join public.games  g on g.id = crg.game_id
      left join public.fields f on f.id = g.field_id
      where crg.championship_id = p_championship_id
    ),
    -- Fase 38: venues OPERATIVOS reales (multi-venue) DERIVADOS de la reserva física. Solo lectura, no persistido.
    'venues', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'venue_id', v.id, 'venue_name', v.name, 'venue_address', v.address,
          'district', v.district, 'city', v.city, 'lat', v.lat, 'lng', v.lng,
          'cover_image_path', v.cover_image_path, 'cover_updated_at', v.cover_updated_at,
          'amenities', v.amenities,
          'fields', (
            select coalesce(jsonb_agg(distinct jsonb_build_object('field_id', f2.id, 'field_name', f2.name)), '[]'::jsonb)
            from public.championship_reservation_games crg2
            join public.games   g2 on g2.id = crg2.game_id
            join public.fields  f2 on f2.id = g2.field_id
            where crg2.championship_id = p_championship_id and f2.venue_id = v.id
          )
        )
        order by (v.id = v_champ.venue_id) desc, dv.first_reserved asc, lower(v.name) asc
      ), '[]'::jsonb)
      from (
        select f.venue_id, min(crg.created_at) as first_reserved
        from public.championship_reservation_games crg
        join public.games  g on g.id = crg.game_id
        join public.fields f on f.id = g.field_id
        where crg.championship_id = p_championship_id and f.venue_id is not null
        group by f.venue_id
      ) dv
      join public.venues v on v.id = dv.venue_id
    )
  );
end; $function$;

CREATE OR REPLACE FUNCTION public.get_championship_public_pricing (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select jsonb_build_object(
    'championship_id',        c.id,
    'is_public',              (c.order_id is null and (c.public_individual_price is not null or c.public_team_price is not null)),
    'public_individual_price', c.public_individual_price,
    'public_team_price',      c.public_team_price
  )
  from public.championships c
  where c.id = p_championship_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_championship_registration_key (
  p_championship_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_champ public.championships%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from auth.uid() then raise exception 'NOT_OWNER'; end if;
  return v_champ.registration_key;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_championship_registration_key"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_championship_registration_state (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_teams jsonb; v_players jsonb; v_me jsonb; v_pcount int;
  v_is_algrass boolean := public._is_algrass_staff(v_actor);
  v_owner jsonb; v_host jsonb;
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  -- Legible en estados públicos, o si el actor es el owner, o AlGrass (para gestión pre-publicación).
  if not (v_champ.status in ('registration_open','registration_closed','in_progress','completed')
          or v_champ.owner_user_id = v_actor or v_is_algrass) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'color', t.color, 'design', t.design,
           'created_by_user_id', t.created_by_user_id,
           -- creator_is_privileged: el team lo creó el owner o un AlGrass → DELETE protegido (solo owner/AlGrass).
           'creator_is_privileged', (t.created_by_user_id = v_champ.owner_user_id
                                      or public._is_algrass_staff(t.created_by_user_id)),
           'player_count', (select count(*) from public.championship_players p where p.team_id = t.id)
         ) order by t.created_at), '[]'::jsonb)
    into v_teams
    from public.championship_teams t where t.championship_id = p_championship_id;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by (x.user_id = v_actor) desc, lower(x.full_name)), '[]'::jsonb)
    into v_players
    from (
      -- is_captain: por equipo, el miembro con joined_at más antiguo (capitán DINÁMICO, sin columna nueva).
      select p.user_id, u.full_name, u.avatar_path, u.avatar_hue, p.team_id, t.name as team_name,
             (p.team_id is not null and p.user_id = (
                select cp.user_id from public.championship_players cp
                 where cp.team_id = p.team_id order by cp.joined_at asc, cp.user_id asc limit 1
             )) as is_captain
        from public.championship_players p
        left join public.users_public u on u.id = p.user_id
        left join public.championship_teams t on t.id = p.team_id
       where p.championship_id = p_championship_id
    ) x;

  select count(*) into v_pcount from public.championship_players where championship_id = p_championship_id;

  select case when p.user_id is null then null
              else jsonb_build_object('user_id', p.user_id, 'team_id', p.team_id) end
    into v_me
    from (select * from public.championship_players where championship_id = p_championship_id and user_id = v_actor) p;

  -- ── Organizadores ──────────────────────────────────────────────────────────
  -- MISMA proyección pública que el roster (user_id, full_name, avatar_path,
  -- avatar_hue) y desde la MISMA fuente, `users_public`: la vista ya filtra las
  -- cuentas borradas y es la única superficie de usuarios que el frontend lee.
  -- Aquí no se toca `public.users`.
  --
  -- El owner viaja SIEMPRE, incluso si su fila no se resuelve —cuenta borrada—:
  -- el LEFT JOIN sobre una fila sintética garantiza el objeto con su `user_id`
  -- y el resto en null. Devolver `organizers.owner = null` habría dejado un
  -- campeonato aparentemente sin dueño, que es peor que un nombre vacío.
  select jsonb_build_object(
           'user_id',     v_champ.owner_user_id,
           'full_name',   u.full_name,
           'avatar_path', u.avatar_path,
           'avatar_hue',  u.avatar_hue)
    into v_owner
    from (select 1) s
    left join public.users_public u on u.id = v_champ.owner_user_id;

  -- El host solo existe si está puesto Y es alguien DISTINTO del owner: una
  -- misma persona en los dos papeles se enseñaría dos veces en la misma tarjeta.
  -- `is distinct from` y no `<>` porque con nulos `<>` no decide nada.
  if v_champ.host_user_id is not null
     and v_champ.host_user_id is distinct from v_champ.owner_user_id then
    select jsonb_build_object(
             'user_id',     v_champ.host_user_id,
             'full_name',   u.full_name,
             'avatar_path', u.avatar_path,
             'avatar_hue',  u.avatar_hue)
      into v_host
      from (select 1) s
      left join public.users_public u on u.id = v_champ.host_user_id;
  end if;

  return jsonb_build_object(
    'teams', v_teams,
    'players', v_players,
    'current_user_membership', v_me,
    'owner_user_id', v_champ.owner_user_id,
    'is_algrass', v_is_algrass,
    'team_count', (select count(*) from public.championship_teams where championship_id = p_championship_id),
    'player_count', v_pcount,
    -- `host` a null cuando no hay: la clave existe siempre, el valor no.
    'organizers', jsonb_build_object('owner', v_owner, 'host', v_host)
  );
end; $function$;

CREATE OR REPLACE FUNCTION public.get_championship_settings_admin (
  p_city text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_set   public.championship_settings%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;

  -- Sin `active = true`: aquí se edita, y una ciudad inactiva es justo la que hay
  -- que poder mirar para activarla.
  select * into v_set from public.championship_settings where city = p_city;
  if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;

  return jsonb_build_object(
    'city',                    v_set.city,
    'currency',                v_set.currency,
    'referee_hourly_rate',     v_set.referee_hourly_rate,
    'algrass_fee_hourly_rate', v_set.algrass_fee_hourly_rate,
    'booking_lead_rules',      v_set.booking_lead_rules,
    'registration_close_days', v_set.registration_close_days,
    'extras',                  v_set.extras,
    'availability_formats',    v_set.availability_formats,
    /* Los bloqueos NO salen por aquí a propósito. Los devuelve
       `list_championship_blocks`, que es la única que interpreta su formato: dos
       maneras de leerlos —una cruda aquí y otra normalizada allí— acabarían con una
       segunda interpretación escrita en JavaScript. Un dueño por cosa. */
    'active',                  v_set.active,
    'created_at',              v_set.created_at,
    'updated_at',              v_set.updated_at
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."get_championship_settings_admin"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_championship_team_secret (
  p_team_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_team  public.championship_teams%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;
  return jsonb_build_object('team_id', v_team.id, 'join_secret', v_team.join_secret);
end $function$;

REVOKE ALL ON FUNCTION "public"."get_championship_team_secret"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_championship_team_share (
  p_team_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_team  public.championship_teams%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;
  return jsonb_build_object('team_id', v_team.id, 'championship_id', v_team.championship_id,
    'join_token', v_team.join_token);
end $function$;

REVOKE ALL ON FUNCTION "public"."get_championship_team_share"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_game_host_contact (
  p_game_id uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor     uuid := auth.uid();
  v_host      uuid;
  v_booked_by uuid;
  v_phone     text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_id is null then raise exception 'INVALID_GAME_ID'; end if;

  select g.host_user_id, g.booked_by_user_id
    into v_host, v_booked_by
    from public.games g
   where g.id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;

  -- Legitimidad para contactar (mismo criterio que el CTA). Si no la tiene → NULL.
  if not (
       v_host = v_actor
    or v_booked_by = v_actor
    or exists (
         select 1 from public.game_players gp
          where gp.game_id = p_game_id
            and gp.status = 'confirmed'
            and (gp.user_id = v_actor or gp.payer_id = v_actor)
       )
  ) then
    return null;
  end if;

  -- Solo el teléfono del host de ESE game. Nada más se devuelve.
  select u.phone into v_phone from public.users u where u.id = v_host;
  return nullif(btrim(coalesce(v_phone, '')), '');   -- NULL si el host no tiene teléfono
end;
$function$;

REVOKE ALL ON FUNCTION "public"."get_game_host_contact"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.get_maintenance_status()
  RETURNS TABLE (
    maintenance_mode    boolean,
    maintenance_message text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  select s.maintenance_mode, s.maintenance_message
    from public.app_settings s
   where s.id = 1
$function$;

CREATE OR REPLACE FUNCTION public.get_pending_slot_expiry()
  RETURNS TABLE (
    reservation_id uuid,
    game_id        uuid
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select gsr.id, gsr.game_id
    from public.game_slot_reservations gsr
    join public.games g on g.id = gsr.game_id
   where gsr.reserved_by_user_id = auth.uid()
     and gsr.released_reason    = 'automatic'
     and gsr.expiry_notified_at is null
     and (g.date_key + g.time) at time zone 'America/Lima' > now()   -- aún no comenzó
   order by gsr.released_at asc nulls last
   limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_slot_reservation (
  p_game_id uuid
)
  RETURNS TABLE (
    has_reservation                    boolean,
    reservation_id                     uuid,
    status                             text,
    reserved_slots_total               integer,
    reserved_slots_used                integer,
    reserved_slots_remaining           integer,
    pool                               integer,
    member_reservation_id              uuid,
    member_reservation_status          text,
    effective_reserved_slots_remaining integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor         uuid := auth.uid();
  v_res           public.game_slot_reservations%rowtype;
  v_has           boolean := false;
  v_member_id     uuid;
  v_member_status text;
  v_member_remaining integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Existencia del partido (GAME_NOT_FOUND).
  perform 1 from public.games g where g.id = p_game_id;
  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  -- R1 ÚNICA del usuario (reserva PROPIA), sin filtrar por estado.
  select gsr.* into v_res
    from public.game_slot_reservations gsr
   where gsr.game_id = p_game_id
     and gsr.reserved_by_user_id = v_actor
   limit 1;
  v_has := found;

  -- V6 · PERTENENCIA del actor: la SlotReservation vinculada en su fila.
  -- DEFINER: el status se lee aunque la reserva sea de otro capitán (RLS bypass).
  -- Prioridad: fila confirmed; si no existe ninguna, la más reciente por updated_at
  -- (cualquier status). El orden por (status='confirmed') desc antepone las confirmed.
  select gp.game_slot_reservation_id
    into v_member_id
    from public.game_players gp
   where gp.game_id = p_game_id
     and gp.user_id = v_actor
   order by (gp.status = 'confirmed') desc, gp.updated_at desc
   limit 1;

  if v_member_id is not null then
    -- Misma fila donde hoy se valida el status de la R1 heredada: se lee además su remaining.
    select gsr.status, gsr.reserved_slots_remaining
      into v_member_status, v_member_remaining
      from public.game_slot_reservations gsr
     where gsr.id = v_member_id;
  end if;

  return query select
    v_has,
    case when v_has then v_res.id                       else null end,
    case when v_has then v_res.status                   else null end,
    case when v_has then v_res.reserved_slots_total      else 0 end,
    case when v_has then v_res.reserved_slots_used        else 0 end,
    case when v_has then v_res.reserved_slots_remaining   else 0 end,
    public.public_availability(p_game_id),
    v_member_id,
    v_member_status,
    -- Remaining EFECTIVO: mismas condiciones que ya determinan la R1 efectiva
    -- (propia activa → pertenencia activa → ninguna). Solo selecciona qué remaining emitir.
    case
      when v_has and v_res.status = 'active'                      then v_res.reserved_slots_remaining
      when v_member_id is not null and v_member_status = 'active' then v_member_remaining
      else 0
    end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_slot_reservation_for_user (
  p_game_id uuid,
  p_user_id uuid
)
  RETURNS TABLE (
    has_reservation                    boolean,
    reservation_id                     uuid,
    status                             text,
    reserved_slots_total               integer,
    reserved_slots_used                integer,
    reserved_slots_remaining           integer,
    pool                               integer,
    member_reservation_id              uuid,
    member_reservation_status          text,
    effective_reserved_slots_remaining integer
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor         uuid := p_user_id;   -- única diferencia con el original (auth.uid()).
  v_total         integer;
  v_confirmed     integer;
  v_held          integer;
  v_res           public.game_slot_reservations%rowtype;
  v_has           boolean := false;
  v_member_id     uuid;
  v_member_status text;
  v_member_remaining integer;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Capacidad del partido (misma fuente que reserve_slots).
  select coalesce(g.total_spots, f.total_spots)
    into v_total
    from public.games g
    left join public.fields f on f.id = g.field_id
   where g.id = p_game_id;
  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  -- R1 ÚNICA del usuario (reserva PROPIA), sin filtrar por estado.
  select gsr.* into v_res
    from public.game_slot_reservations gsr
   where gsr.game_id = p_game_id
     and gsr.reserved_by_user_id = v_actor
   limit 1;
  v_has := found;

  -- Confirmados del partido y held de grupos ACTIVOS (idéntico a enforce_capacity).
  select count(*)::integer
    into v_confirmed
    from public.game_players gp
   where gp.game_id = p_game_id and gp.status = 'confirmed';

  select coalesce(sum(gsr.reserved_slots_remaining), 0)::integer
    into v_held
    from public.game_slot_reservations gsr
   where gsr.game_id = p_game_id and gsr.status = 'active';

  -- V6 · PERTENENCIA del actor: la SlotReservation vinculada en su fila.
  -- DEFINER: el status se lee aunque la reserva sea de otro capitán (RLS bypass).
  -- Prioridad: fila confirmed; si no existe ninguna, la más reciente por updated_at
  -- (cualquier status). El orden por (status='confirmed') desc antepone las confirmed.
  select gp.game_slot_reservation_id
    into v_member_id
    from public.game_players gp
   where gp.game_id = p_game_id
     and gp.user_id = v_actor
   order by (gp.status = 'confirmed') desc, gp.updated_at desc
   limit 1;

  if v_member_id is not null then
    -- Misma fila donde hoy se valida el status de la R1 heredada: se lee además su remaining.
    select gsr.status, gsr.reserved_slots_remaining
      into v_member_status, v_member_remaining
      from public.game_slot_reservations gsr
     where gsr.id = v_member_id;
  end if;

  return query select
    v_has,
    case when v_has then v_res.id                       else null end,
    case when v_has then v_res.status                   else null end,
    case when v_has then v_res.reserved_slots_total      else 0 end,
    case when v_has then v_res.reserved_slots_used        else 0 end,
    case when v_has then v_res.reserved_slots_remaining   else 0 end,
    greatest(coalesce(v_total, 0) - v_confirmed - v_held, 0),
    v_member_id,
    v_member_status,
    -- Remaining EFECTIVO: mismas condiciones que ya determinan la R1 efectiva
    -- (propia activa → pertenencia activa → ninguna). Solo selecciona qué remaining emitir.
    case
      when v_has and v_res.status = 'active'                      then v_res.reserved_slots_remaining
      when v_member_id is not null and v_member_status = 'active' then v_member_remaining
      else 0
    end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_waitlist_user_ids (
  p_game_id uuid
)
  RETURNS TABLE (
    user_id uuid
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  SELECT game_waitlist.user_id
  FROM public.game_waitlist
  WHERE game_waitlist.game_id = p_game_id
    AND game_waitlist.status = 'waiting';
$function$;

CREATE OR REPLACE FUNCTION public.grant_captain (
  p_user_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_granter uuid := auth.uid();
begin
  if v_granter is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not (
       public.is_platform_admin_or_staff(v_granter)
    or public.is_any_venue_owner(v_granter)
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Si ya tiene cualquier tier de capitán (captain o captain_gold), es un error
  -- de lógica: lo hacemos explícito en vez de un return silencioso.
  if public.is_captain(p_user_id) then
    raise exception 'ALREADY_CAPTAIN';
  end if;

  insert into public.user_roles (user_id, role, granted_by_user_id)
  values (p_user_id, 'captain', v_granter)
  on conflict (user_id, role) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_captain_gold (
  p_user_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_granter uuid := auth.uid();
begin
  if v_granter is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not (
       public.is_platform_admin_or_staff(v_granter)
    or public.is_any_venue_owner(v_granter)
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if exists (
    select 1 from public.user_roles
     where user_id = p_user_id and role = 'captain_gold'
  ) then
    raise exception 'ALREADY_CAPTAIN_GOLD';
  end if;

  -- Reemplaza el tier básico si existe (delete + insert) manteniendo la exclusión mutua.
  delete from public.user_roles
   where user_id = p_user_id and role = 'captain';

  insert into public.user_roles (user_id, role, granted_by_user_id)
  values (p_user_id, 'captain_gold', v_granter)
  on conflict (user_id, role) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_manual_reward (
  p_user_id         uuid,
  p_amount          numeric,
  p_reason          text,
  p_idempotency_key text
)
  RETURNS TABLE (
    applied            boolean,
    transaction_id     uuid,
    new_reward_balance numeric
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_reason      text;
  v_key         text;
  v_applied     boolean;
  v_tx_id       uuid;
  v_balance     numeric;
  v_prev_user   uuid;
  v_prev_type   text;
  v_prev_amount numeric;
  v_prev_reason text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- SOLO el administrador. Un algrass_staff se queda aqui.
  if not exists (
    select 1 from public.user_roles r
     where r.user_id = auth.uid() and r.role::text = 'algrass_admin'
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- ── A quien ──
  if p_user_id is null then
    raise exception 'INVALID_USER';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;
  -- Acreditar saldo a una cuenta borrada es dinero que nadie va a gastar.
  if exists (select 1 from public.users u where u.id = p_user_id and u.deleted_at is not null) then
    raise exception 'USER_DELETED';
  end if;

  -- ── Cuanto ──
  -- `= 'NaN'` no es paranoia: en numeric, NaN se ordena por encima de todo, asi
  -- que pasaria tanto el `> 0` como el `<= 500`.
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_amount > 500 then
    raise exception 'AMOUNT_TOO_LARGE';
  end if;

  -- ── Por que ──
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' then
    raise exception 'REASON_REQUIRED';
  end if;
  if length(v_reason) > 200 then
    raise exception 'REASON_TOO_LONG';
  end if;

  -- ── La clave de idempotencia es OBLIGATORIA ──
  -- Sin ella, grant_reward acredita cada vez que se le llama y un doble clic
  -- serian dos recompensas. Quien llama tiene que decidir que es «el mismo
  -- intento», y por eso no se genera aqui.
  v_key := btrim(coalesce(p_idempotency_key, ''));
  if v_key = '' then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if length(v_key) > 200 then
    raise exception 'IDEMPOTENCY_KEY_TOO_LONG';
  end if;

  -- ── El abono, por el unico camino que existe ──
  -- Esta funcion NO escribe wallet_summary. Lo hace grant_reward, dentro de
  -- esta misma transaccion.
  select g.applied, g.transaction_id, g.new_reward_balance
    into v_applied, v_tx_id, v_balance
    from public.grant_reward(p_user_id, p_amount, 'grant_manual', null, v_key) g;

  if v_applied then
    -- El motivo, sobre el asiento que se acaba de crear. Misma transaccion: si
    -- esto fallara, el abono se deshace con el.
    update public.reward_transactions
       set reason = v_reason
     where id = v_tx_id;
  else
    -- Repetida. Antes de darla por buena hay que comprobar que es EL MISMO
    -- intento y no otro que reutiliza la clave por error.
    --
    -- Devolver a ciegas la transaccion que lleve esa clave seria peor que
    -- fallar: quien llama veria «ya estaba hecho» y un importe o un
    -- destinatario que no son los que pidio, y se quedaria tan tranquilo.
    select t.user_id, t.type, t.amount, t.reason, t.id
      into v_prev_user, v_prev_type, v_prev_amount, v_prev_reason, v_tx_id
      from public.reward_transactions t
     where t.idempotency_key = v_key;

    -- grant_reward dijo «ya procesada» pero no hay asiento con esa clave: algo
    -- no cuadra y no vamos a inventarnos un resultado.
    if not found then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;

    -- Mismo destinatario, mismo tipo, mismo importe y mismo motivo. Un reintento
    -- de verdad los repite todos; cualquier diferencia es otra operacion.
    if v_prev_user   is distinct from p_user_id
       or v_prev_type   is distinct from 'grant_manual'
       or v_prev_amount is distinct from p_amount
       or v_prev_reason is distinct from v_reason then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
  end if;

  return query select v_applied, v_tx_id, v_balance;
end $function$;

REVOKE ALL ON FUNCTION "public"."grant_manual_reward"(uuid, numeric, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.grant_reward (
  p_user_id          uuid,
  p_amount           numeric,
  p_type             text    DEFAULT 'grant_manual'::text,
  p_referred_user_id uuid    DEFAULT NULL::uuid,
  p_idempotency_key  text    DEFAULT NULL::text
)
  RETURNS TABLE (
    applied            boolean,
    transaction_id     uuid,
    new_reward_balance numeric
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_tx_id uuid; v_balance numeric;
begin
  if p_user_id is null then raise exception 'INVALID_USER'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  if p_type = 'grant_manual' then
    if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'algrass_admin')
      then raise exception 'NOT_AUTHORIZED'; end if;

  elsif p_type = 'grant_referral' then
    -- SOLO contexto de servidor: pg_cron corre como postgres (session_user='postgres').
    -- Toda llamada de API PostgREST (anon/authenticated/service_role) tiene
    -- session_user='authenticator' → RECHAZADA. NO se usa auth.uid() IS NULL.
    if session_user <> 'postgres' then raise exception 'NOT_AUTHORIZED'; end if;
    if p_referred_user_id is null then raise exception 'INVALID_REFERRED_USER'; end if;

  else
    raise exception 'INVALID_GRANT_TYPE';
  end if;

  insert into public.reward_transactions (user_id, type, amount, granted_by, referred_user_id, idempotency_key)
  values (p_user_id, p_type, p_amount,
          case when p_type = 'grant_manual'   then auth.uid()         end,
          case when p_type = 'grant_referral' then p_referred_user_id end,
          p_idempotency_key)
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_tx_id;

  if v_tx_id is null then                        -- ya procesada → NO reacredita
    select reward_balance into v_balance from public.wallet_summary where user_id = p_user_id;
    return query select false, null::uuid, coalesce(v_balance, 0::numeric); return;
  end if;

  insert into public.wallet_summary (user_id, total_amount, reserved_balance, credit_balance, reward_balance)
  values (p_user_id, 0, 0, 0, p_amount)
  on conflict (user_id) do update set reward_balance = public.wallet_summary.reward_balance + p_amount
  returning reward_balance into v_balance;

  return query select true, v_tx_id, v_balance;
end $function$;

REVOKE ALL ON FUNCTION "public"."grant_reward"(uuid, numeric, text, uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  insert into public.users (
    id,
    full_name,
    email,
    role,
    organizer_status,
    credit_balance
  )
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(trim(concat_ws(' ',
        nullif(trim(new.raw_user_meta_data->>'given_name'), ''),
        nullif(trim(new.raw_user_meta_data->>'family_name'), ''))), ''),
      nullif(trim(split_part(new.email, '@', 1)), ''),
      ''
    ),
    new.email,
    'player',
    'none',
    0
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.has_open_venue_manager_request()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
      from public.venue_manager_requests
     where user_id = auth.uid()
       and status in ('pending', 'contacted')
  );
$function$;

REVOKE ALL ON FUNCTION "public"."has_open_venue_manager_request"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.init_championship_settings (
  p_city      text,
  p_copy_from text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_src   public.championship_settings%rowtype;
  v_extras jsonb := '[]'::jsonb;
  v_rules  jsonb := '[]'::jsonb;
  v_fmts   jsonb := '{}'::jsonb;
  v_close  integer := 0;
  v_cur    text := 'PEN';
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_write_app_settings() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;

  p_city := btrim(p_city);

  if exists (select 1 from public.championship_settings where city = p_city) then
    raise exception 'CHAMPIONSHIP_SETTINGS_EXISTS';
  end if;

  -- Una ciudad sin complejos no tiene canchas que contratar.
  if not exists (select 1 from public.venues v where v.city = p_city) then
    raise exception 'CITY_HAS_NO_VENUES';
  end if;

  if p_copy_from is not null and length(btrim(p_copy_from)) > 0 then
    select * into v_src from public.championship_settings where city = btrim(p_copy_from);
    if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;

    v_cur   := coalesce(v_src.currency, 'PEN');
    v_rules := coalesce(v_src.booking_lead_rules, '[]'::jsonb);
    v_fmts  := coalesce(v_src.availability_formats, '{}'::jsonb);
    v_close := coalesce(v_src.registration_close_days, 0);

    -- El catálogo se copia con su forma y sus límites, pero TODO apagado: un
    -- precio heredado de otra ciudad no es un precio de esta.
    select coalesce(jsonb_agg(e || jsonb_build_object('active', false)
                              order by floor((e->>'sort_order')::numeric)::int, e->>'code'), '[]'::jsonb)
      into v_extras
      from jsonb_array_elements(coalesce(v_src.extras, '[]'::jsonb)) e
     where jsonb_typeof(e) = 'object';

    -- Si el catálogo de origen estuviera mal formado, se dice AQUI. Copiarlo y
    -- descubrirlo al intentar activar la ciudad dejaria el fallo lejos de su causa.
    perform public._championship_assert_extras(v_extras);
  end if;

  insert into public.championship_settings (
    city, currency, referee_hourly_rate, algrass_fee_hourly_rate,
    booking_lead_rules, registration_close_days, extras, availability_formats,
    availability_blocks, active
  ) values (
    p_city, v_cur, 0, 0,
    v_rules, v_close, v_extras, v_fmts,
    '[]'::jsonb, false
  );

  return public.get_championship_settings_admin(p_city);
end $function$;

REVOKE ALL ON FUNCTION "public"."init_championship_settings"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.is_any_venue_owner (
  p_user_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from public.venues
    where manager_user_id = p_user_id
  );
$function$;

REVOKE ALL ON FUNCTION "public"."is_any_venue_owner"(uuid) FROM "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.is_captain (
  p_user_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.user_roles
     where user_id = p_user_id
       and role in ('captain', 'captain_gold')
  );
$function$;

REVOKE ALL ON FUNCTION "public"."is_captain"(uuid) FROM "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.is_platform_admin_or_staff (
  p_user_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.user_roles
     where user_id = p_user_id
       and role in ('algrass_staff', 'algrass_admin')
  );
$function$;

REVOKE ALL ON FUNCTION "public"."is_platform_admin_or_staff"(uuid) FROM "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.join_championship_team (
  p_championship_id uuid,
  p_team_id         uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  if v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)
     and not public._is_algrass_staff(v_actor) then
    raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
  end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  if not (
       v_champ.status = 'registration_open'
       or v_champ.status = 'registration_closed'
       or (v_champ.status = 'in_progress' and v_champ.live_started_at is null)
       or (v_champ.status = 'in_progress' and v_champ.live_started_at is not null and v_is_owner)
       or (v_champ.status = 'pending_publish' and v_is_owner)
     ) then
    raise exception 'NOT_OPEN';
  end if;
  if not exists (select 1 from public.championship_teams where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', p_team_id);
end; $function$;

REVOKE ALL ON FUNCTION "public"."join_championship_team"(uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.join_championship_team_with_secret (
  p_team_id        uuid,
  p_secret         text,
  p_confirm_change boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_team  public.championship_teams%rowtype;
  v_champ public.championships%rowtype;
  v_is_host boolean;
  v_part     text;
  v_cur_team uuid;
  v_in  text := nullif(btrim(coalesce(p_secret, '')), '');
  v_key text;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_host := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  -- Join gratis a equipo existente: abierto Y cerrado (NO abre compras ni cancelaciones).
  if v_champ.status not in ('registration_open', 'registration_closed') then raise exception 'NOT_OPEN'; end if;

  v_key := nullif(btrim(coalesce(v_team.join_secret, '')), '');
  if v_in is null then raise exception 'INVALID_SECRET'; end if;
  if v_key is null then raise exception 'NO_TEAM_SECRET'; end if;
  if v_in <> v_key then raise exception 'INVALID_SECRET'; end if;

  v_part := public._championship_participation(v_team.championship_id, v_actor);
  if v_part = 'none' then
    insert into public.championship_players (championship_id, user_id, team_id)
      values (v_team.championship_id, v_actor, p_team_id);
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id);
  end if;

  select cp.team_id into v_cur_team from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = v_actor;
  if v_cur_team = p_team_id then
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id, 'already', true);
  end if;
  if v_part in ('paid_individual','team_owner') then
    raise exception 'PAID_REGISTRATION_MUST_CANCEL_FIRST';
  end if;
  -- registration_closed: NO se permite CAMBIAR de equipo (ni con confirmación). Solo altas nuevas (v_part='none').
  -- Cambios/retiros excepcionales tras el cierre los hace AlGrass/Admin.
  if v_champ.status = 'registration_closed' then raise exception 'TEAM_CHANGE_CLOSED'; end if;
  if not coalesce(p_confirm_change, false) then raise exception 'CONFIRM_TEAM_CHANGE_REQUIRED'; end if;
  update public.championship_players set team_id = p_team_id
   where championship_id = v_team.championship_id and user_id = v_actor;
  return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', p_team_id, 'changed', true);
end $function$;

REVOKE ALL ON FUNCTION "public"."join_championship_team_with_secret"(uuid, text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.join_championship_team_with_token (
  p_token          text,
  p_confirm_change boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_tok   text := nullif(btrim(coalesce(p_token,'')),'');
  v_team  public.championship_teams%rowtype;
  v_champ public.championships%rowtype;
  v_is_host boolean;
  v_part     text;
  v_cur_team uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_tok is null then raise exception 'INVALID_LINK'; end if;

  select * into v_team from public.championship_teams where join_token = v_tok;
  if not found then raise exception 'INVALID_LINK'; end if;

  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_team.championship_id::text)::bigint);

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_host := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;

  -- Join gratis por link: abierto Y cerrado (NO abre compras ni cancelaciones).
  if v_champ.status not in ('registration_open', 'registration_closed') then raise exception 'NOT_OPEN'; end if;

  v_part := public._championship_participation(v_team.championship_id, v_actor);
  if v_part = 'none' then
    insert into public.championship_players (championship_id, user_id, team_id)
      values (v_team.championship_id, v_actor, v_team.id);
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id);
  end if;

  select cp.team_id into v_cur_team from public.championship_players cp
   where cp.championship_id = v_team.championship_id and cp.user_id = v_actor;
  if v_cur_team = v_team.id then
    return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id, 'already', true);
  end if;
  if v_part in ('paid_individual','team_owner') then
    raise exception 'PAID_REGISTRATION_MUST_CANCEL_FIRST';
  end if;
  -- registration_closed: NO se permite CAMBIAR de equipo (ni con confirmación). Solo altas nuevas (v_part='none').
  -- Cambios/retiros excepcionales tras el cierre los hace AlGrass/Admin.
  if v_champ.status = 'registration_closed' then raise exception 'TEAM_CHANGE_CLOSED'; end if;
  if not coalesce(p_confirm_change, false) then raise exception 'CONFIRM_TEAM_CHANGE_REQUIRED'; end if;
  update public.championship_players set team_id = v_team.id
   where championship_id = v_team.championship_id and user_id = v_actor;
  return jsonb_build_object('championship_id', v_team.championship_id, 'team_id', v_team.id, 'changed', true);
end $function$;

REVOKE ALL ON FUNCTION "public"."join_championship_team_with_token"(text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.join_championship_without_team (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Público de AlGrass (criterio estructural: individual O equipos): la inscripción es de PAGO
  -- (individual) o por equipo (crear/unirse con clave/token). La vía gratuita "sin equipo" queda cerrada.
  if v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null) then
    raise exception 'PUBLIC_CHAMPIONSHIP_PAYMENT_REQUIRED';
  end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;   -- Host NUNCA (aunque sea owner)

  -- "Sin equipo" SOLO en registration_open (cualquiera) o pending_publish (SOLO owner). En closed+ no aplica.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_is_owner)) then
    raise exception 'NOT_OPEN';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, v_actor, null)
  on conflict (championship_id, user_id) do update set team_id = null;

  return jsonb_build_object('championship_id', p_championship_id, 'team_id', null);
end; $function$;

REVOKE ALL ON FUNCTION "public"."join_championship_without_team"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.leave_championship (
  p_championship_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_is_owner boolean;
  v_is_host  boolean;
  v_deleted int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_owner := (v_champ.owner_user_id = v_actor);
  v_is_host  := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if v_is_host then raise exception 'NOT_AUTHORIZED'; end if;   -- Host NUNCA (aunque sea owner)

  -- NUEVO guard: el OWNER de un equipo pagado (capitán fijo) no sale por la vía gratuita;
  -- su única salida es cancelar la reserva del equipo (cancel_championship_team_registration).
  if public._championship_participation(p_championship_id, v_actor) = 'team_owner' then
    raise exception 'TEAM_OWNER_MUST_CANCEL_RESERVATION';
  end if;

  -- registration_open (cualquiera) o pending_publish (SOLO owner). Congelado desde registration_closed.
  if not (v_champ.status = 'registration_open'
          or (v_champ.status = 'pending_publish' and v_is_owner)) then
    raise exception 'NOT_OPEN';
  end if;

  delete from public.championship_players
   where championship_id = p_championship_id and user_id = v_actor;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('left', v_deleted > 0);
end; $function$;

REVOKE ALL ON FUNCTION "public"."leave_championship"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_admin_available_rentals()
  RETURNS TABLE (
    game_id      uuid,
    date_key     date,
    start_time   time without time zone,
    duration_min integer,
    price_total  numeric,
    field_id     uuid,
    field_name   text,
    venue_id     uuid,
    venue_name   text,
    has_twin     boolean
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Mismo permiso que el resto de lecturas del Back Office —admin y staff—, con
  -- el mismo helper que usa `get_admin_championship_reservations`.
  if not public.can_read_backoffice() then raise exception 'NOT_AUTHORIZED'; end if;

  return query
    select g.id, g.date_key, g.time, g.duration_min, g.price_total,
           g.field_id, f.name::text, f.venue_id, v.name::text,
           (g.alternative_game_id is not null)
      from public.games g
      left join public.fields f on f.id = g.field_id
      left join public.venues v on v.id = f.venue_id
     where g.type = 'rental'
       and g.status = 'published'
       and g.championship_id is null
       and g.booked_by_user_id is null
       -- Ya enlazado a un campeonato por otra via: no se ofrece dos veces.
       and not exists (
         select 1 from public.championship_reservation_games l where l.game_id = g.id
       )
       -- Alguien lo esta pagando ahora mismo: ofrecerlo seria enseñar algo que
       -- se va a caer al confirmar. El alta lo vuelve a comprobar, bajo lock.
       and not exists (
         select 1 from public.orders o
          where o.resource_id = g.id and o.status = 'pending' and o.pending_expires_at > now()
       )
       and not exists (
         select 1 from public.orders o
          where o.resource_id = g.alternative_game_id
            and o.status = 'pending' and o.pending_expires_at > now()
       )
       -- Un bloque que ya empezo no se puede contratar. Misma regla de tiempo
       -- que `assert_game_reservable`.
       and g.date_key is not null and g.time is not null
       and (g.date_key + g.time) at time zone 'America/Lima' > now()
     order by g.date_key, g.time, v.name nulls last, f.name nulls last, g.id;
end $function$;

REVOKE ALL ON FUNCTION "public"."list_admin_available_rentals"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_admin_championships()
  RETURNS TABLE (
    id                           uuid,
    name                         text,
    city                         text,
    status                       text,
    payment_method               text,
    event_date                   date,
    start_time                   time without time zone,
    venue_id                     uuid,
    owner_user_id                uuid,
    format_config                jsonb,
    created_at                   timestamp with time zone,
    order_terminal_reason        text,
    order_terminal_reason_detail text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.can_read_backoffice() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
    select c.id, c.name, c.city, c.status, c.payment_method,
           c.event_date, c.start_time, c.venue_id, c.owner_user_id,
           c.format_config, c.created_at,
           o.terminal_reason, o.terminal_reason_detail
      from public.championships c
      left join public.orders o on o.id = c.order_id
     order by c.created_at desc;
end $function$;

REVOKE ALL ON FUNCTION "public"."list_admin_championships"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_championship_blocks (
  p_city text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_set   public.championship_settings%rowtype;
  v_out   jsonb := '[]'::jsonb;
  v_blk   jsonb;
  v_norm  jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;

  select * into v_set from public.championship_settings where city = btrim(p_city);
  if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;

  if jsonb_typeof(v_set.availability_blocks) <> 'array' then
    -- La columna rota se dice, no se disimula: el validador está abortando.
    return jsonb_build_object('city', v_set.city, 'malformed', true, 'blocks', '[]'::jsonb);
  end if;

  for v_blk in select value from jsonb_array_elements(v_set.availability_blocks) as t(value) loop
    begin
      v_norm := public._championship_block_normalize(v_blk);
    exception
      when others then
        -- Un bloqueo que el validador no sabrá leer tiene que verse en pantalla.
        v_norm := jsonb_build_object('malformed', true, 'raw', v_blk);
    end;
    v_out := v_out || jsonb_build_array(v_norm);
  end loop;

  return jsonb_build_object('city', v_set.city, 'malformed', false, 'blocks', v_out);
end $function$;

REVOKE ALL ON FUNCTION "public"."list_championship_blocks"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_championship_requests()
  RETURNS TABLE (
    id                   uuid,
    user_id              uuid,
    contact_name         text,
    email                text,
    phone_country_code   text,
    contact_phone        text,
    company              text,
    job_title            text,
    message              text,
    championship_name    text,
    city                 text,
    districts            text[],
    format               text,
    participant_type     text,
    participant_quantity integer,
    tentative_date       date,
    tentative_start_date date,
    tentative_end_date   date,
    match_duration_min   integer,
    status               text,
    internal_notes       text,
    contacted_at         timestamp with time zone,
    managed_by_user_id   uuid,
    managed_by_name      text,
    created_at           timestamp with time zone,
    updated_at           timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.can_manage_championship_requests() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
    select r.id, r.user_id, r.contact_name, r.email, r.phone_country_code,
           r.contact_phone, r.company, r.job_title, r.message,
           r.championship_name, r.city, r.districts, r.format,
           r.participant_type, r.participant_quantity,
           r.tentative_date, r.tentative_start_date, r.tentative_end_date,
           r.match_duration_min,
           r.status, r.internal_notes, r.contacted_at, r.managed_by_user_id,
           -- Solo el nombre: para enseñar «gestionada por» no hace falta más.
           u.full_name as managed_by_name,
           r.created_at, r.updated_at
      from public.championship_requests r
      left join public.users_public u on u.id = r.managed_by_user_id
     order by r.created_at desc;
end $function$;

REVOKE ALL ON FUNCTION "public"."list_championship_requests"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_championship_settings_admin()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  return jsonb_build_object(
    'cities', coalesce((
      -- Lo justo para un selector de ciudad. El resto lo da
      -- `get_championship_settings_admin` cuando se abre una: repetir aquí las
      -- tarifas y los recuentos serían los mismos datos dichos dos veces.
      select jsonb_agg(
               jsonb_build_object(
                 'city',       s.city,
                 'active',     s.active,
                 'updated_at', s.updated_at
               ) order by s.city)
        from public.championship_settings s
    ), '[]'::jsonb),
    -- Ciudades con complejos y sin fila: son las que se pueden inicializar.
    'pending_cities', coalesce((
      select jsonb_agg(distinct v.city order by v.city)
        from public.venues v
       where v.city is not null
         and length(btrim(v.city)) > 0
         and not exists (select 1 from public.championship_settings s where s.city = v.city)
    ), '[]'::jsonb)
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."list_championship_settings_admin"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_championship_team_formats()
  RETURNS TABLE (
    group_id  text,
    min_teams integer,
    max_teams integer,
    capacity  integer
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
  with techos as (select unnest(array[4, 6, 8, 12, 14, 16]) as techo),
  numerados as (
    select techo, lag(techo) over (order by techo) as anterior from techos
  )
  -- `g1`..`g6`: el mismo ordinal que usa el catalogo del App, derivado del orden
  -- de los tramos en vez de copiado. Los seis son los mismos seis.
  select 'g' || row_number() over (order by techo) as group_id,
         coalesce(anterior + 1, 1)                 as min_teams,
         techo                                     as max_teams,
         public._championship_team_capacity(
           jsonb_build_object('summary', jsonb_build_object('group', jsonb_build_object('max', techo)))
         )                         as capacity
    from numerados
   order by techo;
$function$;

REVOKE ALL ON FUNCTION "public"."list_championship_team_formats"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_eligible_championship_hosts()
  RETURNS TABLE (
    id                uuid,
    full_name         text,
    user_code         text,
    city              text,
    avatar_path       text,
    avatar_hue        integer,
    avatar_updated_at timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Esta lista es del Back Office y de nadie más: dice quién opera la
  -- plataforma, y eso no se enseña por ahí.
  if not public.can_read_backoffice() then raise exception 'NOT_AUTHORIZED'; end if;

  return query
    select u.id, u.full_name::text, u.user_code::text, u.city::text,
           u.avatar_path::text, u.avatar_hue::int, u.avatar_updated_at
      from public.users_public u
      -- `as e(id)`: la función devuelve `setof uuid` y sin nombre de COLUMNA la
      -- referencia no existe. Ya pasó una vez.
      join public._eligible_championship_hosts() as e(id) on e.id = u.id
     order by u.full_name nulls last, u.id;
end $function$;

REVOKE ALL ON FUNCTION "public"."list_eligible_championship_hosts"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_my_championship_requests()
  RETURNS SETOF jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select jsonb_build_object(
    'id', r.id,
    'status', r.status,
    'championship_name', r.championship_name,
    'city', r.city,
    'districts', r.districts,
    'format', r.format,
    'participant_type', r.participant_type,
    'participant_quantity', r.participant_quantity,
    'tentative_date', r.tentative_date,
    'tentative_start_date', r.tentative_start_date,
    'tentative_end_date', r.tentative_end_date,
    'match_duration_min', r.match_duration_min,
    'contact_name', r.contact_name,
    'email', r.email,
    'phone_country_code', r.phone_country_code,
    'contact_phone', r.contact_phone,
    'company', r.company,
    'job_title', r.job_title,
    'message', r.message,
    'created_at', r.created_at,
    'updated_at', r.updated_at
    -- NO se exponen: internal_notes, contacted_at, managed_by_user_id (gestión interna de Admin).
  )
  from public.championship_requests r
  where r.user_id = auth.uid()
    and r.status in ('pending', 'contacted')   -- 'closed' NO visible en Perfil (reversible: vuelve al reabrirse)
  order by r.created_at desc;
$function$;

REVOKE ALL ON FUNCTION "public"."list_my_championship_requests"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_my_championships()
  RETURNS SETOF jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'name', c.name, 'cover_theme', c.cover_theme,
    'event_date', c.event_date, 'start_time', c.start_time, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'created_at', c.created_at,
    'live_started_at', c.live_started_at,
    'host_user_id', c.host_user_id,
    'is_participant', exists (
      select 1 from public.championship_players cp
       where cp.championship_id = c.id and cp.user_id = auth.uid()
    ),
    -- AÑADIDO (lectura autoritativa): capacidad real + sede/ciudad del venue principal + rango fisico.
    'team_capacity', public._championship_team_capacity(c.format_config),
    'venue_name', (select v.name from public.venues v where v.id = c.venue_id),
    'city',       (select v.city from public.venues v where v.id = c.venue_id),
    'first_date', (select min(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id)
  )
  from public.championships c
  where (
      (c.owner_user_id = auth.uid()
       and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                        'registration_closed', 'in_progress', 'completed'))
      or
      (c.host_user_id is not null and c.host_user_id = auth.uid()
       and c.status in ('payment_validation', 'pending_publish', 'registration_open',
                        'registration_closed', 'in_progress', 'completed'))
      or
      (exists (select 1 from public.championship_players cp
                where cp.championship_id = c.id and cp.user_id = auth.uid())
       and c.status in ('registration_open', 'registration_closed',
                        'in_progress', 'completed'))
    )
  order by c.event_date asc;
$function$;

REVOKE ALL ON FUNCTION "public"."list_my_championships"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_public_championships()
  RETURNS SETOF jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'cover_theme', c.cover_theme, 'status', c.status,
    'privacy', c.privacy, 'results_public', c.results_public,
    'event_date', c.event_date, 'start_time', c.start_time, 'end_time', c.end_time,
    'venue_id', c.venue_id, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'published_at', c.published_at,
    -- Fase 40: rango REAL desde championship_reservation_games → games.date_key (NO championship_matches).
    'first_date', (select min(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id)
  )
  from public.championships c
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
  order by c.event_date asc;
$function$;

CREATE OR REPLACE FUNCTION public.list_public_championships (
  p_city text
)
  RETURNS SETOF jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'cover_theme', c.cover_theme, 'status', c.status,
    'cover_image_path', c.cover_image_path,
    'privacy', c.privacy, 'results_public', c.results_public,
    'event_date', c.event_date, 'start_time', c.start_time, 'end_time', c.end_time,
    'venue_id', c.venue_id, 'format_config', c.format_config,
    'registration_closes_at', c.registration_closes_at, 'published_at', c.published_at,
    'first_date', (select min(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    'last_date',  (select max(g.date_key) from public.championship_reservation_games crg
                     join public.games g on g.id = crg.game_id where crg.championship_id = c.id),
    -- AÑADIDO (lectura autoritativa): capacidad real + sede/ciudad del venue principal.
    'team_capacity', public._championship_team_capacity(c.format_config),
    'venue_name', (select v.name from public.venues v where v.id = c.venue_id),
    'city',       (select v.city from public.venues v where v.id = c.venue_id)
  )
  from public.championships c
  where c.status in ('registration_open', 'registration_closed', 'in_progress', 'completed')
    and nullif(btrim(coalesce(p_city, '')), '') is not null
    and exists (select 1 from public.venues v where v.id = c.venue_id and v.city = p_city)
  order by c.event_date asc;
$function$;

CREATE OR REPLACE FUNCTION public.list_venue_manager_requests()
  RETURNS TABLE (
    id                uuid,
    user_id           uuid,
    name              text,
    email             text,
    city              text,
    district          text,
    venue_name        text,
    website           text,
    status            text,
    admin_notes       text,
    closed_comment    text,
    closed_by_user_id uuid,
    closed_by_name    text,
    closed_at         timestamp with time zone,
    created_at        timestamp with time zone,
    updated_at        timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_manage_venue_manager_requests() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
    select r.id, r.user_id, r.name, r.email, r.city, r.district, r.venue_name,
           r.website, r.status, r.admin_notes, r.closed_comment,
           r.closed_by_user_id,
           -- Solo el nombre. Ni el correo, ni el codigo, ni nada mas de la ficha
           -- de quien cerro: para mostrar «Cerrado por» no hace falta mas.
           u.full_name as closed_by_name,
           r.closed_at, r.created_at, r.updated_at
      from public.venue_manager_requests r
      left join public.users_public u on u.id = r.closed_by_user_id
     order by r.created_at desc;
end $function$;

REVOKE ALL ON FUNCTION "public"."list_venue_manager_requests"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.manage_championship_player (
  p_championship_id uuid,
  p_user_id         uuid,
  p_team_id         uuid    DEFAULT NULL::uuid,
  p_remove          boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor      uuid := auth.uid();
  v_champ      public.championships%rowtype;
  v_is_owner   boolean;
  v_is_host    boolean;
  v_is_algrass boolean;
  v_exists     boolean;
  v_self       boolean;
  v_action     text;
  v_deleted    int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- MISMA lock key que join/leave/save/delete → serializa todas las mutaciones de roster que compiten.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  v_is_algrass := public._is_algrass_staff(v_actor);
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_host    := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  if not (v_is_owner or v_is_host or v_is_algrass) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Objetivo: usuario REAL de la app (championship_players.user_id sin FK). Sin invitaciones externas.
  if p_user_id is null
     or not exists (select 1 from public.users_public where id = p_user_id) then
    raise exception 'INVALID_INPUT';
  end if;

  v_self   := (p_user_id = v_actor);
  v_exists := exists (select 1 from public.championship_players
                       where championship_id = p_championship_id and user_id = p_user_id);
  -- Categoría de operación:
  --   self       → target = actor (auto-inscribirse/mover/quedar-sin-equipo/desuscribirse owner/host).
  --   move_player→ target YA inscrito (o remove): mover/asignar/quitar membership existente.
  --   add_player → target NUEVO no inscrito: agregar tercero (host/AlGrass; y owner SOLO en privados).
  if v_self then
    v_action := 'self';
  elsif p_remove or v_exists then
    v_action := 'move_player';
  else
    v_action := 'add_player';
  end if;

  -- Regla de ROL: agregar un tercero nuevo es de host/AlGrass y, en campeonatos PRIVADOS, también del owner
  -- (mismo criterio que _champ_can_manage_roster). Falla de rol → NOT_AUTHORIZED. La ventana de fase la valida
  -- el helper más abajo (owner-privado: RO/RC/PRE/LIVE; nunca pending_publish ni completed).
  if v_action = 'add_player'
     and not (
       v_is_host
       or v_is_algrass
       or (v_is_owner and v_champ.privacy = 'private')
     )
  then
    raise exception 'NOT_AUTHORIZED';
  end if;
  -- Ventana por acción/estado. Privilegiado pero fuera de ventana → NOT_OPEN.
  if not public._champ_can_manage_roster(p_championship_id, v_actor, v_action) then
    raise exception 'NOT_OPEN';
  end if;

  if p_remove then
    delete from public.championship_players
     where championship_id = p_championship_id and user_id = p_user_id;
    get diagnostics v_deleted = row_count;
    return jsonb_build_object('championship_id', p_championship_id, 'user_id', p_user_id,
                              'team_id', null, 'removed', v_deleted > 0);
  end if;

  -- Asignación a team: debe existir Y pertenecer a ESTE campeonato (jamás team de otro campeonato).
  if p_team_id is not null
     and not exists (select 1 from public.championship_teams
                      where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  insert into public.championship_players (championship_id, user_id, team_id)
    values (p_championship_id, p_user_id, p_team_id)
  on conflict (championship_id, user_id) do update set team_id = excluded.team_id;

  return jsonb_build_object('championship_id', p_championship_id, 'user_id', p_user_id,
                            'team_id', p_team_id, 'removed', false);
end; $function$;

REVOKE ALL ON FUNCTION "public"."manage_championship_player"(uuid, uuid, uuid, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.mark_order_confirmed (
  p_order_id uuid
)
  RETURNS public.orders
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_order public.orders%rowtype;
begin
  -- CAS pending → confirmed (una sola transición).
  update public.orders
     set status      = 'confirmed',
         resolved_at = now(),
         updated_at  = now()
   where id = p_order_id
     and status = 'pending'
  returning * into v_order;
  if found then return v_order; end if;

  -- Ya no estaba 'pending'. Idempotente si ya está 'confirmed'; si es otro
  -- terminal (failed/expired), no es confirmable → error explícito.
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'confirmed' then
    raise exception 'ORDER_NOT_CONFIRMABLE: %', v_order.status;
  end if;
  return v_order;   -- ya 'confirmed' (idempotente): se devuelve tal cual
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_referral_rewards_communicated (
  p_ids uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  update public.reward_transactions
     set communicated_at = now()
   where id = any(p_ids)
     and user_id = auth.uid()
     and type in ('grant_referral', 'grant_manual')   -- 'spend' nunca
     and communicated_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

REVOKE ALL ON FUNCTION "public"."mark_referral_rewards_communicated"(uuid[]) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.mark_slot_reservation_notified (
  p_reservation_id uuid
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  update public.game_slot_reservations
     set expiry_notified_at = now()
   where id = p_reservation_id
     and reserved_by_user_id = auth.uid()
     and released_reason = 'automatic'
     and expiry_notified_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.mark_venue_manager_request_contacted (
  p_request_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_estado text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_manage_venue_manager_requests() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select status into v_estado
    from public.venue_manager_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_estado = 'closed' then
    raise exception 'REQUEST_CLOSED';
  end if;
  if v_estado <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  -- Solo el estado. Los campos de cierre siguen a NULL, como exige el CHECK.
  update public.venue_manager_requests
     set status = 'contacted'
   where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'status', 'contacted');
end $function$;

REVOKE ALL ON FUNCTION "public"."mark_venue_manager_request_contacted"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.match_cancellation_window (
  p_game_id uuid
)
  RETURNS TABLE (
    refundable       boolean,
    game_start_at    timestamp with time zone,
    refund_cutoff_at timestamp with time zone,
    server_now       timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'public'
  AS $function$
declare
  v_date_key     date;
  v_time         time;
  v_start        timestamptz;
  v_cutoff       timestamptz;
  v_now          timestamptz := now();   -- reloj del servidor (autoritativo)
  v_cutoff_hours integer;                -- app_settings.match_refund_cutoff_hours
begin
  select g.date_key, g.time
    into v_date_key, v_time
    from public.games g
   where g.id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_date_key is null or v_time is null then raise exception 'GAME_START_UNAVAILABLE'; end if;

  -- Política desde app_settings id=1 (SIN default oculto).
  select s.match_refund_cutoff_hours
    into v_cutoff_hours
    from public.app_settings s
   where s.id = 1;
  if v_cutoff_hours is null or v_cutoff_hours < 0 then
    raise exception 'CANCELLATION_CONFIG_UNAVAILABLE';
  end if;

  v_start  := (v_date_key + v_time) at time zone 'America/Lima';
  v_cutoff := v_start - v_cutoff_hours * interval '1 hour';   -- antes: interval '24 hours'

  -- Límite ESTRICTO: > cutoff ⇒ reembolsable; exactamente cutoff o menos ⇒ no.
  return query
    select (v_now < v_cutoff), v_start, v_cutoff, v_now;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_waitlist_spot_available (
  p_recipient_user_id uuid,
  p_game_id           uuid
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  INSERT INTO notifications (
    recipient_user_id,
    source_type,
    delivery_type,
    category,
    template_key,
    game_id,
    sent_at
  ) VALUES (
    p_recipient_user_id,
    'venue',
    'automatic',
    'reservation',
    'waitlist_spot_available',
    p_game_id,
    now()
  );
$function$;

CREATE OR REPLACE FUNCTION public.prevent_venue_staff_delete_while_hosting()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  v_activos  int;
  v_canchas  text;
begin
  select count(*)
    into v_activos
    from public.games g
    join public.fields f on f.id = g.field_id
   where g.host_user_id = old.user_id
     and f.venue_id = old.venue_id
     and g.status in ('published', 'reserved');

  if v_activos > 0 then
    raise exception
      'Todavía organiza % partido(s) publicado(s) o reservado(s) de este complejo. Reasígnalos a otro host antes de quitarle el acceso.',
      v_activos
      using errcode = 'P0001', hint = 'AG_STAFF_STILL_HOSTING';
  end if;

  -- Se nombran las canchas: sin eso, el administrador sabría que no puede pero
  -- no dónde ir a arreglarlo.
  select string_agg(f.name, ', ' order by f.name)
    into v_canchas
    from public.fields f
   where f.venue_id = old.venue_id
     and f.default_host_user_id = old.user_id;

  if v_canchas is not null then
    raise exception
      'Todavía es el host por defecto de estas canchas: %. Cámbialo en cada una antes de quitarle el acceso.',
      v_canchas
      using errcode = 'P0001', hint = 'AG_STAFF_IS_DEFAULT_HOST';
  end if;

  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION public.process_referral_rewards()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare v_granted int := 0; v_cfg record; p record; v_enabled boolean; v_amount numeric; v_res record;
begin
  select reward_referral_player_enabled, reward_referral_player_amount,
         reward_referral_captain_enabled, reward_referral_captain_amount,
         reward_referral_captain_gold_enabled, reward_referral_captain_gold_amount
    into v_cfg from public.app_settings where id = 1;
  if not found then raise exception 'REFERRAL_CONFIG_UNAVAILABLE'; end if;  -- no marca: reintenta

  for p in
    select v.user_id as referred_user_id, v.first_referred_by as referrer_id, gp.id as gp_id
      from public.player_first_completed_activity v
      join public.game_players gp
        on gp.user_id = v.user_id and gp.game_id = v.first_game_id and gp.status = 'confirmed'
     where v.is_referred_newcomer = true
       and gp.referral_reward_evaluated_at is null
       -- Guardia de orden (timing): difiere si hay una actividad de INICIO anterior aún sin
       -- resolver (podría ser la verdadera primera actividad cuando complete).
       and not exists (
         select 1 from public.games ge
          where ge.status not in ('completed','canceled','expired')
            and (ge.date_key, ge.time, ge.id) < (v.first_date_key, v.first_time, v.first_game_id)
            and ( (ge.type = 'rental' and ge.booked_by_user_id = v.user_id)
               or (ge.type = 'match'  and exists (select 1 from public.game_players gpe
                                                   where gpe.game_id = ge.id and gpe.user_id = v.user_id
                                                     and gpe.status = 'confirmed')) )
       )
  loop
    -- Claim atómico: lock + anti-doble-proceso sin FOR UPDATE sobre la vista.
    update public.game_players
       set referral_reward_evaluated_at = now()
     where id = p.gp_id and referral_reward_evaluated_at is null;
    if not found then continue; end if;                 -- otra corrida ya la tomó

    -- Rol ACTUAL del referrer (precedencia captain_gold > captain > jugador).
    if    exists (select 1 from public.user_roles where user_id = p.referrer_id and role = 'captain_gold')
      then v_enabled := v_cfg.reward_referral_captain_gold_enabled; v_amount := v_cfg.reward_referral_captain_gold_amount;
    elsif exists (select 1 from public.user_roles where user_id = p.referrer_id and role = 'captain')
      then v_enabled := v_cfg.reward_referral_captain_enabled;      v_amount := v_cfg.reward_referral_captain_amount;
    else       v_enabled := v_cfg.reward_referral_player_enabled;   v_amount := v_cfg.reward_referral_player_amount;
    end if;

    -- ON + amount>0 → paga vía grant_reward (único punto). OFF → ya quedó marcado (sin backfill).
    if v_enabled and v_amount > 0 then
      select * into v_res from public.grant_reward(
        p.referrer_id, v_amount, 'grant_referral', p.referred_user_id,
        'referral_first_match:' || p.referred_user_id::text);
      if v_res.applied then v_granted := v_granted + 1; end if;
    end if;
  end loop;
  return v_granted;
end $function$;

REVOKE ALL ON FUNCTION "public"."process_referral_rewards"() FROM PUBLIC, "anon", "authenticated", "service_role";

CREATE OR REPLACE FUNCTION public.protect_locked_game_fields()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  confirmed_count integer;
begin

  -- solo validar OLD en updates
  if tg_op = 'UPDATE' then

    select count(*)
      into confirmed_count
    from game_players gp
    where gp.game_id = new.id
      and gp.status = 'confirmed';

    if confirmed_count > 0 then

      if new.total_spots is distinct from old.total_spots
         or new.format is distinct from old.format then

        raise exception
          'cannot modify format/spots after confirmed players exist';

      end if;

    end if;

  end if;

  -- calcular SOLO para matches
  if new.type = 'match' or new.type is null then
    new.price_total :=
      coalesce(new.price_per_person, 0)
      * coalesce(new.total_spots, 0);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.public_availability (
  g public.games
)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path TO 'public'
  AS $function$
  select public.public_availability(g.id);
$function$;

CREATE OR REPLACE FUNCTION public.public_availability (
  p_game_id uuid
)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select greatest(
    coalesce((
      select coalesce(g.total_spots, f.total_spots)
        from public.games g
        left join public.fields f on f.id = g.field_id
       where g.id = p_game_id
    ), 0)
    - (
      select count(*)::integer
        from public.game_players gp
       where gp.game_id = p_game_id
         and gp.status = 'confirmed'
    )
    - coalesce((
      select sum(gsr.reserved_slots_remaining)::integer
        from public.game_slot_reservations gsr
       where gsr.game_id = p_game_id
         and gsr.status = 'active'
    ), 0),
    0
  );
$function$;

CREATE OR REPLACE FUNCTION public.publish_championship (
  p_championship_id uuid
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from v_actor then raise exception 'NOT_OWNER'; end if;

  -- Idempotencia: ya publicado → no-op, SALVO que sea un público de AlGrass que aún arrastre una clave vieja
  -- → se limpia a NULL (regla: público = sin clave). Privado ya publicado: intacto (conserva su clave).
  if v_champ.status = 'registration_open' then
    if v_champ.order_id is null and v_champ.public_individual_price is not null
       and v_champ.registration_key is not null then
      update public.championships
         set registration_key = null, updated_at = now()
       where id = p_championship_id
      returning * into v_champ;
    end if;
    return v_champ;
  end if;
  if v_champ.status <> 'pending_publish' then raise exception 'INVALID_STATE'; end if;

  -- Clave OBLIGATORIA SOLO en PRIVADOS. Público de AlGrass (order_id NULL + precio individual) publica
  -- con registration_key NULL (no tiene clave de acceso). Privados: idéntico a antes.
  if not (v_champ.order_id is null and v_champ.public_individual_price is not null)
     and nullif(btrim(coalesce(v_champ.registration_key, '')), '') is null then
    raise exception 'NO_REGISTRATION_KEY';
  end if;

  -- Público de AlGrass → la clave se limpia a NULL en el MISMO update (regla: público = sin clave, aunque
  -- arrastrara una registration_key previa). Privado → se conserva EXACTAMENTE su clave.
  update public.championships
     set status           = 'registration_open',
         registration_key = case when (v_champ.order_id is null and v_champ.public_individual_price is not null)
                                 then null else v_champ.registration_key end,
         published_at     = now(),
         updated_at       = now()
   where id = p_championship_id
  returning * into v_champ;

  return v_champ;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."publish_championship"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.quote_championship (
  p_game_ids uuid[],
  p_group_id text,
  p_extras   jsonb  DEFAULT '[]'::jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Solo cálculo (valida formato/ciudad/settings/lead-days/extras). NO championship, NO order, NO reserva, NO spend.
  return public._championship_compute_price(p_game_ids, p_group_id, coalesce(p_extras, '[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION public.rebuild_reserved_slots_used (
  p_game_slot_reservation_id uuid
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  update public.game_slot_reservations gsr
     set reserved_slots_used = (
       select count(*)::integer
         from public.game_players gp
        where gp.game_slot_reservation_id = p_game_slot_reservation_id
          and gp.status = 'confirmed'
          and gp.counts_reserved_slot = true
     )
   where gsr.id = p_game_slot_reservation_id;
$function$;

CREATE OR REPLACE FUNCTION public.reject_captain_request (
  p_request_id uuid,
  p_note       text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_user   uuid;
  v_estado text;
  v_motivo text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_platform_admin_or_staff(v_actor) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Se sanea ANTES de tocar la tabla: un motivo de solo espacios no es motivo.
  v_motivo := nullif(btrim(coalesce(p_note, '')), '');

  if v_motivo is null then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;
  if length(v_motivo) > 2000 then
    raise exception 'REJECTION_REASON_TOO_LONG';
  end if;

  select user_id, status
    into v_user, v_estado
    from public.captain_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_estado <> 'pending_review' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  update public.captain_requests
     set status              = 'rejected',
         assigned_role       = null,
         reviewed_at         = now(),
         reviewed_by_user_id = v_actor,
         review_note         = v_motivo
   where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'user_id', v_user);
end $function$;

REVOKE ALL ON FUNCTION "public"."reject_captain_request"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.reject_championship_transfer (
  p_championship_id uuid,
  p_reason          text DEFAULT NULL::text
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_champ    public.championships%rowtype;
  v_expected uuid[];
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Lock championship PRIMERO (mismo orden que approve).
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Idempotencia VERIFICADA: 'canceled' es no-op SOLO si el terminal quedó CONSISTENTE.
  -- (order failed/expired, sin spend, sin canchas aún reserved de este campeonato.)
  if v_champ.status = 'canceled' then
    if exists (select 1 from public.reservations where championship_id = p_championship_id and status = 'spend') then
      raise exception 'INVALID_STATE';   -- canceled + spend → inconsistente (no debió cancelarse)
    end if;
    if exists (select 1 from public.games where championship_id = p_championship_id and status = 'reserved') then
      raise exception 'INVALID_STATE';   -- canceled + canchas aún reserved → liberación incompleta
    end if;
    if v_champ.order_id is not null
       and not exists (select 1 from public.orders where id = v_champ.order_id and status in ('failed','expired')) then
      raise exception 'INVALID_STATE';   -- canceled + order no terminal → inconsistente
    end if;
    return v_champ;                       -- terminal consistente → no-op idempotente
  end if;
  if v_champ.status <> 'payment_validation' then raise exception 'INVALID_STATE'; end if;

  -- Defensa contable: nunca rechazar un campeonato que YA tiene spend (fue aprobado).
  if exists (
    select 1 from public.reservations where championship_id = p_championship_id and status = 'spend'
  ) then
    raise exception 'ALREADY_PAID';
  end if;

  -- Order debe estar en 'validation'. Lock.
  if v_champ.order_id is not null then
    perform 1 from public.orders where id = v_champ.order_id for update;
    if not exists (select 1 from public.orders where id = v_champ.order_id and status = 'validation') then
      raise exception 'INVALID_STATE';
    end if;
  end if;

  -- Composición esperada = links del campeonato. Lock de esos games (orden estable).
  select array_agg(game_id) into v_expected
    from public.championship_reservation_games where championship_id = p_championship_id;
  if v_expected is null or array_length(v_expected, 1) is null then
    raise exception 'CHAMPIONSHIP_RELEASE_NO_GAMES';
  end if;
  perform 1 from public.games where id = any(v_expected) order by id for update;

  -- TODOS los esperados deben seguir reserved + pertenecer a ESTE campeonato.
  if exists (
    select 1 from unnest(v_expected) gid
     where not exists (
       select 1 from public.games g
        where g.id = gid and g.championship_id = p_championship_id and g.status = 'reserved'
     )
  ) then
    raise exception 'CHAMPIONSHIP_RELEASE_COMPOSITION_MISMATCH';
  end if;
  -- Ningún game EXTRA puede reclamar este campeonato (consistencia).
  if exists (
    select 1 from public.games g
     where g.championship_id = p_championship_id and g.id <> all(v_expected)
  ) then
    raise exception 'CHAMPIONSHIP_RELEASE_COMPOSITION_MISMATCH';
  end if;

  -- Liberar: reserved → published + championship_id NULL. Dispara trg_reopen_double_out_twin
  -- (gemelo 'blocked' → blocked_from_status). booked_by_user_id ya es NULL en el hold.
  update public.games
     set status = 'published', championship_id = null
   where id = any(v_expected) and championship_id = p_championship_id and status = 'reserved';

  -- Links: eliminar (mismo patrón que _championship_release_hold).
  delete from public.championship_reservation_games where championship_id = p_championship_id;

  -- orders: validation → failed (CAS; si no estaba 'validation', abortar y rollback total).
  if v_champ.order_id is not null then
    -- terminal_reason es CÓDIGO de máquina (como 'timeout'/'user_canceled' del release). Se fija el código
    -- 'admin_rejected'. La nota HUMANA viaja a su lado, en terminal_reason_detail: el código dice qué pasó
    -- y el detalle por qué. Vacío o solo espacios se guarda como NULL —el motivo sigue siendo opcional—.
    --
    -- No hay riesgo de pisar un motivo anterior: esta sentencia solo se alcanza desde 'payment_validation',
    -- y un segundo rechazo sobre un campeonato ya 'canceled' sale antes por la rama idempotente de arriba.
    update public.orders
       set status = 'failed',
           terminal_reason = 'admin_rejected',
           terminal_reason_detail = nullif(btrim(p_reason), ''),
           resolved_at = now(),
           updated_at = now()
     where id = v_champ.order_id and status = 'validation';
    if not found then raise exception 'INVALID_STATE'; end if;
  end if;

  -- championships: payment_validation → canceled.
  update public.championships
     set status = 'canceled', hold_expires_at = null, updated_at = now()
   where id = p_championship_id
  returning * into v_champ;

  return v_champ;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."reject_championship_transfer"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.release_championship_transfer_hold (
  p_championship_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id <> v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status = 'canceled' then return; end if;                  -- idempotente
  -- Solo se libera un transfer_hold. NUNCA payment_validation / pending_publish / campeonato ajeno.
  if v_champ.status <> 'transfer_hold' then raise exception 'INVALID_STATE'; end if;
  -- Causa fijada por la RPC (no por el frontend): cancelación voluntaria → order 'failed'/user_canceled.
  perform public._championship_release_hold(p_championship_id, 'user_canceled');
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_slot_reservation (
  p_reservation_id uuid,
  p_reason         text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  -- Solo se libera una R1 ACTIVA. En un único UPDATE: last_released_slots toma el
  -- valor VIEJO de reserved_slots_total (todos los RHS se evalúan sobre la fila
  -- previa) y reserved_slots_total pasa a 0.
  update public.game_slot_reservations
     set status               = 'inactive',
         last_released_slots  = reserved_slots_total,
         reserved_slots_total = 0,
         reserved_slots_used  = 0,
         released_reason      = p_reason,
         released_at          = now(),
         updated_at           = now()
   where id = p_reservation_id
     and status = 'active';

  -- Si no había una R1 ACTIVA con ese id, no se liberó nada → idempotente: no se
  -- toca game_players ni ningún otro campo.
  if not found then
    return;
  end if;

  -- Los game_players del grupo dejan de consumir cupos reservados. SOLO ese flag:
  -- no se tocan game_slot_reservation_id, status, reservation_id, invited_by ni
  -- referred_by_user_id (idéntico a la liberación manual histórica).
  update public.game_players
     set counts_reserved_slot = false
   where game_slot_reservation_id = p_reservation_id
     and counts_reserved_slot = true;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."release_slot_reservation"(uuid, text) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.remove_championship_block (
  p_city     text,
  p_block_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_set   public.championship_settings%rowtype;
  v_out   jsonb := '[]'::jsonb;
  v_blk   jsonb;
  v_hubo  boolean := false;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_write_app_settings() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;
  if p_block_id is null then raise exception 'INVALID_INPUT'; end if;

  select * into v_set from public.championship_settings where city = btrim(p_city) for update;
  if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;
  if jsonb_typeof(v_set.availability_blocks) <> 'array' then
    raise exception 'CHAMPIONSHIP_BLOCKS_MALFORMED';
  end if;

  for v_blk in select value from jsonb_array_elements(v_set.availability_blocks) as t(value) loop
    if (v_blk->>'id') is not distinct from p_block_id::text then
      v_hubo := true;                      -- se cae
    else
      v_out := v_out || jsonb_build_array(v_blk);
    end if;
  end loop;

  if not v_hubo then raise exception 'CHAMPIONSHIP_BLOCK_NOT_FOUND'; end if;

  update public.championship_settings
     set availability_blocks = v_out,
         updated_at          = now()
   where city = btrim(p_city);

  return public.list_championship_blocks(btrim(p_city));
end $function$;

REVOKE ALL ON FUNCTION "public"."remove_championship_block"(text, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.rental_cancellation_window (
  p_game_id uuid
)
  RETURNS TABLE (
    refund_pct    integer,
    game_start_at timestamp with time zone,
    cutoff_72h    timestamp with time zone,
    cutoff_24h    timestamp with time zone,
    server_now    timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'public'
  AS $function$
declare
  v_type     text;
  v_date_key date;
  v_time     time;
  v_start    timestamptz;
  v_now      timestamptz := now();
  v_full_h   integer;    -- rental_full_refund_cutoff_hours
  v_part_h   integer;    -- rental_partial_refund_cutoff_hours
  v_part_pct integer;    -- rental_partial_refund_percent
begin
  select g.type, g.date_key, g.time
    into v_type, v_date_key, v_time
    from public.games g
   where g.id = p_game_id;

  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_type is distinct from 'rental' then raise exception 'NOT_A_RENTAL'; end if;
  if v_date_key is null or v_time is null then raise exception 'GAME_START_UNAVAILABLE'; end if;

  -- Política desde app_settings id=1 (MISMA fuente que cancel_rental_self; SIN default).
  select s.rental_full_refund_cutoff_hours, s.rental_partial_refund_cutoff_hours, s.rental_partial_refund_percent
    into v_full_h, v_part_h, v_part_pct
    from public.app_settings s
   where s.id = 1;
  if v_full_h is null or v_part_h is null or v_part_pct is null
     or v_full_h < 0 or v_part_h < 0 or v_part_pct < 0 or v_part_pct > 100
     or v_full_h <= v_part_h then   -- coincide con el constraint: full > partial (estricto)
    raise exception 'CANCELLATION_CONFIG_UNAVAILABLE';
  end if;

  v_start := (v_date_key + v_time) at time zone 'America/Lima';

  if v_start <= v_now then raise exception 'RENTAL_ALREADY_STARTED'; end if;

  return query
    select
      case
        when v_now < v_start - v_full_h * interval '1 hour' then 100          -- tope estructural
        when v_now < v_start - v_part_h * interval '1 hour' then v_part_pct   -- antes: 50
        else 0                                                                -- piso estructural
      end,
      v_start,
      v_start - v_full_h * interval '1 hour',
      v_start - v_part_h * interval '1 hour',
      v_now;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."rental_cancellation_window"(uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.reopen_double_out_twin()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_twin public.games%rowtype;
begin
  -- Gemelo (lock de fila para consistencia dentro de la tx).
  select * into v_twin
    from public.games
   where id = new.alternative_game_id
   for update;

  -- Vínculo roto o gemelo inexistente → NO-OP (no abortar una liberación; no
  -- tocar una fila que ya no es la pareja de A).
  if not found or v_twin.alternative_game_id is distinct from new.id then
    return null;
  end if;

  -- Restaurar SOLO si B sigue sellado por A ('blocked') Y su estado previo es uno
  -- de los válidos ('published'/'paused'/'draft'). NO se asume 'published': si
  -- blocked_from_status es NULL o cualquier valor inesperado → NO-OP (no publicar
  -- automáticamente nada). Si B ya no está blocked → tampoco se toca (idempotente).
  if v_twin.status = 'blocked'
     and v_twin.blocked_from_status in ('published', 'paused', 'draft') then
    update public.games
       set status              = v_twin.blocked_from_status,
           blocked_from_status = null
     where id = v_twin.id;
  end if;

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_stuck_captain_welcome_emails (
  p_timeout interval DEFAULT '00:15:00'::interval
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_n integer;
begin
  update public.captain_welcome_emails
     set status     = 'failed',
         claimed_at = null,
         last_error = 'Reclamacion caducada: el envio se interrumpio a medias y la fila volvio a la cola.'
   where status = 'sending'
     and (claimed_at is null or claimed_at < now() - p_timeout);

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

REVOKE ALL ON FUNCTION "public"."requeue_stuck_captain_welcome_emails"(interval) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.requeue_stuck_welcome_emails (
  p_timeout interval DEFAULT '00:15:00'::interval
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_n integer;
begin
  update public.welcome_emails
     set status     = 'failed',
         claimed_at = null,
         last_error = 'Reclamacion caducada: el envio se interrumpio a medias y la fila volvio a la cola.'
   where status = 'sending'
     and (claimed_at is null or claimed_at < now() - p_timeout);

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

REVOKE ALL ON FUNCTION "public"."requeue_stuck_welcome_emails"(interval) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.required_players_from_format (
  p_format text
)
  RETURNS integer
  LANGUAGE plpgsql
  IMMUTABLE
  AS $function$
declare
  v_players integer;
begin
  v_players := split_part(lower(p_format), 'v', 1)::integer;
  return v_players * 2;
exception
  when others then
    return 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_slots (
  p_game_id              uuid,
  p_reserved_slots_total integer,
  p_actor                uuid    DEFAULT NULL::uuid
)
  RETURNS public.game_slot_reservations
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor            uuid := coalesce(auth.uid(), p_actor);
  v_type             text;
  v_status           text;
  v_date_key         date;
  v_time             time;
  v_total_spots      integer;
  v_venue_owner_id   uuid;
  v_game_start       timestamptz;
  v_is_captain_gold  boolean;
  v_is_captain       boolean;
  v_is_admin         boolean;
  v_is_staff         boolean;
  v_is_owner         boolean;
  v_role             text;
  v_new_status       text;
  v_confirmed        integer;
  v_held             integer;
  v_holds            integer := 0;   -- Σ claimed_units de PENDING vivos de OTROS usuarios
  v_public_available integer;
  v_existing         public.game_slot_reservations%rowtype;
  v_r1_exists        boolean;
  v_floor            integer := 0;   -- V14: piso adoptable (titular + directos gsr null / ya propios)
  v_used_after       integer := 0;   -- V14: used PROYECTADO tras la adopción (reemplaza v_used de V13)
  v_new_hold         integer;
  v_reservation      public.game_slot_reservations%rowtype;
  v_cap_h            integer;    -- app_settings.captain_release_hours
  v_gold_h           integer;    -- app_settings.captain_gold_release_hours
  v_release_h        integer;    -- horas efectivas según rol (0 = expira en game_start)
begin
  -- 1) Sesión.
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- 2) Cantidad válida. 0 es válido (R1 nace/queda 'inactive'); negativo no.
  if p_reserved_slots_total is null or p_reserved_slots_total < 0 then
    raise exception 'INVALID_SLOT_COUNT';
  end if;

  -- 3) Bloqueo del partido (FOR UPDATE) + datos del venue para autorizar al owner.
  select g.type,
         g.status,
         g.date_key,
         g.time,
         coalesce(g.total_spots, f.total_spots),
         v.manager_user_id
    into v_type, v_status, v_date_key, v_time, v_total_spots, v_venue_owner_id
    from public.games g
    left join public.fields f on f.id = g.field_id
    left join public.venues v on v.id = f.venue_id
   where g.id = p_game_id
   for update of g;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  -- 4-5) Precondiciones del recurso (tipo / estado publicado-reservable / no iniciado).
  perform public.assert_game_reservable(p_game_id, 'match');
  v_game_start := (v_date_key + v_time) at time zone 'America/Lima';

  -- 6) Autorización + reserved_by_role por precedencia.
  v_is_captain_gold := exists (select 1 from public.user_roles where user_id = v_actor and role = 'captain_gold');
  v_is_captain      := exists (select 1 from public.user_roles where user_id = v_actor and role = 'captain');
  v_is_admin        := exists (select 1 from public.user_roles where user_id = v_actor and role = 'algrass_admin');
  v_is_staff        := exists (select 1 from public.user_roles where user_id = v_actor and role = 'algrass_staff');
  v_is_owner        := v_venue_owner_id is not null and v_venue_owner_id = v_actor;

  if    v_is_owner        then v_role := 'venue_owner';
  elsif v_is_captain_gold then v_role := 'captain_gold';
  elsif v_is_captain      then v_role := 'captain';
  elsif v_is_admin        then v_role := 'algrass_admin';
  elsif v_is_staff        then v_role := 'algrass_staff';
  else
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 7) Precondición: solo un capitán INSCRITO (confirmado) puede crear/reactivar.
  if not exists (
    select 1 from public.game_players
     where game_id = p_game_id
       and user_id = v_actor
       and status = 'confirmed'
  ) then
    raise exception 'CAPTAIN_NOT_ENROLLED';
  end if;

  -- 8) R1 ÚNICA por (game_id, reserved_by_user_id). Se bloquea si existe.
  select * into v_existing
    from public.game_slot_reservations
   where game_id = p_game_id
     and reserved_by_user_id = v_actor
   for update;

  v_r1_exists := found;

  -- Una R1 liberada por el cron (released_reason='automatic') no puede reactivarse.
  if v_r1_exists and v_existing.released_reason = 'automatic' then
    raise exception 'SLOT_RESERVATION_EXPIRED';
  end if;

  -- V14 · PISO adoptable + CLAMP N >= piso (solo p_total > 0). Piso = titular + directos
  -- confirmed con gsr NULL o ya en MI R1 (excluye directos en OTRA R1 y a los link).
  if p_reserved_slots_total > 0 then
    select count(*)::integer
      into v_floor
      from public.game_players
     where game_id  = p_game_id
       and status   = 'confirmed'
       and payer_id = v_actor
       and ( user_id = v_actor
             or game_slot_reservation_id is null
             or game_slot_reservation_id = v_existing.id );   -- v_existing.id es NULL en R1 nueva
    if p_reserved_slots_total < v_floor then
      p_reserved_slots_total := v_floor;                      -- auto-raise a piso (Sección 13)
    end if;
  end if;

  v_new_status := case when p_reserved_slots_total > 0 then 'active' else 'inactive' end;

  -- 9) Capacidad (GAME_FULL) con used PROYECTADO (acredita titular + directos a adoptar).
  select count(*)::integer
    into v_confirmed
    from public.game_players
   where game_id = p_game_id and status = 'confirmed';

  select coalesce(sum(reserved_slots_remaining), 0)::integer
    into v_held
    from public.game_slot_reservations
   where game_id = p_game_id
     and status = 'active'
     and id is distinct from v_existing.id;

  -- HOLD-aware: Orders PENDING vivos de OTROS usuarios (holds de pasarela/crédito en
  -- ventana de pago). reserve_slots y create_order ya serializan por FOR UPDATE of g;
  -- sin esto, reserve_slots ignoraba estos holds y podía crear/aumentar R1 sobre
  -- capacidad ya retenida. Se excluye el hold en vuelo del propio actor (su Order se
  -- está materializando ahora: no debe contar contra sí mismo).
  select coalesce(sum(o.claimed_units), 0)::integer
    into v_holds
    from public.orders o
   where o.resource_id = p_game_id
     and o.status = 'pending'
     and o.pending_expires_at > now()
     and o.payer_user_id <> v_actor;

  v_public_available := coalesce(v_total_spots, 0) - v_confirmed - v_held - v_holds;

  -- used_after = conjunto counts=true que tendrá MI R1 tras la adopción:
  --   · miembros actuales de mi R1 (incl. links, counts=true), UNIÓN
  --   · titular + directos adoptables (payer=actor con user=actor / gsr null / gsr=mi R1).
  select count(*)::integer
    into v_used_after
    from public.game_players
   where game_id = p_game_id
     and status  = 'confirmed'
     and ( (game_slot_reservation_id = v_existing.id and counts_reserved_slot = true)
           or (payer_id = v_actor
               and (user_id = v_actor
                    or game_slot_reservation_id is null
                    or game_slot_reservation_id = v_existing.id)) );

  v_new_hold := greatest(p_reserved_slots_total - v_used_after, 0);
  if v_new_hold > v_public_available then
    raise exception 'GAME_FULL';
  end if;

  -- 10) Escritura V6. Si existe R1 → UPDATE; si no y total>0 → INSERT.
  if v_r1_exists then
    if p_reserved_slots_total = 0 then
      -- V6 · reducir a 0: liberación MANUAL (punto único). NO adopta ni reasigna a nadie.
      perform public.release_slot_reservation(v_existing.id, 'manual_cancel_slots');
      select * into v_reservation
        from public.game_slot_reservations
       where id = v_existing.id;
      return v_reservation;
    end if;

    -- total > 0: actualizar la MISMA R1.
    update public.game_slot_reservations
       set status               = v_new_status,
           reserved_slots_total = p_reserved_slots_total,
           peak_reserved_slots  = greatest(coalesce(peak_reserved_slots, v_existing.reserved_slots_total), p_reserved_slots_total),
           updated_at           = now()
     where id = v_existing.id
    returning * into v_reservation;

    -- V14 · adopción: titular (SIEMPRE, aun desde otra R1) + invitados directos con gsr NULL
    -- o ya en MI R1. Los directos en OTRA R1 NO se tocan; los link (payer<>actor) tampoco.
    -- El trigger recomputa reserved_slots_used (destino y, para el titular, origen).
    update public.game_players
       set game_slot_reservation_id = v_reservation.id,
           counts_reserved_slot     = true
     where game_id  = p_game_id
       and status   = 'confirmed'
       and payer_id = v_actor
       and ( user_id = v_actor
             or game_slot_reservation_id is null
             or game_slot_reservation_id = v_reservation.id )
       and (game_slot_reservation_id is distinct from v_reservation.id
            or counts_reserved_slot is distinct from true);

    return v_reservation;
  end if;

  -- No existe R1: solo se CREA si se reservan cupos (total > 0).
  if p_reserved_slots_total = 0 then
    return null;
  end if;

  -- Ventana de liberación configurable (app_settings id=1). Se lee SOLO AQUÍ, en el
  -- punto de CREACIÓN de la R1 (materializa expires_at UNA vez). La rama UPDATE de una
  -- R1 existente retorna antes de llegar aquí → NUNCA recalcula expires_at. Roles no
  -- capitanes (admin/staff/owner) conservan 0h (expira en game_start), sin leer config.
  if v_role = 'captain_gold' or v_role = 'captain' then
    select s.captain_gold_release_hours, s.captain_release_hours
      into v_gold_h, v_cap_h
      from public.app_settings s
     where s.id = 1;

    v_release_h := case v_role
                     when 'captain_gold' then v_gold_h
                     when 'captain'      then v_cap_h
                   end;

    -- SIN fallback silencioso a 24/48: config ausente / NULL / fuera de 0..720 → abortar
    -- ANTES de escribir la R1. 0 es VÁLIDO (expira en game_start).
    if v_release_h is null or v_release_h < 0 or v_release_h > 720 then
      raise exception 'SLOT_RELEASE_CONFIG_UNAVAILABLE';
    end if;
  else
    v_release_h := 0;
  end if;

  insert into public.game_slot_reservations (
    game_id,
    reserved_by_user_id,
    reserved_by_role,
    status,
    reserved_slots_total,
    initial_reserved_slots,
    peak_reserved_slots,
    expires_at,
    created_at,
    updated_at
  ) values (
    p_game_id,
    v_actor,
    v_role,
    v_new_status,
    p_reserved_slots_total,
    p_reserved_slots_total,
    p_reserved_slots_total,
    v_game_start - make_interval(hours => v_release_h),   -- config: captain(_gold)_release_hours; 0 ⇒ game_start
    now(),
    now()
  )
  returning * into v_reservation;

  -- V14 · adopción en la R1 recién creada (misma filosofía que la rama UPDATE).
  update public.game_players
     set game_slot_reservation_id = v_reservation.id,
         counts_reserved_slot     = true
   where game_id  = p_game_id
     and status   = 'confirmed'
     and payer_id = v_actor
     and ( user_id = v_actor
           or game_slot_reservation_id is null
           or game_slot_reservation_id = v_reservation.id )
     and (game_slot_reservation_id is distinct from v_reservation.id
          or counts_reserved_slot is distinct from true);

  return v_reservation;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_captain (
  p_user_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_granter uuid := auth.uid();
begin
  if v_granter is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_platform_admin_or_staff(v_granter) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  delete from public.user_roles
   where user_id = p_user_id and role in ('captain', 'captain_gold');
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_championship_fixture (
  p_championship_id uuid,
  p_matches         jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_errors   jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_add      jsonb;
  v_saved    int;
  v_nuevos   int;
  v_borrados int;
  v_orden    int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Rol comprobado DENTRO. Ni el dueño, ni el host, ni un jugador: esconder el
  -- botón no es una protección.
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  if not exists (select 1 from public.championships where id = p_championship_id) then
    raise exception 'CHAMPIONSHIP_NOT_FOUND';
  end if;
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then
    raise exception 'INVALID_PAYLOAD';
  end if;

  -- Se puede editar DESDE QUE HAY CALENDARIO. La fase no manda aquí: corregir la
  -- hora de un partido de un campeonato ya terminado es una corrección histórica
  -- legítima, y la marca de cuándo se publicó es un dato, no un permiso.
  if not exists (
    select 1 from public.championship_matches where championship_id = p_championship_id
  ) then
    raise exception 'FIXTURE_REQUIRED';
  end if;

  -- Bloqueo de los partidos del campeonato, en orden estable. Dos admins
  -- guardando a la vez se serializan aquí; el segundo verá el `updated_at`
  -- cambiado y se llevará CONCURRENT_UPDATE en vez de pisar lo del primero.
  perform 1 from public.championship_matches
   where championship_id = p_championship_id
   order by id
   for update;

  -- ── El borrador, normalizado ───────────────────────────────────────────────
  drop table if exists pg_temp._borrador;
  create temporary table pg_temp._borrador on commit drop as
  select coalesce(nullif(e->>'key', ''), (e->>'id'))          as id_fila,
         nullif(e->>'id', '')::uuid                           as id,
         nullif(e->>'home_team_id', '')::uuid                 as home_team_id,
         nullif(e->>'away_team_id', '')::uuid                 as away_team_id,
         -- Solo se usan al INSERTAR; en los que ya existen se ignoran.
         nullif(e->>'stage', '')::text                        as stage,
         nullif(e->>'group_code', '')::text                   as group_code,
         -- Lo que elige el Admin: una cancha y un día. El bloque se resuelve
         -- más abajo y `game_id` empieza vacío a propósito.
         nullif(e->>'field_id', '')::uuid                     as field_id,
         nullif(e->>'date_key', '')::date                     as date_key,
         nullif(e->>'start_time', '')::time                   as start_time,
         nullif(e->>'duration_min', '')::int                  as duration_min,
         nullif(e->>'updated_at', '')::timestamptz            as updated_at,
         null::uuid                                           as game_id
    from jsonb_array_elements(p_matches) e;

  -- ── Integridad del borrador ───────────────────────────────────────────────
  -- Ya NO se exige que sean exactamente los partidos de hoy —justo lo contrario:
  -- ahora se pueden añadir y quitar—. Lo que sí se exige es que cada `id` que
  -- llegue sea real y de ESTE campeonato, y que no venga repetido. Un id ajeno
  -- sería escribir en el calendario de otro.
  select jsonb_agg(distinct id_fila) into v_add
    from pg_temp._borrador b
   where b.id is not null
     and not exists (select 1 from public.championship_matches m
                      where m.id = b.id and m.championship_id = p_championship_id);
  if v_add is null then
    select jsonb_agg(distinct id_fila) into v_add
      from pg_temp._borrador
     where id is not null
       and id in (select id from pg_temp._borrador where id is not null
                  group by id having count(*) > 1);
  end if;
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object('code', 'MATCH_SET_MISMATCH', 'match_ids', v_add);
    -- Sin un borrador coherente, el resto de controles no significan nada.
    return jsonb_build_object('ok', false, 'errors', v_errors, 'warnings', '[]'::jsonb,
                              'saved', 0, 'inserted', 0, 'deleted', 0);
  end if;

  -- ── Concurrencia ──────────────────────────────────────────────────────────
  -- `updated_at` viaja tal cual se leyó. Si en la base es otro, alguien guardó
  -- en medio: no se pisa su trabajo, se pide recargar. Las filas nuevas no
  -- tienen testigo porque no había nada que testificar.
  select jsonb_agg(b.id_fila) into v_add
    from public.championship_matches m
    join pg_temp._borrador b on b.id = m.id
   where b.updated_at is distinct from m.updated_at;
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object('code', 'CONCURRENT_UPDATE', 'match_ids', v_add);
    return jsonb_build_object('ok', false, 'errors', v_errors, 'warnings', '[]'::jsonb,
                              'saved', 0, 'inserted', 0, 'deleted', 0);
  end if;

  -- ── Fase: obligatoria al crear ────────────────────────────────────────────
  -- `stage` es `not null` en la tabla y tiene su propio CHECK; aquí se comprueba
  -- antes para poder decirlo con un código y no con un error de base de datos.
  select jsonb_agg(id_fila) into v_add from pg_temp._borrador
   where id is null
     and (stage is null or stage not in ('group', 'semifinal', 'final', 'third_place'));
  if v_add is null then
    -- Y el grupo solo tiene sentido en fase de grupos: en una final no dice nada.
    select jsonb_agg(id_fila) into v_add from pg_temp._borrador
     where id is null and group_code is not null and stage is distinct from 'group';
  end if;
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object('code', 'INVALID_STAGE', 'match_ids', v_add);
  end if;

  -- ── Horario: las cuatro cosas van juntas ──────────────────────────────────
  -- Cancha, día, hora y duración son UN dato: cuándo y dónde se juega. O están
  -- las cuatro —programado— o ninguna —sin programar, que el modelo ya
  -- contempla con `game_id` a null—.
  select jsonb_agg(id_fila) into v_add from pg_temp._borrador
   where num_nonnulls(field_id, date_key, start_time, duration_min) not in (0, 4);
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object('code', 'INCOMPLETE_SCHEDULE', 'match_ids', v_add);
  end if;

  select jsonb_agg(id_fila) into v_add from pg_temp._borrador
   where duration_min is not null and duration_min <= 0;
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object('code', 'INVALID_DURATION', 'match_ids', v_add);
  end if;

  -- ── Equipos ───────────────────────────────────────────────────────────────
  select jsonb_agg(id_fila) into v_add from pg_temp._borrador
   where home_team_id is not null and home_team_id = away_team_id;
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object('code', 'SAME_TEAM', 'match_ids', v_add);
  end if;

  -- Elegible = existe. La MISMA regla del generador y la que mide si el
  -- calendario se quedó viejo: un equipo real del campeonato vale aunque no
  -- tenga ni un jugador inscrito. Lo que no vale es un equipo de otro
  -- campeonato, o uno que ya se borró.
  for v_add in
    select jsonb_build_object('code', 'TEAM_NOT_ELIGIBLE', 'team_id', t,
             'match_ids', jsonb_agg(id_fila))
      from (
        select id_fila, home_team_id as t from pg_temp._borrador where home_team_id is not null
        union all
        select id_fila, away_team_id from pg_temp._borrador where away_team_id is not null
      ) s
     where t not in (select e.id from public._championship_eligible_teams(p_championship_id) as e(id))
     group by t
  loop
    v_errors := v_errors || v_add;
  end loop;

  -- ── Cambiar equipos en un partido ya jugado ───────────────────────────────
  -- El marcador, los goles y el clasificado son de ESOS dos equipos. Cambiarlos
  -- dejaría goles atribuidos a un equipo que ya no juega el partido y un
  -- marcador que no cuenta lo que pasó. No se borra nada por nuestra cuenta: se
  -- bloquea y que decida una persona.
  select jsonb_agg(b.id_fila) into v_add
    from public.championship_matches m
    join pg_temp._borrador b on b.id = m.id
   where (b.home_team_id is distinct from m.home_team_id
          or b.away_team_id is distinct from m.away_team_id)
     and public._championship_match_played(m.id);
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object('code', 'MATCH_HAS_RESULT', 'match_ids', v_add);
  end if;

  -- ── Y BORRAR uno ya jugado, tampoco ───────────────────────────────────────
  -- `championship_goals` cuelga del partido con `on delete cascade`: borrarlo se
  -- llevaría por delante sus goleadores sin decir nada. Quien quiera quitarlo,
  -- que limpie antes el resultado por donde se limpia un resultado.
  select jsonb_agg(m.id::text) into v_add
    from public.championship_matches m
   where m.championship_id = p_championship_id
     and not exists (select 1 from pg_temp._borrador b where b.id = m.id)
     and public._championship_match_played(m.id);
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object('code', 'MATCH_HAS_RESULT', 'match_ids', v_add);
  end if;

  -- ── EL BLOQUE, RESUELTO AQUÍ ──────────────────────────────────────────────
  -- La pantalla eligió cancha, día, hora y duración. Ahora se busca qué bloque
  -- RESERVADO POR ESTE CAMPEONATO, en ESA cancha y ESE día, cubre el partido
  -- ENTERO: empieza antes o a la vez, y termina después o a la vez.
  --
  -- Entero, no a trozos. Aunque la misma cancha esté reservada de 10 a 11 y de
  -- 11 a 12, un partido de 10:50 a 11:10 no cabe en ninguno de los dos, y el
  -- modelo no permite partirlo entre dos `game_id`.
  --
  -- Si encajan varios —dos reservas solapadas de la misma cancha—, se coge el
  -- que TERMINA ANTES, con el mismo criterio determinista del generador: los
  -- bloques largos quedan libres para lo que venga después.
  update pg_temp._borrador b
     set game_id = (
       select g.id
         from public.championship_reservation_games l
         join public.games g on g.id = l.game_id
        where l.championship_id = p_championship_id
          and g.championship_id = p_championship_id
          and g.field_id = b.field_id
          and g.date_key  = b.date_key
          and g.status not in ('canceled', 'expired')
          and g.time is not null and coalesce(g.duration_min, 0) > 0
          -- Cobertura completa del intervalo del partido.
          and g.time <= b.start_time
          and (g.date_key + g.time + make_interval(mins => g.duration_min))
              >= (b.date_key + b.start_time + make_interval(mins => b.duration_min))
        order by (g.date_key + g.time + make_interval(mins => g.duration_min)), g.time, g.id
        limit 1
     )
   where b.field_id is not null and b.date_key is not null
     and b.start_time is not null and b.duration_min is not null and b.duration_min > 0;

  -- Sin bloque que lo cubra, no hay dónde jugarlo. Da igual si la cancha no
  -- está contratada, si ese día no hay reserva o si el partido se sale por diez
  -- minutos: desde fuera es lo mismo, no cabe donde se ha pedido.
  select jsonb_agg(id_fila) into v_add
    from pg_temp._borrador
   where field_id is not null and game_id is null;
  if v_add is not null then
    v_errors := v_errors || jsonb_build_object(
      'code', 'MATCH_OUTSIDE_RESERVED_COURT', 'match_ids', v_add);
  end if;

  -- ── Dos partidos en la misma CANCHA a la vez ──────────────────────────────
  -- Sobre el ESTADO FINAL: los que siguen, los modificados y los nuevos, sin los
  -- borrados. Por eso se mira el borrador y no la tabla: dos filas nuevas que
  -- chocan entre sí se ven igual que una nueva contra una vieja.
  --
  -- Por cancha física (`field_id`), no por bloque: dos bloques distintos pueden
  -- ser la misma cancha en horas pegadas. Y por SOLAPE real de intervalos, no
  -- por hora de inicio igual.
  for v_add in
    with prog as (
      select b.id_fila, g.field_id,
             (g.date_key + b.start_time) as ini,
             (g.date_key + b.start_time + make_interval(mins => b.duration_min)) as fin
        from pg_temp._borrador b
        join public.games g on g.id = b.game_id
       where b.start_time is not null and b.duration_min is not null and b.duration_min > 0
         and g.date_key is not null and g.field_id is not null
    )
    select jsonb_build_object('code', 'COURT_OVERLAP', 'field_id', x.field_id,
             'match_ids', jsonb_build_array(x.id_fila, y.id_fila))
      from prog x join prog y
        on x.field_id = y.field_id and x.id_fila < y.id_fila
       and x.ini < y.fin and y.ini < x.fin
  loop
    v_errors := v_errors || v_add;
  end loop;

  -- ── Un EQUIPO en dos partidos a la vez ────────────────────────────────────
  -- Aunque sean canchas distintas. Se mira cada equipo contra los dos lados del
  -- otro partido, también sobre el estado final.
  for v_add in
    with prog as (
      select b.id_fila, b.home_team_id, b.away_team_id,
             (g.date_key + b.start_time) as ini,
             (g.date_key + b.start_time + make_interval(mins => b.duration_min)) as fin
        from pg_temp._borrador b
        join public.games g on g.id = b.game_id
       where b.start_time is not null and b.duration_min is not null and b.duration_min > 0
         and g.date_key is not null
    ), lados as (
      select id_fila, ini, fin, home_team_id as team from prog where home_team_id is not null
      union all
      select id_fila, ini, fin, away_team_id     from prog where away_team_id is not null
    )
    select jsonb_build_object('code', 'TEAM_OVERLAP', 'team_id', x.team,
             'match_ids', jsonb_build_array(x.id_fila, y.id_fila))
      from lados x join lados y
        on x.team = y.team and x.id_fila < y.id_fila
       and x.ini < y.fin and y.ini < x.fin
  loop
    v_errors := v_errors || v_add;
  end loop;

  -- ── AVISO · los mismos dos equipos, otra vez ──────────────────────────────
  -- No es un error: repetir un cruce puede ser deliberado —un desempate, una
  -- liguilla a doble vuelta—. Se avisa para distinguir la decisión del descuido.
  --
  -- El emparejamiento no tiene lados: A vs B y B vs A son el mismo. Por eso se
  -- ordenan los dos ids antes de agrupar.
  for v_add in
    select jsonb_build_object('code', 'DUPLICATE_PAIRING',
             'team_ids', jsonb_build_array(a, b), 'match_ids', jsonb_agg(id_fila order by id_fila))
      from (
        select id_fila,
               least(home_team_id, away_team_id)    as a,
               greatest(home_team_id, away_team_id) as b
          from pg_temp._borrador
         where home_team_id is not null and away_team_id is not null
      ) s
     group by a, b
    having count(*) > 1
  loop
    v_warnings := v_warnings || v_add;
  end loop;

  -- ── ¿Se guarda? ───────────────────────────────────────────────────────────
  -- Hasta aquí NO se ha escrito una sola fila. Si hay errores se devuelve el
  -- diagnóstico completo y el calendario sigue exactamente como estaba: la
  -- atomicidad no depende de deshacer nada, depende de no haber empezado.
  --
  -- Y a partir de aquí las tres operaciones van en la MISMA transacción: si
  -- cualquiera fallase, no queda un calendario a medio guardar.
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors, 'warnings', v_warnings,
                              'saved', 0, 'inserted', 0, 'deleted', 0);
  end if;

  -- 1) Los que ya no están en el borrador. Ninguno tiene resultado: eso se
  --    comprobó arriba.
  delete from public.championship_matches m
   where m.championship_id = p_championship_id
     and not exists (select 1 from pg_temp._borrador b where b.id = m.id);
  get diagnostics v_borrados = row_count;

  -- 2) Los que siguen. Solo las filas que de verdad cambian: así `updated_at`
  --    sigue significando «cuándo cambió esto», y no «cuándo se abrió el editor
  --    por última vez».
  update public.championship_matches m
     set home_team_id = b.home_team_id,
         away_team_id = b.away_team_id,
         game_id      = b.game_id,
         start_time   = b.start_time,
         duration_min = b.duration_min,
         updated_at   = now()
    from pg_temp._borrador b
   where m.id = b.id
     and m.championship_id = p_championship_id
     and (m.home_team_id is distinct from b.home_team_id
          or m.away_team_id is distinct from b.away_team_id
          or m.game_id      is distinct from b.game_id
          or m.start_time   is distinct from b.start_time
          or m.duration_min is distinct from b.duration_min);
  get diagnostics v_saved = row_count;

  -- 3) Y los nuevos, detrás de lo que ya había. `match_order` lo pone la base:
  --    no es un dato que el operador tenga que inventar.
  select coalesce(max(match_order), 0) into v_orden
    from public.championship_matches where championship_id = p_championship_id;

  insert into public.championship_matches (
    championship_id, stage, group_code, home_team_id, away_team_id,
    game_id, start_time, duration_min, match_order
  )
  select p_championship_id, b.stage, b.group_code, b.home_team_id, b.away_team_id,
         b.game_id, b.start_time, b.duration_min,
         v_orden + row_number() over (order by b.start_time nulls last, b.id_fila)
    from pg_temp._borrador b
   where b.id is null;
  get diagnostics v_nuevos = row_count;

  return jsonb_build_object(
    'ok', true, 'errors', '[]'::jsonb, 'warnings', v_warnings,
    'saved', v_saved, 'inserted', v_nuevos, 'deleted', v_borrados);
end $function$;

REVOKE ALL ON FUNCTION "public"."save_championship_fixture"(uuid, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.save_championship_match_result (
  p_match_id   uuid,
  p_home_score integer,
  p_away_score integer,
  p_goals      jsonb                    DEFAULT '[]'::jsonb,
  p_updated_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_m     public.championship_matches%rowtype;
  v_g     jsonb;
  v_uid   uuid;
  v_tid   uuid;
  v_goals int;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- p_goals SIEMPRE forma de array JSON: null u otro tipo (objeto, número…) → INVALID_INPUT, antes de cualquier
  -- jsonb_array_elements(). No cambia el contrato [{ user_id, team_id, goals }]; el array vacío sigue válido.
  if p_goals is null or jsonb_typeof(p_goals) <> 'array' then raise exception 'INVALID_INPUT'; end if;
  -- FOR UPDATE: dos personas guardando el mismo partido se serializan aquí, y la
  -- segunda ve el updated_at ya cambiado en vez de pisar lo de la primera.
  select * into v_m from public.championship_matches where id = p_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  if p_updated_at is not null and v_m.updated_at is distinct from p_updated_at then
    raise exception 'CONCURRENT_UPDATE';
  end if;
  -- Serializa con las mutaciones de roster del mismo campeonato (misma lock key).
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_m.championship_id::text)::bigint);

  if not public._champ_can_manage_results(v_m.championship_id, v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Marcador: AMBOS null (sin resultado) o AMBOS enteros >= 0 (0 válido). Espejo del CHECK score_pair (Fase 15).
  if (p_home_score is null) <> (p_away_score is null) then raise exception 'INVALID_INPUT'; end if;
  if (p_home_score is not null and p_home_score < 0) or (p_away_score is not null and p_away_score < 0) then raise exception 'INVALID_INPUT'; end if;
  -- Para cargar marcador deben existir ambos equipos (partido operativo).
  if p_home_score is not null and (v_m.home_team_id is null or v_m.away_team_id is null) then raise exception 'NOT_OPEN'; end if;
  -- Sin marcador (NULL/NULL) NO puede haber goleadores atribuidos. (No cambia la regla de que la suma de goles
  -- es independiente del marcador cuando este existe; solo impide goles con el partido sin resultado.)
  if p_home_score is null and exists (
       select 1 from jsonb_array_elements(coalesce(p_goals, '[]'::jsonb)) e
        where coalesce(nullif(e->>'goals', '')::int, 0) > 0
     ) then
    raise exception 'INVALID_INPUT';
  end if;

  update public.championship_matches
     set home_score = p_home_score, away_score = p_away_score, updated_at = now()
   where id = p_match_id;

  -- Goleadores: REEMPLAZO total para este match. Cada gol valida team ∈ {home,away} y jugador miembro de ESE
  -- team. La suma NO tiene que igualar el marcador (info adicional; autores no identificados quedan fuera).
  delete from public.championship_goals where match_id = p_match_id;
  for v_g in select value from jsonb_array_elements(coalesce(p_goals, '[]'::jsonb)) loop
    v_uid   := nullif(v_g->>'user_id', '')::uuid;
    v_tid   := nullif(v_g->>'team_id', '')::uuid;
    v_goals := coalesce((v_g->>'goals')::int, 0);
    if v_uid is null or v_tid is null or v_goals <= 0 then continue; end if;   -- entradas vacías/0 → se ignoran
    if v_tid is distinct from v_m.home_team_id and v_tid is distinct from v_m.away_team_id then
      raise exception 'TEAM_NOT_IN_MATCH';
    end if;
    if not exists (select 1 from public.championship_players cp
                    where cp.championship_id = v_m.championship_id and cp.user_id = v_uid and cp.team_id = v_tid) then
      raise exception 'PLAYER_NOT_IN_TEAM';
    end if;
    insert into public.championship_goals (match_id, player_user_id, team_id, goals)
      values (p_match_id, v_uid, v_tid, v_goals);
  end loop;

  return jsonb_build_object(
    'match_id', p_match_id, 'home_score', p_home_score, 'away_score', p_away_score,
    'goals_count', (select count(*) from public.championship_goals where match_id = p_match_id)
  );
end; $function$;

REVOKE ALL ON FUNCTION "public"."save_championship_match_result"(uuid, integer, integer, jsonb, timestamp WITH time zone) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.save_championship_team (
  p_championship_id uuid,
  p_team_id         uuid,
  p_name            text,
  p_color           text DEFAULT NULL::text,
  p_design          text DEFAULT NULL::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor   uuid := auth.uid();
  v_champ   public.championships%rowtype;
  v_team    public.championship_teams%rowtype;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_color   text := nullif(btrim(coalesce(p_color, '')), '');
  v_design  text := nullif(btrim(coalesce(p_design, '')), '');
  v_is_owner   boolean;
  v_is_host    boolean;
  v_is_algrass boolean;
  v_is_creator boolean;
  v_creator_priv boolean;
  v_captain    uuid;
  v_is_captain boolean;
  v_can_full   boolean;
  v_can_create boolean;
  v_can_edit   boolean;
  v_can_rename boolean;
  v_cap int; v_count int; v_team_id uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  v_is_owner   := (v_champ.owner_user_id = v_actor);
  v_is_host    := (v_champ.host_user_id is not null and v_champ.host_user_id = v_actor);
  v_is_algrass := public._is_algrass_staff(v_actor);

  if p_team_id is null then
    if v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null) and not v_is_algrass then
      raise exception 'PUBLIC_CHAMPIONSHIP_TEAM_PAYMENT_REQUIRED';
    end if;
    v_can_create := public._champ_can_manage_roster(p_championship_id, v_actor, 'create_team');
    if not (v_can_create or v_champ.status = 'registration_open') then
      raise exception 'NOT_OPEN';
    end if;
    v_cap := public._championship_team_capacity(v_champ.format_config);
    select count(*) into v_count from public.championship_teams where championship_id = p_championship_id;
    if v_count >= v_cap then raise exception 'CAPACITY_FULL'; end if;

    insert into public.championship_teams (championship_id, name, color, design, created_by_user_id)
      values (p_championship_id, v_name, v_color, v_design, v_actor)
      returning id into v_team_id;
    return jsonb_build_object('team_id', v_team_id, 'name', v_name);
  end if;

  select * into v_team from public.championship_teams
   where id = p_team_id and championship_id = p_championship_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  v_is_creator := (v_team.created_by_user_id = v_actor);
  v_creator_priv := (v_team.created_by_user_id = v_champ.owner_user_id)
                    or public._is_algrass_staff(v_team.created_by_user_id);

  select count(*) into v_count from public.championship_players where team_id = p_team_id;
  select user_id into v_captain from public.championship_players
   where team_id = p_team_id order by joined_at asc, user_id asc limit 1;
  v_is_captain := (v_captain is not null and v_captain = v_actor);

  v_can_full := (v_count = 0 and (not v_creator_priv or v_is_owner or v_is_algrass))
                or (v_count >= 1 and v_is_captain);
  v_can_edit := public._champ_can_manage_roster(p_championship_id, v_actor, 'edit_team');
  v_can_rename := (v_is_owner or v_is_host or v_is_algrass) and v_champ.status <> 'canceled';

  if not (v_can_edit or v_can_full or v_can_rename) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_can_edit or (v_can_full and v_champ.status = 'registration_open') then
    update public.championship_teams
       set name = v_name, color = v_color, design = v_design, updated_at = now()
     where id = p_team_id;
  elsif v_can_rename then
    update public.championship_teams
       set name = v_name, updated_at = now()
     where id = p_team_id;
  else
    raise exception 'NOT_OPEN';
  end if;

  return jsonb_build_object('team_id', p_team_id, 'name', v_name);
end; $function$;

REVOKE ALL ON FUNCTION "public"."save_championship_team"(uuid, uuid, text, text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_cancellation_settings (
  p_match_refund_cutoff_hours          integer,
  p_rental_full_refund_cutoff_hours    integer,
  p_rental_partial_refund_cutoff_hours integer,
  p_rental_partial_refund_percent      integer
)
  RETURNS public.app_settings
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_row public.app_settings;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_write_app_settings() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_match_refund_cutoff_hours is null
     or p_match_refund_cutoff_hours not between 0 and 720 then
    raise exception 'INVALID_MATCH_CUTOFF';
  end if;
  if p_rental_full_refund_cutoff_hours is null
     or p_rental_full_refund_cutoff_hours not between 0 and 720 then
    raise exception 'INVALID_RENTAL_FULL_CUTOFF';
  end if;
  if p_rental_partial_refund_cutoff_hours is null
     or p_rental_partial_refund_cutoff_hours not between 0 and 720 then
    raise exception 'INVALID_RENTAL_PARTIAL_CUTOFF';
  end if;
  if p_rental_partial_refund_percent is null
     or p_rental_partial_refund_percent not between 0 and 100 then
    raise exception 'INVALID_RENTAL_PARTIAL_PERCENT';
  end if;

  -- La misma regla que el CHECK de la tabla, aquí para poder explicarla con un
  -- token propio en vez de con una violacion de restriccion.
  if p_rental_full_refund_cutoff_hours <= p_rental_partial_refund_cutoff_hours then
    raise exception 'RENTAL_CUTOFFS_OUT_OF_ORDER';
  end if;

  update public.app_settings
     set match_refund_cutoff_hours          = p_match_refund_cutoff_hours,
         rental_full_refund_cutoff_hours    = p_rental_full_refund_cutoff_hours,
         rental_partial_refund_cutoff_hours = p_rental_partial_refund_cutoff_hours,
         rental_partial_refund_percent      = p_rental_partial_refund_percent,
         updated_at                         = now(),
         updated_by                         = auth.uid()
   where id = 1
  returning * into v_row;

  if not found then
    raise exception 'SETTINGS_ROW_MISSING';
  end if;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_cancellation_settings"(integer, integer, integer, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_captain_release_settings (
  p_captain_release_hours      integer,
  p_captain_gold_release_hours integer
)
  RETURNS public.app_settings
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_row public.app_settings;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_write_app_settings() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_captain_release_hours is null
     or p_captain_release_hours not between 0 and 720 then
    raise exception 'INVALID_CAPTAIN_RELEASE';
  end if;
  if p_captain_gold_release_hours is null
     or p_captain_gold_release_hours not between 0 and 720 then
    raise exception 'INVALID_CAPTAIN_GOLD_RELEASE';
  end if;

  -- Ninguna comparación entre las dos: son independientes a propósito.

  update public.app_settings
     set captain_release_hours      = p_captain_release_hours,
         captain_gold_release_hours = p_captain_gold_release_hours,
         updated_at                 = now(),
         updated_by                 = auth.uid()
   where id = 1
  returning * into v_row;

  if not found then
    raise exception 'SETTINGS_ROW_MISSING';
  end if;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_captain_release_settings"(integer, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_captain_request_notes (
  p_request_id uuid,
  p_notes      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_estado text;
  v_notas  text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.is_platform_admin_or_staff(v_actor) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Vacío y NULL son lo mismo aquí: «no hay nota». Así borrarla es escribir
  -- nada, sin un botón aparte.
  v_notas := nullif(btrim(coalesce(p_notes, '')), '');

  if length(coalesce(v_notas, '')) > 2000 then
    raise exception 'NOTES_TOO_LONG';
  end if;

  select status into v_estado
    from public.captain_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_estado <> 'pending_review' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  update public.captain_requests
     set management_notes = v_notas
   where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'management_notes', v_notas);
end $function$;

REVOKE ALL ON FUNCTION "public"."set_captain_request_notes"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_champion (
  p_championship_id uuid,
  p_team_id         uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Misma lock key del módulo (serializa con roster/resultados/transiciones del mismo campeonato).
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Permisos: MISMA autoridad que resultados (host in_progress; AlGrass in_progress+completed; owner/player nunca).
  if not public._champ_can_manage_results(p_championship_id, v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- El equipo (si se define) DEBE pertenecer a ESTE campeonato. NULL = limpiar.
  if p_team_id is not null
     and not exists (select 1 from public.championship_teams
                      where id = p_team_id and championship_id = p_championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  update public.championships set champion_team_id = p_team_id where id = p_championship_id
    returning * into v_champ;

  return jsonb_build_object('id', v_champ.id, 'champion_team_id', v_champ.champion_team_id);
end; $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_champion"(uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_extras (
  p_city   text,
  p_extras jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_write_app_settings() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;

  perform public._championship_assert_extras(p_extras);

  update public.championship_settings
     set extras     = p_extras,
         updated_at = now()
   where city = btrim(p_city);
  if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;

  return public.get_championship_settings_admin(btrim(p_city));
end $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_extras"(text, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_host (
  p_championship_id uuid,
  p_host_user_id    uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Rol comprobado DENTRO, con el helper del módulo: no se confía en que la
  -- pantalla haya escondido el botón.
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  if p_host_user_id is not null then
    -- El host tiene que ser alguien que existe. `users_public` ya excluye las
    -- cuentas borradas: nombrar host a una cuenta eliminada dejaría un
    -- campeonato sin operador real.
    if not exists (select 1 from public.users_public u where u.id = p_host_user_id) then
      raise exception 'HOST_NOT_FOUND';
    end if;

    -- Y tiene que ser elegible. MISMA función que alimenta el selector: si un
    -- día cambia la regla, cambia en los dos sitios a la vez porque es uno solo.
    if not exists (
      select 1 from public._eligible_championship_hosts() as e(id) where e.id = p_host_user_id
    ) then
      raise exception 'HOST_NOT_ELIGIBLE';
    end if;
  end if;

  -- UNA columna. Ni el estado, ni el dueño, ni nada más.
  update public.championships
     set host_user_id = p_host_user_id,
         updated_at = now()
   where id = p_championship_id
  returning * into v_champ;

  -- Se devuelve el host ya resuelto para que la pantalla pueda pintarlo sin otra
  -- consulta; `host` es null cuando se acaba de quitar.
  return jsonb_build_object(
    'championship_id', v_champ.id,
    'host_user_id', v_champ.host_user_id,
    'host', (
      select jsonb_build_object(
               'user_id', u.id, 'full_name', u.full_name, 'user_code', u.user_code,
               'city', u.city, 'avatar_path', u.avatar_path,
               'avatar_hue', u.avatar_hue, 'avatar_updated_at', u.avatar_updated_at)
        from public.users_public u where u.id = v_champ.host_user_id
    )
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_host"(uuid, uuid) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_match_team (
  p_match_id   uuid,
  p_side       text,
  p_team_id    uuid,
  p_updated_at timestamp with time zone DEFAULT NULL::timestamp WITH time zone
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_m     public.championship_matches%rowtype;
  v_other uuid;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_side not in ('home','away') then raise exception 'INVALID_INPUT'; end if;
  if p_team_id is null then raise exception 'INVALID_INPUT'; end if;

  -- FOR UPDATE: dos ediciones del mismo partido se serializan; la 2.ª ve updated_at cambiado (no pisa).
  select * into v_m from public.championship_matches where id = p_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;

  if p_updated_at is not null and v_m.updated_at is distinct from p_updated_at then
    raise exception 'CONCURRENT_UPDATE';
  end if;
  -- Misma lock key que roster/resultados del mismo campeonato → serializa todas las mutaciones que compiten.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || v_m.championship_id::text)::bigint);

  if not public._champ_can_manage_results(v_m.championship_id, v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- Ventana ESTRICTA: solo con el campeonato in_progress (PRE-LIVE o LIVE). Excluye completed incluso para
  -- AlGrass (para ESTA acción), y RO/RC/pending_publish/canceled. La superficie de llave editable es in_progress.
  if not exists (select 1 from public.championships
                  where id = v_m.championship_id and status = 'in_progress') then
    raise exception 'INVALID_PHASE';
  end if;

  -- Partido "concluido" (marcador, goleadores o clasificado) → protegido, no se cambia el equipo.
  if v_m.home_score is not null or v_m.away_score is not null
     or v_m.qualified_team_id is not null
     or exists (select 1 from public.championship_goals where match_id = p_match_id) then
    raise exception 'MATCH_HAS_RESULT';
  end if;

  -- El equipo debe pertenecer a ESTE campeonato.
  if not exists (select 1 from public.championship_teams
                  where id = p_team_id and championship_id = v_m.championship_id) then
    raise exception 'TEAM_NOT_FOUND';
  end if;

  -- Nunca el mismo equipo en ambos lados (espejo del CHECK de la tabla).
  v_other := case when p_side = 'home' then v_m.away_team_id else v_m.home_team_id end;
  if v_other is not null and v_other = p_team_id then raise exception 'SAME_TEAM'; end if;

  -- SOLAPAMIENTO DE HORARIO: el equipo NO puede jugar dos partidos que se solapan en el tiempo el MISMO día.
  -- Criterio estándar de intervalos [start_time, start_time + duration_min): dos partidos se solapan si
  --   s1 < s2 + d2  AND  s2 < s1 + d1.  La fecha viene del game vinculado (games.date_key). Se comparan SOLO
  -- partidos programados (game_id con date_key, start_time y duration_min presentes) del MISMO campeonato,
  -- distintos del que se edita, donde el equipo ya esté en home o away. App y Admin deben coincidir en estos
  -- mismos casos. Si el partido editado no está programado (sin game/fecha/hora), no hay solape que evaluar.
  if exists (
    select 1
      from public.championship_matches m2
      join public.games g2 on g2.id = m2.game_id
      join public.games g1 on g1.id = v_m.game_id
     where m2.championship_id = v_m.championship_id
       and m2.id <> v_m.id
       and (m2.home_team_id = p_team_id or m2.away_team_id = p_team_id)
       and g1.date_key = g2.date_key
       and v_m.start_time is not null and v_m.duration_min is not null
       and m2.start_time is not null and m2.duration_min is not null
       and v_m.start_time < (m2.start_time + make_interval(mins => m2.duration_min))
       and m2.start_time < (v_m.start_time + make_interval(mins => v_m.duration_min))
  ) then
    raise exception 'TEAM_TIME_OVERLAP';
  end if;

  if p_side = 'home' then
    update public.championship_matches set home_team_id = p_team_id, updated_at = now() where id = p_match_id;
  else
    update public.championship_matches set away_team_id = p_team_id, updated_at = now() where id = p_match_id;
  end if;

  select * into v_m from public.championship_matches where id = p_match_id;
  return jsonb_build_object(
    'match_id', p_match_id, 'home_team_id', v_m.home_team_id, 'away_team_id', v_m.away_team_id,
    'updated_at', v_m.updated_at
  );
end; $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_match_team"(uuid, text, uuid, timestamp WITH time zone) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_pricing (
  p_city                    text,
  p_currency                text,
  p_referee_hourly_rate     numeric,
  p_algrass_fee_hourly_rate numeric
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_write_app_settings() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;
  if p_currency is null or length(btrim(p_currency)) = 0 then raise exception 'INVALID_CURRENCY'; end if;

  if p_referee_hourly_rate is null
     or p_referee_hourly_rate = 'NaN'::numeric
     or p_referee_hourly_rate < 0 then
    raise exception 'INVALID_REFEREE_RATE';
  end if;
  if p_algrass_fee_hourly_rate is null
     or p_algrass_fee_hourly_rate = 'NaN'::numeric
     or p_algrass_fee_hourly_rate < 0 then
    raise exception 'INVALID_FEE_RATE';
  end if;

  update public.championship_settings
     set currency                = btrim(p_currency),
         referee_hourly_rate     = p_referee_hourly_rate,
         algrass_fee_hourly_rate = p_algrass_fee_hourly_rate,
         updated_at              = now()
   where city = btrim(p_city);
  if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;

  return public.get_championship_settings_admin(btrim(p_city));
end $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_pricing"(text, text, numeric, numeric) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_request_notes (
  p_request_id uuid,
  p_notes      text
)
  RETURNS public.championship_requests
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_row public.championship_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.can_manage_championship_requests() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_row from public.championship_requests
   where id = p_request_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  update public.championship_requests
     set internal_notes = nullif(btrim(coalesce(p_notes, '')), ''),
         managed_by_user_id = coalesce(managed_by_user_id, auth.uid())
   where id = p_request_id
  returning * into v_row;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_request_notes"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_request_status (
  p_request_id uuid,
  p_status     text
)
  RETURNS public.championship_requests
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_row public.championship_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not public.can_manage_championship_requests() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_status is null or p_status not in ('pending', 'contacted', 'closed') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_row from public.championship_requests
   where id = p_request_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  update public.championship_requests
     set status = p_status,
         -- Solo la PRIMERA vez que se contacta. `coalesce` es lo que impide que
         -- un segundo paso por 'contacted' reescriba la fecha original.
         contacted_at = case
           when p_status = 'contacted' then coalesce(contacted_at, now())
           else contacted_at          -- volver atrás NO la borra
         end,
         managed_by_user_id = coalesce(managed_by_user_id, auth.uid())
   where id = p_request_id
  returning * into v_row;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_request_status"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_rules (
  p_city                    text,
  p_registration_close_days integer,
  p_booking_lead_rules      jsonb,
  p_availability_formats    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_write_app_settings() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;

  -- El CHECK de la columna ya exige >= 0; se dice antes y mejor.
  if p_registration_close_days is null or p_registration_close_days < 0 then
    raise exception 'INVALID_CLOSE_DAYS';
  end if;

  perform public._championship_assert_lead_rules(p_booking_lead_rules);
  perform public._championship_assert_formats(p_availability_formats);

  update public.championship_settings
     set registration_close_days = p_registration_close_days,
         booking_lead_rules      = p_booking_lead_rules,
         availability_formats    = p_availability_formats,
         updated_at              = now()
   where city = btrim(p_city);
  if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;

  return public.get_championship_settings_admin(btrim(p_city));
end $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_rules"(text, integer, jsonb, jsonb) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_settings_active (
  p_city   text,
  p_active boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_set   public.championship_settings%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_write_app_settings() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_city is null or length(btrim(p_city)) = 0 then raise exception 'INVALID_INPUT'; end if;
  if p_active is null then raise exception 'INVALID_INPUT'; end if;

  select * into v_set from public.championship_settings where city = btrim(p_city);
  if not found then raise exception 'CHAMPIONSHIP_SETTINGS_NOT_FOUND'; end if;

  if p_active then
    if coalesce(v_set.availability_formats, '{}'::jsonb) = '{}'::jsonb then
      raise exception 'CHAMPIONSHIP_SETTINGS_INCOMPLETE';
    end if;
    perform public._championship_assert_formats(v_set.availability_formats);
    perform public._championship_assert_lead_rules(coalesce(v_set.booking_lead_rules, '[]'::jsonb));
    perform public._championship_assert_extras(coalesce(v_set.extras, '[]'::jsonb));
  end if;

  update public.championship_settings
     set active     = p_active,
         updated_at = now()
   where city = btrim(p_city);

  return public.get_championship_settings_admin(btrim(p_city));
end $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_settings_active"(text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_status (
  p_championship_id uuid,
  p_target          text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_cur   text;   -- fase funcional actual
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- MISMA lock key que las mutaciones de roster → una transición no compite con create/move/etc. en curso.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- SOLO AlGrass staff/admin cambia fases (ni owner, ni host, ni player).
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_target not in ('pending_publish','registration_open','registration_closed',
                      'in_progress_prelive','in_progress_live','completed') then
    raise exception 'INVALID_INPUT';
  end if;

  -- Fase funcional actual (in_progress desdoblado por live_started_at).
  v_cur := case
             when v_champ.status = 'in_progress' and v_champ.live_started_at is not null then 'in_progress_live'
             when v_champ.status = 'in_progress'                                          then 'in_progress_prelive'
             else v_champ.status
           end;

  -- ── Grafo de transiciones permitidas (cada rama aplica SOLO las marcas necesarias; nada más se toca) ──
  if    v_cur = 'pending_publish'     and p_target = 'registration_open' then
    update public.championships set status = 'registration_open',
           published_at = coalesce(published_at, now()) where id = p_championship_id;

  elsif v_cur = 'registration_open'   and p_target = 'pending_publish' then
    update public.championships set status = 'pending_publish' where id = p_championship_id;

  elsif v_cur = 'registration_open'   and p_target = 'registration_closed' then
    update public.championships set status = 'registration_closed' where id = p_championship_id;

  elsif v_cur = 'registration_closed' and p_target = 'registration_open' then
    update public.championships set status = 'registration_open' where id = p_championship_id;

  elsif v_cur = 'registration_closed' and p_target = 'in_progress_prelive' then
    -- AÑADIDO (correctivo): publicar el calendario exige que HAYA calendario. Sin
    -- partidos, los inscritos verían una pantalla vacía.
    if not exists (
      select 1 from public.championship_matches where championship_id = p_championship_id
    ) then
      raise exception 'FIXTURE_REQUIRED';
    end if;
    -- AÑADIDO (correctivo): y que ese calendario sea el de los equipos de AHORA.
    -- Se comparan los dos conjuntos en las dos direcciones: un equipo elegible que
    -- no aparece en el fixture, o un equipo del fixture que ya no es elegible
    -- —porque se borró, o porque se quedó sin jugadores—, lo dejan viejo.
    -- CORREGIDO: los dos lados del EXCEPT tienen que ser UUID, y la union va
    -- entre PARENTESIS. Antes el lado izquierdo era `select 1` —un integer contra
    -- uuid, que Postgres rechaza— y, ademas, `EXCEPT` y `UNION` tienen la misma
    -- precedencia y asocian por la izquierda: sin parentesis aquello era
    -- `(elegibles except home) union away`, que no es la pregunta.
    --
    -- El helper devuelve `SETOF uuid`, asi que necesita alias de COLUMNA —`as
    -- e(id)`— para poder nombrar el valor.
    if exists (
      -- A) elegible que NO esta en el fixture (equipo nuevo, o que acaba de
      --    recibir su primer jugador).
      select e.id from public._championship_eligible_teams(p_championship_id) as e(id)
      except
      (
        select m.home_team_id from public.championship_matches m
         where m.championship_id = p_championship_id and m.home_team_id is not null
        union
        select m.away_team_id from public.championship_matches m
         where m.championship_id = p_championship_id and m.away_team_id is not null
      )
    ) or exists (
      -- B) equipo del fixture que YA NO es elegible (se borro, o se quedo sin
      --    jugadores).
      (
        select m.home_team_id from public.championship_matches m
         where m.championship_id = p_championship_id and m.home_team_id is not null
        union
        select m.away_team_id from public.championship_matches m
         where m.championship_id = p_championship_id and m.away_team_id is not null
      )
      except
      select e.id from public._championship_eligible_teams(p_championship_id) as e(id)
    ) then
      raise exception 'FIXTURE_STALE';
    end if;
    -- Lo demás de esta rama es idéntico a la Phase 21.
    -- Publicar calendario: entra en in_progress PRE-LIVE. fixture_published_at solo se fija la 1ª vez.
    update public.championships set status = 'in_progress',
           fixture_published_at = coalesce(fixture_published_at, now()),
           live_started_at = null where id = p_championship_id;

  elsif v_cur = 'in_progress_prelive' and p_target = 'registration_closed' then
    -- Volver a inscripciones cerradas. Conserva fixture_published_at (histórico). No borra nada.
    update public.championships set status = 'registration_closed',
           live_started_at = null where id = p_championship_id;

  elsif v_cur = 'in_progress_prelive' and p_target = 'in_progress_live' then
    update public.championships set status = 'in_progress',
           live_started_at = now() where id = p_championship_id;

  elsif v_cur = 'in_progress_live'    and p_target = 'in_progress_prelive' then
    update public.championships set status = 'in_progress',
           live_started_at = null where id = p_championship_id;

  elsif v_cur = 'in_progress_live'    and p_target = 'completed' then
    -- Finalizar. Conserva fixture_published_at y live_started_at (histórico intacto).
    update public.championships set status = 'completed' where id = p_championship_id;

  elsif v_cur = 'completed' and p_target = 'in_progress_live'    and v_champ.live_started_at is not null then
    -- Reabrir: el subestado viene del live_started_at CONSERVADO (no se inventa fecha nueva).
    update public.championships set status = 'in_progress' where id = p_championship_id;

  elsif v_cur = 'completed' and p_target = 'in_progress_prelive' and v_champ.live_started_at is null then
    update public.championships set status = 'in_progress' where id = p_championship_id;

  else
    raise exception 'INVALID_TRANSITION';
  end if;

  select * into v_champ from public.championships where id = p_championship_id;
  return jsonb_build_object(
    'id', v_champ.id,
    'status', v_champ.status,
    'live_started_at', v_champ.live_started_at,
    'fixture_published_at', v_champ.fixture_published_at,
    'phase', case
               when v_champ.status = 'in_progress' and v_champ.live_started_at is not null then 'in_progress_live'
               when v_champ.status = 'in_progress'                                          then 'in_progress_prelive'
               else v_champ.status
             end
  );
end; $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_status"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_championship_team_format (
  p_championship_id uuid,
  p_max_teams       integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor    uuid := auth.uid();
  v_champ    public.championships%rowtype;
  v_gid      text;
  v_min      int;
  v_max      int;
  v_cap      int;
  v_equipos  int;
  v_config   jsonb;
  v_group    jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Gente de AlGrass: el mismo helper que el resto de escrituras del modulo.
  -- Cambiar el tramo no cuesta nada y se deshace eligiendo otro, asi que no pide
  -- el guard de admin que si piden las operaciones destructivas.
  if not public._is_algrass_staff(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;

  -- MISMA lock key que roster, resultados y transiciones: cambiar la capacidad no
  -- puede cruzarse con alguien inscribiendo un equipo.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Fuera quedan, a proposito:
  --   transfer_hold / payment_validation → la configuracion contratada la gobierna
  --     el flujo de pago, que todavia la esta validando.
  --   completed / canceled → terminales; reetiquetar un tramo ahi no significa nada.
  if v_champ.status not in ('pending_publish','registration_open',
                            'registration_closed','in_progress') then
    raise exception 'CHAMPIONSHIP_NOT_EDITABLE';
  end if;

  -- El tramo tiene que ser uno de los que existen. No se acepta un numero suelto:
  -- la capacidad la definen los tramos, no cualquier techo.
  select f.group_id, f.min_teams, f.max_teams, f.capacity into v_gid, v_min, v_max, v_cap
    from public.list_championship_team_formats() f
   where f.max_teams = p_max_teams;
  if v_max is null then raise exception 'INVALID_FORMAT'; end if;

  v_config := coalesce(v_champ.format_config, '{}'::jsonb);

  -- Una liga no tiene tramo de equipos: su capacidad es 1 por definicion. Aceptar
  -- el cambio escribiria un dato que el helper ignora, y dejaria la pantalla
  -- diciendo algo que la base no cumple.
  if (v_config->'summary'->>'mode') = 'liga' then
    raise exception 'LEAGUE_HAS_NO_BRACKET';
  end if;

  -- Reducir por debajo de lo ya inscrito NO se guarda. Ni a medias, ni expulsando
  -- a nadie: se corta y se dice cuantos hay.
  select count(*) into v_equipos
    from public.championship_teams t where t.championship_id = p_championship_id;
  if v_equipos > v_cap then
    raise exception 'TEAMS_EXCEED_CAPACITY: % equipos inscritos, capacidad %', v_equipos, v_cap;
  end if;

  -- ── Escribir el tramo ──
  -- Solo `id`, `min` y `max`. `phases` y `courtHours` se CONSERVAN: describen las
  -- canchas y horas que se contrataron, y eso no cambia porque el tramo se
  -- reetiquete. Cambiarlas seria tocar la compra, que es justo lo que no toca.
  if v_config->'summary' is null or jsonb_typeof(v_config->'summary') <> 'object' then
    v_config := jsonb_set(v_config, '{summary}', '{}'::jsonb, true);
  end if;
  v_group := coalesce(v_config->'summary'->'group', '{}'::jsonb)
             || jsonb_build_object('id', v_gid, 'min', v_min, 'max', v_max);
  v_config := jsonb_set(v_config, '{summary,group}', v_group, true);

  -- Algunos snapshots llevan `group` tambien en la raiz, y el Back Office lo lee
  -- de ahi primero. Si existe, se actualiza igual: dejar dos copias discrepando
  -- haria que la pantalla enseñara un tramo y la base cumpliera otro.
  if v_config ? 'group' then
    v_config := jsonb_set(v_config, '{group}',
      coalesce(v_config->'group', '{}'::jsonb)
        || jsonb_build_object('id', v_gid, 'min', v_min, 'max', v_max), true);
  end if;

  update public.championships
     set format_config = v_config,
         updated_at = now()
   where id = p_championship_id;

  return jsonb_build_object(
    'championship_id', p_championship_id,
    'group_id',        v_gid,
    'min_teams',       v_min,
    'max_teams',       v_max,
    'team_capacity',   v_cap,
    'teams_enrolled',  v_equipos
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."set_championship_team_format"(uuid, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_double_out_mode (
  p_game_id uuid,
  p_mode    text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_alt   uuid;
  v_a public.games%rowtype;  -- el game recibido
  v_b public.games%rowtype;  -- su gemelo
  v_match_id  uuid;
  v_rental_id uuid;
begin
  -- Autorización: solo back-office (algrass_admin | algrass_staff). Mismo patrón
  -- que cancel_match/reserve_slots (EXISTS sobre user_roles). SECURITY DEFINER, así
  -- que la validación se hace aquí dentro; un jugador authenticated recibe rechazo.
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_mode not in ('double','match_only','rental_only','none') then raise exception 'INVALID_MODE'; end if;

  -- Identifica el gemelo y BLOQUEA ambas filas SIEMPRE en orden ascendente por id
  -- (determinista → sin deadlocks entre llamadas desde games opuestos de la pareja).
  select alternative_game_id into v_alt from public.games where id = p_game_id;
  if not found then raise exception 'GAME_NOT_FOUND'; end if;
  if v_alt is null then raise exception 'NOT_PAIRED'; end if;

  perform 1 from public.games where id in (p_game_id, v_alt) order by id for update;

  select * into v_a from public.games where id = p_game_id;
  select * into v_b from public.games where id = v_alt;
  if not found then raise exception 'TWIN_NOT_FOUND'; end if;

  -- Ambos deben estar libres (preferencia manual): published o paused.
  if v_a.status not in ('published','paused') or v_b.status not in ('published','paused') then
    raise exception 'PAIR_NOT_FREE';
  end if;

  if v_a.type = 'match' then v_match_id := v_a.id; v_rental_id := v_b.id;
  else v_match_id := v_b.id; v_rental_id := v_a.id; end if;

  if p_mode = 'double' then
    update public.games set status = 'published' where id in (v_match_id, v_rental_id);
  elsif p_mode = 'match_only' then
    update public.games set status = 'published' where id = v_match_id;
    update public.games set status = 'paused'    where id = v_rental_id;
  elsif p_mode = 'rental_only' then
    update public.games set status = 'paused'    where id = v_match_id;
    update public.games set status = 'published' where id = v_rental_id;
  else -- none
    update public.games set status = 'paused' where id in (v_match_id, v_rental_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_double_out_side_bulk (
  p_game_ids uuid[],
  p_side     text,
  p_action   text
)
  RETURNS TABLE (
    match_id      uuid,
    match_status  text,
    rental_id     uuid,
    rental_status text,
    result        text,
    changed_count integer,
    reason        text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_id     uuid;
  v_vistos uuid[] := '{}';                 -- ids ya cubiertos, para deduplicar
  v_alt    uuid;
  v_a      public.games%rowtype;
  v_b      public.games%rowtype;
  v_m      public.games%rowtype;           -- el Match de la pareja
  v_r      public.games%rowtype;           -- el Rental
  -- %type y no `text`: así vale igual si games.status es un enum.
  v_destino public.games.status%type;
  v_toca_match  boolean;
  v_toca_rental boolean;
begin
  -- ── Autorización, idéntica a la de set_double_out_mode ────────────────────
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.user_roles
    where user_id = v_actor and role in ('algrass_admin', 'algrass_staff')
  ) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_side   not in ('rental','match','both') then raise exception 'INVALID_SIDE';   end if;
  if p_action not in ('pause','publish')       then raise exception 'INVALID_ACTION'; end if;

  -- published <-> paused son los ÚNICOS estados que esta función gestiona.
  v_destino := case p_action when 'pause' then 'paused' else 'published' end;

  -- ── Orden global determinista entre parejas ───────────────────────────────
  --
  -- Dentro de una pareja el orden ya es fijo (el `for update ... order by id`
  -- de abajo, el mismo que usan las funciones existentes). Entre parejas hacía
  -- falta fijarlo también: este lote toma varios locks en UNA transacción, y si
  -- dos admins mandaran selecciones solapadas en orden inverso podrían abrazarse.
  --
  -- La clave de ordenación es la canónica de la pareja —el menor de sus dos
  -- ids—, que es la misma se envíe el Match o el Rental. Así dos llamadas
  -- cualesquiera recorren las parejas en la misma secuencia.
  --
  -- Los ids que no existen no bloquean nada, así que van al final: no alteran
  -- el orden de adquisición y conservan su fila GAME_NOT_FOUND. Esta lectura no
  -- decide nada; toda la validación sigue ocurriendo después del lock.
  for v_id in
    select t.id
      from unnest(coalesce(p_game_ids, '{}'::uuid[])) as t(id)
      left join public.games g on g.id = t.id
     order by (g.id is null),
              least(g.id, coalesce(g.alternative_game_id, g.id)),
              t.id
  loop
    -- Deduplicación defensiva: si llegan los dos miembros de la misma pareja,
    -- el segundo ya está cubierto y no vuelve a procesarse ni a devolverse.
    continue when v_id = any(v_vistos);

    -- Cada pareja en su propio bloque, que en plpgsql es un savepoint. Los
    -- BEFORE UPDATE de games pueden levantar excepción; si eso pasa, se deshace
    -- SOLO lo de esta pareja y el lote continúa.
    begin
      match_id      := null;  rental_id     := null;
      match_status  := null;  rental_status := null;
      changed_count := 0;     reason        := null;
      v_m := null;            v_r := null;

      select g.alternative_game_id into v_alt from public.games g where g.id = v_id;
      if not found then
        v_vistos := v_vistos || v_id;
        result := 'skipped'; reason := 'GAME_NOT_FOUND';
        return next; continue;
      end if;
      if v_alt is null then
        v_vistos := v_vistos || v_id;
        result := 'skipped'; reason := 'NOT_PAIRED';
        return next; continue;
      end if;

      -- ── Lock de las DOS filas, por id ──
      -- El mismo orden que usan set_double_out_mode y apply_double_out_mode_system,
      -- para que nunca puedan hacerse un abrazo mortal entre ellas y esta.
      perform 1 from public.games where id in (v_id, v_alt) order by id for update;

      -- ── Revalidación COMPLETA después del lock ──
      -- Lo leído antes del lock no vale como prueba de nada: entre la lectura y
      -- el bloqueo la pareja pudo romperse, reservarse o cambiar de estado.
      select * into v_a from public.games where id = v_id;
      if not found then
        v_vistos := v_vistos || v_id;
        result := 'skipped'; reason := 'GAME_NOT_FOUND';
        return next; continue;
      end if;
      select * into v_b from public.games where id = v_alt;
      if not found then
        v_vistos := v_vistos || v_id;
        result := 'skipped'; reason := 'TWIN_NOT_FOUND';
        return next; continue;
      end if;

      v_vistos := v_vistos || v_a.id || v_b.id;

      -- El enlace tiene que ser recíproco…
      if v_b.alternative_game_id is distinct from v_a.id then
        result := 'skipped'; reason := 'PAIR_NOT_RECIPROCAL';
        return next; continue;
      end if;
      -- …compartir un overlap_group real…
      if v_a.overlap_group is null or v_a.overlap_group is distinct from v_b.overlap_group then
        result := 'skipped'; reason := 'PAIR_GROUP_MISMATCH';
        return next; continue;
      end if;
      -- …y ser exactamente un Match y un Rental.
      if not ((v_a.type = 'match'  and v_b.type = 'rental')
           or (v_a.type = 'rental' and v_b.type = 'match')) then
        result := 'skipped'; reason := 'PAIR_TYPES_INVALID';
        return next; continue;
      end if;

      if v_a.type = 'match' then v_m := v_a; v_r := v_b;
      else                       v_m := v_b; v_r := v_a; end if;

      -- Se informa del estado real aunque después se omita: el Admin parchea su
      -- copia con esto y no tiene que suponer nada.
      match_id      := v_m.id;   match_status  := v_m.status::text;
      rental_id     := v_r.id;   rental_status := v_r.status::text;

      -- ── Barrera ──
      -- Basta con que UNO esté fuera de published|paused —draft, reserved,
      -- blocked, completed, expired, canceled o cualquier otro— para omitir la
      -- pareja ENTERA. No se escribe ni una fila: nunca medio movimiento.
      if v_m.status not in ('published','paused')
         or v_r.status not in ('published','paused') then
        result := 'skipped';
        reason := format('PAIR_NOT_FREE: match=%s, rental=%s', v_m.status, v_r.status);
        return next; continue;
      end if;

      -- ── Qué lados tocar ──
      -- Solo los que nombra p_side, y solo si de verdad cambian. Como aquí los
      -- dos estados ya son published|paused, «distinto del destino» equivale
      -- exactamente a published→paused al pausar y paused→published al publicar.
      v_toca_match  := p_side in ('match','both')  and v_m.status is distinct from v_destino;
      v_toca_rental := p_side in ('rental','both') and v_r.status is distinct from v_destino;

      if v_toca_match then
        update public.games set status = v_destino where id = v_m.id;
        match_status  := v_destino::text;
        changed_count := changed_count + 1;
      end if;

      if v_toca_rental then
        update public.games set status = v_destino where id = v_r.id;
        rental_status := v_destino::text;
        changed_count := changed_count + 1;
      end if;

      -- Sin UPDATE no hay nada que contar: el lado ya estaba donde se le pedía.
      if changed_count = 0 then
        result := 'noop'; reason := 'ALREADY_IN_TARGET';
      else
        result := 'applied';
      end if;
      return next;

    exception when others then
      -- El savepoint ya deshizo lo que esta pareja hubiera escrito. Se devuelve
      -- su estado REAL tras ese deshacer, no el que íbamos a dejar.
      v_vistos      := v_vistos || v_id;
      result        := 'skipped';
      reason        := left(sqlerrm, 300);
      changed_count := 0;
      if v_m.id is not null then
        select g.status::text into match_status  from public.games g where g.id = v_m.id;
      end if;
      if v_r.id is not null then
        select g.status::text into rental_status from public.games g where g.id = v_r.id;
      end if;
      return next;
    end;
  end loop;

  return;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."set_double_out_side_bulk"(uuid[], text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_field_total_spots_from_format()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  required_players integer;
begin
  -- autocompletar solo si:
  -- format existe
  -- y total_spots viene null
  if new.format is not null
     and new.total_spots is null then

    required_players :=
      split_part(lower(new.format), 'v', 1)::integer * 2;

    new.total_spots := required_players;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_game_duration_default()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin

  if new.duration_min is null then
    select duration_min
    into new.duration_min
    from fields
    where id = new.field_id;
  end if;

  return new;

end;
$function$;

CREATE OR REPLACE FUNCTION public.set_game_format()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  if new.format is null then
    select format
    into new.format
    from fields
    where id = new.field_id;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_game_total_spots()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  if new.total_spots is null then
    select total_spots
    into new.total_spots
    from fields
    where id = new.field_id;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_game_windows (
  p_free_invites_lead_min integer,
  p_attendance_lead_min   integer
)
  RETURNS public.app_settings
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_row public.app_settings;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_write_app_settings() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_free_invites_lead_min is null
     or p_free_invites_lead_min not between 0 and 1440 then
    raise exception 'INVALID_FREE_INVITES_LEAD';
  end if;
  if p_attendance_lead_min is null
     or p_attendance_lead_min not between 0 and 1440 then
    raise exception 'INVALID_ATTENDANCE_LEAD';
  end if;

  update public.app_settings
     set free_invites_lead_min = p_free_invites_lead_min,
         attendance_lead_min   = p_attendance_lead_min,
         updated_at            = now(),
         updated_by            = auth.uid()
   where id = 1
  returning * into v_row;

  if not found then
    raise exception 'SETTINGS_ROW_MISSING';
  end if;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_game_windows"(integer, integer) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_maintenance_settings (
  p_maintenance_mode    boolean,
  p_maintenance_message text
)
  RETURNS public.app_settings
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_message text;
  v_row     public.app_settings;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_write_app_settings() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_maintenance_mode is null then
    raise exception 'INVALID_MAINTENANCE_MODE';
  end if;

  -- Se guarda ya limpio: los espacios de los extremos no son mensaje, y sin
  -- recortarlos un texto de solo espacios pasaria por lleno.
  v_message := btrim(coalesce(p_maintenance_message, ''));

  if p_maintenance_mode and v_message = '' then
    raise exception 'MAINTENANCE_MESSAGE_REQUIRED';
  end if;
  if length(v_message) > 500 then
    raise exception 'MAINTENANCE_MESSAGE_TOO_LONG';
  end if;

  update public.app_settings
     set maintenance_mode    = p_maintenance_mode,
         maintenance_message = v_message,
         updated_at          = now(),
         updated_by          = auth.uid()
   where id = 1
  returning * into v_row;

  if not found then
    raise exception 'SETTINGS_ROW_MISSING';
  end if;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_maintenance_settings"(boolean, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_organizer_contact (
  p_mode  text,
  p_phone text DEFAULT NULL::text
)
  RETURNS public.app_settings
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_phone text;
  v_row   public.app_settings;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_write_app_settings() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_mode not in ('host', 'algrass') then
    raise exception 'INVALID_CONTACT_MODE';
  end if;

  -- Fuera todo lo que no sea dígito: espacios, guiones, paréntesis y el «+».
  v_phone := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');

  if v_phone is not null and v_phone !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'INVALID_PHONE';
  end if;

  if p_mode = 'algrass' and v_phone is null then
    raise exception 'PHONE_REQUIRED';
  end if;

  update public.app_settings
     set organizer_contact_mode    = p_mode,
         algrass_operational_phone = v_phone,
         updated_at                = now(),
         updated_by                = auth.uid()
   where id = 1
  returning * into v_row;

  if not found then
    raise exception 'SETTINGS_ROW_MISSING';
  end if;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_organizer_contact"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_reward_referral_settings (
  p_player_enabled       boolean,
  p_player_amount        numeric,
  p_captain_enabled      boolean,
  p_captain_amount       numeric,
  p_captain_gold_enabled boolean,
  p_captain_gold_amount  numeric
)
  RETURNS public.app_settings
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_row public.app_settings;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_write_app_settings() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Los tres interruptores son obligatorios. Nulo no es «apagado»: es no haber
  -- dicho nada, y esta funcion escribe siempre los seis campos.
  if p_player_enabled is null
     or p_captain_enabled is null
     or p_captain_gold_enabled is null then
    raise exception 'INVALID_REWARD_ENABLED';
  end if;

  -- Los importes se guardan encendidos o apagados, asi que se validan los tres
  -- siempre. `= 'NaN'` no es paranoia: en numeric, NaN pasa el `>= 0`.
  if p_player_amount is null
     or p_player_amount = 'NaN'::numeric
     or p_player_amount < 0 then
    raise exception 'INVALID_REWARD_PLAYER_AMOUNT';
  end if;
  if p_captain_amount is null
     or p_captain_amount = 'NaN'::numeric
     or p_captain_amount < 0 then
    raise exception 'INVALID_REWARD_CAPTAIN_AMOUNT';
  end if;
  if p_captain_gold_amount is null
     or p_captain_gold_amount = 'NaN'::numeric
     or p_captain_gold_amount < 0 then
    raise exception 'INVALID_REWARD_CAPTAIN_GOLD_AMOUNT';
  end if;

  -- Las seis columnas y nada mas. `updated_at` y `updated_by` son el sello de
  -- auditoria que escriben las cinco hermanas: dejarlo sin tocar aqui haria que
  -- Configuracion mintiera sobre cuando se cambio por ultima vez.
  update public.app_settings
     set reward_referral_player_enabled       = p_player_enabled,
         reward_referral_player_amount        = p_player_amount,
         reward_referral_captain_enabled      = p_captain_enabled,
         reward_referral_captain_amount       = p_captain_amount,
         reward_referral_captain_gold_enabled = p_captain_gold_enabled,
         reward_referral_captain_gold_amount  = p_captain_gold_amount,
         updated_at                           = now(),
         updated_by                           = auth.uid()
   where id = 1
  returning * into v_row;

  if not found then
    raise exception 'SETTINGS_ROW_MISSING';
  end if;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_reward_referral_settings"(boolean, numeric, boolean, numeric, boolean, numeric) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_support_contact (
  p_whatsapp text,
  p_email    text
)
  RETURNS public.app_settings
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_row      public.app_settings;
  v_whatsapp text;
  v_email    text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_write_app_settings() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Misma normalizacion que `set_organizer_contact`: fuera todo lo que no sea
  -- digito, y el vacio es NULL. Con el mismo rango de longitudes, que cubre
  -- cualquier prefijo internacional.
  v_whatsapp := nullif(regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g'), '');

  if v_whatsapp is not null and v_whatsapp !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'INVALID_SUPPORT_WHATSAPP';
  end if;

  -- El email, recortado y en minusculas: es un identificador, no un texto, y
  -- guardarlo con la caja que vino haria que el mismo buzon pareciera dos.
  v_email := nullif(btrim(lower(coalesce(p_email, ''))), '');

  -- Deliberadamente conservador: algo antes de la arroba, algo despues, y un
  -- dominio con punto. No se intenta validar un email de verdad —no se puede
  -- desde una expresion— sino descartar lo que seguro no lo es.
  if v_email is not null
     and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]{2,}$' then
    raise exception 'INVALID_SUPPORT_EMAIL';
  end if;

  -- Las dos columnas y nada mas. `updated_at` y `updated_by` son el sello de
  -- auditoria que escriben las seis hermanas: dejarlo sin tocar aqui haria que
  -- Configuracion mintiera sobre cuando se cambio por ultima vez.
  update public.app_settings
     set support_whatsapp = v_whatsapp,
         support_email    = v_email,
         updated_at       = now(),
         updated_by       = auth.uid()
   where id = 1
  returning * into v_row;

  if not found then
    raise exception 'SETTINGS_ROW_MISSING';
  end if;

  return v_row;
end $function$;

REVOKE ALL ON FUNCTION "public"."set_support_contact"(text, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.set_venue_manager_request_notes (
  p_request_id uuid,
  p_notes      text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_estado text;
  v_notas  text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not public.can_manage_venue_manager_requests() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_notas := nullif(btrim(coalesce(p_notes, '')), '');

  if length(coalesce(v_notas, '')) > 2000 then
    raise exception 'NOTES_TOO_LONG';
  end if;

  select status into v_estado
    from public.venue_manager_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_estado = 'closed' then
    raise exception 'REQUEST_CLOSED';
  end if;

  update public.venue_manager_requests
     set admin_notes = v_notas
   where id = p_request_id;

  return jsonb_build_object('request_id', p_request_id, 'admin_notes', v_notas);
end $function$;

REVOKE ALL ON FUNCTION "public"."set_venue_manager_request_notes"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.spend_wallet_credit (
  p_user_id uuid,
  p_amount  numeric
)
  RETURNS numeric
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
declare
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_nuevo  numeric;
begin
  if p_user_id is null then raise exception 'INVALID_USER'; end if;
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  update public.wallet_summary
     set credit_balance   = credit_balance - v_amount,
         reserved_balance = reserved_balance + v_amount
   where user_id = p_user_id
     and credit_balance >= v_amount
  returning credit_balance into v_nuevo;

  -- Sin fila, o con saldo insuficiente: lo mismo de cara al que paga. No se
  -- distingue a propósito: «no tienes crédito» es la verdad en los dos casos.
  if v_nuevo is null then
    raise exception 'INSUFFICIENT_CREDIT: %', v_amount;
  end if;

  return v_nuevo;
end $function$;

REVOKE ALL ON FUNCTION "public"."spend_wallet_credit"(uuid, numeric) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.sync_field_total_spots_with_format()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  required_players integer;
begin
  if new.format is not null then
    required_players :=
      split_part(lower(new.format), 'v', 1)::integer * 2;

    new.total_spots := required_players;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_manager_to_venue_staff()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if new.manager_user_id is not null then

    insert into public.venue_staff (
      venue_id,
      user_id,
      status
    )
    values (
      new.id,
      new.manager_user_id,
      'accepted'
    )

    on conflict (venue_id, user_id)
    do update set
      status = 'accepted';

  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_championship_live (
  p_championship_id uuid,
  p_live            boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_live is null then raise exception 'INVALID_INPUT'; end if;
  -- Misma lock key que roster/resultados/transiciones → no compite con otras mutaciones del campeonato.
  perform pg_advisory_xact_lock(hashtext('champ_reg:' || p_championship_id::text)::bigint);

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;

  -- Solo HOST asignado o AlGrass. Owner puro / jugador → NO.
  if not ((v_champ.host_user_id is not null and v_champ.host_user_id = v_actor)
          or public._is_algrass_staff(v_actor)) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Solo dentro de in_progress: el toggle NO cambia el estado base ni cruza a otras fases.
  if v_champ.status <> 'in_progress' then raise exception 'INVALID_PHASE'; end if;

  update public.championships
     set live_started_at = case when p_live then now() else null end
   where id = p_championship_id
  returning * into v_champ;

  return jsonb_build_object(
    'id', v_champ.id,
    'status', v_champ.status,
    'live_started_at', v_champ.live_started_at,
    'phase', case when v_champ.live_started_at is not null then 'in_progress_live' else 'in_progress_prelive' end
  );
end; $function$;

REVOKE ALL ON FUNCTION "public"."toggle_championship_live"(uuid, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.trg_rebuild_reserved_slots_used()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
begin
  if tg_op = 'DELETE' then
    perform public.rebuild_reserved_slots_used(old.game_slot_reservation_id);
    return old;
  end if;

  -- UPDATE que NO puede afectar el conteo → no se recomputa.
  if tg_op = 'UPDATE'
     and new.game_slot_reservation_id is not distinct from old.game_slot_reservation_id
     and new.status                   is not distinct from old.status
     and new.counts_reserved_slot     is not distinct from old.counts_reserved_slot then
    return new;
  end if;

  -- INSERT o UPDATE relevante: recomputar el grupo destino.
  perform public.rebuild_reserved_slots_used(new.game_slot_reservation_id);

  -- Si en un UPDATE la fila cambió de grupo (pertenencia), recomputar también el origen.
  if tg_op = 'UPDATE'
     and old.game_slot_reservation_id is distinct from new.game_slot_reservation_id then
    perform public.rebuild_reserved_slots_used(old.game_slot_reservation_id);
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_championship_cover (
  p_championship_id  uuid,
  p_name             text,
  p_cover_theme      text,
  p_cover_image_path text    DEFAULT NULL::text,
  p_set_cover_image  boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_cover text := nullif(btrim(coalesce(p_cover_theme, '')), '');
  v_img   text := nullif(btrim(coalesce(p_cover_image_path, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is null then raise exception 'INVALID_INPUT'; end if;
  if v_cover is not null and v_cover !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'INVALID_INPUT'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from v_actor then raise exception 'NOT_OWNER'; end if;
  if v_champ.status in ('canceled', 'completed') then raise exception 'INVALID_STATE'; end if;

  -- Validar el path de la foto (si se está fijando y no es NULL): debe estar bajo {owner}/{championship}/.
  if p_set_cover_image and v_img is not null
     and v_img not like (v_actor::text || '/' || p_championship_id::text || '/%') then
    raise exception 'INVALID_INPUT';
  end if;

  update public.championships
     set name             = v_name,
         cover_theme      = coalesce(v_cover, cover_theme),
         cover_image_path = case when p_set_cover_image then v_img else cover_image_path end,
         updated_at       = now()
   where id = p_championship_id
  returning * into v_champ;

  return jsonb_build_object(
    'id', v_champ.id,
    'name', v_champ.name,
    'cover_theme', v_champ.cover_theme,
    'cover_image_path', v_champ.cover_image_path
  );
end;
$function$;

REVOKE ALL ON FUNCTION "public"."update_championship_cover"(uuid, text, text, text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_championship_privacy (
  p_championship_id  uuid,
  p_registration_key text,
  p_results_public   boolean
)
  RETURNS public.championships
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_champ public.championships%rowtype;
  v_key   text := nullif(btrim(coalesce(p_registration_key, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_results_public is null then raise exception 'INVALID_INPUT'; end if;

  select * into v_champ from public.championships where id = p_championship_id for update;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if v_champ.owner_user_id is distinct from v_actor then raise exception 'NOT_OWNER'; end if;
  -- AMPLIADO: `in_progress` entra. Abrir o cerrar el calendario publico es
  -- justamente lo que se quiere poder hacer MIENTRAS el torneo ocurre, y antes
  -- cortaba con INVALID_STATE ahi.
  --
  -- `in_progress` cubre PRE-LIVE y EN VIVO: en la base son el mismo estado, y
  -- `live_started_at` no se mira a proposito. `completed` y `canceled` se quedan
  -- FUERA, exactamente como estaban.
  if v_champ.status not in ('pending_publish', 'registration_open', 'registration_closed',
                            'in_progress') then
    raise exception 'INVALID_STATE';
  end if;

  update public.championships
     set registration_key = v_key,
         results_public    = p_results_public,
         updated_at        = now()
   where id = p_championship_id
  returning * into v_champ;

  return v_champ;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."update_championship_privacy"(uuid, text, boolean) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_championship_team_secret (
  p_team_id uuid,
  p_secret  text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_actor  uuid := auth.uid();
  v_team   public.championship_teams%rowtype;
  v_champ  public.championships%rowtype;
  v_secret text := nullif(btrim(coalesce(p_secret, '')), '');
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_secret is null or length(v_secret) < 4 then raise exception 'TEAM_SECRET_REQUIRED'; end if;

  select * into v_team from public.championship_teams where id = p_team_id;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if v_team.created_by_user_id is distinct from v_actor then raise exception 'NOT_AUTHORIZED'; end if;

  select * into v_champ from public.championships where id = v_team.championship_id;
  if not found then raise exception 'CHAMPIONSHIP_NOT_FOUND'; end if;
  if not (v_champ.order_id is null and (v_champ.public_individual_price is not null or v_champ.public_team_price is not null)) then
    raise exception 'NOT_PUBLIC';
  end if;
  if v_champ.status <> 'registration_open' then raise exception 'NOT_OPEN'; end if;

  update public.championship_teams set join_secret = v_secret, updated_at = now()
   where id = p_team_id;

  return jsonb_build_object('team_id', p_team_id, 'status', 'ok');
end $function$;

REVOKE ALL ON FUNCTION "public"."update_championship_team_secret"(uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.update_game_lifecycle()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
BEGIN

  -- Matches published → completed o expired
  UPDATE games g
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM game_players gp
      WHERE gp.game_id = g.id
    )
    THEN 'completed'
    ELSE 'expired'
  END
  FROM fields f
  WHERE g.field_id = f.id
    AND g.type = 'match'
    AND g.status = 'published'
    AND (
      (
        (g.date_key || ' ' || g.time)::timestamp
        + COALESCE(g.duration_min, f.duration_min, 60)
          * INTERVAL '1 minute'
      )
      AT TIME ZONE 'America/Lima'
    ) < NOW();

  -- Rentals published → completed o expired
  UPDATE games g
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM reservations r
      WHERE r.game_id = g.id
        AND r.status = 'confirmed'
    )
    THEN 'completed'
    ELSE 'expired'
  END
  FROM fields f
  WHERE g.field_id = f.id
    AND g.type = 'rental'
    AND g.status = 'published'
    AND (
      (
        (g.date_key || ' ' || g.time)::timestamp
        + COALESCE(g.duration_min, f.duration_min, 60)
          * INTERVAL '1 minute'
      )
      AT TIME ZONE 'America/Lima'
    ) < NOW();

  -- Rentals reserved → completed
  UPDATE games g
  SET status = 'completed'
  FROM fields f
  WHERE g.field_id = f.id
    AND g.status = 'reserved'
    AND (
      (
        (g.date_key || ' ' || g.time)::timestamp
        + COALESCE(g.duration_min, f.duration_min, 60)
          * INTERVAL '1 minute'
      )
      AT TIME ZONE 'America/Lima'
    ) < NOW();

END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_format_vs_total_spots()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  required_players integer;
  effective_format text;
  effective_total_spots integer;
begin
  effective_format := new.format;
  effective_total_spots := new.total_spots;

  -- fallback desde fields si vienen null
  if effective_format is null or effective_total_spots is null then
    select
      coalesce(effective_format, format),
      coalesce(effective_total_spots, total_spots)
    into
      effective_format,
      effective_total_spots
    from fields
    where id = new.field_id;
  end if;

  -- si aún falta algo, no validar
  if effective_format is null or effective_total_spots is null then
    return new;
  end if;

  required_players := required_players_from_format(effective_format);

  if effective_total_spots < required_players then
    raise exception 'total_spots cannot be lower than required players for format';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_game_host_is_venue_staff()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  v_venue_id uuid;
begin
  if new.host_user_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.host_user_id is not distinct from old.host_user_id
     and new.field_id is not distinct from old.field_id then
    return new;
  end if;

  select f.venue_id into v_venue_id
    from public.fields f
   where f.id = new.field_id;

  if not exists (
        select 1
          from public.venue_staff vs
         where vs.user_id = new.host_user_id
           and vs.venue_id = v_venue_id
           and vs.status = 'accepted') then
    raise exception
      'El host de un partido debe pertenecer al staff aceptado del complejo de su cancha.'
      using errcode = 'P0001', hint = 'AG_HOST_NOT_STAFF';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_game_total_spots()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
declare
  confirmed_count integer;
begin
  select count(*)
  into confirmed_count
  from game_players
  where game_id = new.id
    and status = 'confirmed';

  if new.total_spots < confirmed_count then
    raise exception 'games.total_spots cannot be lower than confirmed players';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.venue_manager_requests_touch()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION "public"."venue_manager_requests_touch"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION public.verify_championship_access (
  p_championship_id  uuid,
  p_registration_key text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_champ public.championships%rowtype;
  v_typed text := btrim(coalesce(p_registration_key, ''));
begin
  select * into v_champ from public.championships where id = p_championship_id;
  if not found then return false; end if;
  if v_champ.status not in ('registration_open','registration_closed','in_progress','completed') then return false; end if;
  if v_champ.owner_user_id = auth.uid() then return true; end if;                              -- owner
  if auth.uid() is not null and exists (
       select 1 from public.championship_players where championship_id = p_championship_id and user_id = auth.uid()
     ) then return true; end if;                                                              -- miembro inscrito
  if nullif(btrim(coalesce(v_champ.registration_key, '')), '') is null then return false; end if;
  return v_typed = btrim(v_champ.registration_key);                                           -- visitante: clave
end; $function$;

CREATE OR REPLACE FUNCTION public.welcome_email_enqueue()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $function$
begin
  -- La condicion —de NULL a un correo— la ha comprobado ya el WHEN. Aqui solo
  -- queda encolar.
  --
  -- ON CONFLICT DO NOTHING es la segunda defensa: una bienvenida por persona y
  -- para siempre, aunque alguien vuelva a vaciar y rellenar confirmed_email.
  insert into public.welcome_emails (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return null;   -- AFTER trigger: el valor devuelto se ignora
end $function$;

REVOKE ALL ON FUNCTION "public"."welcome_email_enqueue"() FROM PUBLIC, "anon", "authenticated";

ALTER TABLE "public"."championship_goals"
  ADD CONSTRAINT "championship_goals_match_id_fkey" FOREIGN KEY (match_id) REFERENCES public.championship_matches(id) ON DELETE CASCADE;

ALTER TABLE "public"."championship_goals"
  ADD CONSTRAINT "championship_goals_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.championship_teams(id) ON DELETE RESTRICT;

ALTER TABLE "public"."championship_matches"
  ADD CONSTRAINT "championship_matches_away_team_id_fkey" FOREIGN KEY (away_team_id) REFERENCES public.championship_teams(id) ON DELETE RESTRICT;

ALTER TABLE "public"."championship_matches"
  ADD CONSTRAINT "championship_matches_home_team_id_fkey" FOREIGN KEY (home_team_id) REFERENCES public.championship_teams(id) ON DELETE RESTRICT;

ALTER TABLE "public"."championship_matches"
  ADD CONSTRAINT "championship_matches_qualified_team_id_fkey" FOREIGN KEY (qualified_team_id) REFERENCES public.championship_teams(id) ON DELETE RESTRICT;

ALTER TABLE "public"."championship_players"
  ADD CONSTRAINT "championship_players_team_id_fkey" FOREIGN KEY (team_id) REFERENCES public.championship_teams(id) ON DELETE SET NULL;

ALTER TABLE "public"."championships"
  ADD CONSTRAINT "championships_champion_team_id_fkey" FOREIGN KEY (champion_team_id) REFERENCES public.championship_teams(id) ON DELETE SET NULL;

ALTER TABLE "public"."championship_matches"
  ADD CONSTRAINT "championship_matches_championship_id_fkey" FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;

ALTER TABLE "public"."championship_players"
  ADD CONSTRAINT "championship_players_championship_id_fkey" FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;

ALTER TABLE "public"."championship_reservation_games"
  ADD CONSTRAINT "championship_reservation_games_championship_id_fkey" FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;

ALTER TABLE "public"."championship_teams"
  ADD CONSTRAINT "championship_teams_championship_id_fkey" FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE CASCADE;

ALTER TABLE "public"."game_players"
  ADD CONSTRAINT "game_players_game_slot_reservation_id_fkey" FOREIGN KEY (game_slot_reservation_id) REFERENCES public.game_slot_reservations(id) ON DELETE SET NULL;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_championship_id_fkey" FOREIGN KEY (championship_id) REFERENCES public.championships(id) ON DELETE SET NULL;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_field_id_fkey" FOREIGN KEY (field_id) REFERENCES public.fields(id);

ALTER TABLE "public"."championship_matches"
  ADD CONSTRAINT "championship_matches_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE SET NULL;

ALTER TABLE "public"."championship_reservation_games"
  ADD CONSTRAINT "championship_reservation_games_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE "public"."game_players"
  ADD CONSTRAINT "game_players_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE "public"."game_slot_reservations"
  ADD CONSTRAINT "game_slot_reservations_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE "public"."game_waitlist"
  ADD CONSTRAINT "game_waitlist_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_alternative_game_id_fkey" FOREIGN KEY (alternative_game_id) REFERENCES public.games(id) ON DELETE SET NULL;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "no_field_time_overlap" EXCLUDE USING gist (field_id WITH =, ((COALESCE(overlap_group, id))::text)
    WITH <>,
    tsrange((date_key + "time"), ((date_key + "time") + ((duration_min)::double precision * '00:01:00'::interval)), '[)'::text) WITH &&)
    WHERE ((status = ANY (ARRAY['draft'::text, 'published'::text, 'active'::text])));

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE;

ALTER TABLE "public"."championship_players"
  ADD CONSTRAINT "championship_players_registration_order_id_fkey" FOREIGN KEY (registration_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE "public"."championship_teams"
  ADD CONSTRAINT "championship_teams_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE "public"."rating"
  ADD CONSTRAINT "rating_field_id_fkey" FOREIGN KEY (field_id) REFERENCES public.fields(id) ON DELETE SET NULL;

ALTER TABLE "public"."reservations"
  ADD CONSTRAINT "reservations_championship_id_fkey" FOREIGN KEY (championship_id) REFERENCES public.championships(id);

ALTER TABLE "public"."reservations"
  ADD CONSTRAINT "reservations_game_id_fkey" FOREIGN KEY (game_id) REFERENCES public.games(id);

ALTER TABLE "public"."game_players"
  ADD CONSTRAINT "game_players_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES public.reservations(id);

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES public.reservations(id);

ALTER TABLE "public"."reservations"
  ADD CONSTRAINT "reservations_promo_code_id_fkey" FOREIGN KEY (promo_code_id) REFERENCES public.promo_codes(id);

ALTER TABLE "public"."reward_transactions"
  ADD CONSTRAINT "reward_transactions_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES public.reservations(id) ON DELETE SET NULL;

ALTER TABLE "public"."broadcasts"
  ADD CONSTRAINT "broadcasts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."captain_requests"
  ADD CONSTRAINT "captain_requests_reviewed_by_user_id_fkey" FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id);

ALTER TABLE "public"."captain_requests"
  ADD CONSTRAINT "captain_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."captain_welcome_emails"
  ADD CONSTRAINT "captain_welcome_emails_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."championship_requests"
  ADD CONSTRAINT "championship_requests_managed_by_user_id_fkey" FOREIGN KEY (managed_by_user_id) REFERENCES public.users(id);

ALTER TABLE "public"."championship_requests"
  ADD CONSTRAINT "championship_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."fields"
  ADD CONSTRAINT "fields_default_host_user_id_fkey" FOREIGN KEY (default_host_user_id) REFERENCES public.users(id);

ALTER TABLE "public"."game_players"
  ADD CONSTRAINT "game_players_invited_by_fkey" FOREIGN KEY (payer_id) REFERENCES public.users(id);

ALTER TABLE "public"."game_players"
  ADD CONSTRAINT "game_players_invited_by_user_id_fkey" FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."game_players"
  ADD CONSTRAINT "game_players_referred_by_user_id_fkey" FOREIGN KEY (referred_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."game_players"
  ADD CONSTRAINT "game_players_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."game_slot_reservations"
  ADD CONSTRAINT "game_slot_reservations_released_by_user_id_fkey" FOREIGN KEY (released_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."game_slot_reservations"
  ADD CONSTRAINT "game_slot_reservations_reserved_by_user_id_fkey" FOREIGN KEY (reserved_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."game_waitlist"
  ADD CONSTRAINT "game_waitlist_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_booked_by_user_id_fkey" FOREIGN KEY (booked_by_user_id) REFERENCES public.users(id);

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_cancelled_by_user_id_fkey" FOREIGN KEY (cancelled_by_user_id) REFERENCES public.users(id);

ALTER TABLE "public"."games"
  ADD CONSTRAINT "games_host_user_id_fkey" FOREIGN KEY (host_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."rating"
  ADD CONSTRAINT "rating_host_user_id_fkey" FOREIGN KEY (host_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."reservations"
  ADD CONSTRAINT "reservations_canceled_by_fkey" FOREIGN KEY (canceled_by) REFERENCES public.users(id);

ALTER TABLE "public"."reservations"
  ADD CONSTRAINT "reservations_invited_by_user_id_fkey" FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."reservations"
  ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id);

ALTER TABLE "public"."reward_transactions"
  ADD CONSTRAINT "reward_transactions_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES public.users(id);

ALTER TABLE "public"."reward_transactions"
  ADD CONSTRAINT "reward_transactions_referred_user_id_fkey" FOREIGN KEY (referred_user_id) REFERENCES public.users(id);

ALTER TABLE "public"."reward_transactions"
  ADD CONSTRAINT "reward_transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_user_code_unique" UNIQUE (user_code);

ALTER TABLE "public"."venue_manager_requests"
  ADD CONSTRAINT "venue_manager_requests_closed_by_user_id_fkey" FOREIGN KEY (closed_by_user_id) REFERENCES public.users(id);

ALTER TABLE "public"."venue_manager_requests"
  ADD CONSTRAINT "venue_manager_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."venue_staff"
  ADD CONSTRAINT "venue_hosts_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."venue_staff"
  ADD CONSTRAINT "venue_hosts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."venues"
  ADD CONSTRAINT "venues_manager_user_id_fkey" FOREIGN KEY (manager_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE "public"."fields"
  ADD CONSTRAINT "fields_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public.venues(id);

ALTER TABLE "public"."notifications"
  ADD CONSTRAINT "notifications_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;

ALTER TABLE "public"."rating"
  ADD CONSTRAINT "rating_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE SET NULL;

ALTER TABLE "public"."venue_staff"
  ADD CONSTRAINT "venue_hosts_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES public.venues(id) ON DELETE CASCADE;

ALTER TABLE "public"."wallet_summary"
  ADD CONSTRAINT "wallet_summary_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE VIEW "public"."game_live_spots" AS  SELECT g.id AS game_id,
    (COALESCE(g.total_spots, 0) - count(gp.id) FILTER (WHERE (gp.status = 'confirmed'::text))) AS open_spots,
    count(gp.id) FILTER (WHERE (gp.status = 'confirmed'::text)) AS occupied_spots
   FROM (public.games g
     LEFT JOIN public.game_players gp ON ((gp.game_id = g.id)))
  GROUP BY g.id, g.total_spots;

CREATE VIEW "public"."player_first_completed_activity" WITH (security_invoker=true) AS  WITH actividades AS (
         SELECT gp.user_id,
            g.id AS game_id,
            'match'::text AS type,
            g.date_key,
            g."time",
            gp.referred_by_user_id AS referred_by
           FROM (public.game_players gp
             JOIN public.games g ON ((g.id = gp.game_id)))
          WHERE ((gp.status = 'confirmed'::text) AND (g.type = 'match'::text) AND (g.status = 'completed'::text))
        UNION ALL
         SELECT g.booked_by_user_id,
            g.id,
            'rental'::text AS text,
            g.date_key,
            g."time",
            NULL::uuid AS uuid
           FROM public.games g
          WHERE ((g.type = 'rental'::text) AND (g.status = 'completed'::text) AND (g.booked_by_user_id IS NOT NULL))
        ), ordenadas AS (
         SELECT a.user_id,
            a.game_id,
            a.type,
            a.date_key,
            a."time",
            a.referred_by,
            row_number() OVER (PARTITION BY a.user_id ORDER BY a.date_key, a."time", a.game_id) AS rn
           FROM actividades a
        )
 SELECT user_id,
    game_id AS first_game_id,
    type AS first_type,
    date_key AS first_date_key,
    "time" AS first_time,
    ((date_key + "time") AT TIME ZONE 'America/Lima'::text) AS first_started_at,
    referred_by AS first_referred_by,
    ((type = 'match'::text) AND (referred_by IS NOT NULL) AND (referred_by <> user_id)) AS is_referred_newcomer
   FROM ordenadas o
  WHERE (rn = 1);

REVOKE ALL ON TABLE "public"."player_first_completed_activity" FROM "anon";

CREATE VIEW "public"."users_public" AS  SELECT id,
    full_name,
    full_name_search,
    user_code,
    avatar_hue,
    avatar_path,
    avatar_updated_at,
    city,
    preferred_position,
    sex,
    (EXTRACT(year FROM age((birth_date)::timestamp with time zone)))::integer AS age,
    profile_private,
    ((COALESCE(array_length(preferred_position, 1), 0) > 0) AND (birth_date IS NOT NULL) AND (COALESCE(phone, ''::text) <> ''::text) AND (COALESCE(nationality, ''::text) <> ''::text) AND (COALESCE(occupation, ''::text) <> ''::text)) AS profile_complete
   FROM public.users
  WHERE (deleted_at IS NULL);

CREATE INDEX broadcasts_dates_idx ON public.broadcasts USING btree (starts_at, expires_at);

CREATE UNIQUE INDEX captain_requests_one_open ON public.captain_requests USING btree (user_id)
  WHERE (status = ANY (ARRAY['pending_email_confirmation'::text, 'pending_review'::text]));

CREATE INDEX captain_requests_status_requested_at ON public.captain_requests USING btree (status, requested_at DESC);

CREATE INDEX captain_welcome_emails_pending ON public.captain_welcome_emails USING btree (created_at)
  WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

CREATE INDEX captain_welcome_emails_sending ON public.captain_welcome_emails USING btree (claimed_at)
  WHERE (status = 'sending'::text);

CREATE INDEX championship_matches_champ_idx ON public.championship_matches USING btree (championship_id);

CREATE INDEX championship_matches_game_idx ON public.championship_matches USING btree (game_id);

CREATE INDEX championship_players_champ_idx ON public.championship_players USING btree (championship_id);

CREATE INDEX championship_players_reg_order_idx ON public.championship_players USING btree (registration_order_id)
  WHERE (registration_order_id IS NOT NULL);

CREATE INDEX championship_players_team_idx ON public.championship_players USING btree (team_id)
  WHERE (team_id IS NOT NULL);

CREATE INDEX championship_requests_status_created ON public.championship_requests USING btree (status, created_at DESC);

CREATE UNIQUE INDEX championship_reservation_games_game_unique ON public.championship_reservation_games USING btree (game_id);

CREATE INDEX championship_teams_champ_idx ON public.championship_teams USING btree (championship_id);

CREATE UNIQUE INDEX championship_teams_join_token_uq ON public.championship_teams USING btree (join_token)
  WHERE (join_token IS NOT NULL);

CREATE UNIQUE INDEX championship_teams_order_uq ON public.championship_teams USING btree (order_id)
  WHERE (order_id IS NOT NULL);

CREATE INDEX championships_hold_sweep_idx ON public.championships USING btree (hold_expires_at)
  WHERE (hold_expires_at IS NOT NULL);

CREATE INDEX championships_owner_idx ON public.championships USING btree (owner_user_id);

CREATE INDEX game_players_game_id_invited_by_idx ON public.game_players USING btree (game_id, payer_id);

CREATE INDEX game_players_game_id_status_idx ON public.game_players USING btree (game_id, status);

CREATE INDEX game_players_game_status_idx ON public.game_players USING btree (game_id, status);

CREATE INDEX game_players_invited_by_idx ON public.game_players USING btree (payer_id);

CREATE UNIQUE INDEX game_players_one_active_slot_idx ON public.game_players USING btree (game_id, user_id)
  WHERE (status = 'confirmed'::text);

CREATE UNIQUE INDEX game_players_one_confirmed_per_user ON public.game_players USING btree (game_id, user_id)
  WHERE (status = 'confirmed'::text);

CREATE INDEX game_players_referral_pending_idx ON public.game_players USING btree (game_id)
  WHERE ((referral_reward_evaluated_at IS NULL) AND (referred_by_user_id IS NOT NULL));

CREATE INDEX game_players_referred_by_user_id_idx ON public.game_players USING btree (referred_by_user_id);

CREATE INDEX game_players_reservation_idx ON public.game_players USING btree (reservation_id);

CREATE INDEX game_players_slot_reservation_idx ON public.game_players USING btree (game_slot_reservation_id);

CREATE INDEX game_players_user_id_idx ON public.game_players USING btree (user_id);

CREATE INDEX game_slot_reservations_active_expiry_idx ON public.game_slot_reservations USING btree (expires_at)
  WHERE (status = 'active'::text);

CREATE UNIQUE INDEX game_slot_reservations_captain_uk ON public.game_slot_reservations USING btree (game_id, reserved_by_user_id);

CREATE INDEX game_slot_reservations_game_id_idx ON public.game_slot_reservations USING btree (game_id);

CREATE INDEX game_slot_reservations_reserved_by_idx ON public.game_slot_reservations USING btree (reserved_by_user_id);

CREATE INDEX games_championship_id_idx ON public.games USING btree (championship_id)
  WHERE (championship_id IS NOT NULL);

CREATE INDEX idx_game_players_reserved_count ON public.game_players USING btree (game_slot_reservation_id, counts_reserved_slot, status)
  WHERE (game_slot_reservation_id IS NOT NULL);

CREATE INDEX ix_game_waitlist_game ON public.game_waitlist USING btree (game_id);

CREATE INDEX ix_game_waitlist_user ON public.game_waitlist USING btree (user_id);

CREATE INDEX notifications_recipient_created_idx ON public.notifications USING btree (recipient_user_id, created_at DESC);

CREATE INDEX orders_expiry_sweep_idx ON public.orders USING btree (pending_expires_at)
  WHERE (status = 'pending'::text);

CREATE INDEX orders_resource_pending_idx ON public.orders USING btree (resource_id)
  WHERE (status = 'pending'::text);

CREATE INDEX rating_field_idx ON public.rating USING btree (field_id);

CREATE INDEX rating_game_idx ON public.rating USING btree (game_id);

CREATE INDEX rating_host_idx ON public.rating USING btree (host_user_id);

CREATE UNIQUE INDEX rating_user_game_unique ON public.rating USING btree (user_id, game_id);

CREATE INDEX rating_user_idx ON public.rating USING btree (user_id);

CREATE INDEX rating_venue_idx ON public.rating USING btree (venue_id);

CREATE INDEX reservations_championship_id_idx ON public.reservations USING btree (championship_id)
  WHERE (championship_id IS NOT NULL);

CREATE UNIQUE INDEX reservations_championship_order_spend_uq ON public.reservations USING btree (order_id)
  WHERE ((status = 'spend'::text) AND (championship_id IS NOT NULL));

CREATE INDEX reservations_championship_refund_idx ON public.reservations USING btree (championship_id)
  WHERE ((status = 'refund'::text) AND (championship_id IS NOT NULL));

CREATE INDEX reservations_order_id_idx ON public.reservations USING btree (order_id)
  WHERE (order_id IS NOT NULL);

CREATE INDEX reservations_promo_usage_idx ON public.reservations USING btree (promo_code_id, user_id)
  WHERE ((status = 'spend'::text) AND (promo_code_id IS NOT NULL));

CREATE UNIQUE INDEX reservations_refund_scope_key_uidx ON public.reservations USING btree (((refund_scope ->> 'key'::text)))
  WHERE ((status = 'refund'::text) AND (refund_scope IS NOT NULL));

CREATE UNIQUE INDEX reservations_rental_refund_uq ON public.reservations USING btree (refund_of_reservation_id)
  WHERE ((status = 'refund'::text) AND (source = 'rental'::text) AND (refund_of_reservation_id IS NOT NULL));

CREATE UNIQUE INDEX reward_transactions_idempotency_key ON public.reward_transactions USING btree (idempotency_key)
  WHERE (idempotency_key IS NOT NULL);

CREATE INDEX reward_transactions_uncommunicated_idx ON public.reward_transactions USING btree (user_id)
  WHERE ((communicated_at IS NULL) AND (TYPE = ANY (ARRAY['grant_referral'::text, 'grant_manual'::text])));

CREATE INDEX reward_transactions_user_created ON public.reward_transactions USING btree (user_id, created_at DESC);

CREATE UNIQUE INDEX unique_active_game_player ON public.game_players USING btree (game_id, user_id)
  WHERE (status = 'confirmed'::text);

CREATE INDEX user_roles_role_idx ON public.user_roles USING btree (ROLE);

CREATE UNIQUE INDEX user_roles_single_captain_tier ON public.user_roles USING btree (user_id)
  WHERE (ROLE = ANY (ARRAY['captain'::text, 'captain_gold'::text]));

CREATE INDEX user_roles_user_id_idx ON public.user_roles USING btree (user_id);

CREATE INDEX users_full_name_search_idx ON public.users USING btree (full_name_search);

CREATE INDEX users_user_code_idx ON public.users USING btree (user_code);

CREATE UNIQUE INDEX ux_game_waitlist_active ON public.game_waitlist USING btree (game_id, user_id)
  WHERE (status = 'waiting'::text);

CREATE UNIQUE INDEX venue_hosts_unique_user_per_venue ON public.venue_staff USING btree (venue_id, user_id);

CREATE UNIQUE INDEX venue_manager_requests_one_open ON public.venue_manager_requests USING btree (user_id)
  WHERE (status = ANY (ARRAY['pending'::text, 'contacted'::text]));

CREATE INDEX venue_manager_requests_status_created ON public.venue_manager_requests USING btree (status, created_at DESC);

CREATE INDEX welcome_emails_pending ON public.welcome_emails USING btree (created_at)
  WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_championship_requests_touch
  BEFORE UPDATE ON public.championship_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.championship_requests_touch();

CREATE TRIGGER field_total_spots_default
  BEFORE INSERT OR UPDATE ON public.fields
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_field_total_spots_with_format();

CREATE TRIGGER validate_fields_format_vs_total_spots
  BEFORE INSERT OR UPDATE ON public.fields
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_format_vs_total_spots();

CREATE TRIGGER enforce_game_capacity
  BEFORE INSERT OR UPDATE OF status ON public.game_players
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_capacity();

CREATE TRIGGER trg_game_players_reserved_slots_used
  AFTER INSERT OR DELETE OR UPDATE ON public.game_players
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_rebuild_reserved_slots_used();

CREATE TRIGGER trg_gate_match_double_out_commit
  BEFORE INSERT OR UPDATE ON public.game_players
  FOR EACH ROW
  EXECUTE FUNCTION public.gate_match_double_out_commit();

CREATE TRIGGER game_duration_default
  BEFORE INSERT ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.set_game_duration_default();

CREATE TRIGGER game_format_default
  BEFORE INSERT ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.set_game_format();

CREATE TRIGGER game_total_spots_default
  BEFORE INSERT ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.set_game_total_spots();

CREATE TRIGGER games_lock_sensitive_fields
  BEFORE UPDATE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_locked_game_fields();

CREATE TRIGGER protect_locked_game_fields_trigger
  BEFORE INSERT OR UPDATE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_locked_game_fields();

CREATE TRIGGER trg_apply_default_host_to_game
  BEFORE INSERT ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_default_host_to_game();

CREATE TRIGGER trg_block_double_out_twin
  AFTER UPDATE OF status ON public.games
  FOR EACH ROW
  WHEN (((old.status = 'published'::text) AND (new.status = 'reserved'::text) AND (new.alternative_game_id IS NOT NULL)))
  EXECUTE FUNCTION public.block_double_out_twin_on_reserve();

CREATE TRIGGER trg_clear_double_out_on_delete
  AFTER DELETE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_double_out_on_delete();

CREATE TRIGGER trg_reopen_double_out_twin
  AFTER UPDATE OF status ON public.games
  FOR EACH ROW
  WHEN (((old.status = 'reserved'::text) AND (new.status = ANY (ARRAY['published'::text, 'canceled'::text])) AND (new.alternative_game_id IS NOT NULL)))
  EXECUTE FUNCTION public.reopen_double_out_twin();

CREATE TRIGGER validate_game_host_is_venue_staff
  BEFORE INSERT OR UPDATE OF host_user_id, field_id ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_game_host_is_venue_staff();

CREATE TRIGGER validate_game_total_spots_trigger
  BEFORE INSERT OR UPDATE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_game_total_spots();

CREATE TRIGGER validate_games_format_vs_total_spots
  BEFORE INSERT OR UPDATE ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_format_vs_total_spots();

CREATE TRIGGER trg_orders_credit_restore
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN
    (((old.status = ANY (ARRAY['pending'::text, 'validation'::text])) AND (new.status = ANY (ARRAY['failed'::text, 'expired'::text])) AND (old.resource_type =
    'championship'::text)))
  EXECUTE FUNCTION public._championship_order_restore_credit();

CREATE TRIGGER trg_championship_spend_wallet
  BEFORE INSERT ON public.reservations
  FOR EACH ROW
  WHEN (((new.championship_id IS NOT NULL) AND (new.status = 'spend'::text)))
  EXECUTE FUNCTION public._championship_spend_to_wallet();

CREATE TRIGGER trg_captain_welcome_enqueue
  AFTER INSERT OR UPDATE OF ROLE ON public.user_roles
  FOR EACH ROW
  WHEN ((new.role = ANY (ARRAY['captain'::text, 'captain_gold'::text])))
  EXECUTE FUNCTION public.captain_welcome_enqueue();

CREATE TRIGGER trg_welcome_email_enqueue
  AFTER UPDATE OF confirmed_email ON public.users
  FOR EACH ROW
  WHEN (((old.confirmed_email IS NULL) AND (new.confirmed_email IS NOT NULL)))
  EXECUTE FUNCTION public.welcome_email_enqueue();

CREATE TRIGGER users_enforce_adult_birth_date
  BEFORE INSERT OR UPDATE OF birth_date ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_adult_birth_date();

CREATE TRIGGER trg_venue_manager_requests_touch
  BEFORE UPDATE ON public.venue_manager_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.venue_manager_requests_touch();

CREATE TRIGGER prevent_venue_staff_delete_while_hosting
  BEFORE DELETE ON public.venue_staff
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_venue_staff_delete_while_hosting();

CREATE TRIGGER trg_sync_manager_to_venue_staff
  AFTER INSERT OR UPDATE OF manager_user_id ON public.venues
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_manager_to_venue_staff();

CREATE POLICY "app_settings_read" ON "public"."app_settings"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "authenticated users read broadcasts" ON "public"."broadcasts"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() IS NOT NULL));

CREATE POLICY "captain_requests_insert_own" ON "public"."captain_requests"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    (((user_id = auth.uid()) AND (status = 'pending_review'::text) AND (reviewed_at IS NULL) AND (reviewed_by_user_id IS NULL) AND (assigned_role IS NULL) AND (review_note IS
    NULL)));

CREATE POLICY "captain_requests_select_backoffice" ON "public"."captain_requests"
  FOR SELECT
  TO "authenticated"
  USING (public.is_platform_admin_or_staff(auth.uid()));

CREATE POLICY "captain_requests_select_own" ON "public"."captain_requests"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = auth.uid()));

CREATE POLICY "championship_requests_insert_own" ON "public"."championship_requests"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((user_id = auth.uid()) AND (status = 'pending'::text) AND (internal_notes IS NULL) AND (contacted_at IS NULL) AND (managed_by_user_id IS NULL)));

CREATE POLICY "championship_reservation_games_select" ON "public"."championship_reservation_games"
  FOR SELECT
  TO PUBLIC
  USING (((EXISTS ( SELECT 1
   FROM public.championships c
  WHERE ((c.id = championship_reservation_games.championship_id) AND (c.owner_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text])))))));

CREATE POLICY "championships_select" ON "public"."championships"
  FOR SELECT
  TO PUBLIC
  USING
    (((owner_user_id = auth.uid()) OR (status = ANY (ARRAY['registration_open'::text, 'registration_closed'::text, 'in_progress'::text, 'completed'::text])) OR (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text])))))));

CREATE POLICY "backoffice_delete_fields" ON "public"."fields"
  FOR DELETE
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "backoffice_insert_fields" ON "public"."fields"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.can_read_backoffice());

CREATE POLICY "backoffice_update_fields" ON "public"."fields"
  FOR UPDATE
  TO "authenticated"
  USING (public.can_read_backoffice())
  WITH CHECK (public.can_read_backoffice());

CREATE POLICY "fields_select_public" ON "public"."fields"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "Hosts can update attendance for their games" ON "public"."game_players"
  FOR UPDATE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.games
  WHERE ((games.id = game_players.game_id) AND (games.host_user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.games
  WHERE ((games.id = game_players.game_id) AND (games.host_user_id = auth.uid())))));

CREATE POLICY "game_players_insert_own_or_invited" ON "public"."game_players"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((((user_id = auth.uid()) AND (payer_id IS NULL)) OR ((payer_id = auth.uid()) AND (reservation_id IN ( SELECT reservations.id
   FROM public.reservations
  WHERE (reservations.user_id = auth.uid()))))));

CREATE POLICY "game_players_insert_policy" ON "public"."game_players"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((payer_id = auth.uid()));

CREATE POLICY "game_players_select_policy" ON "public"."game_players"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "game_players_select_public" ON "public"."game_players"
  FOR SELECT
  TO PUBLIC
  USING (true);

CREATE POLICY "game_players_update_own_or_invited" ON "public"."game_players"
  FOR UPDATE
  TO PUBLIC
  USING (((user_id = auth.uid()) OR (payer_id = auth.uid())));

CREATE POLICY "game_players_update_policy" ON "public"."game_players"
  FOR UPDATE
  TO "authenticated"
  USING ((payer_id = auth.uid()))
  WITH CHECK ((payer_id = auth.uid()));

CREATE POLICY "backoffice_read_slot_reservations" ON "public"."game_slot_reservations"
  FOR SELECT
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "game_slot_reservations_select_own" ON "public"."game_slot_reservations"
  FOR SELECT
  TO "authenticated"
  USING ((reserved_by_user_id = auth.uid()));

CREATE POLICY "backoffice_read_game_waitlist" ON "public"."game_waitlist"
  FOR SELECT
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "waitlist_insert_own" ON "public"."game_waitlist"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "waitlist_select_own" ON "public"."game_waitlist"
  FOR SELECT
  TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "waitlist_update_own" ON "public"."game_waitlist"
  FOR UPDATE
  TO "authenticated"
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "authenticated users insert notifications" ON "public"."notifications"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "users read own notifications" ON "public"."notifications"
  FOR SELECT
  TO PUBLIC
  USING ((recipient_user_id = auth.uid()));

CREATE POLICY "users update own notifications" ON "public"."notifications"
  FOR UPDATE
  TO PUBLIC
  USING ((recipient_user_id = auth.uid()));

CREATE POLICY "orders_select_own" ON "public"."orders"
  FOR SELECT
  TO "authenticated"
  USING ((payer_user_id = auth.uid()));

CREATE POLICY "Anyone can read active promo codes" ON "public"."promo_codes"
  FOR SELECT
  TO PUBLIC
  USING ((active = true));

CREATE POLICY "backoffice_delete_promo_codes" ON "public"."promo_codes"
  FOR DELETE
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "backoffice_insert_promo_codes" ON "public"."promo_codes"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.can_read_backoffice());

CREATE POLICY "backoffice_read_promo_codes" ON "public"."promo_codes"
  FOR SELECT
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "backoffice_update_promo_codes" ON "public"."promo_codes"
  FOR UPDATE
  TO "authenticated"
  USING (public.can_read_backoffice())
  WITH CHECK (public.can_read_backoffice());

CREATE POLICY "rating_insert_own" ON "public"."rating"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "rating_select_backoffice" ON "public"."rating"
  FOR SELECT
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "rating_select_own" ON "public"."rating"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = auth.uid()));

CREATE POLICY "rating_update_own" ON "public"."rating"
  FOR UPDATE
  TO "authenticated"
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Users can update own reservations" ON "public"."reservations"
  FOR UPDATE
  TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "users can insert own reservations" ON "public"."reservations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "users can read own reservations" ON "public"."reservations"
  FOR SELECT
  TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "reservations_insert_own" ON "public"."reservations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((user_id = auth.uid()) OR ((status = 'refund'::text) AND (canceled_by = auth.uid()))));

CREATE POLICY "reservations_select_backoffice" ON "public"."reservations"
  FOR SELECT
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "reservations_select_own" ON "public"."reservations"
  FOR SELECT
  TO PUBLIC
  USING ((user_id = auth.uid()));

CREATE POLICY "reward_transactions_select_own" ON "public"."reward_transactions"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = auth.uid()));

CREATE POLICY "backoffice_delete_user_roles" ON "public"."user_roles"
  FOR DELETE
  TO "authenticated"
  USING (public.can_delete_user_roles());

CREATE POLICY "backoffice_read_user_roles" ON "public"."user_roles"
  FOR SELECT
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "backoffice_update_user_roles" ON "public"."user_roles"
  FOR UPDATE
  TO "authenticated"
  USING (public.can_write_user_roles(ROLE))
  WITH CHECK (public.can_write_user_roles(role));

CREATE POLICY "user_roles_select_own" ON "public"."user_roles"
  FOR SELECT
  TO "authenticated"
  USING ((user_id = auth.uid()));

CREATE POLICY "backoffice_read_users" ON "public"."users"
  FOR SELECT
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "users_select_own" ON "public"."users"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = id));

CREATE POLICY "users_update_own" ON "public"."users"
  FOR UPDATE
  TO PUBLIC
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "venue_manager_requests_insert_own" ON "public"."venue_manager_requests"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK (((user_id = auth.uid()) AND (status = 'pending'::text) AND (admin_notes IS NULL) AND (closed_comment IS NULL) AND (closed_by_user_id IS NULL) AND (closed_at IS NULL)));

CREATE POLICY "Users can read their own venue staff rows" ON "public"."venue_staff"
  FOR SELECT
  TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "Users can update their own venue staff rows" ON "public"."venue_staff"
  FOR UPDATE
  TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "backoffice_delete_venue_staff" ON "public"."venue_staff"
  FOR DELETE
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "venue_staff_insert_backoffice" ON "public"."venue_staff"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text]))))));

CREATE POLICY "venue_staff_resend_backoffice" ON "public"."venue_staff"
  FOR UPDATE
  TO "authenticated"
  USING (((status = 'rejected'::text) AND (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text])))))))
  WITH CHECK (((status = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text])))))));

CREATE POLICY "venue_staff_select_backoffice" ON "public"."venue_staff"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text]))))));

CREATE POLICY "backoffice_delete_venues" ON "public"."venues"
  FOR DELETE
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "backoffice_insert_venues" ON "public"."venues"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.can_read_backoffice());

CREATE POLICY "backoffice_update_venues" ON "public"."venues"
  FOR UPDATE
  TO "authenticated"
  USING (public.can_read_backoffice())
  WITH CHECK (public.can_read_backoffice());

CREATE POLICY "venues_select_public" ON "public"."venues"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "wallet_summary_insert_own" ON "public"."wallet_summary"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "wallet_summary_select_backoffice" ON "public"."wallet_summary"
  FOR SELECT
  TO "authenticated"
  USING (public.can_read_backoffice());

CREATE POLICY "wallet_summary_select_own" ON "public"."wallet_summary"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = user_id));

CREATE POLICY "wallet_summary_update_own" ON "public"."wallet_summary"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = user_id));

CREATE POLICY "avatars_delete_own" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "avatars_insert_own" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "avatars_public_read" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING ((bucket_id = 'avatars'::text));

CREATE POLICY "avatars_update_own" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)))
  WITH CHECK (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "champ_covers_owner_delete" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'championship-covers'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "champ_covers_owner_insert" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'championship-covers'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "champ_covers_public_read" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING ((bucket_id = 'championship-covers'::text));

CREATE POLICY "champ_proofs_admin_select" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'championship-payment-proofs'::text) AND (EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text])))))));

CREATE POLICY "champ_proofs_owner_insert" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'championship-payment-proofs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "champ_proofs_owner_select" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'championship-payment-proofs'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "champ_proofs_staff_insert" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'championship-payment-proofs'::text) AND (EXISTS ( SELECT 1
   FROM public.user_roles
  WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text])))))));

CREATE POLICY "venues_delete_manager" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'venues'::text) AND ((EXISTS ( SELECT 1
   FROM public.venues v
  WHERE (((v.id)::text = (storage.foldername(v.name))[1]) AND (v.manager_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text]))))))));

CREATE POLICY "venues_insert_manager" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'venues'::text) AND ((EXISTS ( SELECT 1
   FROM public.venues v
  WHERE (((v.id)::text = (storage.foldername(v.name))[1]) AND (v.manager_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text]))))))));

CREATE POLICY "venues_public_read" ON "storage"."objects"
  FOR SELECT
  TO PUBLIC
  USING ((bucket_id = 'venues'::text));

CREATE POLICY "venues_update_manager" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'venues'::text) AND ((EXISTS ( SELECT 1
   FROM public.venues v
  WHERE (((v.id)::text = (storage.foldername(v.name))[1]) AND (v.manager_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text]))))))))
  WITH CHECK (((bucket_id = 'venues'::text) AND ((EXISTS ( SELECT 1
   FROM public.venues v
  WHERE (((v.id)::text = (storage.foldername(v.name))[1]) AND (v.manager_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.user_roles ur
  WHERE ((ur.user_id = auth.uid()) AND (ur.role = ANY (ARRAY['algrass_admin'::text, 'algrass_staff'::text]))))))));

COMMENT ON COLUMN "public"."app_settings"."attendance_lead_min" IS 'Minutos antes del inicio desde los que se puede marcar asistencia. Igual para match (game_players.checked_in_at) y rental (games.booker_checked_in_at). No aplica a host_checked_in_at.';

COMMENT ON COLUMN "public"."app_settings"."captain_gold_release_hours" IS 'Lo mismo para un Capitan Gold. Ventana independiente: no se exige que sea menor ni mayor que la del Capitan.';

COMMENT ON COLUMN "public"."app_settings"."captain_release_hours" IS 'Horas antes del inicio en que se liberan los cupos sin usar de un Capitan. Se aplica al CREAR la R1, para calcular su expires_at; las R1 ya existentes conservan el suyo.';

COMMENT ON COLUMN "public"."app_settings"."free_invites_lead_min" IS 'Minutos antes del inicio desde los que el HOST puede invitar gratis a un match. Solo ese flujo: no es la ventana general de operacion del host y no debe abrir ninguna otra accion.';

COMMENT ON COLUMN "public"."app_settings"."maintenance_message" IS 'Frase que se muestra durante el mantenimiento. Es solo el cuerpo: la pantalla pone su propio titulo y su propio cierre. Obligatoria cuando maintenance_mode es true; maximo 500 caracteres.';

COMMENT ON COLUMN "public"."app_settings"."maintenance_mode" IS 'Si AlGrass esta cerrado al publico. false = abierto, que es el default.';

COMMENT ON COLUMN "public"."app_settings"."match_refund_cutoff_hours" IS 'Horas de antelacion por encima de las cuales un jugador que se autocancela de un match recupera el 100%. Por debajo, 0%. No aplica a invitaciones gratuitas ni a cancel_match, que devuelve siempre el 100%.';

COMMENT ON COLUMN "public"."app_settings"."rental_full_refund_cutoff_hours" IS 'Horas de antelacion por encima de las cuales el booker que se autocancela recupera el 100%. No aplica a cancel_rental, que devuelve siempre el 100%.';

COMMENT ON COLUMN "public"."app_settings"."rental_partial_refund_cutoff_hours" IS 'Horas de antelacion por debajo de las cuales el booker que se autocancela no recupera nada. Entre esta y la frontera completa se devuelve rental_partial_refund_percent.';

COMMENT ON COLUMN "public"."app_settings"."rental_partial_refund_percent" IS 'Porcentaje que recupera el booker en el tramo intermedio. El 100% y el 0% de los tramos extremos son estructurales y no se configuran.';

COMMENT ON COLUMN "public"."app_settings"."support_email" IS 'Email de soporte de AlGrass, recortado y en minusculas. NULL = sin canal publicado. Lo escribe set_support_contact.';

COMMENT ON COLUMN "public"."app_settings"."support_whatsapp" IS 'WhatsApp de soporte de AlGrass, solo digitos con prefijo de pais y sin «+», listo para https://wa.me/<numero>. NULL = sin canal publicado. Lo escribe set_support_contact. No es algrass_operational_phone, que es el contacto DENTRO del partido.';

COMMENT ON COLUMN "public"."captain_requests"."management_notes" IS 'Bitacora interna del Back Office mientras la solicitud esta pendiente: contactos, intentos, lo que quedo acordado. No cambia el estado ni concede nada. Distinta de review_note, que es el motivo del rechazo.';

COMMENT ON COLUMN "public"."captain_welcome_emails"."claimed_at" IS 'Cuando un barrido reclamo esta fila. Solo tiene valor mientras status = sending; al terminar vuelve a NULL. Sirve para distinguir una reclamacion en vuelo de una colgada por un proceso que murio a medias.';

COMMENT ON COLUMN "public"."captain_welcome_emails"."status" IS 'pending esperando envio; sending reclamada por un barrido; sent entregada; failed se intento y no se pudo; skipped no debe enviarse (es el estado con el que se sembraron los capitanes que ya existian).';

COMMENT ON COLUMN "public"."captain_welcome_emails"."user_id" IS 'A quien va la bienvenida. UNIQUE: quien ya tiene fila no vuelve a recibirla, aunque se le revoque y se le vuelva a nombrar Capitan.';

COMMENT ON COLUMN "public"."championships"."champion_team_id" IS 'Campeón OFICIAL, seleccionado MANUALMENTE por Host/AlGrass (set_championship_champion). NULL = sin campeón. NO se infiere del resultado de la final.';

COMMENT ON COLUMN "public"."championships"."host_user_id" IS 'Organizador que dirige el campeonato, si no es el que pagó. Referencia LOGICA a users (sin FK, como owner_user_id). NULL = solo hay owner. La asignacion no esta implementada todavia.';

COMMENT ON COLUMN "public"."championships"."public_individual_price" IS 'Campeonato PUBLICO organizado por AlGrass: precio de «Unirme sin equipo» en la App. NULL en privados. Sin relacion con el coste de canchas/arbitro/extras/fee.';

COMMENT ON COLUMN "public"."championships"."public_team_price" IS 'Campeonato PUBLICO organizado por AlGrass: precio de «Crear equipo» en la App. NULL en privados. Sin relacion con el coste de canchas/arbitro/extras/fee.';

COMMENT ON COLUMN "public"."game_players"."counts_reserved_slot" IS 'Indica si este jugador contabiliza dentro de reserved_slots_used de su game_slot_reservation. No representa pertenencia al grupo; la pertenencia vive exclusivamente en game_slot_reservation_id.';

COMMENT ON COLUMN "public"."orders"."terminal_reason_detail" IS 'Nota humana que acompana a terminal_reason (p. ej. por que se rechazo una transferencia). La escribe solo la RPC que resuelve la orden; NULL en las resoluciones que no dejaron comentario.';

COMMENT ON COLUMN "public"."reservations"."order_id" IS 'Proveniencia: Order que materializó este asiento. Solo trazabilidad/correlación; NO es idempotencia y el dominio NUNCA lo lee para decidir estado. NULL en el camino interno.';

COMMENT ON COLUMN "public"."reservations"."refund_scope" IS 'Solo en filas status=refund de campeonatos: que concepto se devolvio. {key,kind,code,game_id,quantity,order_id,by}. `key` es unico en todo el sistema (indice unico parcial) y es lo que impide devolver dos veces el mismo concepto. NULL en Match, Rental y en todo lo anterior.';

COMMENT ON COLUMN "public"."reward_transactions"."reason" IS 'Motivo escrito por el administrador al otorgar una recompensa manual. NULL en las automaticas por referido y en las manuales anteriores a esta columna. Lo rellena grant_manual_reward, nunca el cliente.';

COMMENT ON COLUMN "public"."users"."confirmed_email" IS 'Último correo confirmado visualmente por el usuario. Si no coincide con users.email, la aplicación volverá a solicitar la confirmación del correo.';

COMMENT ON COLUMN "public"."welcome_emails"."attempts" IS 'Intentos gastados. Se incrementa AL RECLAMAR, no al fallar, para que una fila que cuelgue tambien consuma intentos y no se reintente sin fin.';

COMMENT ON COLUMN "public"."welcome_emails"."claimed_at" IS 'Cuando la reclamo un barrido. Sirve para recuperar las que se quedaron a medias: ver requeue_stuck_welcome_emails.';

COMMENT ON COLUMN "public"."welcome_emails"."status" IS 'pending esperando envio; sending reclamada por un barrido; sent entregada; failed se intento y no se pudo, se reintenta sola; skipped no debe enviarse (no la pone nadie automaticamente, es el freno de mano manual).';

COMMENT ON COLUMN "public"."welcome_emails"."user_id" IS 'A quien va la bienvenida. Es auth.users.id, guardado tal cual SIN clave ajena: en OAuth esta fila puede existir antes que public.users, y una FK ahi seria justo la carrera que se quiere evitar. UNIQUE: quien ya tiene fila no vuelve a recibirla, cambie de correo las veces que cambie.';

COMMENT ON EXTENSION "btree_gist" IS 'support for indexing common datatypes in GiST';

COMMENT ON EXTENSION "pg_cron" IS 'Job scheduler for PostgreSQL';

COMMENT ON EXTENSION "pg_net" IS 'Async HTTP';

COMMENT ON EXTENSION "unaccent" IS 'text search dictionary that removes accents';

COMMENT ON FUNCTION "public"."_add_championship_courts_b2b"(uuid, uuid[], text, numeric) IS 'Back Office: agrega canchas rental publicadas a un campeonato y registra su cobro, todo o nada. Reclama con _championship_claim_games ANTES de tocar el saldo. Un order confirmed + un spend por cancha, con total/subtotal = BRUTO de esa cancha. El credito del lote viaja en p_credit_applied (0 por defecto, acotado a [0, bruto]), se descuenta UNA vez con spend_wallet_credit del pagador autoritativo (_championship_payer) y se reparte entre las canchas en orden, min(resto, precio); cada snapshot guarda su credit_applied y external_amount y trg_championship_spend_wallet contabiliza solo lo externo. Medio: `credit` en la cancha cubierta del todo por saldo; el manual (yape_direct/transfer), obligatorio si queda parte externa. Con credito 0, el comportamiento de siempre. Solo algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."_admin_cancel_championship_b2b"(uuid, text, text, text, text[], uuid[], numeric, boolean) IS 'Back Office: cancela un campeonato entero, canchas sueltas o extras completos. Reutiliza el mismo nucleo que la cancelacion del organizador. Motivo interno obligatorio en todo alcance. El importe de una cancha del bloque inicial lo fija el operador y el backend lo acota entre un centimo y lo que quede sin devolver de ese asiento. El credito va siempre al pagador original. Bloqueado con fixture generado y en registration_closed/in_progress/completed. Solo algrass_admin: algrass_staff NO puede cancelar.';

COMMENT ON FUNCTION "public"."_admin_championship_extras_b2b"(uuid, jsonb, boolean, text, text, numeric) IS 'Back Office: compra POSTERIOR de extras de un campeonato, con credito opcional del pagador. Dos modos: p_confirm=false tarifa y devuelve el desglose mas payer_user_id autoritativo y su credit_balance -nunca reward_balance-, sin escribir nada; p_confirm=true cobra. El precio sale SOLO de _championship_price_lines, el mismo helper que la compra inicial, asi que lo que se enseña es lo que se cobra. El credito a aplicar viaja en p_credit_applied (0 por defecto, acotado a [0, bruto]) y se descuenta con spend_wallet_credit; el snapshot guarda credit_applied y external_amount, de donde los lee trg_championship_spend_wallet para contabilizar en el wallet SOLO la parte externa. Con credito 0 el comportamiento es el de siempre. Si el credito cubre el total, el medio apuntado es `credit` y no hay deposito que certificar; si queda parte externa, el medio manual sigue siendo obligatorio. La compra nace CONFIRMADA en los tres casos -el operador certifica un deposito ya recibido-, con su asiento en la misma transaccion: no hay pending, ni validation, ni caducidad, ni rechazo. reservations.total_amount es el BRUTO contratado, asi que los topes de reembolso no cambian. Idempotente por (payer, champ_extras:<champ>:<key>): un reintento devuelve la compra existente sin descontar credito otra vez. Solo algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."_admin_create_championship_b2b"(uuid, uuid[], integer, jsonb, jsonb) IS 'Back Office: crea un campeonato a nombre de otro usuario con seleccion LIBRE de canchas (cualquier sede, fecha y cantidad de horas) y, si se piden, arbitro y extras en la MISMA compra inicial. p_max_teams es solo la capacidad. p_items son las lineas de extras, con el mismo contrato que admin_championship_extras. El precio lo calcula _championship_admin_price, el mismo que cotiza la pantalla, y su desglose entero se congela en financial_snapshot. El credito a aplicar viaja en p_config.credit_applied (0 por defecto) y se descuenta con spend_wallet_credit; el snapshot guarda credit_applied y external_amount. Con credito 0 el comportamiento es el de siempre: UN order en validation, el campeonato en payment_validation con payment_method NULL y SIN asiento, porque el spend nace al confirmar via approve_championship_transfer. Si el credito cubre el total, el order nace confirmed y el asiento se escribe aqui. OJO: validation NO caduca (ni TTL ni cron), asi que el credito de un pago mixto queda retenido hasta que alguien apruebe o rechace. reservations.total_amount es el BRUTO contratado, asi que los topes de reembolso no cambian. Reclama las canchas con _championship_claim_games, el mismo helper que add_championship_courts. Solo algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."_championship_admin_price"(uuid[], jsonb) IS 'INTERNA: que cuesta una compra inicial de campeonato. Canchas = suma de games.price_total; arbitro y extras = _championship_price_lines (la MISMA formula que cobra una compra posterior); fee = horas-cancha REALES x la tarifa de championship_settings de la ciudad. El arbitro es OPCIONAL: solo se cobra si viene una linea {code:referee, quantity:horas}. Solo lectura, stable. La usan admin_quote_championship para enseñar el desglose y admin_create_championship para cobrarlo: el mismo calculo, para que el resumen no pueda diferir del cobro.';

COMMENT ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb) IS 'INTERNA: aborta con CHAMPIONSHIP_AVAILABILITY_BLOCKED si ALGUNO de los games elegidos solapa con ALGUN bloqueo operativo de la ciudad. Rango semiabierto sobre instantes anclados a America/Lima, asi que admite franjas de un dia, rangos de varios dias y bloqueos que cruzan la medianoche. Entiende los dos formatos via _championship_block_normalize. Fail-safe: columna rota, bloqueo malformado o game sin fecha/hora → CHAMPIONSHIP_CONFIG_UNAVAILABLE; nunca se da por supuesto que no hay bloqueos.';

COMMENT ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb, date) IS 'INTERNA, COMPATIBILIDAD: la firma que llama _championship_compute_price del App. En transaccion READ ONLY (la cotizacion STABLE del App via PostgREST) valida los bloqueos recibidos SIN tomar locks, para no abortar el quote con «cannot execute SELECT FOR SHARE in a read-only transaction». En READ WRITE (el hold autoritativo, bajo el lock de los games) relee los bloqueos VIGENTES de la ciudad con for share —cerrando la carrera contra add/remove_championship_block— y delega en la version de dos argumentos. p_event_date se ignora. Volatile a proposito: la select con lock del camino read-write no se puede ejecutar en una funcion stable.';

COMMENT ON FUNCTION "public"."_championship_block_normalize"(jsonb) IS 'INTERNA: traduce un bloqueo de disponibilidad —formato viejo {date,all_day} / {date,from,to} o nuevo {id,starts_at,ends_at,...}— a un rango semiabierto [starts_at, ends_at) en UTC, mas su version en hora de Lima para pintar. Es la UNICA interpretacion del formato: la usan el validador y las lecturas. BAD_BLOCK si esta mal formado; quien llama decide (el validador lo convierte en CHAMPIONSHIP_CONFIG_UNAVAILABLE).';

COMMENT ON FUNCTION "public"."_championship_cancel_core"(uuid, text, text[], uuid[], numeric, text, uuid, boolean, text) IS 'INTERNA: la mecanica de cancelar un campeonato, compartida por owner y Admin. scope full/extras/courts. Toma la lock key del campeonato, comprueba fixture y equipos, escribe los reembolsos por _championship_refund_one y libera canchas por _championship_release_courts. No recalcula precios, no reescribe orders y no actualiza ninguna fila del libro. Los permisos los comprueba quien la llama.';

COMMENT ON FUNCTION "public"."_championship_claim_games"(uuid, uuid[]) IS 'INTERNA: reclama N bloques rental publicados para un campeonato (published -> reserved + championship_id + enlace), bajo un unico lock ordenado de elegidos + gemelos y revalidando todos antes de escribir. No sabe nada de dinero: quien llama decide como se cobra. La usan add_championship_courts y admin_create_championship.';

COMMENT ON FUNCTION "public"."_championship_concepts"(uuid) IS 'INTERNA: los conceptos cobrados de un campeonato, derivados de sus asientos spend y de los financial_snapshot congelados de sus orders. Un concepto por cancha suelta, por bloque de canchas inicial, por linea de extra, por el arbitro del App y por el fee. No recalcula precios. settled_by dice como se saldo: self (su propia cancelacion, por key) o full (la cancelacion completa del asiento, que escribe UNA fila por spend y no una por concepto).';

COMMENT ON FUNCTION "public"."_championship_eligible_teams"(uuid) IS 'Equipos que compiten: TODOS los reales del campeonato, tengan jugadores o no. El fixture no depende de championship_players. Unica definicion: la usan el generador, el selector manual, el guardado manual y FIXTURE_STALE.';

COMMENT ON FUNCTION "public"."_championship_fixture_template"(integer) IS 'Catalogo de plantillas de fixture (2-16 equipos). Generado por scripts/fixtures/build-catalog.mjs desde Docs/campeonatos-formatos.xlsx; 2 y 3 son extension de producto. Minutos RELATIVOS al inicio de la ventana reservada; letras de sorteo sin resolver. span_min = fin del ultimo partido, NO la ventana contratada.';

COMMENT ON FUNCTION "public"."_championship_is_algrass_public"(uuid) IS 'INTERNA: true si el campeonato es PUBLICO organizado por AlGrass (sin order y con precio publico). Decide si las RPC de Admin toman la ruta operativa, sin dinero, o la B2B de siempre.';

COMMENT ON FUNCTION "public"."_championship_match_played"(uuid) IS 'TRUE si un partido tiene CUALQUIER dato competitivo: marcador en cualquiera de los dos lados, clasificado o goleadores. Interna: define «ya jugado» para las RPC de Back Office que corren como owner. Unica definicion: la usan save_championship_fixture y delete_championship_fixture.';

COMMENT ON FUNCTION "public"."_championship_payer"(uuid) IS 'INTERNA: pagador autoritativo de un campeonato (payer del order original, si no el del primer spend, si no el owner). La usan add_championship_courts y admin_championship_payer_credit.';

COMMENT ON FUNCTION "public"."_championship_price_lines"(text, jsonb) IS 'INTERNA: tarifa las lineas de extras de una ciudad y devuelve {lines, amount}. Arbitro por referee_hourly_rate x horas; extras del catalogo de championship_settings por unit_price x cantidad, con sus limites; `other` con descripcion obligatoria y precio libre, repetible. Es la UNICA copia de esta formula: la usan admin_championship_extras (compra posterior) y _championship_admin_price (compra inicial), para que las dos cobren lo mismo. Una lista vacia vale cero y no es un error: decidir si un cero sirve es de quien cobra.';

COMMENT ON FUNCTION "public"."_championship_refund_one"(uuid, uuid, numeric, jsonb, uuid) IS 'INTERNA: escribe UN reembolso de campeonato en reservations (status=refund, refund_of_reservation_id al spend, refund_scope con la identidad del concepto) y acredita el wallet del pagador con apply_wallet_refund. Comprueba el techo del asiento. Append-only: no actualiza ni borra nada. La unicidad de refund_scope->>key impide el doble reembolso.';

COMMENT ON FUNCTION "public"."_championship_release_courts"(uuid, uuid[]) IS 'INTERNA: devuelve canchas de un campeonato al inventario (reserved -> published, championship_id NULL, vinculos borrados), que es lo que dispara trg_reopen_double_out_twin para la doble salida. Mismo movimiento que reject_championship_transfer. Aborta entero si alguna no sigue siendo del campeonato y reservada. p_game_ids NULL = todas.';

COMMENT ON FUNCTION "public"."_championship_team_roster"(uuid, uuid) IS 'Plantilla actual de un equipo del campeonato. Interna: la usan las RPC de Back Office que corren como owner.';

COMMENT ON FUNCTION "public"."_eligible_championship_hosts"() IS 'Ids que pueden ser host de un campeonato: venue_staff aceptado, host por defecto de una cancha, o personal AlGrass. Unica definicion de la regla; la usan list_eligible_championship_hosts y set_championship_host.';

COMMENT ON FUNCTION "public"."_is_algrass_admin"(uuid) IS 'TRUE si el usuario tiene rol algrass_admin. NO incluye algrass_staff, a diferencia de _is_algrass_staff: para operaciones que solo un admin puede hacer.';

COMMENT ON FUNCTION "public"."add_championship_block"(text, timestamp with time zone, timestamp with time zone, text) IS 'Back Office: añade un bloqueo operativo de campeonatos a una ciudad. Rango semiabierto [starts_at, ends_at): admite una franja del dia, varios dias y cruzar la medianoche. N por ciudad, pueden solaparse, sin maximo. El motivo es obligatorio e INTERNO: la App nunca lo lee. No cancela ni altera nada ya contratado. Solo algrass_admin.';

COMMENT ON FUNCTION "public"."add_championship_court"(uuid, uuid) IS 'Back Office: agrega UN bloque rental publicado al inventario fisico de un campeonato, cobrandolo. Envoltorio de add_championship_courts con un solo elemento: no tiene logica propia. Devuelve game_id, order_id, amount, payer_user_id, twin_game_id y championship_id.';

COMMENT ON FUNCTION "public"."add_championship_court"(uuid, uuid, text) IS 'Back Office: agrega UN bloque rental publicado al inventario fisico de un campeonato, cobrandolo con el medio indicado (yape_direct o transfer). Envoltorio de add_championship_courts(uuid, uuid[], text): sin logica propia. SOBRECARGA ADITIVA: la firma (uuid, uuid) sigue existiendo, intacta.';

COMMENT ON FUNCTION "public"."add_championship_courts"(uuid, uuid[]) IS 'Back Office: agrega VARIOS bloques rental publicados al inventario fisico de un campeonato, cobrandolos. algrass_admin o algrass_staff. TODO O NADA: valida el lote entero bajo un unico lock ordenado (elegidos + gemelos) antes de escribir; si un bloque falla no entra ninguno. Un game = un order confirmed = un spend. Los errores de disponibilidad terminan en :<game_id>.';

COMMENT ON FUNCTION "public"."add_championship_courts"(uuid, uuid[], text, numeric) IS 'Back Office: agrega canchas a un campeonato. Privado: delega SIN CAMBIOS en _add_championship_courts_b2b (order + spend por cancha, credito opcional). Publico de AlGrass: solo _championship_claim_games -published -> reserved, championship_id, enlace y gemelo de doble salida sellado por su trigger-, sin order, sin reservations, sin wallet. Solo algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."admin_attach_championship_voucher"(uuid, text) IS 'Back Office: devuelve el path del comprobante de un cobro manual de campeonato -cancha añadida, extras o la compra INICIAL creada desde el Back Office- y lo apunta SOLO si el archivo ya esta subido a Storage. Admite N comprobantes por compra, uno por nombre de archivo, en financial_snapshot.vouchers; el mismo path dos veces no duplica nada. El path es {payer_user_id}/{championship_id}/{order_id}/{filename}, compuesto del propio order: nunca depende de auth.uid(), que solo se usa para el rol. La compra INICIAL se puede documentar en validation y en confirmed -adjuntar NO aprueba el pago ni crea asientos-; las posteriores exigen confirmed, que es como nacen. El PRIMER comprobante de la inicial se copia a championships.payment_voucher_ref, la misma columna que escribe el App, y no se pisa nunca. Un campeonato creado en el App no entra: su snapshot no lleva source. Sin importes ni saldos: son comprobantes documentales.';

COMMENT ON FUNCTION "public"."admin_cancel_championship"(uuid, text, text, text, text[], uuid[], numeric, boolean) IS 'Back Office: cancela un campeonato, canchas sueltas o extras. Privado: delega SIN CAMBIOS en _admin_cancel_championship_b2b en todos los alcances. Publico de AlGrass: full -> si queda algo por devolver de inscripciones pagadas, delega en _admin_cancel_championship_b2b (nucleo: reembolsa cada spend al pagador de su order, bruto = subtotal_amount menos lo ya devuelto, libera canchas y cancela) y añade la auditoria; si no, mismas comprobaciones de fixture y equipos que el nucleo, libera TODAS las canchas con _championship_release_courts (gemelos reabiertos por su trigger), status=canceled, extras conservados como historico y auditoria en format_config.cancellation (origin, reason, canceled_by, canceled_at, team_count, released_game_ids); courts -> libera esas canchas tras las comprobaciones del nucleo; extras -> quita esos codigos de format_config.extras. Fuera de los reembolsos del nucleo, sin reservations ni wallet. Motivo obligatorio. Solo algrass_admin.';

COMMENT ON FUNCTION "public"."admin_championship_extras"(uuid, jsonb, boolean, text, text, numeric) IS 'Back Office: extras de un campeonato. Cotizar (p_confirm=false) y todo lo privado: delega SIN CAMBIOS en _admin_championship_extras_b2b. Publico de AlGrass con p_confirm=true: tarifa con _championship_price_lines y AÑADE las lineas a format_config.extras como configuracion interna, idempotente por clave; sin order, sin reservations, sin wallet, sin credito. Solo algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."admin_championship_payer_credit"(uuid) IS 'Back Office: solo lectura. Devuelve el pagador autoritativo de un campeonato y su credit_balance (nunca reward_balance), para ofrecer el credito al agregar canchas. Es una FOTO: el cobro vuelve a comprobar el saldo con spend_wallet_credit. Solo algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."admin_confirm_championship_payment"(uuid, text) IS 'Back Office: confirma el pago de un campeonato en payment_validation eligiendo el medio (yape_direct o transfer), y delega el estado final en approve_championship_transfer, que no se modifica. Solo escribe payment_method si estaba NULL: uno creado en el App ya dice como se pago. algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."admin_create_championship"(uuid, uuid[], integer, jsonb, jsonb) IS 'Back Office: crea un campeonato. PRIVADO (p_config.privacy ausente o private): delega SIN CAMBIOS en _admin_create_championship_b2b -owner externo, order, credito, validacion-. PUBLICO (p_config.privacy=public): organizado por AlGrass, owner = auth.uid() (p_owner_user_id se ignora), exige p_config.public_individual_price y public_team_price >= 0 y los guarda en sus columnas, nace en pending_publish, reclama las canchas con _championship_claim_games y guarda los extras tarifados en format_config.extras como coste interno. Sin order, sin reservations, sin spend, sin wallet, sin credito. Solo algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."admin_get_user_rewards"(uuid) IS 'Saldo de recompensas y ultimos 100 movimientos de UN usuario, para el Back Office. Solo algrass_admin. Existe para no tener que abrir reward_transactions con una policy de lectura general: la tabla sigue con reward_transactions_select_own como unica policy. Solo lee.';

COMMENT ON FUNCTION "public"."admin_list_rewards"(uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) IS 'Libro mayor de recompensas otorgadas para el Back Office. Lectura para algrass_admin y algrass_staff; otorgar sigue siendo exclusivo de algrass_admin en grant_manual_reward(). Devuelve la pagina pedida, el total de filas y los tres importes acumulados (total, automaticas, manuales) calculados SOBRE LOS MISMOS FILTROS, no sobre la pagina. Solo grant_referral y grant_manual: spend nunca entra. Resuelve los nombres del receptor, del jugador que origino la recompensa automatica y del administrador que otorgo la manual. Existe para no abrir reward_transactions con una policy de lectura general. Solo lee.';

COMMENT ON FUNCTION "public"."admin_move_championship_player"(uuid, uuid, uuid) IS 'Back Office: mueve a un jugador inscrito de equipo, o lo deja sin equipo (p_team_id null). Solo AlGrass. Permitido en pending_publish, registration_open, registration_closed e in_progress (PRE-LIVE y EN VIVO); NO en completed ni canceled. Que exista calendario no congela el roster. Solo escribe championship_players.team_id: no toca la inscripcion, ni joined_at, ni el fixture, ni los resultados.';

COMMENT ON FUNCTION "public"."admin_quote_championship"(uuid[], jsonb) IS 'Back Office: que costaria crear un campeonato con estas canchas y estos extras, sin crear nada. Delega en _championship_admin_price, la MISMA funcion que cobra al crear, asi que el desglose que se enseña no puede diferir del importe que acaba en el order. Solo lectura: no reserva ni aparta nada. Requiere rol algrass porque devuelve tarifas.';

COMMENT ON FUNCTION "public"."admin_set_championship_registration_close"(uuid, timestamp with time zone) IS 'Back Office: fija o quita la fecha PREVISTA de cierre de inscripciones de un campeonato (championships.registration_closes_at). Informativa: no cierra inscripciones ni cambia el estado; el cierre efectivo lo hace set_championship_status. No crea order, asiento ni reembolso, y no toca canchas, fixture, resultados ni championship_settings. Fuera de completed y canceled. algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."algrass_cancel_free_invite"(uuid) IS 'Cancela una invitacion gratuita de un match desde el Back Office. Solo algrass_admin y algrass_staff -sin exigir que sean quienes invitaron-, y solo antes del inicio (hora de Lima). Reconoce la invitacion cruzando game_players.reservation_id con reservations.source in (organizer_invite, algrass_invite); nunca por el importe. Tras el claim confirmed->canceled deja el asiento de la baja: una reservation status=refund, reservation_type=invited y economia cero, con invited_by_user_id el original y canceled_by quien cancela; no mueve dinero y no cambia game_players.reservation_id, que sigue apuntando al spend. Si el jugador tenia cupos reservados a su nombre en ese partido, los libera con release_slot_reservation(id, admin) - nunca por game_slot_reservation_id, que puede ser de otra persona. No borra y no escribe en game_slot_reservations. Avisa al jugador retirado con la notificacion de cancelacion de invitacion de la App.';

COMMENT ON FUNCTION "public"."approve_captain_request"(uuid, text) IS 'Aprueba una solicitud de capitan desde el Back Office: concede el rol efectivo en user_roles y cierra la solicitud como approved, atomicamente. Solo algrass_admin y algrass_staff (is_platform_admin_or_staff). Bloquea la fila con FOR UPDATE, exige pending_review, prohibe autoaprobarse y falla con ALREADY_CAPTAIN si la persona ya es capitan: este flujo no asciende ni degrada.';

COMMENT ON FUNCTION "public"."can_delete_user_roles"() IS 'TRUE si el usuario autenticado puede retirar una asignación de rol. Solo algrass_admin. Exclusiva de public.user_roles. SECURITY DEFINER para usarse dentro de sus policies sin recursión.';

COMMENT ON FUNCTION "public"."can_manage_venue_manager_requests"() IS 'TRUE si el usuario autenticado puede leer y gestionar las solicitudes de Venue Manager. Solo algrass_admin y algrass_staff. Exclusiva de public.venue_manager_requests.';

COMMENT ON FUNCTION "public"."can_read_backoffice"() IS 'TRUE si el usuario autenticado tiene rol algrass_admin o algrass_staff en public.user_roles. Única función de permiso de lectura del Back Office. SECURITY DEFINER para poder usarse dentro de las policies de user_roles sin recursión.';

COMMENT ON FUNCTION "public"."can_write_app_settings"() IS 'TRUE si el usuario autenticado puede cambiar la configuracion global. Solo algrass_admin: un algrass_staff la lee pero no la toca. Exclusiva de public.app_settings. SECURITY DEFINER para poder leer user_roles desde dentro de las RPC.';

COMMENT ON FUNCTION "public"."can_write_user_roles"(text) IS 'TRUE si el usuario autenticado puede crear o modificar una asignación del rol indicado. algrass_admin puede con los cuatro; algrass_staff solo con captain y captain_gold. Exclusiva de public.user_roles: no reutilizar para otras tablas. SECURITY DEFINER para poder usarse dentro de las policies de user_roles sin recursión.';

COMMENT ON FUNCTION "public"."cancel_championship_contract"(uuid, text, text[], boolean, text) IS 'El organizador cancela su contratacion de campeonato. Solo su propio campeonato y solo en pending_publish. scope full (todo lo que quede por devolver, libera canchas y deja el campeonato canceled) o extras (los codes completos). Devolucion del 100% en credito de wallet al pagador del order. No puede cancelar canchas sueltas ni cantidades parciales.';

COMMENT ON FUNCTION "public"."captain_welcome_enqueue"() IS 'Trigger de public.user_roles: cuando alguien SE CONVIERTE en captain o captain_gold, deja una fila en captain_welcome_emails. En UPDATE solo cuenta si antes no era ninguno de los dos, asi que captain <-> captain_gold no encola. SECURITY DEFINER porque quien concede el rol es authenticated y no tiene permisos sobre la cola. Nunca puede hacer fallar la concesion del rol: cualquier error se traga con un WARNING. No envia nada.';

COMMENT ON FUNCTION "public"."claim_captain_welcome_email"(uuid, integer) IS 'Reclama una fila de la cola de bienvenida: la pasa a sending, le pone claimed_at = now() e incrementa attempts, todo en una sentencia. Devuelve la fila si la reclamo y nada si otro barrido se adelanto o si ya agoto los intentos. No puede tocar filas sent ni skipped.';

COMMENT ON FUNCTION "public"."claim_welcome_email"(uuid, integer) IS 'Reclama una fila de la cola de bienvenida general: la pasa a sending, le pone claimed_at = now() e incrementa attempts, todo en una sentencia. Devuelve la fila si la reclamo y nada si otro barrido se adelanto o si ya agoto los intentos. No puede tocar filas sent ni skipped. Independiente de claim_captain_welcome_email.';

COMMENT ON FUNCTION "public"."close_venue_manager_request"(uuid, text) IS 'Cierra una solicitud de Venue Manager: fija status=closed, closed_comment, closed_at=now() y closed_by_user_id=auth.uid() en una sola sentencia. El comentario es OBLIGATORIO. Solo algrass_admin y algrass_staff. Terminal: una solicitud ya cerrada se rechaza con REQUEST_CLOSED.';

COMMENT ON FUNCTION "public"."delete_championship_fixture"(uuid) IS 'Back Office: borra los partidos de un campeonato. Solo algrass_admin y solo en registration_closed. Se niega entera si hay marcador, clasificado o goles (FIXTURE_HAS_RESULTS). No toca equipos, inscritos, reservas, games, estado ni pagos.';

COMMENT ON FUNCTION "public"."generate_championship_fixture"(uuid, boolean) IS 'Back Office: genera (o reemplaza con p_replace) el fixture de un campeonato en registration_closed. Solo algrass_admin/algrass_staff. Plantilla por numero REAL de equipos; horarios y canchas solo desde championship_reservation_games. Se niega a reemplazar si hay marcadores, clasificados o goles.';

COMMENT ON FUNCTION "public"."get_admin_championship"(uuid) IS 'Back Office: el detalle de un campeonato. Resuelve el host por left join a users_public, la capacidad con _championship_team_capacity y el desenlace del order. Devuelve orders.financial_snapshot —el desglose del cobro inicial—, extras_purchases —las compras de extras posteriores con su detalle— y payment_vouchers —cada cobro manual posterior, canchas y extras, con su comprobante—. Solo lectura, y solo para admin/staff.';

COMMENT ON FUNCTION "public"."get_admin_championship_fixture"(uuid) IS 'Back Office: estado editable del calendario (partidos con game_id y updated_at, bloques contratados y equipos elegibles). Solo lectura.';

COMMENT ON FUNCTION "public"."get_admin_championship_match"(uuid) IS 'Back Office: un partido con su cruce, sitio, horario, marcador, goles y las plantillas de los dos equipos. Solo lectura.';

COMMENT ON FUNCTION "public"."get_admin_championship_reservations"(uuid) IS 'Back Office: bloques de cancha contratados por un campeonato (inventario fisico, no partidos). Solo algrass_admin/algrass_staff. Solo lectura, sin datos personales.';

COMMENT ON FUNCTION "public"."get_championship_config"(text) IS 'App: la configuracion de campeonatos de una ciudad activa para construir la pantalla. NO es autoridad de precio. Los bloqueos salen reducidos a las claves con las que se filtra disponibilidad —{starts_at,ends_at} o {date,all_day,from,to}—: el motivo interno, quien lo puso y cuando NO se exponen.';

COMMENT ON FUNCTION "public"."get_championship_payment_detail"(uuid) IS 'Detalles del pago de un campeonato: conceptos originales congelados, que se devolvio de cada uno, movimientos de reembolso, total pagado, devuelto y saldo. El owner solo ve su campeonato; el staff de AlGrass, cualquiera. Nadie mas. Solo lectura.';

COMMENT ON FUNCTION "public"."get_championship_settings_admin"(text) IS 'Back Office: la fila COMPLETA de championship_settings de una ciudad, extras apagados incluidos, para poder editarla. Incluye las ciudades inactivas a proposito: son las que hay que mirar para activarlas. Solo lectura. algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."get_maintenance_status"() IS 'Estado publico del modo mantenimiento. Devuelve UNICAMENTE maintenance_mode y maintenance_message. Ejecutable sin sesion, porque la pantalla de mantenimiento tiene que poder decidirse antes de que haya usuario.';

COMMENT ON FUNCTION "public"."grant_manual_reward"(uuid, numeric, text, text) IS 'Otorga una recompensa manual a un usuario. Solo algrass_admin. Valida destinatario vivo, importe entre 0 y 500, motivo obligatorio de hasta 200 caracteres y clave de idempotencia obligatoria. Delega el abono en grant_reward, que sigue siendo el unico punto que mueve reward_balance, y solo despues escribe el motivo sobre el asiento creado, en la misma transaccion. Repetir la misma clave con los mismos datos devuelve el asiento y el saldo existentes sin reacreditar; con datos distintos falla con IDEMPOTENCY_CONFLICT.';

COMMENT ON FUNCTION "public"."init_championship_settings"(text, text) IS 'Back Office: crea la configuracion de campeonatos de una ciudad nueva. Nace INACTIVA y con las dos tarifas a cero, asi que no puede vender: los dos pricings abortan con CHAMPIONSHIP_CONFIG_UNAVAILABLE mientras active sea false. Con p_copy_from hereda la estructura operativa de otra ciudad y su catalogo de extras APAGADO; los precios no se heredan como definitivos. Exige que la ciudad tenga venues. Solo algrass_admin.';

COMMENT ON FUNCTION "public"."list_admin_available_rentals"() IS 'Back Office: bloques rental publicados y libres, para agregar a un campeonato. algrass_admin o algrass_staff. No filtra por venue: un campeonato puede ocupar varios complejos. Es una foto: la disponibilidad se decide al confirmar, bajo lock.';

COMMENT ON FUNCTION "public"."list_championship_blocks"(text) IS 'Back Office: los bloqueos operativos de una ciudad, con su rango en UTC y en hora de Lima y su motivo interno. Normaliza los dos formatos y marca `malformed` el bloqueo que el validador no sabria leer. Solo lectura. algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."list_championship_settings_admin"() IS 'Back Office: que ciudades tienen configuracion de campeonatos y cuales estan habilitadas sin ella. «Habilitada» = tiene al menos un venue, la misma derivacion de ciudad que usa el pricing. Solo lectura. algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."list_championship_team_formats"() IS 'Los tramos de equipos contratables, derivados del MISMO _championship_team_capacity que decide la capacidad: no es un segundo catalogo. Solo lectura.';

COMMENT ON FUNCTION "public"."list_eligible_championship_hosts"() IS 'Back Office: candidatos a host de campeonato. Solo algrass_admin/algrass_staff. Sin datos privados.';

COMMENT ON FUNCTION "public"."list_venue_manager_requests"() IS 'Lista las solicitudes de Venue Manager para el Back Office, mas recientes primero, con el nombre de quien cerro resuelto desde users_public. Solo algrass_admin y algrass_staff. Es la unica via de lectura: la tabla sigue sin SELECT para authenticated.';

COMMENT ON FUNCTION "public"."mark_venue_manager_request_contacted"(uuid) IS 'Pasa una solicitud de Venue Manager de pending a contacted. Solo algrass_admin y algrass_staff. Bloquea la fila con FOR UPDATE. No toca notas ni campos de cierre, y no reabre nada.';

COMMENT ON FUNCTION "public"."prevent_venue_staff_delete_while_hosting"() IS 'Trigger de venue_staff: impide el DELETE mientras esa persona siga siendo host de un partido published o reserved del mismo complejo, o host por defecto de alguna de sus canchas. No reasigna ni limpia nada.';

COMMENT ON FUNCTION "public"."reject_captain_request"(uuid, text) IS 'Rechaza una solicitud de capitan desde el Back Office. No toca user_roles. Solo algrass_admin y algrass_staff. Bloquea la fila con FOR UPDATE y exige pending_review. El motivo es OBLIGATORIO y se guarda en review_note junto a reviewed_at y reviewed_by_user_id. No borra los comentarios de gestion: quedan como parte del historial.';

COMMENT ON FUNCTION "public"."remove_championship_block"(text, uuid) IS 'Back Office: quita un bloqueo operativo por su id. Solo algrass_admin.';

COMMENT ON FUNCTION "public"."requeue_stuck_captain_welcome_emails"(interval) IS 'Devuelve a la cola las reclamaciones colgadas: filas en sending cuyo claimed_at es mas viejo que el timeout (15 minutos por defecto). Las deja en failed, para que el barrido las reintente sin regalarles un intento. Nunca toca sent ni skipped. Devuelve cuantas recupero.';

COMMENT ON FUNCTION "public"."requeue_stuck_welcome_emails"(interval) IS 'Devuelve a la cola las reclamaciones colgadas de la bienvenida general: filas en sending cuyo claimed_at es mas viejo que el timeout (15 minutos por defecto). Las deja en failed, para que el barrido las reintente sin regalarles un intento. Nunca toca sent ni skipped. Devuelve cuantas recupero. Independiente de requeue_stuck_captain_welcome_emails.';

COMMENT ON FUNCTION "public"."save_championship_fixture"(uuid, jsonb) IS 'Back Office: guarda el ESTADO FINAL del calendario en una sola transaccion. Elemento con id = update, sin id = insert, partido ausente = delete (bloqueado si ya se jugo). Solo algrass_admin/algrass_staff. Valida TODO antes de escribir y devuelve {ok, errors[], warnings[], saved, inserted, deleted} con codigos. No toca marcadores, goles, fase de campeonato ni inventario de canchas.';

COMMENT ON FUNCTION "public"."save_championship_match_result"(uuid, integer, integer, jsonb, timestamp with time zone) IS 'UNICA RPC de escritura de resultados (marcador + goleadores) en una transaccion. La usan App y Admin. Autoriza con _champ_can_manage_results: host en in_progress, AlGrass en in_progress y completed; owner y player nunca. La suma de goles NO tiene que igualar el marcador. No toca fixture ni qualified_team_id.';

COMMENT ON FUNCTION "public"."set_cancellation_settings"(integer, integer, integer, integer) IS 'Actualiza las fronteras de la politica de cancelacion. Solo algrass_admin. Los tramos del 100 % y del 0 % son estructurales y no se configuran. Devuelve la fila guardada.';

COMMENT ON FUNCTION "public"."set_captain_release_settings"(integer, integer) IS 'Actualiza las ventanas de liberacion de cupos de Capitan y Capitan Gold, en horas. Solo algrass_admin. Son independientes entre si. Se aplicaran al crear nuevas R1; no recalcula ninguna existente. No toca las demas columnas. Devuelve la fila guardada.';

COMMENT ON FUNCTION "public"."set_captain_request_notes"(uuid, text) IS 'Guarda los comentarios de gestion de una solicitud de capitan. Solo algrass_admin y algrass_staff (is_platform_admin_or_staff), y solo mientras la solicitud sigue en pending_review. No cambia el estado, no toca user_roles y no escribe en users. Vacio equivale a borrar la nota.';

COMMENT ON FUNCTION "public"."set_championship_champion"(uuid, uuid) IS 'Define/cambia/limpia (p_team_id null) el campeón OFICIAL (champion_team_id). Autoriza con _champ_can_manage_results: host in_progress; AlGrass in_progress+completed; owner/player nunca. El equipo debe ser del campeonato. Independiente del fixture/final.';

COMMENT ON FUNCTION "public"."set_championship_extras"(text, jsonb) IS 'Back Office: catalogo de extras de una ciudad. Valida forma, codigos unicos, precios y cantidades, y rechaza los codigos reservados del contrato de precios (referee, other). Apagar un extra no borra su precio. No recalcula nada ya contratado. Solo algrass_admin.';

COMMENT ON FUNCTION "public"."set_championship_host"(uuid, uuid) IS 'Back Office: asigna o quita (null) el host de un campeonato. Solo algrass_admin/algrass_staff, y solo sobre usuarios elegibles (_eligible_championship_hosts). Escribe UNICAMENTE championships.host_user_id.';

COMMENT ON FUNCTION "public"."set_championship_match_team"(uuid, text, uuid, timestamp with time zone) IS 'Asigna/cambia el equipo de un lado (home|away) de un partido de la llave. Autoriza con _champ_can_manage_results (host in_progress; AlGrass in_progress+completed; owner/player nunca). Bloquea si el partido ya tiene marcador, goles o qualified_team_id. No mismo equipo en ambos lados; el equipo debe ser del campeonato. No toca marcador/goles/roster/standings/lifecycle.';

COMMENT ON FUNCTION "public"."set_championship_pricing"(text, text, numeric, numeric) IS 'Back Office: moneda y las dos tarifas por hora-cancha de servicio de una ciudad. No recalcula nada ya contratado: el desglose de un campeonato vive congelado en orders.financial_snapshot. Solo toca esas tres columnas mas updated_at. Solo algrass_admin.';

COMMENT ON FUNCTION "public"."set_championship_rules"(text, integer, jsonb, jsonb) IS 'Back Office: reglas de organizacion de una ciudad — dias de cierre previsto de inscripciones, tramos de antelacion minima y perfiles de formato (service_court_hours por grupo). Valida la forma de los dos jsonb y que los tramos no se solapen. No recalcula nada ya contratado. Solo algrass_admin.';

COMMENT ON FUNCTION "public"."set_championship_settings_active"(text, boolean) IS 'Back Office: enciende o apaga la contratacion de campeonatos en una ciudad. Apagar no cancela ni altera nada ya contratado: solo deja de poder venderse ahi. Encender exige al menos un perfil de formato y que los tres jsonb esten bien formados. Solo algrass_admin.';

COMMENT ON FUNCTION "public"."set_championship_team_format"(uuid, integer) IS 'Back Office: cambia el tramo de equipos contratado de un campeonato (format_config.summary.group.min/max), que es lo que fija la capacidad. Sin coste: no crea order, asiento ni reembolso, y no toca canchas, fixture ni formatLabel. Se niega si ya hay mas equipos inscritos que la nueva capacidad (TEAMS_EXCEED_CAPACITY) y en una liga (LEAGUE_HAS_NO_BRACKET). algrass_admin o algrass_staff.';

COMMENT ON FUNCTION "public"."set_game_windows"(integer, integer) IS 'Actualiza en minutos las dos ventanas configurables del partido: invitados gratis y marcar asistencia. Solo algrass_admin. No toca las demas columnas. Devuelve la fila guardada.';

COMMENT ON FUNCTION "public"."set_maintenance_settings"(boolean, text) IS 'Enciende o apaga el modo mantenimiento y fija su mensaje. Solo algrass_admin. Con el modo encendido el mensaje es obligatorio. No toca las demas columnas. Devuelve la fila guardada.';

COMMENT ON FUNCTION "public"."set_organizer_contact"(text, text) IS 'Cambia el contacto dentro del partido. Solo algrass_admin. Normaliza el telefono a digitos (E.164 sin +) y exige uno cuando el modo es algrass. Devuelve la fila guardada.';

COMMENT ON FUNCTION "public"."set_reward_referral_settings"(boolean, numeric, boolean, numeric, boolean, numeric) IS 'Fija cuanto cobra el referidor segun su rol: jugador, capitan y capitan gold, cada uno con su interruptor y su importe. Solo algrass_admin, via can_write_app_settings. Apagar NO borra el importe: los seis campos se escriben siempre. Rechaza importes nulos, negativos o NaN. Solo toca las seis columnas reward_referral_* mas el sello de auditoria. No decide a quien se paga ni cuando: eso es del backend.';

COMMENT ON FUNCTION "public"."set_support_contact"(text, text) IS 'Fija el canal de soporte de AlGrass: WhatsApp y email. Solo algrass_admin, via can_write_app_settings. El telefono se guarda normalizado —solo digitos, sin «+»— con la misma regla que set_organizer_contact, y el email recortado y en minusculas. Los dos son opcionales: en blanco se guardan como NULL, que significa «sin canal publicado». Solo toca support_whatsapp y support_email mas el sello de auditoria.';

COMMENT ON FUNCTION "public"."set_venue_manager_request_notes"(uuid, text) IS 'Guarda las notas internas de una solicitud de Venue Manager. Solo algrass_admin y algrass_staff, y solo mientras la solicitud sigue abierta. No cambia el estado. Vacio equivale a borrar la nota. El solicitante nunca las lee: la tabla no tiene SELECT para authenticated.';

COMMENT ON FUNCTION "public"."spend_wallet_credit"(uuid, numeric) IS 'INTERNA: descuenta credito del wallet de un usuario de forma atomica y condicional (credit_balance -= X, reserved_balance += X, conservando total_amount = reserved + credit). Es el inverso exacto de apply_wallet_refund. Sin saldo suficiente lanza INSUFFICIENT_CREDIT y no toca nada. Quien la llama comprueba los permisos.';

COMMENT ON FUNCTION "public"."toggle_championship_live"(uuid, boolean) IS 'Host/AlGrass alterna EN VIVO (live_started_at) dentro de in_progress: p_live true → now(), false → null. Owner puro/jugador NO. Fuera de in_progress → INVALID_PHASE. No cambia status base ni toca roster/fixture/resultados/lifecycle general.';

COMMENT ON FUNCTION "public"."validate_game_host_is_venue_staff"() IS 'Trigger de games: exige que host_user_id sea staff con status=accepted del complejo de la cancha. Permite NULL y, en UPDATE, solo valida si cambia el host o la cancha.';

COMMENT ON FUNCTION "public"."welcome_email_enqueue"() IS 'Trigger de public.users: encola una bienvenida general cuando confirmed_email pasa de NULL a un correo. La condicion entera vive en el WHEN del disparador, que al atender solo UPDATE si puede mirar OLD. Una sola bienvenida por persona: el UNIQUE de welcome_emails mas el ON CONFLICT DO NOTHING lo garantizan aunque confirmed_email volviera a vaciarse y rellenarse. NO atrapa errores: un fallo real de la base debe verse y abortar en vez de confirmar el correo perdiendo el evento para siempre. No envia nada.';

COMMENT ON INDEX "public"."reservations_championship_order_spend_uq" IS 'Un asiento de gasto como maximo por cada order de campeonato. Sustituye a reservations_championship_spend_uq (que limitaba a UNO por campeonato): un campeonato puede tener varias compras -la inicial y cada cancha extra-, pero ninguna compra se cobra dos veces.';

COMMENT ON TABLE "public"."app_settings" IS 'Configuracion global de la plataforma, una sola fila. Hoy solo gobierna el CTA de contacto dentro del partido. Lectura para authenticated; escritura unicamente por set_organizer_contact().';

COMMENT ON TABLE "public"."captain_welcome_emails" IS 'Cola de la bienvenida de Capitan. Una fila por persona y para siempre: el UNIQUE sobre user_id es la idempotencia entera. No se escribe desde el cliente; la llenara un trigger sobre user_roles y la vaciara una Edge Function con service_role.';

COMMENT ON TABLE "public"."welcome_emails" IS 'Cola de la bienvenida general. Una fila por persona y para siempre: el UNIQUE sobre user_id es la idempotencia entera. La llena un disparador sobre auth.users cuando el correo queda confirmado y la vacia la Edge Function send_welcome con service_role. Nace vacia a proposito: nadie confirmado antes del despliegue recibe bienvenida. Independiente de captain_welcome_emails, que no se toca.';

REVOKE ALL ON FUNCTION "public"."_add_championship_courts_b2b"(uuid, uuid[], text, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_add_championship_courts_b2b"(uuid, uuid[], text, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_add_championship_courts_b2b"(uuid, uuid[], text, numeric) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_admin_cancel_championship_b2b"(uuid, text, text, text, text[], uuid[], numeric, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_admin_cancel_championship_b2b"(uuid, text, text, text, text[], uuid[], numeric, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_admin_cancel_championship_b2b"(uuid, text, text, text, text[], uuid[], numeric, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_admin_championship_extras_b2b"(uuid, jsonb, boolean, text, text, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_admin_championship_extras_b2b"(uuid, jsonb, boolean, text, text, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_admin_championship_extras_b2b"(uuid, jsonb, boolean, text, text, numeric) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_admin_create_championship_b2b"(uuid, uuid[], integer, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_admin_create_championship_b2b"(uuid, uuid[], integer, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_admin_create_championship_b2b"(uuid, uuid[], integer, jsonb, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_champ_can_manage_results"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_champ_can_manage_results"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_champ_can_manage_results"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."_champ_can_manage_roster"(uuid, uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."_champ_can_manage_roster"(uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_champ_can_manage_roster"(uuid, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_champ_can_manage_roster"(uuid, uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_admin_price"(uuid[], jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_admin_price"(uuid[], jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_admin_price"(uuid[], jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_assert_extras"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_extras"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_extras"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_assert_formats"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_formats"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_formats"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_assert_lead_rules"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_lead_rules"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_lead_rules"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb, date) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb, date) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_assert_not_blocked"(uuid[], jsonb, date) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_block_normalize"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_block_normalize"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_block_normalize"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_cancel_core"(uuid, text, text[], uuid[], numeric, text, uuid, boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_cancel_core"(uuid, text, text[], uuid[], numeric, text, uuid, boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_cancel_core"(uuid, text, text[], uuid[], numeric, text, uuid, boolean, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_claim_games"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_claim_games"(uuid, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_claim_games"(uuid, uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_compute_price"(uuid[], text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_compute_price"(uuid[], text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_compute_price"(uuid[], text, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_concepts"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_concepts"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_concepts"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."_championship_eligible_teams"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."_championship_eligible_teams"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_eligible_teams"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_eligible_teams"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."_championship_fixture_template"(integer) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."_championship_fixture_template"(integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_fixture_template"(integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_fixture_template"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_hash_secret"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_hash_secret"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_hash_secret"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_is_algrass_public"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_is_algrass_public"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_is_algrass_public"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_match_played"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_match_played"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_match_played"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."_championship_order_restore_credit"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."_championship_order_restore_credit"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_order_restore_credit"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_order_restore_credit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_participation"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_participation"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_participation"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_payer"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_payer"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_payer"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_price_lines"(text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_price_lines"(text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_price_lines"(text, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_refund_one"(uuid, uuid, numeric, jsonb, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_refund_one"(uuid, uuid, numeric, jsonb, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_refund_one"(uuid, uuid, numeric, jsonb, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_release_courts"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_release_courts"(uuid, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_release_courts"(uuid, uuid[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_release_hold"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_release_hold"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_release_hold"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."_championship_spend_to_wallet"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."_championship_spend_to_wallet"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_spend_to_wallet"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_spend_to_wallet"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."_championship_team_capacity"(jsonb) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."_championship_team_capacity"(jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_team_capacity"(jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_team_capacity"(jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_team_roster"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_team_roster"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_team_roster"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_championship_verify_secret"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_verify_secret"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_championship_verify_secret"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."_eligible_championship_hosts"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_eligible_championship_hosts"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_eligible_championship_hosts"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."_is_algrass_admin"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."_is_algrass_admin"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_is_algrass_admin"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_is_algrass_admin"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."_is_algrass_staff"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."_is_algrass_staff"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."_is_algrass_staff"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."_is_algrass_staff"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."add_championship_block"(text, timestamp WITH time zone, timestamp WITH time zone, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."add_championship_block"(text, timestamp WITH time zone, timestamp WITH time zone, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_block"(text, timestamp WITH time zone, timestamp WITH time zone, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_block"(text, timestamp WITH time zone, timestamp WITH time zone, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."add_championship_court"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."add_championship_court"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_court"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_court"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."add_championship_court"(uuid, uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."add_championship_court"(uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_court"(uuid, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_court"(uuid, uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."add_championship_courts"(uuid, uuid[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."add_championship_courts"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_courts"(uuid, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_courts"(uuid, uuid[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."add_championship_courts"(uuid, uuid[], text, numeric) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."add_championship_courts"(uuid, uuid[], text, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_courts"(uuid, uuid[], text, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_courts"(uuid, uuid[], text, numeric) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."add_championship_team_member"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."add_championship_team_member"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_team_member"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."add_championship_team_member"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_attach_championship_voucher"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_attach_championship_voucher"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_attach_championship_voucher"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_attach_championship_voucher"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_cancel_championship"(uuid, text, text, text, text[], uuid[], numeric, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_cancel_championship"(uuid, text, text, text, text[], uuid[], numeric, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_cancel_championship"(uuid, text, text, text, text[], uuid[], numeric, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_cancel_championship"(uuid, text, text, text, text[], uuid[], numeric, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_championship_extras"(uuid, jsonb, boolean, text, text, numeric) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_championship_extras"(uuid, jsonb, boolean, text, text, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_championship_extras"(uuid, jsonb, boolean, text, text, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_championship_extras"(uuid, jsonb, boolean, text, text, numeric) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_championship_payer_credit"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_championship_payer_credit"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_championship_payer_credit"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_championship_payer_credit"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_confirm_championship_payment"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_confirm_championship_payment"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_confirm_championship_payment"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_confirm_championship_payment"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_create_championship"(uuid, uuid[], integer, jsonb, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_create_championship"(uuid, uuid[], integer, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_create_championship"(uuid, uuid[], integer, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_create_championship"(uuid, uuid[], integer, jsonb, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_get_user_rewards"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_get_user_rewards"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_get_user_rewards"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_get_user_rewards"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_list_rewards"(uuid, text, timestamp WITH time zone, timestamp WITH time zone, integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_list_rewards"(uuid, text, timestamp WITH time zone, timestamp WITH time zone, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_list_rewards"(uuid, text, timestamp WITH time zone, timestamp WITH time zone, integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_list_rewards"(uuid, text, timestamp WITH time zone, timestamp WITH time zone, integer, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_move_championship_player"(uuid, uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_move_championship_player"(uuid, uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_move_championship_player"(uuid, uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_move_championship_player"(uuid, uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_quote_championship"(uuid[], jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_quote_championship"(uuid[], jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_quote_championship"(uuid[], jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_quote_championship"(uuid[], jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."admin_set_championship_registration_close"(uuid, timestamp WITH time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_set_championship_registration_close"(uuid, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_set_championship_registration_close"(uuid, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."admin_set_championship_registration_close"(uuid, timestamp WITH time zone) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."algrass_cancel_free_invite"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."algrass_cancel_free_invite"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."algrass_cancel_free_invite"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."algrass_cancel_free_invite"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."apply_default_host_to_game"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."apply_default_host_to_game"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."apply_default_host_to_game"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."apply_default_host_to_game"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."apply_double_out_mode_system"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."apply_double_out_mode_system"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."apply_double_out_mode_system"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."apply_wallet_refund"(uuid, numeric) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."apply_wallet_refund"(uuid, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."apply_wallet_refund"(uuid, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."apply_wallet_refund"(uuid, numeric) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."approve_captain_request"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."approve_captain_request"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."approve_captain_request"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."approve_captain_request"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."approve_championship_transfer"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."approve_championship_transfer"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."approve_championship_transfer"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."approve_championship_transfer"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."assert_game_reservable"(uuid, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."assert_game_reservable"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."assert_game_reservable"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."assert_game_reservable"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."block_double_out_twin_on_reserve"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."block_double_out_twin_on_reserve"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."block_double_out_twin_on_reserve"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."block_double_out_twin_on_reserve"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_delete_user_roles"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."can_delete_user_roles"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."can_delete_user_roles"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_delete_user_roles"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_delete_user_roles"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_manage_championship_requests"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."can_manage_championship_requests"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_manage_championship_requests"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_manage_championship_requests"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_manage_venue_manager_requests"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."can_manage_venue_manager_requests"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_manage_venue_manager_requests"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_manage_venue_manager_requests"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_read_backoffice"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."can_read_backoffice"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."can_read_backoffice"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_read_backoffice"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_read_backoffice"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."can_write_app_settings"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."can_write_app_settings"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_write_app_settings"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_write_app_settings"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_write_user_roles"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."can_write_user_roles"(text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."can_write_user_roles"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_write_user_roles"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."can_write_user_roles"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_contract"(uuid, text, text[], boolean, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_championship_contract"(uuid, text, text[], boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_contract"(uuid, text, text[], boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_contract"(uuid, text, text[], boolean, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_registration_plaza"(uuid, uuid[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_championship_registration_plaza"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_registration_plaza"(uuid, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_registration_plaza"(uuid, uuid[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_team_registration"(uuid, uuid, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_championship_team_registration"(uuid, uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_team_registration"(uuid, uuid, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_championship_team_registration"(uuid, uuid, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_double_out"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_double_out"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_double_out"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_double_out"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_guest_players"(uuid, uuid[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_guest_players"(uuid, uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_guest_players"(uuid, uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_guest_players"(uuid, uuid[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_match"(uuid, text, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_match"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_match"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_match"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_rental"(uuid, text, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_rental"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_rental"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_rental"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."cancel_rental_self"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cancel_rental_self"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_rental_self"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."cancel_rental_self"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."captain_welcome_enqueue"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."captain_welcome_enqueue"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."captain_welcome_enqueue"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."championship_requests_touch"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."championship_requests_touch"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."championship_requests_touch"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."check_private_access"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."check_private_access"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_private_access"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."check_private_access"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_captain_welcome_email"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_captain_welcome_email"(uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_captain_welcome_email"(uuid, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."claim_rental_double_out_aware"(uuid, uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."claim_rental_double_out_aware"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_rental_double_out_aware"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_rental_double_out_aware"(uuid, uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_welcome_email"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_welcome_email"(uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_welcome_email"(uuid, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."clear_double_out_on_delete"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."clear_double_out_on_delete"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."clear_double_out_on_delete"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."clear_double_out_on_delete"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."close_venue_manager_request"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."close_venue_manager_request"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."close_venue_manager_request"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."close_venue_manager_request"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_gateway_payment"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."confirm_championship_gateway_payment"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_gateway_payment"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_gateway_payment"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_registration"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."confirm_championship_registration"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_registration"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_registration"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_team_registration"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."confirm_championship_team_registration"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_team_registration"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_team_registration"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_transfer"(uuid, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."confirm_championship_transfer"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_transfer"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."confirm_championship_transfer"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."consume_reward"(uuid, uuid, numeric) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."consume_reward"(uuid, uuid, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."consume_reward"(uuid, uuid, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."consume_reward"(uuid, uuid, numeric) TO "service_role";

REVOKE ALL ON FUNCTION "public"."count_promo_uses"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."count_promo_uses"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."count_promo_uses"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_promo_uses"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."count_promo_uses"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_championship_gateway_order"(uuid[], text, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_championship_gateway_order"(uuid[], text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_gateway_order"(uuid[], text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_gateway_order"(uuid[], text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_championship_registration_order"(uuid, text, uuid[], jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_championship_registration_order"(uuid, text, uuid[], jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_registration_order"(uuid, text, uuid[], jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_registration_order"(uuid, text, uuid[], jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_championship_team"(uuid, text, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_championship_team"(uuid, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_team"(uuid, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_team"(uuid, text, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_championship_team_registration_order"(uuid, text, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_championship_team_registration_order"(uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_team_registration_order"(uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_team_registration_order"(uuid, text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_championship_transfer_hold"(uuid[], text, jsonb) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."create_championship_transfer_hold"(uuid[], text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_transfer_hold"(uuid[], text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_championship_transfer_hold"(uuid[], text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_double_out"(uuid, numeric, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."create_double_out"(uuid, numeric, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_double_out"(uuid, numeric, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_double_out"(uuid, numeric, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."create_order"(text, text, uuid, jsonb, numeric, text, jsonb, timestamp WITH time zone, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."create_order"(text, text, uuid, jsonb, numeric, text, jsonb, timestamp WITH time zone, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_order"(text, text, uuid, jsonb, numeric, text, jsonb, timestamp WITH time zone, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."create_order"(text, text, uuid, jsonb, numeric, text, jsonb, timestamp WITH time zone, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."delete_auth_user"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."delete_auth_user"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_auth_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_auth_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_auth_user"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."delete_championship_fixture"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_championship_fixture"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_championship_fixture"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_championship_fixture"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."delete_championship_team"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."delete_championship_team"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_championship_team"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."delete_championship_team"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_adult_birth_date"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."enforce_adult_birth_date"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_adult_birth_date"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_adult_birth_date"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_capacity"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."enforce_capacity"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_capacity"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_capacity"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."expire_championship_gateway_holds"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_championship_gateway_holds"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_championship_gateway_holds"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."expire_championship_transfer_holds"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_championship_transfer_holds"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_championship_transfer_holds"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."expire_orders"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."expire_orders"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_orders"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_orders"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."expire_slot_reservations"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_slot_reservations"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_slot_reservations"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."expire_waitlists"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."expire_waitlists"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_waitlists"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."expire_waitlists"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_gateway"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."fail_championship_gateway"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_gateway"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_gateway"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_registration"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."fail_championship_registration"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_registration"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_registration"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_team_registration"(uuid, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."fail_championship_team_registration"(uuid, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_team_registration"(uuid, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fail_championship_team_registration"(uuid, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."fail_order"(uuid, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."fail_order"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fail_order"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."fail_order"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."gate_match_double_out_commit"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."gate_match_double_out_commit"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."gate_match_double_out_commit"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."gate_match_double_out_commit"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."generate_championship_fixture"(uuid, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."generate_championship_fixture"(uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."generate_championship_fixture"(uuid, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."generate_championship_fixture"(uuid, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."generate_user_code"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."generate_user_code"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."generate_user_code"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."generate_user_code"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_admin_championship"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_fixture"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_admin_championship_fixture"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_fixture"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_fixture"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_match"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_admin_championship_match"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_match"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_match"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_reservations"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_admin_championship_reservations"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_reservations"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_admin_championship_reservations"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_championship_availability_restrictions"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_championship_availability_restrictions"(text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_availability_restrictions"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_availability_restrictions"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_availability_restrictions"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_championship_competition"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_championship_competition"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_competition"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_competition"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_competition"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_championship_config"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_config"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_config"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_config"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_championship_my_reservation"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_my_reservation"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_my_reservation"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_my_reservation"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_championship_organizer_contact"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_organizer_contact"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_organizer_contact"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_organizer_contact"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_championship_payment_detail"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_payment_detail"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_payment_detail"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_payment_detail"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_championship_public"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_championship_public"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_public"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_public"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_public"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_championship_public_pricing"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_championship_public_pricing"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_public_pricing"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_public_pricing"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_public_pricing"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_championship_registration_key"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_registration_key"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_registration_key"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_registration_key"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_championship_registration_state"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_championship_registration_state"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_registration_state"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_registration_state"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_registration_state"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_championship_settings_admin"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_settings_admin"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_settings_admin"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_settings_admin"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_championship_team_secret"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_team_secret"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_team_secret"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_team_secret"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_championship_team_share"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_championship_team_share"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_team_share"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_championship_team_share"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_game_host_contact"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_game_host_contact"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_game_host_contact"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_game_host_contact"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_maintenance_status"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."get_maintenance_status"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_maintenance_status"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_maintenance_status"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_maintenance_status"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_pending_slot_expiry"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_pending_slot_expiry"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_pending_slot_expiry"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_pending_slot_expiry"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_slot_reservation"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_slot_reservation"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_slot_reservation"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_slot_reservation"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_slot_reservation_for_user"(uuid, uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_slot_reservation_for_user"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_slot_reservation_for_user"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_slot_reservation_for_user"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."get_waitlist_user_ids"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."get_waitlist_user_ids"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_waitlist_user_ids"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_waitlist_user_ids"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."grant_captain"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."grant_captain"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_captain"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_captain"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."grant_captain_gold"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."grant_captain_gold"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_captain_gold"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_captain_gold"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."grant_manual_reward"(uuid, numeric, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."grant_manual_reward"(uuid, numeric, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_manual_reward"(uuid, numeric, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_manual_reward"(uuid, numeric, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."grant_reward"(uuid, numeric, text, uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."grant_reward"(uuid, numeric, text, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_reward"(uuid, numeric, text, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."grant_reward"(uuid, numeric, text, uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."has_open_venue_manager_request"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."has_open_venue_manager_request"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."has_open_venue_manager_request"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."has_open_venue_manager_request"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."init_championship_settings"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."init_championship_settings"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."init_championship_settings"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."init_championship_settings"(text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_any_venue_owner"(uuid) TO PUBLIC;

REVOKE ALL ON FUNCTION "public"."is_any_venue_owner"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_any_venue_owner"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_any_venue_owner"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_captain"(uuid) TO PUBLIC;

REVOKE ALL ON FUNCTION "public"."is_captain"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_captain"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_captain"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_platform_admin_or_staff"(uuid) TO PUBLIC;

REVOKE ALL ON FUNCTION "public"."is_platform_admin_or_staff"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_platform_admin_or_staff"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_platform_admin_or_staff"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."join_championship_team"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team_with_secret"(uuid, text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."join_championship_team_with_secret"(uuid, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team_with_secret"(uuid, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team_with_secret"(uuid, text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team_with_token"(text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."join_championship_team_with_token"(text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team_with_token"(text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."join_championship_team_with_token"(text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."join_championship_without_team"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."join_championship_without_team"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."join_championship_without_team"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."join_championship_without_team"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."leave_championship"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."leave_championship"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."leave_championship"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."leave_championship"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_admin_available_rentals"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_admin_available_rentals"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_admin_available_rentals"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_admin_available_rentals"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_admin_championships"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_admin_championships"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_admin_championships"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_admin_championships"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_championship_blocks"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_championship_blocks"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_championship_blocks"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_championship_blocks"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_championship_requests"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_championship_requests"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_championship_requests"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_championship_requests"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_championship_settings_admin"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_championship_settings_admin"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_championship_settings_admin"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_championship_settings_admin"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_championship_team_formats"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_championship_team_formats"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_championship_team_formats"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_championship_team_formats"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_eligible_championship_hosts"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_eligible_championship_hosts"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_eligible_championship_hosts"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_eligible_championship_hosts"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_my_championship_requests"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_my_championship_requests"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_my_championship_requests"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_my_championship_requests"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_my_championships"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_my_championships"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_my_championships"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_my_championships"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_public_championships"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_public_championships"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."list_public_championships"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_public_championships"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_public_championships"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_public_championships"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_public_championships"(text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."list_public_championships"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_public_championships"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_public_championships"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_venue_manager_requests"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_venue_manager_requests"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_venue_manager_requests"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_venue_manager_requests"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."manage_championship_player"(uuid, uuid, uuid, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."manage_championship_player"(uuid, uuid, uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."manage_championship_player"(uuid, uuid, uuid, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."manage_championship_player"(uuid, uuid, uuid, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_order_confirmed"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."mark_order_confirmed"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_order_confirmed"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_order_confirmed"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_referral_rewards_communicated"(uuid[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."mark_referral_rewards_communicated"(uuid[]) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_referral_rewards_communicated"(uuid[]) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_referral_rewards_communicated"(uuid[]) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_slot_reservation_notified"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."mark_slot_reservation_notified"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_slot_reservation_notified"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_slot_reservation_notified"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."mark_venue_manager_request_contacted"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."mark_venue_manager_request_contacted"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_venue_manager_request_contacted"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."mark_venue_manager_request_contacted"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."match_cancellation_window"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."match_cancellation_window"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."match_cancellation_window"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."match_cancellation_window"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."match_cancellation_window"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."notify_waitlist_spot_available"(uuid, uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."notify_waitlist_spot_available"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."notify_waitlist_spot_available"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."notify_waitlist_spot_available"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."prevent_venue_staff_delete_while_hosting"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."prevent_venue_staff_delete_while_hosting"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."prevent_venue_staff_delete_while_hosting"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."prevent_venue_staff_delete_while_hosting"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."process_referral_rewards"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."process_referral_rewards"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_locked_game_fields"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."protect_locked_game_fields"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_locked_game_fields"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."protect_locked_game_fields"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."public_availability"(public.games) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."public_availability"(public.games) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."public_availability"(public.games) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."public_availability"(public.games) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."public_availability"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."public_availability"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."public_availability"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."public_availability"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."publish_championship"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."publish_championship"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."publish_championship"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."publish_championship"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."quote_championship"(uuid[], text, jsonb) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."quote_championship"(uuid[], text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."quote_championship"(uuid[], text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."quote_championship"(uuid[], text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."rebuild_reserved_slots_used"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."rebuild_reserved_slots_used"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rebuild_reserved_slots_used"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."rebuild_reserved_slots_used"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reject_captain_request"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."reject_captain_request"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reject_captain_request"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reject_captain_request"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reject_championship_transfer"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."reject_championship_transfer"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reject_championship_transfer"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reject_championship_transfer"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."release_championship_transfer_hold"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."release_championship_transfer_hold"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."release_championship_transfer_hold"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."release_championship_transfer_hold"(uuid) TO "service_role";

REVOKE ALL ON FUNCTION "public"."release_slot_reservation"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."release_slot_reservation"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."release_slot_reservation"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."remove_championship_block"(text, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."remove_championship_block"(text, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."remove_championship_block"(text, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."remove_championship_block"(text, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."rental_cancellation_window"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."rental_cancellation_window"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rental_cancellation_window"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."rental_cancellation_window"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reopen_double_out_twin"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."reopen_double_out_twin"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reopen_double_out_twin"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reopen_double_out_twin"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."requeue_stuck_captain_welcome_emails"(interval) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."requeue_stuck_captain_welcome_emails"(interval) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."requeue_stuck_captain_welcome_emails"(interval) TO "service_role";

REVOKE ALL ON FUNCTION "public"."requeue_stuck_welcome_emails"(interval) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."requeue_stuck_welcome_emails"(interval) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."requeue_stuck_welcome_emails"(interval) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."required_players_from_format"(text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."required_players_from_format"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."required_players_from_format"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."required_players_from_format"(text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."reserve_slots"(uuid, integer, uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."reserve_slots"(uuid, integer, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."reserve_slots"(uuid, integer, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."reserve_slots"(uuid, integer, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."revoke_captain"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."revoke_captain"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."revoke_captain"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."revoke_captain"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."save_championship_fixture"(uuid, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."save_championship_fixture"(uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_championship_fixture"(uuid, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_championship_fixture"(uuid, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."save_championship_match_result"(uuid, integer, integer, jsonb, timestamp WITH time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."save_championship_match_result"(uuid, integer, integer, jsonb, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_championship_match_result"(uuid, integer, integer, jsonb, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_championship_match_result"(uuid, integer, integer, jsonb, timestamp WITH time zone) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."save_championship_team"(uuid, uuid, text, text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."save_championship_team"(uuid, uuid, text, text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_championship_team"(uuid, uuid, text, text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."save_championship_team"(uuid, uuid, text, text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_cancellation_settings"(integer, integer, integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_cancellation_settings"(integer, integer, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_cancellation_settings"(integer, integer, integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_cancellation_settings"(integer, integer, integer, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_captain_release_settings"(integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_captain_release_settings"(integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_captain_release_settings"(integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_captain_release_settings"(integer, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_captain_request_notes"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_captain_request_notes"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_captain_request_notes"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_captain_request_notes"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_champion"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_champion"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_champion"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_champion"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_extras"(text, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_extras"(text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_extras"(text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_extras"(text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_host"(uuid, uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_host"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_host"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_host"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_match_team"(uuid, text, uuid, timestamp WITH time zone) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_match_team"(uuid, text, uuid, timestamp WITH time zone) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_match_team"(uuid, text, uuid, timestamp WITH time zone) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_match_team"(uuid, text, uuid, timestamp WITH time zone) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_pricing"(text, text, numeric, numeric) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_pricing"(text, text, numeric, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_pricing"(text, text, numeric, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_pricing"(text, text, numeric, numeric) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_request_notes"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_request_notes"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_request_notes"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_request_notes"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_request_status"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_request_status"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_request_status"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_request_status"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_rules"(text, integer, jsonb, jsonb) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_rules"(text, integer, jsonb, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_rules"(text, integer, jsonb, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_rules"(text, integer, jsonb, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_settings_active"(text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_settings_active"(text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_settings_active"(text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_settings_active"(text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_status"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_status"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_status"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_status"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_championship_team_format"(uuid, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_championship_team_format"(uuid, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_team_format"(uuid, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_championship_team_format"(uuid, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_double_out_mode"(uuid, text) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_double_out_mode"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_double_out_mode"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_double_out_mode"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_double_out_side_bulk"(uuid[], text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_double_out_side_bulk"(uuid[], text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_double_out_side_bulk"(uuid[], text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_double_out_side_bulk"(uuid[], text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_field_total_spots_from_format"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_field_total_spots_from_format"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_field_total_spots_from_format"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_field_total_spots_from_format"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_game_duration_default"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_game_duration_default"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_game_duration_default"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_game_duration_default"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_game_format"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_game_format"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_game_format"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_game_format"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_game_total_spots"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_game_total_spots"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_game_total_spots"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_game_total_spots"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_game_windows"(integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_game_windows"(integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_game_windows"(integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_game_windows"(integer, integer) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_maintenance_settings"(boolean, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_maintenance_settings"(boolean, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_maintenance_settings"(boolean, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_maintenance_settings"(boolean, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_organizer_contact"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_organizer_contact"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_organizer_contact"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_organizer_contact"(text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_reward_referral_settings"(boolean, numeric, boolean, numeric, boolean, numeric) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_reward_referral_settings"(boolean, numeric, boolean, numeric, boolean, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_reward_referral_settings"(boolean, numeric, boolean, numeric, boolean, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_reward_referral_settings"(boolean, numeric, boolean, numeric, boolean, numeric) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_support_contact"(text, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_support_contact"(text, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_support_contact"(text, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_support_contact"(text, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_venue_manager_request_notes"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_venue_manager_request_notes"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_venue_manager_request_notes"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_venue_manager_request_notes"(uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."spend_wallet_credit"(uuid, numeric) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."spend_wallet_credit"(uuid, numeric) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."spend_wallet_credit"(uuid, numeric) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_field_total_spots_with_format"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."sync_field_total_spots_with_format"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_field_total_spots_with_format"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_field_total_spots_with_format"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."sync_manager_to_venue_staff"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."sync_manager_to_venue_staff"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_manager_to_venue_staff"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."sync_manager_to_venue_staff"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."toggle_championship_live"(uuid, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."toggle_championship_live"(uuid, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."toggle_championship_live"(uuid, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."toggle_championship_live"(uuid, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."trg_rebuild_reserved_slots_used"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."trg_rebuild_reserved_slots_used"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."trg_rebuild_reserved_slots_used"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."trg_rebuild_reserved_slots_used"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_championship_cover"(uuid, text, text, text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_championship_cover"(uuid, text, text, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_championship_cover"(uuid, text, text, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_championship_cover"(uuid, text, text, text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_championship_privacy"(uuid, text, boolean) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_championship_privacy"(uuid, text, boolean) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_championship_privacy"(uuid, text, boolean) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_championship_privacy"(uuid, text, boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_championship_team_secret"(uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_championship_team_secret"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_championship_team_secret"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_championship_team_secret"(uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_game_lifecycle"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."update_game_lifecycle"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_game_lifecycle"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_game_lifecycle"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."validate_format_vs_total_spots"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."validate_format_vs_total_spots"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_format_vs_total_spots"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_format_vs_total_spots"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."validate_game_host_is_venue_staff"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."validate_game_host_is_venue_staff"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_game_host_is_venue_staff"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_game_host_is_venue_staff"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."validate_game_total_spots"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."validate_game_total_spots"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_game_total_spots"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."validate_game_total_spots"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."venue_manager_requests_touch"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."venue_manager_requests_touch"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."venue_manager_requests_touch"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."verify_championship_access"(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."verify_championship_access"(uuid, text) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."verify_championship_access"(uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."verify_championship_access"(uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."verify_championship_access"(uuid, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."welcome_email_enqueue"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."welcome_email_enqueue"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."welcome_email_enqueue"() TO "service_role";

REVOKE ALL ON TABLE "public"."app_settings" FROM "authenticated";

GRANT SELECT ON TABLE "public"."app_settings" TO "authenticated";

REVOKE ALL ON TABLE "public"."app_settings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_settings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."app_settings" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."broadcasts" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."broadcasts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."broadcasts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."broadcasts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."captain_requests" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."captain_requests" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."captain_requests" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."captain_requests" TO "service_role";

REVOKE ALL ON TABLE "public"."captain_welcome_emails" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."captain_welcome_emails" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."captain_welcome_emails" TO "service_role";

REVOKE ALL ON TABLE "public"."championship_goals" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_goals" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_goals" TO "service_role";

REVOKE ALL ON TABLE "public"."championship_matches" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_matches" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_matches" TO "service_role";

REVOKE ALL ON TABLE "public"."championship_players" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_players" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_players" TO "service_role";

REVOKE ALL ON TABLE "public"."championship_requests" FROM "authenticated";

REVOKE ALL ("championship_name") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("championship_name") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("city") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("city") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("company") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("company") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("contact_name") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("contact_name") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("contact_phone") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("contact_phone") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("districts") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("districts") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("email") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("email") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("format") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("format") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("job_title") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("job_title") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("match_duration_min") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("match_duration_min") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("message") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("message") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("participant_quantity") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("participant_quantity") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("participant_type") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("participant_type") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("phone_country_code") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("phone_country_code") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("tentative_date") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("tentative_date") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("tentative_end_date") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("tentative_end_date") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("tentative_start_date") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("tentative_start_date") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ("user_id") ON TABLE "public"."championship_requests" FROM "authenticated";

GRANT INSERT ("user_id") ON TABLE "public"."championship_requests" TO "authenticated";

REVOKE ALL ON TABLE "public"."championship_requests" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_requests" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_requests" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_reservation_games" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."championship_reservation_games" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_reservation_games" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_reservation_games" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_settings" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."championship_settings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_settings" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_settings" TO "service_role";

REVOKE ALL ON TABLE "public"."championship_teams" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_teams" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championship_teams" TO "service_role";

REVOKE ALL ON TABLE "public"."championships" FROM "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championships" TO "anon";

REVOKE ALL ON TABLE "public"."championships" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championships" TO "authenticated";

REVOKE ALL ON TABLE "public"."championships" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championships" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."championships" TO "service_role";

REVOKE ALL ON TABLE "public"."fields" FROM "anon";

GRANT SELECT ON TABLE "public"."fields" TO "anon";

REVOKE ALL ON TABLE "public"."fields" FROM "authenticated";

REVOKE ALL ("amenities") ON TABLE "public"."fields" FROM "authenticated";

GRANT UPDATE ("amenities") ON TABLE "public"."fields" TO "authenticated";

REVOKE ALL ("cover_image_path") ON TABLE "public"."fields" FROM "authenticated";

GRANT UPDATE ("cover_image_path") ON TABLE "public"."fields" TO "authenticated";

REVOKE ALL ("cover_updated_at") ON TABLE "public"."fields" FROM "authenticated";

GRANT UPDATE ("cover_updated_at") ON TABLE "public"."fields" TO "authenticated";

REVOKE ALL ("default_host_user_id") ON TABLE "public"."fields" FROM "authenticated";

GRANT UPDATE ("default_host_user_id") ON TABLE "public"."fields" TO "authenticated";

REVOKE ALL ("duration_min") ON TABLE "public"."fields" FROM "authenticated";

GRANT UPDATE ("duration_min") ON TABLE "public"."fields" TO "authenticated";

REVOKE ALL ("format") ON TABLE "public"."fields" FROM "authenticated";

GRANT UPDATE ("format") ON TABLE "public"."fields" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."fields" FROM "authenticated";

GRANT UPDATE ("name") ON TABLE "public"."fields" TO "authenticated";

REVOKE ALL ("total_spots") ON TABLE "public"."fields" FROM "authenticated";

GRANT UPDATE ("total_spots") ON TABLE "public"."fields" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, SELECT ON TABLE "public"."fields" TO "authenticated";

REVOKE ALL ON TABLE "public"."fields" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."fields" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."fields" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_players" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."game_players" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_players" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_players" TO "service_role";

REVOKE ALL ON TABLE "public"."game_slot_reservations" FROM "authenticated";

GRANT SELECT ON TABLE "public"."game_slot_reservations" TO "authenticated";

REVOKE ALL ON TABLE "public"."game_slot_reservations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_slot_reservations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_slot_reservations" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_waitlist" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."game_waitlist" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_waitlist" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_waitlist" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."games" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."games" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."games" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."games" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."notifications" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."notifications" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."orders" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."orders" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."orders" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."orders" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."promo_codes" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."promo_codes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."promo_codes" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."promo_codes" TO "service_role";

REVOKE ALL ON TABLE "public"."rating" FROM "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."rating" TO "authenticated";

REVOKE ALL ON TABLE "public"."rating" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rating" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rating" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reservations" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."reservations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reservations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reservations" TO "service_role";

REVOKE ALL ON TABLE "public"."reward_transactions" FROM "authenticated";

GRANT SELECT ON TABLE "public"."reward_transactions" TO "authenticated";

REVOKE ALL ON TABLE "public"."reward_transactions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reward_transactions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reward_transactions" TO "service_role";

REVOKE ALL ON TABLE "public"."user_roles" FROM "authenticated";

REVOKE ALL ("role") ON TABLE "public"."user_roles" FROM "authenticated";

GRANT INSERT ("role"), UPDATE ("role") ON TABLE "public"."user_roles" TO "authenticated";

REVOKE ALL ("user_id") ON TABLE "public"."user_roles" FROM "authenticated";

GRANT INSERT ("user_id") ON TABLE "public"."user_roles" TO "authenticated";

GRANT DELETE, SELECT ON TABLE "public"."user_roles" TO "authenticated";

REVOKE ALL ON TABLE "public"."user_roles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."user_roles" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."users" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "service_role";

REVOKE ALL ON TABLE "public"."venue_manager_requests" FROM "authenticated";

GRANT INSERT ON TABLE "public"."venue_manager_requests" TO "authenticated";

REVOKE ALL ON TABLE "public"."venue_manager_requests" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."venue_manager_requests" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."venue_manager_requests" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."venue_staff" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."venue_staff" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."venue_staff" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."venue_staff" TO "service_role";

REVOKE ALL ON TABLE "public"."venues" FROM "anon";

GRANT SELECT ON TABLE "public"."venues" TO "anon";

REVOKE ALL ON TABLE "public"."venues" FROM "authenticated";

REVOKE ALL ("amenities") ON TABLE "public"."venues" FROM "authenticated";

GRANT UPDATE ("amenities") ON TABLE "public"."venues" TO "authenticated";

REVOKE ALL ("cover_image_path") ON TABLE "public"."venues" FROM "authenticated";

GRANT UPDATE ("cover_image_path") ON TABLE "public"."venues" TO "authenticated";

REVOKE ALL ("cover_updated_at") ON TABLE "public"."venues" FROM "authenticated";

GRANT UPDATE ("cover_updated_at") ON TABLE "public"."venues" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."venues" FROM "authenticated";

GRANT UPDATE ("name") ON TABLE "public"."venues" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, SELECT ON TABLE "public"."venues" TO "authenticated";

REVOKE ALL ON TABLE "public"."venues" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."venues" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."venues" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."wallet_summary" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."wallet_summary" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."wallet_summary" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."wallet_summary" TO "service_role";

REVOKE ALL ON TABLE "public"."welcome_emails" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."welcome_emails" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."welcome_emails" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_live_spots" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."game_live_spots" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_live_spots" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."game_live_spots" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_first_completed_activity" TO "authenticated";

REVOKE ALL ON TABLE "public"."player_first_completed_activity" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_first_completed_activity" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."player_first_completed_activity" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users_public" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."users_public" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users_public" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users_public" TO "service_role";

SELECT cron.schedule_in_database('captain-welcome-drain', '*/5 * * * *', '
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
               where name = ''captain_welcome_function_url''),
      headers := jsonb_build_object(
        ''Content-Type'', ''application/json'',
        ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets
                                        where name = ''captain_welcome_service_role_key''),
        ''x-worker-secret'', (select decrypted_secret from vault.decrypted_secrets
                             where name = ''captain_welcome_worker_secret'')
      ),
      body := ''{}''::jsonb,
      timeout_milliseconds := 60000
    );
  ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('cleanup-cron-history', '0 */2 * * *', '
    delete from cron.job_run_details
    where end_time < now() - interval ''2 hours'';
  ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('expire-championship-gateway-holds', '* * * * *', ' select public.expire_championship_gateway_holds(); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('expire-championship-transfer-holds', '* * * * *', ' select public.expire_championship_transfer_holds(); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('expire-orders', '* * * * *', ' select public.expire_orders(); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('expire-slot-reservations', '0 * * * *', '
  select public.expire_slot_reservations();
  ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('game-lifecycle', '*/15 * * * *', 'SELECT update_game_lifecycle()', 'postgres', NULL, true);

SELECT cron.schedule_in_database('process-referral-rewards', '2,17,32,47 * * * *', ' select public.process_referral_rewards(); ', 'postgres', NULL, true);

SELECT cron.schedule_in_database('welcome-drain', '*/5 * * * *', '
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
               where name = ''welcome_function_url''),
      headers := jsonb_build_object(
        ''Content-Type'', ''application/json'',
        ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets
                                        where name = ''welcome_service_role_key''),
        ''x-worker-secret'', (select decrypted_secret from vault.decrypted_secrets
                             where name = ''welcome_worker_secret'')
      ),
      body := ''{}''::jsonb,
      timeout_milliseconds := 60000
    );
  ', 'postgres', NULL, true);

ALTER TABLE "public"."user_roles"
  ADD CONSTRAINT "user_roles_granted_by_user_id_fkey" FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

CREATE POLICY "backoffice_insert_user_roles" ON "public"."user_roles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((public.can_write_user_roles(role) AND (granted_by_user_id = auth.uid())));

