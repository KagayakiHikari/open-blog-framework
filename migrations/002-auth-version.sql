ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(auth_version)='integer' AND auth_version>=1);
ALTER TABLE sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
-- Existing sessions predate credential generations and must authenticate again.
DELETE FROM sessions;
