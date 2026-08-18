require('dotenv').config();
const { createApp } = require('./app');
const { startScheduler } = require('./services/scheduler.service');

const PORT = process.env.PORT || 4000;

const app = createApp();

app.listen(PORT, () => {
  console.log(`İSG Takip API ${PORT} portunda çalışıyor (env: ${process.env.NODE_ENV || 'development'})`);
  startScheduler();
});
