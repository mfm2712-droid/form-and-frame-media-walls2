#!/usr/bin/env bash
# Applies every migration, in order, to a throwaway local PostgreSQL and runs the
# SQL behaviour tests in supabase/tests. Never connects to the real project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$BIN/initdb" ] || { echo "PostgreSQL server binaries not found (set PG_BIN)." >&2; exit 2; }
WORK="$(mktemp -d)"; PORT="${PG_TEST_PORT:-54329}"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ "$(id -u)" = 0 ]; then chown postgres "$WORK"; fi
cleanup() { as_pg "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
as_pg "$BIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -p $PORT -c listen_addresses='' -c wal_level=logical" -l "$WORK/log" -w start >/dev/null
PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -X -t)
"${PSQL[@]}" -d postgres -c "create database ff_test" >/dev/null
"${PSQL[@]}" -d ff_test -f "$ROOT/supabase/tests/bootstrap.sql" >/dev/null
for file in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d ff_test -f "$file" >/dev/null 2>"$WORK/err" || { echo "FAILED applying $(basename "$file")"; cat "$WORK/err"; exit 1; }
  echo "applied $(basename "$file")"
done
status=0
for test in "$ROOT"/supabase/tests/*.test.sql; do
  if ! "${PSQL[@]}" -d ff_test -f "$test" >"$WORK/out" 2>&1 || ! grep -q "ok all owner desk database tests finished" "$WORK/out"; then echo "FAIL $(basename "$test")"; cat "$WORK/out"; status=1
  else grep -E "NOTICE:  (ok|pass)" "$WORK/out" | sed 's/.*NOTICE:  /  /'; echo "PASS $(basename "$test")"; fi
done
# Pre-flight: the new migration must refuse a database that already holds
# duplicate drafts or duplicate accepted quotations, and leave it unchanged.
LAST="$(ls "$ROOT"/supabase/migrations/*.sql | sort | tail -1)"
for case in draft accepted; do
  db="ff_preflight_$case"
  "${PSQL[@]}" -d postgres -c "create database $db" >/dev/null
  "${PSQL[@]}" -d "$db" -f "$ROOT/supabase/tests/bootstrap.sql" >/dev/null 2>&1
  for file in "$ROOT"/supabase/migrations/*.sql; do [ "$file" = "$LAST" ] || "${PSQL[@]}" -d "$db" -f "$file" >/dev/null 2>&1; done
  "${PSQL[@]}" -d "$db" >/dev/null <<SQL
insert into public.consultation_requests(id, reference, customer_name, postcode) values ('00000000-0000-4000-8000-000000000901', 'FF-PRE-1', 'Fictional Customer', 'SL1 1AA');
set session_replication_role = replica;
insert into public.quotes(request_id, quote_number, version, status, subtotal_pence, tax_rate_basis_points, tax_pence, scope, accepted_at, sent_at)
select '00000000-0000-4000-8000-000000000901', 'FFQ-PRE-' || n, n, '$case', 100, 0, 0, 'x', case when '$case' = 'accepted' then now() end, case when '$case' = 'accepted' then now() end from generate_series(1, 2) n;
SQL
  if "${PSQL[@]}" -d "$db" -f "$LAST" >"$WORK/pre" 2>&1; then echo "FAIL pre-flight allowed duplicate $case quotations"; status=1
  elif grep -q "Pre-flight failed: an enquiry has more than one $case quotation" "$WORK/pre" && [ "$("${PSQL[@]}" -d "$db" -c "select count(*) from information_schema.columns where table_name = 'quotes' and column_name = 'line_items'" | tr -d ' ')" = 0 ]; then
    echo "PASS pre-flight stops on duplicate $case quotations and changes nothing"
  else echo "FAIL pre-flight message for $case"; cat "$WORK/pre"; status=1; fi
done
exit $status
