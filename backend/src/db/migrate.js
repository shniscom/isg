require('dotenv').config();
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const path = require('path');

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL ortam değişkeni tanımlı değil.');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  console.log('Veritabanı migrasyonları uygulanıyor...');
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
  console.log('Migrasyonlar tamamlandı.');
  await pool.end();
}

run().catch((err) => {
  console.error('Migrasyon hatası:', err);
  process.exit(1);
});
