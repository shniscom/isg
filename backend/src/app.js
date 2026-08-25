const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.set('trust proxy', 1); // Coolify/nginx arkasında doğru IP tespiti için

  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Bazı uçlar (ör. /penalties/:id/approve) gövdesiz POST isteğiyle çağrılabilir; tarayıcı
  // istemcisi (axios) bu durumda Content-Type göndermez ve express.json() req.body'yi hiç
  // dokunmadan bırakır (undefined kalır). zod'un `z.object({...}).safeParse(undefined)` her
  // zaman başarısız olduğundan, tamamen opsiyonel alanlı gövdeler bile "Geçersiz istek" (400)
  // hatası veriyordu. Burada req.body her zaman en azından boş bir nesne olacak şekilde
  // garanti altına alınır.
  app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  });

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
