-- READ ONLY. Save this output before/after applying the additive upgrade.
-- Run while application writes are paused to compare fingerprints exactly.
BEGIN READ ONLY;
SELECT current_database() AS database_name, now() AS captured_at;
SELECT count(*) AS users, sum(wallet) AS wallet_total,
       sum("frozenWallet") AS frozen_total,
       md5(string_agg(id || ':' || wallet::text || ':' || "frozenWallet"::text,
                      '|' ORDER BY id)) AS wallet_fingerprint
FROM users;
SELECT count(*) AS bookings,
       md5(string_agg(id || ':' || status::text || ':' || "consultFee"::text || ':' ||
                     "serviceFeeAmount"::text || ':' || "totalAmount"::text,
                     '|' ORDER BY id)) AS booking_fingerprint
FROM booking_appointments;
SELECT count(*) AS journal_rows, sum(amount) AS journal_amount FROM top_ups;
SELECT status, count(*) AS requests, sum(amount) AS amount
FROM settlements GROUP BY status ORDER BY status;
-- Existing field types should match the schema. Missing new fields are expected
-- before migration; incompatible existing types require investigation first.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND (
  (table_name = 'users' AND column_name IN ('profileApproved','remoteConsultationsEnabled','bankDetails')) OR
  (table_name = 'booking_appointments' AND column_name IN ('absenceType','feeCountry')) OR
  (table_name = 'patient_service_fees' AND column_name IN ('modelBPercentage','clinicFeePercentage')) OR
  (table_name = 'settlements' AND column_name IN ('payoutMethod','payoutCountry','bankDetails')) OR
  (table_name = 'platform_booking_settings' AND column_name = 'arrivalWindowHours')
) ORDER BY table_name, column_name;
COMMIT;
