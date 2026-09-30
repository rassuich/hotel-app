-- Spanish content alongside French/English. Empty string = not translated yet
-- (the apps fall back to English, then French).
ALTER TABLE properties ADD COLUMN tagline_es TEXT NOT NULL DEFAULT '';
ALTER TABLE content_items ADD COLUMN title_es TEXT NOT NULL DEFAULT '';
ALTER TABLE content_items ADD COLUMN body_es TEXT NOT NULL DEFAULT '';
ALTER TABLE food_categories ADD COLUMN name_es TEXT NOT NULL DEFAULT '';
ALTER TABLE food_items ADD COLUMN name_es TEXT NOT NULL DEFAULT '';
ALTER TABLE food_items ADD COLUMN description_es TEXT NOT NULL DEFAULT '';
ALTER TABLE food_option_groups ADD COLUMN name_es TEXT NOT NULL DEFAULT '';
ALTER TABLE food_options ADD COLUMN name_es TEXT NOT NULL DEFAULT '';
ALTER TABLE service_items ADD COLUMN name_es TEXT NOT NULL DEFAULT '';
ALTER TABLE service_items ADD COLUMN description_es TEXT NOT NULL DEFAULT '';
ALTER TABLE delivery_locations ADD COLUMN label_es TEXT NOT NULL DEFAULT '';
-- Historical snapshot of the Spanish name at submission time.
ALTER TABLE request_lines ADD COLUMN name_es TEXT NOT NULL DEFAULT '';

-- Typed validation code issued with each private QR (same credential, same revocation).
-- Only a SHA-256 hash of the normalised code is stored.
ALTER TABLE activation_credentials ADD COLUMN code_hash TEXT;
CREATE UNIQUE INDEX activation_credentials_code ON activation_credentials(code_hash) WHERE code_hash IS NOT NULL;

ALTER TABLE department_accounts ADD COLUMN display_name_es TEXT NOT NULL DEFAULT '';
UPDATE department_accounts SET display_name_es = CASE role
  WHEN 'reception' THEN 'Recepción'
  WHEN 'room_service' THEN 'Room Service'
  ELSE 'Administración' END;
