import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';

/**
 * Авторизация по Bearer-токену с константным временем сравнения.
 *
 * Защита от timing attack: используется crypto.timingSafeEqual вместо XOR-цикла,
 * как в оригинале. XOR-цикл тоже constant-time, но timingSafeEqual — это нативная
 * гарантия от Node и проверена аудиторами.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization token required' });
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  // Сравниваем буферы одинаковой длины, иначе timingSafeEqual бросает RangeError.
  const tokenBuf = Buffer.from(token, 'utf-8');
  const expectedBuf = Buffer.from(config.authToken, 'utf-8');

  if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  next();
}
