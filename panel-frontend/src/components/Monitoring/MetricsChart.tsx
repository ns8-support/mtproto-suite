import { useEffect, useRef } from 'react';
import type { MetricsHistoryPoint } from '@mtproto-suite/shared/types';

/**
 * Линейный график метрик (CPU / RAM / Disk) с использованием Canvas API.
 *
 * Почему не chart.js: для простого линейного графика нет смысла тянуть
 * тяжёлую библиотеку. Canvas + нативная отрисовка даёт лучший контроль.
 *
 * Опционально можно подключить chart.js для интерактивности (zoom, tooltip).
 */

interface MetricsChartProps {
  history: MetricsHistoryPoint[];
  /** Какие метрики показывать. */
  showCpu?: boolean;
  showMemory?: boolean;
  showDisk?: boolean;
  /** Высота графика в px. */
  height?: number;
}

interface SeriesConfig {
  label: string;
  color: string;
  extract: (p: MetricsHistoryPoint) => number;
}

export function MetricsChart({
  history,
  showCpu = true,
  showMemory = true,
  showDisk = true,
  height = 200,
}: MetricsChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Учитываем devicePixelRatio для retina-экранов.
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const heightPx = rect.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };

    // Очищаем.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, heightPx);

    // Рисуем сетку.
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + ((heightPx - padding.top - padding.bottom) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Подписи Y.
      const value = 100 - i * 25;
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${value}%`, padding.left - 5, y + 4);
    }
    ctx.setLineDash([]);

    // Оси.
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, heightPx - padding.bottom);
    ctx.lineTo(width - padding.right, heightPx - padding.bottom);
    ctx.stroke();

    const series: SeriesConfig[] = [];
    if (showCpu) series.push({ label: 'CPU', color: '#007bff', extract: (p) => p.cpuPercent });
    if (showMemory) series.push({ label: 'RAM', color: '#28a745', extract: (p) => p.memoryPercent });
    if (showDisk) series.push({ label: 'Disk', color: '#fd7e14', extract: (p) => p.diskPercent });

    if (series.length === 0) return;

    const xStep = (width - padding.left - padding.right) / Math.max(history.length - 1, 1);

    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      history.forEach((point, idx) => {
        const x = padding.left + idx * xStep;
        const value = Math.max(0, Math.min(100, s.extract(point)));
        const y =
          padding.top +
          (heightPx - padding.top - padding.bottom) * (1 - value / 100);

        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      // Точки на графике.
      ctx.fillStyle = s.color;
      history.forEach((point, idx) => {
        const value = Math.max(0, Math.min(100, s.extract(point)));
        if (value === 0 || value === 100) return; // Пропускаем крайние значения для чистоты
        const x = padding.left + idx * xStep;
        const y =
          padding.top +
          (heightPx - padding.top - padding.bottom) * (1 - value / 100);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Подписи X (первая и последняя точки).
    if (history.length > 0) {
      ctx.fillStyle = '#666';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(
        new Date(history[0].timestamp).toLocaleTimeString('ru-RU'),
        padding.left,
        heightPx - 10
      );
      ctx.textAlign = 'right';
      ctx.fillText(
        new Date(history[history.length - 1].timestamp).toLocaleTimeString('ru-RU'),
        width - padding.right,
        heightPx - 10
      );
    }

    // Легенда.
    const legendY = padding.top - 8;
    let legendX = padding.left;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(legendX, legendY - 6, 12, 4);
      ctx.fillStyle = '#333';
      ctx.fillText(s.label, legendX + 16, legendY);
      legendX += 60;
    }
  }, [history, showCpu, showMemory, showDisk]);

  if (history.length === 0) {
    return (
      <div className="metrics-chart empty">
        <p>Нет данных. История появится после первого сбора метрик.</p>
      </div>
    );
  }

  return (
    <div className="metrics-chart">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: `${height}px`, display: 'block' }}
      />
    </div>
  );
}
