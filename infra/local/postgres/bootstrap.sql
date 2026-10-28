-- Local infrastructure only. Application tables and migrations belong to #28.
\set ON_ERROR_STOP on
\getenv runtime_password THOLI_DB_PASSWORD
\getenv migration_password THOLI_MIGRATION_PASSWORD
\getenv identity_password OIDC_DB_PASSWORD

SELECT 'CREATE ROLE tholi_runtime' WHERE NOT EXISTS (
  SELECT FROM pg_roles WHERE rolname = 'tholi_runtime'
) \gexec
SELECT 'CREATE ROLE tholi_migrator' WHERE NOT EXISTS (
  SELECT FROM pg_roles WHERE rolname = 'tholi_migrator'
) \gexec
SELECT 'CREATE ROLE tholi_identity' WHERE NOT EXISTS (
  SELECT FROM pg_roles WHERE rolname = 'tholi_identity'
) \gexec

ALTER ROLE tholi_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8 PASSWORD :'runtime_password';
ALTER ROLE tholi_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD :'migration_password';
ALTER ROLE tholi_identity WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 6 PASSWORD :'identity_password';

SELECT 'CREATE DATABASE tholi OWNER tholi_migrator' WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'tholi'
) \gexec
SELECT 'CREATE DATABASE tholi_identity OWNER tholi_identity' WHERE NOT EXISTS (
  SELECT FROM pg_database WHERE datname = 'tholi_identity'
) \gexec

ALTER DATABASE tholi OWNER TO tholi_migrator;
ALTER DATABASE tholi_identity OWNER TO tholi_identity;
REVOKE ALL ON DATABASE tholi FROM PUBLIC;
REVOKE ALL ON DATABASE tholi_identity FROM PUBLIC;
GRANT CONNECT ON DATABASE tholi TO tholi_runtime, tholi_migrator;
GRANT CONNECT ON DATABASE tholi_identity TO tholi_identity;

\connect tholi
ALTER SCHEMA public OWNER TO tholi_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tholi_runtime;

\connect tholi_identity
ALTER SCHEMA public OWNER TO tholi_identity;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
