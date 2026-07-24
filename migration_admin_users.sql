-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE: Ruolo admin + funzione admin_list_users (scheda Utenti)
-- AntiGravity Hybrid FV + BESS Simulator — PRODUZIONE
--
-- COSA FA:
--   1. Assegna app_metadata.role = 'admin' all'utente fabarre@gmail.com
--      (il claim JWT si aggiorna al prossimo refresh/login del token)
--   2. Crea public.admin_list_users(): funzione SECURITY DEFINER che espone
--      elenco utenti + sessioni attive SOLO al ruolo admin (check interno
--      sul claim JWT). EXECUTE revocata a PUBLIC/anon, concessa ad authenticated.
--
-- Semaforo presenza (lato app, derivato dalle sessioni):
--   🟢 sessione attiva con attività < 1h | 🟡 sessione valida ma inattiva | ⚫ offline
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Ruolo admin
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
WHERE email = 'fabarre@gmail.com';

-- 2. Funzione admin_list_users (SECURITY DEFINER con check ruolo interno)
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Accesso riservato al ruolo admin (claim JWT app_metadata.role)
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'access denied: admin role required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'created_at', u.created_at,
      'confirmed', (u.email_confirmed_at IS NOT NULL),
      'last_sign_in_at', u.last_sign_in_at,
      'sessions_active', COALESCE(s.active_count, 0),
      'last_activity', s.last_activity
    ) ORDER BY u.created_at DESC), '[]'::jsonb)
    FROM auth.users u
    LEFT JOIN LATERAL (
      SELECT
        -- not_after è NULL per le sessioni standard (valide fino a logout/revoca)
        count(*) FILTER (WHERE sess.not_after IS NULL OR sess.not_after > now()) AS active_count,
        max(sess.updated_at) AS last_activity
      FROM auth.sessions sess
      WHERE sess.user_id = u.id
    ) s ON true
  );
END;
$$;

-- Hardening: non chiamabile da PUBLIC/anon, solo utenti autenticati
-- (il filtro admin è comunque dentro la funzione)
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

COMMIT;
