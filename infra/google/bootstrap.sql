-- Operator-only, over a verified private administrative connection.
-- Reuse role/schema bootstrap. Passwords come from protected process variables.
-- Application migrations still belong to the one-shot application CLI.
\ir ../local/postgres/bootstrap.sql
ALTER ROLE tholi_runtime CONNECTION LIMIT 32;
ALTER ROLE tholi_worker CONNECTION LIMIT 8;
ALTER ROLE tholi_identity CONNECTION LIMIT 10;
