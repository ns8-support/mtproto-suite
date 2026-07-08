import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { config } from '../config';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { sanitizeErrorMessage } from '../utils/error-sanitizer';
import { logger } from '../../../shared/utils/logger';

const router = Router();

router.post('/login', async (req: AuthRequest, res: Response) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      // Одинаковый ответ с реальным пользователем — защита от username enumeration.
      await bcrypt.compare(password, '$2b$12$dummyhashdummyhashdummyhashdummyhashdumm');
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error: any) {
    logger.error('auth', 'Login error', { error: error.message });
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

export default router;
