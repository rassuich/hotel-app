-- Wrong room/name answers given with a VALID credential. After too many, the
-- credential is revoked ('too_many_attempts') and reception issues a new one.
ALTER TABLE activation_credentials ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
