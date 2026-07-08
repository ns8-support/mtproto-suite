# Обновление GitHub Actions для Node.js 24

## ✅ Что было сделано

Обновлён файл `.github/workflows/docker-publish.yml` для устранения предупреждений о устаревшем Node.js 20.

### Изменённые версии actions:

| Action | Старая версия | Новая версия | Статус |
|--------|---------------|--------------|--------|
| `docker/build-push-action` | v5 | **v7** | ✅ Node.js 24 |
| `docker/login-action` | v3 | **v4** | ✅ Node.js 24 |
| `docker/setup-buildx-action` | v3 | **v4** | ✅ Node.js 24 |
| `docker/metadata-action` | v5 | **v6** | ✅ Node.js 24 |
| `actions/checkout` | v4 | v4 | ⚠️ Node.js 20 (форсирован Node.js 24) |

### Добавлена переменная окружения:

```yaml
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
```

Эта переменная принудительно запускает все actions на Node.js 24, даже если они ещё не обновили свою конфигурацию.

## 📋 Что нужно сделать

### 1. Закоммитить изменения

```bash
cd /home/user/mtproto-suite
git add .github/workflows/docker-publish.yml
git commit -m "fix(ci): update GitHub Actions to Node.js 24 compatible versions"
```

### 2. Запушить в GitHub

```bash
git push origin main
```

### 3. Проверить workflow

После push перейдите в:
```
https://github.com/ns8-support/mtproto-suite/actions
```

Убедитесь, что:
- ✅ Workflow "Build and Publish Docker Images" запустился
- ✅ Нет предупреждений о Node.js 20
- ✅ Все шаги выполнены успешно

## 🔍 Проверка файла

Текущее содержимое `.github/workflows/docker-publish.yml`:

```yaml
name: Build and Publish Docker Images

on:
  push:
    branches:
      - main
    tags:
      - 'v*.*.*'
  pull_request:
    branches:
      - main

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ${{ github.repository }}
  # Force Node.js 24 for actions that still use Node.js 20
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    strategy:
      matrix:
        component:
          - name: panel-backend
            dockerfile: panel-backend/Dockerfile
            context: .
          - name: panel-frontend
            dockerfile: panel-frontend/Dockerfile
            context: .
          - name: service-node
            dockerfile: service-node/Dockerfile
            context: .

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GitHub Container Registry
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels)
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_PREFIX }}/${{ matrix.component.name }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
            type=sha,prefix={{branch}}-
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v7
        with:
          context: ${{ matrix.component.context }}
          file: ${{ matrix.component.dockerfile }}
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64

  update-readme:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Update image tags in README
        run: |
          echo "Docker images published successfully!"
          echo ""
          echo "Available images:"
          echo "  - ${{ env.REGISTRY }}/${{ env.IMAGE_PREFIX }}/panel-backend:latest"
          echo "  - ${{ env.REGISTRY }}/${{ env.IMAGE_PREFIX }}/panel-frontend:latest"
          echo "  - ${{ env.REGISTRY }}/${{ env.IMAGE_PREFIX }}/service-node:latest"
```

## 📚 Ссылки

- [GitHub Blog: Deprecation of Node.js 20 on GitHub Actions runners](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/)
- [actions/checkout](https://github.com/actions/checkout)
- [docker/build-push-action](https://github.com/docker/build-push-action)

## ⚠️ Важно

Предупреждение о Node.js 20 — это **warning, а не ошибка**. Workflow продолжит работать, но:

- **2 июня 2026** — GitHub принудительно переведёт все actions на Node.js 24
- **16 сентября 2026** — Node.js 20 будет полностью удалён из runners

Обновление сейчас предотвратит возможные проблемы в будущем.
