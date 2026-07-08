import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

const router = Router();

let nodeVersion = 'unknown';
try {
  // Путь относительно dist/index.js после сборки: ../../package.json
  const pkgPath = join(__dirname, '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  nodeVersion = pkg.version || 'unknown';
} catch {
  // ignore — останется 'unknown'
}

router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: nodeVersion,
  });
});

export default router;
