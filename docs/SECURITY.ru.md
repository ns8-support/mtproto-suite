# Политика безопасности

Этот документ описывает модель безопасности MTProto Suite, лучшие практики и как сообщать об уязвимостях.

[🇬🇧 English version](SECURITY.md)

## 📋 Содержание

- [Поддерживаемые версии](#-поддерживаемые-версии)
- [Аудит SSH credentials](#-аудит-ssh-credentials)
- [Сообщение об уязвимости](#-сообщение-об-уязвимости)
- [Архитектура безопасности](#-архитектура-безопасности)
- [Модель угроз](#-модель-угроз)
- [Лучшие практики безопасности](#-лучшие-практики-безопасности)
- [Руководство по усилению защиты](#-руководство-по-усилению-защиты)
- [Соответствие требованиям](#-соответствие-требованиям)

---

## 🛡 Поддерживаемые версии

| Версия | Поддерживается | Обновления безопасности |
|---|---|---|
| 2.x.x | ✅ Активная | Да |
| 1.x.x | ❌ End-of-life | Нет (обновитесь до 2.x) |
| < 1.0 | ❌ End-of-life | Нет |

Только последняя major версия получает обновления безопасности.

## 🔍 Аудит безопасности SSH credentials

Полный аудит обработки SSH credentials (логины, пароли, приватные ключи) проведён в [SECURITY_AUDIT_SSH.md](SECURITY_AUDIT_SSH.md).

### Краткая сводка аудита

**✅ Защищено от утечек credentials:**
- Пароли НЕ логируются в открытом виде
- Приватные ключи НЕ логируются
- Credentials передаются per-request через HTTPS, не сохраняются
- JWT защищает все endpoints
- Все SSH команды захардкожены (нет command injection)
- Input validation (IPv4, port, token) перед SSH подключением
- SSH соединение всегда закрывается (try/finally)

**✅ Добавлены дополнительные защиты:**
- CORS whitelist (только панель frontend может делать запросы)
- Rate limiting на SSH endpoints (10 запросов за 5 минут)
- Sanitization error messages (нет утечек stack traces, IP, путей)
- Security headers (HSTS, X-Frame-Options, X-Content-Type-Options)
- Logger auto-redaction для password, token, privateKey, secret
- Global error handler с разделением server logs vs client response

См. [SECURITY_AUDIT_SSH.md](SECURITY_AUDIT_SSH.md) для детального отчёта.

---

## 📢 Сообщение об уязвимости

Мы серьёзно относимся к безопасности. Если вы обнаружили уязвимость:

### Как сообщить

**Email:** ns8sup@gmail.com (placeholder — настройте реальный email)

**GitHub:** https://github.com/mtproto-suite/mtproto-suite/security/advisories/new (приватное раскрытие)

**НЕ** открывайте публичный GitHub issue для уязвимостей безопасности.

### Что включить

1. **Описание** уязвимости
2. **Шаги для воспроизведения** (proof-of-concept)
3. **Затронутые версии**
4. **Оценка воздействия** (что может сделать атакующий)
5. **Ваши контактные данные** (для уточняющих вопросов)

### Сроки реагирования

| Этап | Срок |
|---|---|
| Подтверждение получения | В течение 48 часов |
| Первичная оценка | В течение 7 дней |
| Выпуск исправления | В течение 30 дней (критично: 7 дней) |
| Публичное раскрытие | После того, как исправление будет широко развёрнуто |

### Программа вознаграждений

В настоящее время мы не предлагаем программу bug bounty. Авторство будет указано в release notes для подтверждённых отчётов.

---

## 🏗 Архитектура безопасности

### Слои аутентификации

**Слой 1: Panel API (JWT)**
- Алгоритм: HS256
- Срок действия: 24 часа (настраивается)
- Секрет: 64-символьный hex (256-битная энтропия)
- Хранение: PostgreSQL `users.password_hash` (bcrypt cost 12)
- Транспорт: только HTTPS (TLS 1.2/1.3)

**Слой 2: Service Node API (Bearer Token)**
- Статический токен, 64-символьный hex (256-бит)
- Сравнение: `crypto.timingSafeEqual` (constant-time)
- Транспорт: рекомендуется HTTPS
- Авто-генерируется `install.sh --mode=node`

**Слой 3: SSH (Панель → Нода)**
- Методы: Пароль ИЛИ OpenSSH приватный ключ
- Опциональная passphrase
- Соединение: Новая SSH сессия на каждый запрос (без persistent connection)
- Credentials: Передаются per-request через HTTPS, никогда не сохраняются

**Слой 4: База данных (Внутренний)**
- PostgreSQL в приватной Docker сети
- Без внешнего доступа (только панель)
- Параметризованные запросы (SQL инъекция невозможна)

**Слой 5: Docker (Внутренний)**
- Контейнеры работают в bridge сети `mtproto-net`
- nginx использует host network (для порта 443 + видимости IP клиентов)
- Изоляция volumes (данные персистентны на хосте)

### Криптографические алгоритмы

| Назначение | Алгоритм | Параметры |
|---|---|---|
| Хеширование паролей | bcrypt | cost 12 (≈250мс на хеш) |
| Подпись JWT | HMAC-SHA256 | 256-битный секрет |
| Сравнение токенов | timingSafeEqual | (встроенный) |
| TLS | TLS 1.2 / 1.3 | Современный cipher suite |
| SSL (Let's Encrypt) | RSA 2048 | ACME v2 |
| SSH | ed25519 / RSA 4096 | OpenSSH формат |

### Настройки безопасности по умолчанию

✅ **Включено по умолчанию:**
- JWT_SECRET должен быть установлен (нет небезопасного дефолта)
- AUTH_TOKEN должен быть ≥16 символов (нет пустого токена)
- HTTPS рекомендован в install.sh
- Заголовок `Strict-Transport-Security`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- bcrypt cost 12 для admin пароля
- `timingSafeEqual` для сравнения токенов
- Защита от username enumeration
- Файлы `.env` chmod 600
- Docker контейнеры `restart: unless-stopped`

❌ **Отключено по умолчанию (требует явного opt-in):**
- TLS для панели (только HTTP — для dev/тестирования)
- Публичное IP панели (полагается на firewall)
- Самоподписанные сертификаты (предупреждение пользователю)

---

## 🎯 Модель угроз

### Атакующие

**Уровень 1: Случайные атакующие / скрипт-кидди**
- Возможности: Автоматическое сканирование
- Мотивация: Низкая
- Митигация: Стандартный firewall, нет известных эксплойтов

**Уровень 2: Хактивисты**
- Возможности: Целевые атаки на Telegram-инфраструктуру
- Мотивация: Средняя
- Митигация: TLS, сильная auth, мониторинг

**Уровень 3: Государственные субъекты (РКН, GFW)**
- Возможности: Deep packet inspection, анализ трафика
- Мотивация: Блокировка MTProto трафика
- Митигация: fake TLS через SNI, VLESS/Reality VPN

**Уровень 4: Инсайдерские угрозы**
- Возможности: Доступ к admin панели или SSH
- Мотивация: Саботаж, шпионаж
- Митигация: Audit логи (запланировано), принцип минимальных привилегий

### Адресуемые угрозы

| Угроза | Вектор | Митигация |
|---|---|---|
| **Брутфорс credentials** | `/api/auth/login` | bcrypt (медленный), JWT срок 24ч, нет password lockout (рекомендуется fail2ban) |
| **Кража токена** | XSS, MITM | Только HTTPS, localStorage (не cookie), SameSite=Strict |
| **Timing-атака на токен** | Side-channel | `timingSafeEqual` |
| **Username enumeration** | Response timing | Идентичный bcrypt для неизвестных пользователей |
| **SQL инъекция** | API запросы | Параметризованные запросы (pg library) |
| **CSRF** | Браузерные запросы | Bearer-токен (не cookie-based) |
| **MITM на API** | Сеть | TLS 1.2/1.3 принудительный |
| **Container escape** | Скомпрометированный прокси | Docker изоляция, non-root user внутри контейнеров (запланировано) |
| **Fake TLS fingerprinting** | DPI | `tls_emulation: true`, кастомные cipher suites |
| **Брутфорс SSH** | Панель → Нода | SSH credentials не сохраняются (передаются per-request) |
| **MITM на SSH** | Сеть | SSH протокол (встроенное шифрование) |
| **Replay атака на действия** | API | JWT включает срок действия, ротация токенов |

### Неадресуемые угрозы (вне scope)

- **Физический доступ к серверам** — если атакующий имеет root, игра окончена
- **Скомпрометированный Docker daemon** — обходит изоляцию контейнеров
- **Скомпрометированное ядро ОС** — обходит всю изоляцию
- **Side-channel атаки** (Spectre, Meltdown) — требуют патчей ядра
- **Telegram-банны** — обрабатываются ME серверами (функция telemt)
- **Юридические/регуляторные** — ответственность пользователя по соблюдению местных законов

### Принятие рисков

| Риск | Уровень | Принят? |
|---|---|---|
| HTTP-only панель (dev режим) | Высокий | Только для локальной разработки |
| Самоподписанный TLS | Средний | Для внутренних сетей |
| Долгоживущие SSH credentials | Средний | Митигировано короткоживущими SSH сессиями |
| Нет audit log (v2.0) | Средний | Запланировано в v2.1 |
| Нет rate limiting | Средний | Рекомендуется `express-rate-limit` |
| Нет обнаружения вторжений | Средний | Рекомендуется Fail2ban |

---

## ✅ Лучшие практики безопасности

### Для операторов панели

1. **Используйте HTTPS** — никогда не выставляйте панель через HTTP в production
2. **Используйте Let's Encrypt** — не самоподписанный
3. **Сильный пароль админа** — минимум 16 символов, случайный
4. **Ограничьте сетевой доступ** — firewall панели только для доверенных IP
5. **Регулярные обновления** — поддерживайте панель и ноды в актуальном состоянии
6. **Бэкап `.env` файлов** — зашифрованный бэкап секретов
7. **Мониторинг логов** — оповещения о подозрительной активности
8. **Используйте SSH ключи** — отключите password SSH на нодах
9. **Ротация токенов** — периодически перегенерируйте AUTH_TOKEN
10. **Аудит доступа** — проверяйте, кто имеет доступ к панели

### Для операторов нод

1. **Отключите password SSH** — `PasswordAuthentication no` в `/etc/ssh/sshd_config`
2. **Используйте SSH ключи с passphrase** — защита от кражи ключа
3. **Включите UFW** — открывайте только необходимые порты
4. **Включите автоматические обновления безопасности** — `unattended-upgrades`
5. **Мониторьте Docker** — `docker events` для жизненного цикла контейнеров
6. **Ограничьте Docker сокет** — доступ только root
7. **Используйте fail2ban** — защита от SSH брутфорса
8. **Аудит пользователей** — `last`, `lastlog`, `/var/log/auth.log`
9. **Патчите ядро** — `apt upgrade linux-image-*` регулярно
10. **Бэкап данных** — ежедневные снапшоты `/opt/mtproto-suite`

### Для конечных пользователей (Telegram клиенты)

1. **Используйте официальное приложение Telegram** — проверенное, без бэкдоров
2. **Проверяйте URL прокси** — вставляйте в Telegram, не в браузер
3. **Используйте VPN параллельно** — для двойной приватности
4. **Не делитесь tg:// ссылками** — каждый пользователь должен иметь уникальный прокси

---

## 🔧 Руководство по усилению защиты

### Усиление панели

#### 1. Только HTTPS

```bash
# Переустановить с Let's Encrypt
bash install.sh --mode=panel --ssl-letsencrypt panel.example.com

# Или вручную: редирект HTTP на HTTPS в nginx
# Отредактируйте panel-frontend/nginx.conf:
server {
    listen 80;
    server_name panel.example.com;
    return 301 https://$server_name$request_uri;
}
```

#### 2. Правила firewall

```bash
# UFW (Ubuntu/Debian)
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH (только с вашего IP)
ufw allow 443/tcp    # HTTPS

# Ограничить по IP (замените YOUR_IP на реальный IP)
ufw allow from YOUR_IP to any port 22

# iptables (CentOS/RHEL)
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -s YOUR_IP -j ACCEPT
iptables -A INPUT -j DROP
```

#### 3. Fail2ban

```bash
# Установить
apt-get install fail2ban

# Включить SSH jail (по умолчанию)
systemctl enable fail2ban
systemctl start fail2ban

# Проверить
fail2ban-client status sshd
```

#### 4. Сильный пароль админа

```bash
# Сгенерировать
openssl rand -base64 32

# Обновить через UI панели: Settings → Сменить пароль
# Или через SQL (если заблокированы):
docker exec -it <db-container> psql -U mtproto -d mtproto_panel -c "
UPDATE users SET password_hash = crypt('НОВЫЙ_СИЛЬНЫЙ_ПАРОЛЬ', gen_salt('bf', 12))
WHERE username = 'admin';
"
```

#### 5. Ротация секретов

```bash
# JWT_SECRET (требует перезапуска панели)
NEW_SECRET=$(openssl rand -hex 32)
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" /opt/mtproto-suite/panel-backend/.env
cd /opt/mtproto-suite && docker compose restart backend

# Все пользователи должны войти снова (существующие токены инвалидированы)

# DB_PASSWORD (более инвазивно)
NEW_PASS=$(openssl rand -hex 16)
sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=$NEW_PASS/" /opt/mtproto-suite/panel-backend/.env
# Также обновите в docker-compose.yml или файле .env
cd /opt/mtproto-suite && docker compose down && docker compose up -d

# AUTH_TOKEN (per node)
NEW_TOKEN=$(openssl rand -hex 32)
# Отредактируйте на ноде: /opt/mtproto-suite/service-node/.env
# Обновите в панели: Ноды → Редактировать → Новый токен
```

### Усиление ноды

#### 1. Только SSH ключ auth

```bash
# На ноде
sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# Тест (должно работать с вашим ключом)
ssh root@<ip-ноды> "echo 'OK'"
```

#### 2. Отключите вход под root (используйте sudo пользователя)

```bash
# Создать sudo пользователя
adduser mtproto
usermod -aG sudo mtproto
mkdir -p /home/mtproto/.ssh
cp ~/.ssh/authorized_keys /home/mtproto/.ssh/
chown -R mtproto:mtproto /home/mtproto/.ssh

# Отключить root SSH
sed -i 's/^#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart sshd

# В панели смените SSH username с "root" на "mtproto"
```

#### 3. UFW на ноде

```bash
ufw default deny incoming
ufw default allow outgoing

# SSH только с IP панели
ufw allow from <ip-панели> to any port 22

# Порт прокси (публичный)
ufw allow 443/tcp

# API ноды (только от панели)
ufw allow from <ip-панели> to any port 8443

# Включить
ufw enable
```

#### 4. Права на Docker сокет

```bash
# По умолчанию: сокет имеет rw для root и группы docker
# Только root и группа docker должны иметь доступ

# Добавить пользователей в группу docker (НЕ рекомендуется)
usermod -aG docker mtproto  # Теперь mtproto может запускать docker

# Лучше: использовать sudo для доступа к docker
echo 'mtproto ALL=(ALL) NOPASSWD: /usr/bin/docker' >> /etc/sudoers.d/mtproto
```

#### 5. Автоматические обновления безопасности

```bash
# Ubuntu/Debian
apt-get install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# CentOS/RHEL
yum install yum-cron
systemctl enable yum-cron
```

### Усиление приложения

#### 1. Rate limiting (рекомендуется)

```typescript
// panel-backend/src/index.ts
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 минут
  max: 10,                     // 10 попыток
  message: { error: 'Too many login attempts' },
});

app.use('/api/auth/login', authLimiter);
```

#### 2. Security headers

Уже настроено в `panel-frontend/nginx-ssl.conf`:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`

#### 3. Усиление CORS

```typescript
// panel-backend/src/index.ts
// В настоящее время: app.use(cors()) — разрешает ВСЕ origins
// Рекомендуется: ограничить известными origins
app.use(cors({
  origin: ['https://panel.example.com'],
  credentials: true,
}));
```

---

## 📋 Соответствие требованиям

### GDPR

MTProto Suite **не собирает персональные данные** кроме:
- Логин админа (один пользователь)
- IP адреса нод (операционные)
- IP адреса пользователей прокси (для геолокации, опционально)

Все данные хранятся локально. Нет телеметрии. Нет сторонней аналитики.

### Хранение данных

| Данные | Срок хранения | Обоснование |
|---|---|---|
| Конфигурации прокси | До удаления | Операционные |
| История статистики | 7 дней | Troubleshooting |
| История IP | До удаления | Операционные, опционально |
| Пароль админа | До изменения | Аутентификация |
| SSH credentials | Per-request (не сохраняются) | Безопасность |
| JWT токены | 24 часа (в localStorage браузера) | Аутентификация |
| Логи | 30 MB (ротируются) | Отладка |

### Права пользователей (GDPR)

Если вы управляете MTProto Suite в ЕС:
- Право на доступ: Предоставьте список пользователей (только вы сами)
- Право на удаление: Удалите пользователей из таблицы `users`
- Право на портативность: Экспортируйте данные через `pg_dump`

### Российский 152-ФЗ (Закон о персональных данных)

Если работаете в России:
- IP адреса являются персональными данными
- Хранение должно быть на российских серверах (если собираете)
- Мы не рекомендуем использовать MTProto Suite для сбора персональных данных

---

## 🔍 Чек-лист аудита безопасности

Пройдитесь по этому чек-листу перед production развёртыванием:

### Панель

- [ ] HTTPS с валидным сертификатом (не самоподписанный)
- [ ] JWT_SECRET — 64-символьный hex (256-бит)
- [ ] Пароль админа — 16+ символов, случайный
- [ ] DB_PASSWORD — 32-символьный hex
- [ ] Файлы `.env` имеют права 600
- [ ] Firewall ограничивает доступ панели к доверенным IP
- [ ] fail2ban установлен и работает
- [ ] Нет SSH password auth (только ключи)
- [ ] SSH root login отключён (используется sudo пользователь)
- [ ] Audit логи проверены на подозрительную активность

### Ноды

- [ ] AUTH_TOKEN — 64-символьный hex (256-бит)
- [ ] UFW ограничивает SSH до IP панели
- [ ] UFW ограничивает API (8443) до IP панели
- [ ] Порт прокси (443) доступен из интернета
- [ ] Только SSH ключи (нет password auth)
- [ ] Docker сокет доступен только группе docker
- [ ] Включены автоматические обновления безопасности
- [ ] Ежедневные бэкапы директории данных

### Код

- [ ] Нет `console.log` секретов
- [ ] Нет файлов `.env` в git
- [ ] Нет захардкоженных credentials
- [ ] Все SQL запросы параметризованы
- [ ] Все пользовательские вводы валидированы (IP, port, token формат)
- [ ] CORS ограничен известными origins
- [ ] Rate limiting на auth endpoints
- [ ] Зависимости обновлены (нет известных CVE)

### Операционное

- [ ] Бэкапы хранятся вне сайта (S3, зашифрованные)
- [ ] План аварийного восстановления задокументирован
- [ ] Мониторинг + оповещения настроены
- [ ] План реагирования на инциденты задокументирован
- [ ] Email для контакта по безопасности опубликован
- [ ] Все действия админов логируются (запланировано для v2.1)

---

## 📜 История изменений безопасности

### v2.0.0 (2026-07-06)

**Исправлены уязвимости из оригинального danielVNru/mtproto-panel:**

| ID | Описание | Серьёзность | Исправление |
|---|---|---|---|
| VULN-001 | JWT_SECRET захардкоженный дефолт `'change-me-in-production'` | Критично | Удалён дефолт, требует env var |
| VULN-002 | Пустой AUTH_TOKEN разрешал любой доступ | Критично | Добавлена валидация min 16 символов |
| VULN-003 | Сравнение токенов уязвимо к timing атакам | Средне | Заменено на `crypto.timingSafeEqual` |
| VULN-004 | Username enumeration через response timing | Средне | Идентичный bcrypt для неизвестных пользователей |
| VULN-005 | Нет валидации IP/port/token на /api/nodes | Средне | Добавлена строгая regex валидация |
| VULN-006 | Нет port CHECK constraint в PostgreSQL | Низкая | Добавлен `CHECK (port > 0 AND port <= 65535)` |
| VULN-007 | SSH credentials не валидировались | Низкая | Добавлена валидация для host, port, user, auth method |
| VULN-008 | HTTPS не рекомендован в install | Низкая | Сделал Let's Encrypt дефолтным предложением |

**Известные проблемы (запланировано для v2.1):**
- Нет rate limiting на auth endpoints
- Нет audit log действий админа
- CORS разрешает все origins

---

## 📞 Контакт по безопасности

- **Email:** security@mtproto-suite.example.com (placeholder)
- **GitHub Security:** https://github.com/mtproto-suite/mtproto-suite/security
- **PGP Key:** TBD (будет опубликован на сайте)

Для не-безопасных вопросов используйте GitHub Issues: https://github.com/mtproto-suite/mtproto-suite/issues
