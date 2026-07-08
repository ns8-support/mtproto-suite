import { createReadStream, ReadStream } from 'fs';
import { Readable } from 'stream';

/**
 * Создаёт корректный tar-архив с одним файлом, пригодный для `docker.putArchive`.
 *
 * Используется и в docker.ts, и в nginx.ts, и в xray.ts (раньше было три копии этой функции).
 *
 * Почему не tar-библиотека:
 * - Файлы маленькие (конфиги < 10 КБ)
 * - Нет внешних зависимостей → меньше размер образа и zero vulnerabilities
 * - Формат простой: один файл + header + padding + EOF block
 *
 * Если в будущем понадобится многофайловый архив — стоит добавить `tar-stream` зависимостью.
 */
export function createTarBuffer(filename: string, content: string): Buffer {
  const contentBuffer = Buffer.from(content, 'utf-8');
  const header = Buffer.alloc(512);

  // Filename (max 100 chars)
  header.write(filename, 0, 100);
  // File mode: 0644
  header.write('0000644\0', 100, 8);
  // Owner UID
  header.write('0000000\0', 108, 8);
  // Group GID
  header.write('0000000\0', 116, 8);
  // File size in octal
  header.write(contentBuffer.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  // Modification time
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12);
  // Blank checksum field (will be filled below)
  header.write('        ', 148, 8);
  // Type flag: '0' = normal file
  header.write('0', 156, 1);

  // Compute checksum: sum of all bytes in the header, treating the checksum field
  // itself as spaces (already blanked above).
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i];
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);

  // Pad file content to 512-byte boundary
  const padding = 512 - (contentBuffer.length % 512);
  const paddingBuffer = padding < 512 ? Buffer.alloc(padding) : Buffer.alloc(0);

  // Two 512-byte blocks of zeros to mark end of archive
  const endBlock = Buffer.alloc(1024);

  return Buffer.concat([header, contentBuffer, paddingBuffer, endBlock]);
}

/**
 * Парсит IP-адрес из строки (берётся первое вхождение IPv4).
 *
 * Заменяет повторяющийся regex `/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g` в docker.ts/nginx.ts.
 */
export function extractIp(text: string): string | null {
  const match = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  return match ? match[1] : null;
}
