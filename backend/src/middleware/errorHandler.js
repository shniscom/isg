const { ApiError } = require('../utils/apiError');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Rota bulunamadı: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isApiError = err instanceof ApiError;
  const statusCode = isApiError ? err.statusCode : 500;

  if (!isApiError) {
    console.error('Beklenmeyen hata:', err);
  }

  res.status(statusCode).json({
    error: {
      message: isApiError ? err.message : 'Sunucuda beklenmeyen bir hata oluştu.',
      details: isApiError ? err.details : undefined,
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
