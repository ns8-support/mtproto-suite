import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { JwtPayload } from '../types';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/**
 * JWT авторизация.
 *
 * Исправление: оригинал делал `payload = jwt.verify(...)` без type assertion,
 * что позволяло принимать токены с произвольным payload. Теперь типизируем.
 */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    // jwt.verify возвращает string | object — кастуем строго к JwtPayload.
    const payload = jwt.verify(token, config.jwtSecret) as unknown as JwtPayload;
    if (typeof payload.userId !== 'number' || typeof payload.username !== 'string') {
      res.status(401).json({ error: 'Malformed token payload' });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
