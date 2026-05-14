


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."generate_user_code"("p_full_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."generate_user_code"("p_full_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_guest_cancellation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_unit_price numeric;
  v_titular_id uuid;
  v_reservation_status text;
BEGIN
  IF NEW.status = 'canceled'
     AND OLD.status = 'confirmed'
     AND NEW.invited_by IS NOT NULL
  THEN
    v_titular_id := NEW.invited_by;

    -- Si la reserva del titular ya está cancelada,
    -- significa que es un full cancel cascade.
    -- El refund total ya fue generado.
    SELECT status INTO v_reservation_status
    FROM reservations
    WHERE user_id = v_titular_id
      AND game_id = NEW.game_id
    LIMIT 1;

    IF v_reservation_status = 'canceled' THEN
      RETURN NEW;
    END IF;

    SELECT unit_price INTO v_unit_price
    FROM reservations
    WHERE id = NEW.reservation_id
      AND user_id = v_titular_id;

    IF v_unit_price IS NOT NULL THEN
      INSERT INTO wallet_transactions (
        user_id,
        type,
        amount,
        game_id,
        reservation_id,
        description
      )
      VALUES (
        v_titular_id,
        'refund',
        v_unit_price,
        NEW.game_id,
        NEW.reservation_id,
        'Reembolso por cancelación de invitado'
      );

      UPDATE users
      SET credit_balance = COALESCE(credit_balance, 0) + v_unit_price
      WHERE id = v_titular_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_guest_cancellation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    'player',
    'none',
    0
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."credit_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" numeric,
    "reason" "text",
    "reservation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."credit_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "venue_id" "uuid",
    "format" "text",
    "players_per_team" integer,
    "amenities" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "reservation_id" "uuid" NOT NULL,
    "invited_by" "uuid",
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "canceled_at" timestamp with time zone,
    CONSTRAINT "game_players_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."game_players" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."games" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "field_id" "uuid" NOT NULL,
    "date_key" "date",
    "time" time without time zone,
    "price_per_person" numeric,
    "status" "text",
    "organizer_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "type" "text",
    "price_total" numeric,
    "current_players" integer,
    "amenities" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promo_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "discount_percent" numeric(5,2) NOT NULL,
    "active" boolean DEFAULT true,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."promo_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rating" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "stars" smallint,
    "comment" "text",
    "rated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."rating" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "game_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "status" "text",
    "unit_price" numeric,
    "promo_code" "text",
    "promo_discount" numeric,
    "credit_applied" numeric,
    "total_amount" numeric,
    "reserved_at" timestamp with time zone DEFAULT "now"(),
    "canceled_at" timestamp with time zone,
    "payment_method" "text",
    "source" "text",
    "players_count" integer,
    "guests_total" numeric,
    "subtotal_amount" numeric(10,2)
);


ALTER TABLE "public"."reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text",
    "role" "text" DEFAULT ''::"text",
    "organizer_status" "text" DEFAULT ''::"text",
    "credit_balance" numeric DEFAULT '0'::numeric,
    "birth_date" "date",
    "sex" "text",
    "preferred_position" "text"[],
    "phone" "text",
    "nationality" "text",
    "occupation" "text",
    "user_code" "text",
    "avatar_hue" smallint,
    "city" "text",
    CONSTRAINT "users_avatar_hue_check" CHECK ((("avatar_hue" >= 0) AND ("avatar_hue" < 360)))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "amenities" "jsonb" DEFAULT '{}'::"jsonb",
    "city" "text"
);


ALTER TABLE "public"."venues" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wallet_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "game_id" "uuid",
    "reservation_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "wallet_transactions_type_check" CHECK (("type" = ANY (ARRAY['refund'::"text", 'spend'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."wallet_transactions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."wallet_summary" AS
 SELECT "user_id",
    "sum"("amount") AS "credit_balance",
    "sum"("amount") FILTER (WHERE ("type" = 'refund'::"text")) AS "total_refunds",
    "sum"("amount") FILTER (WHERE ("type" = 'spend'::"text")) AS "total_spends"
   FROM "public"."wallet_transactions"
  GROUP BY "user_id";


ALTER VIEW "public"."wallet_summary" OWNER TO "postgres";


