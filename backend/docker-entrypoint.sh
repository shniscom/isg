#!/bin/sh
set -e

echo "Veritabani migrasyonlari uygulaniyor..."
node src/db/migrate.js

echo "Baslangic verileri (roller/izinler/admin) kontrol ediliyor..."
node src/db/seed.js

echo "API baslatiliyor..."
exec "$@"
