const { eq } = require('drizzle-orm');
const { db } = require('../db/client');
const { systemSettings } = require('../db/schema');

async function getSetting(key, defaultValue) {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return row ? row.value : defaultValue;
}

module.exports = { getSetting };