ALTER TABLE ONLY "public"."credit_transactions"
    ADD CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."fields"
    ADD CONSTRAINT "fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_game_id_user_id_key" UNIQUE ("game_id", "user_id");



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rating"
    ADD CONSTRAINT "rating_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_user_code_key" UNIQUE ("user_code");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_name_city_unique" UNIQUE ("name", "city");



ALTER TABLE ONLY "public"."venues"
    ADD CONSTRAINT "venues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id");



CREATE INDEX "game_players_game_id_invited_by_idx" ON "public"."game_players" USING "btree" ("game_id", "invited_by");



CREATE INDEX "game_players_game_id_status_idx" ON "public"."game_players" USING "btree" ("game_id", "status");



CREATE INDEX "game_players_user_id_idx" ON "public"."game_players" USING "btree" ("user_id");



CREATE INDEX "users_user_code_idx" ON "public"."users" USING "btree" ("user_code");



CREATE INDEX "wallet_transactions_user_id_created_at_idx" ON "public"."wallet_transactions" USING "btree" ("user_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "on_guest_canceled" AFTER UPDATE ON "public"."game_players" FOR EACH ROW EXECUTE FUNCTION "public"."handle_guest_cancellation"();



ALTER TABLE ONLY "public"."fields"
    ADD CONSTRAINT "fields_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id");



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id");



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id");



ALTER TABLE ONLY "public"."reservations"
    ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."wallet_transactions"
    ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



CREATE POLICY "Anyone can read active promo codes" ON "public"."promo_codes" FOR SELECT USING (("active" = true));



CREATE POLICY "Users can update own reservations" ON "public"."reservations" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."game_players" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "game_players_insert_own_or_invited" ON "public"."game_players" FOR INSERT WITH CHECK (((("user_id" = "auth"."uid"()) AND ("invited_by" IS NULL)) OR (("invited_by" = "auth"."uid"()) AND ("reservation_id" IN ( SELECT "reservations"."id"
   FROM "public"."reservations"
  WHERE ("reservations"."user_id" = "auth"."uid"()))))));



CREATE POLICY "game_players_select_public" ON "public"."game_players" FOR SELECT USING (true);



CREATE POLICY "game_players_update_own_or_invited" ON "public"."game_players" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR ("invited_by" = "auth"."uid"())));



ALTER TABLE "public"."promo_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reservations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reservations_insert_own" ON "public"."reservations" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "reservations_select_own" ON "public"."reservations" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users can insert own reservations" ON "public"."reservations" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users can read own reservations" ON "public"."reservations" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "users_select_public" ON "public"."users" FOR SELECT USING (true);



CREATE POLICY "users_update_own" ON "public"."users" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "wallet_insert_own" ON "public"."wallet_transactions" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."wallet_transactions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."generate_user_code"("p_full_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_user_code"("p_full_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_user_code"("p_full_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_guest_cancellation"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_guest_cancellation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_guest_cancellation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "service_role";


















GRANT ALL ON TABLE "public"."credit_transactions" TO "anon";
GRANT ALL ON TABLE "public"."credit_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."fields" TO "anon";
GRANT ALL ON TABLE "public"."fields" TO "authenticated";
GRANT ALL ON TABLE "public"."fields" TO "service_role";



GRANT ALL ON TABLE "public"."game_players" TO "anon";
GRANT ALL ON TABLE "public"."game_players" TO "authenticated";
GRANT ALL ON TABLE "public"."game_players" TO "service_role";



GRANT ALL ON TABLE "public"."games" TO "anon";
GRANT ALL ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT ALL ON TABLE "public"."promo_codes" TO "anon";
GRANT ALL ON TABLE "public"."promo_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_codes" TO "service_role";



GRANT ALL ON TABLE "public"."rating" TO "anon";
GRANT ALL ON TABLE "public"."rating" TO "authenticated";
GRANT ALL ON TABLE "public"."rating" TO "service_role";



GRANT ALL ON TABLE "public"."reservations" TO "anon";
GRANT ALL ON TABLE "public"."reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."reservations" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."venues" TO "anon";
GRANT ALL ON TABLE "public"."venues" TO "authenticated";
GRANT ALL ON TABLE "public"."venues" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_transactions" TO "anon";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."wallet_summary" TO "anon";
GRANT ALL ON TABLE "public"."wallet_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."wallet_summary" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































