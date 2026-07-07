/**
 * Типы для мониторинга нод.
 *
 * Используются на panel-backend (для сбора и хранения) и panel-frontend (для отображения).
 *
 * Метрики собираются через SSH (выполнение стандартных Linux команд на удалённой ноде).
 * Не требуют установки агента на ноде — работает "из коробки" на любом Linux.
 */

export interface CpuMetrics {
  /** Загрузка CPU в процентах (0-100, multi-core). */
  usagePercent: number;
  /** Количество ядер. */
  cores: number;
  /** Load average за 1 минуту. */
  loadAvg1: number;
  /** Load average за 5 минут. */
  loadAvg5: number;
  /** Load average за 15 минут. */
  loadAvg15: number;
  /** Модель процессора. */
  model: string;
}

export interface MemoryMetrics {
  /** Всего RAM в байтах. */
  totalBytes: number;
  /** Использовано в байтах. */
  usedBytes: number;
  /** Свободно в байтах. */
  freeBytes: number;
  /** Использовано в процентах (0-100). */
  usagePercent: number;
  /** Swap всего в байтах. */
  swapTotalBytes: number;
  /** Swap использовано в байтах. */
  swapUsedBytes: number;
}

export interface DiskMetrics {
  /** Точка монтирования. */
  mountPoint: string;
  /** Всего в байтах. */
  totalBytes: number;
  /** Использовано в байтах. */
  usedBytes: number;
  /** Свободно в байтах. */
  freeBytes: number;
  /** Использовано в процентах (0-100). */
  usagePercent: number;
  /** Файловая система (ext4, xfs, tmpfs, и т.д.). */
  filesystem: string;
}

export interface SystemInfo {
  hostname: string;
  /** ОС (Ubuntu, Debian, CentOS, и т.д.). */
  os: string;
  /** Версия ОС. */
  osVersion: string;
  /** Версия ядра Linux. */
  kernel: string;
  /** Архитектура (x86_64, aarch64). */
  arch: string;
  /** Время работы в секундах. */
  uptimeSeconds: number;
  /** Текущее время на сервере (ISO). */
  currentTime: string;
  /** IP адреса всех интерфейсов. */
  ipAddresses: string[];
}

export interface ContainerStats {
  /** Имя контейнера. */
  name: string;
  /** Образ (например, "telemt-proxy-v4"). */
  image: string;
  /** Статус: running, stopped, paused, restarting, dead. */
  status: string;
  /** Created timestamp. */
  created: string;
  /** CPU usage % (может быть 0 для stopped). */
  cpuPercent: number;
  /** Memory usage в байтах. */
  memoryBytes: number;
  /** Memory limit в байтах. */
  memoryLimit: number;
  /** Network RX bytes (всего с момента создания). */
  networkRxBytes: number;
  /** Network TX bytes (всего с момента создания). */
  networkTxBytes: number;
}

export interface NodeMetrics {
  nodeId: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  /** Все диски (обычно 1-2: root и /boot). */
  disks: DiskMetrics[];
  /** Информация о Docker контейнерах на ноде. */
  containers: ContainerStats[];
  /** Timestamp сбора. */
  collectedAt: string;
}

export interface MetricsHistoryPoint {
  timestamp: string;
  cpuPercent: number;
  memoryPercent: number;
  /** Disk usage % главного диска. */
  diskPercent: number;
  /** Количество контейнеров в статусе running. */
  runningContainers: number;
}

export type MetricsHistory = MetricsHistoryPoint[];

export interface NodeHealth {
  /** Общий статус: healthy, degraded, critical, unreachable. */
  status: 'healthy' | 'degraded' | 'critical' | 'unreachable';
  /** Детали по каждой метрике. */
  checks: {
    cpu: 'ok' | 'warning' | 'critical';
    memory: 'ok' | 'warning' | 'critical';
    disk: 'ok' | 'warning' | 'critical';
    containers: 'ok' | 'warning' | 'critical';
  };
  /** Сообщение для UI. */
  message: string;
}

// ============ NetBird integration ============

export interface NetBirdStatus {
  /** Установлен ли NetBird клиент. */
  installed: boolean;
  /** Подключён к management server. */
  connected: boolean;
  /** Внутренний IP в mesh сети. */
  meshIp: string | null;
  /** Peer name в NetBird. */
  peerName: string | null;
  /** Management server URL. */
  managementUrl: string | null;
  /** Версия клиента. */
  version: string | null;
  /** Список других peers в mesh. */
  peers: Array<{
    name: string;
    ip: string;
    connected: boolean;
  }>;
}

export interface NetBirdInstallRequest {
  /** Setup key из NetBird management server. */
  setupKey: string;
  /** Management server URL (опционально — для self-hosted). */
  managementUrl?: string;
  /** Hostname для этого peer (default — текущий hostname сервера). */
  hostname?: string;
}
