# Contributing to MTProto Suite

Thank you for your interest in contributing! This document explains how to set up the development environment, coding standards, and the contribution process.

## 📋 Table of Contents

- [Code of Conduct](#-code-of-conduct)
- [How to Contribute](#-how-to-contribute)
- [Development Setup](#-development-setup)
- [Project Structure](#-project-structure)
- [Coding Standards](#-coding-standards)
- [Testing](#-testing)
- [Commit Messages](#-commit-messages)
- [Pull Request Process](#-pull-request-process)
- [Release Process](#-release-process)

---

## 🤝 Code of Conduct

### Our Pledge

We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Expected Behavior

- Be welcoming and inclusive
- Be respectful of differing viewpoints
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards other community members

### Unacceptable Behavior

- Harassment, trolling, or discriminatory language
- Publishing others' private information without permission
- Spam, trolling, or flaming
- Any conduct that would be inappropriate in a professional setting

---

## 🛠 How to Contribute

### Reporting Bugs

1. **Search existing issues** — your bug may already be reported
2. **Use the bug report template** — fill in all sections
3. **Include reproduction steps** — clear, minimal steps
4. **Include environment** — OS, Docker version, panel/node versions

### Suggesting Features

1. **Search existing issues** — feature may already be requested
2. **Use the feature request template**
3. **Explain the use case** — what problem does it solve?
4. **Consider alternatives** — what other approaches exist?

### Contributing Code

1. **Start small** — fix typos, documentation, small bugs first
2. **Open an issue first** — discuss major changes before coding
3. **Follow coding standards** (below)
4. **Write tests** — for new functionality
5. **Update documentation** — code + docs change together

### Improving Documentation

1. **Fix typos** — directly open PR
2. **Improve clarity** — open PR with rationale
3. **Add examples** — encouraged!
4. **Translate** — currently English + Russian, add other languages

---

## 💻 Development Setup

### Prerequisites

- **Node.js ≥ 20** (LTS recommended)
- **npm ≥ 10**
- **Docker ≥ 20.10**
- **Docker Compose plugin ≥ 2.0**
- **Git ≥ 2.30**
- **VS Code** (recommended) or any TypeScript-aware editor

### Initial Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/mtproto-suite.git
cd mtproto-suite

# Add upstream
git remote add upstream https://github.com/ns8-support/mtproto-suite.git

# Install all packages
cd shared && npm install && npm run build && cd ..
cd service-node && npm link ../shared && npm install && npm run build && cd ..
cd panel-backend && npm link ../shared && npm install && npm run build && cd ..
cd panel-frontend && npm link ../shared && npm install && npm run build && cd ..

# Setup database for panel-backend
cd panel-backend
docker run -d --name mtproto-postgres-dev \
  -e POSTGRES_PASSWORD=devpassword \
  -e POSTGRES_USER=mtproto \
  -e POSTGRES_DB=mtproto_panel \
  -p 5432:5432 \
  postgres:16-alpine
cd ..

# Create dev .env file
cat > panel-backend/.env << EOF
PORT=3000
JWT_SECRET=$(openssl rand -hex 32)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mtproto_panel
DB_USER=mtproto
DB_PASSWORD=devpassword
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin1234
NODE_ENV=development
EOF
```

### Running in Dev Mode

```bash
# Terminal 1: Panel backend (with hot reload)
cd panel-backend
npm run dev

# Terminal 2: Panel frontend (Vite HMR)
cd panel-frontend
npm run dev

# Terminal 3: Service node (if testing node features)
cd service-node
# Generate test AUTH_TOKEN
echo "AUTH_TOKEN=$(openssl rand -hex 32)" > .env
echo "PORT=8443" >> .env
echo "NGINX_PORT=443" >> .env
echo "DATA_DIR=./data" >> .env
npm run dev
```

### Development URLs

- **Backend API**: http://localhost:3000/api/*
- **Frontend**: http://localhost:5173
- **Vite proxy** automatically forwards `/api/*` to backend

### Running Tests

```bash
# Type checking (all packages)
cd shared && npm run lint && cd ..
cd service-node && npm run lint && cd ..
cd panel-backend && npm run lint && cd ..

# Or run all at once
for pkg in shared service-node panel-backend; do
  echo "=== $pkg ==="
  (cd $pkg && npm run lint)
done
```

---

## 📁 Project Structure

```
mtproto-suite/
├── shared/                    # Common types & utilities
│   ├── types/
│   │   ├── proxy.ts           # ProxyConfig, ProxyStats
│   │   ├── vless.ts           # VLESS types
│   │   ├── monitoring.ts      # NodeMetrics, ContainerStats
│   │   └── api.ts             # API contracts
│   └── utils/
│       ├── tar.ts             # createTarBuffer
│       ├── fetch.ts           # fetchWithTimeout
│       └── logger.ts          # Structured JSON logger
│
├── service-node/              # Proxy runtime
├── panel-backend/             # API server
├── panel-frontend/            # React SPA
├── docs/                      # Documentation
├── install.sh                 # Unified installer
└── docker-compose.yml
```

### Where to Add Code

| Feature | Location |
|---|---|
| New API endpoint | `panel-backend/src/routes/` |
| New business logic | `panel-backend/src/services/` |
| New type/interface | `shared/types/` |
| New utility function | `shared/utils/` |
| New SSH operation | `panel-backend/src/services/ssh/` |
| New NetBird feature | `panel-backend/src/services/netbird/` |
| New UI component | `panel-frontend/src/components/` |
| New page | `panel-frontend/src/pages/` |
| New Docker container | Add to `docker-compose.yml` |

---

## 🎨 Coding Standards

### TypeScript

- **Strict mode** — `strict: true` in tsconfig.json (already enabled)
- **No `any`** — use proper types or `unknown` if needed
- **Explicit return types** for exported functions
- **Async/await** — prefer over Promise chains
- **Error handling** — always catch and log
- **Logging** — use `logger.info/warn/error` from `shared/utils/logger`

**Example:**
```typescript
// ❌ Bad
export async function getMetrics(id: any): Promise<any> {
  try {
    return await fetchData(id);
  } catch (e) {
    console.log('error', e);
    return null;
  }
}

// ✅ Good
export async function getMetrics(nodeId: number): Promise<Metrics | null> {
  try {
    return await fetchData(nodeId);
  } catch (err: any) {
    logger.error('metrics', `Failed to get metrics for ${nodeId}`, {
      error: err.message,
    });
    return null;
  }
}
```

### React

- **Functional components** — no class components
- **Hooks** — use `useAsync` from `panel-frontend/src/hooks/useAsync.ts`
- **TypeScript types** for props (`interface ComponentProps`)
- **No inline styles** — use CSS modules or styled components
- **Accessibility** — proper `aria-*` attributes, semantic HTML

**Example:**
```typescript
// ✅ Good
interface MetricsCardProps {
  metrics: NodeMetrics;
  onRefresh?: () => void;
}

export function MetricsCard({ metrics, onRefresh }: MetricsCardProps) {
  return (
    <div className="metrics-card" aria-label="Node metrics">
      <h3>Metrics</h3>
      {/* ... */}
    </div>
  );
}
```

### Backend Routes

- **RESTful conventions** — GET/POST/PUT/DELETE
- **Async route handlers** — no callback-style
- **Typed request/response** — use TypeScript interfaces
- **Error responses** — `{ error: 'message' }`
- **Status codes** — proper HTTP codes (200, 201, 400, 401, 404, 500, 502)
- **Authentication** — always use `authMiddleware`
- **Validation** — validate ALL user input
- **Logging** — log important operations with context

**Example:**
```typescript
// ✅ Good
router.post('/:id/metrics', async (req: AuthRequest, res: Response) => {
  const nodeId = parseInt(req.params.id, 10);
  if (!nodeId) {
    res.status(400).json({ error: 'Invalid node id' });
    return;
  }

  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  try {
    const metrics = await getNodeMetrics(ssh, nodeId);
    res.json(metrics);
  } catch (err: any) {
    logger.error('monitoring', `Failed for node ${nodeId}`, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
```

### Bash Scripts

- **Use `set -e`** — fail on errors
- **Quote variables** — `"$VAR"` not `$VAR`
- **Use functions** for repeated logic
- **Validate inputs** — check before use
- **Use `readonly`** for constants
- **Color output** — use `\033` escape codes for status messages

---

## 🧪 Testing

### Current Status

⚠️ **Test coverage is incomplete.** We welcome PRs adding tests.

### Recommended Test Types

1. **Unit tests** — for individual functions
   - Use `vitest` or `jest`
   - Mock external dependencies
2. **Integration tests** — for API endpoints
   - Use `supertest` for Express
   - Test against real PostgreSQL (testcontainers)
3. **E2E tests** — for full workflows
   - Use `playwright` for browser tests
   - Test with real Docker setup

### Setting Up Tests

```bash
# Install test dependencies (in package.json devDependencies)
npm install --save-dev vitest supertest @types/supertest
```

### Writing a Test

```typescript
// service-node/src/utils/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { generateSecret } from './crypto';

describe('crypto', () => {
  it('generates 32-char hex string', () => {
    const secret = generateSecret();
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[0-9a-f]+$/);
  });
});
```

### Running Tests

```bash
cd panel-backend
npm test
```

---

## 📝 Commit Messages

We follow **Conventional Commits** specification.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `style` — formatting (no code change)
- `refactor` — code change that neither fixes bug nor adds feature
- `perf` — performance improvement
- `test` — adding tests
- `chore` — build/tooling changes

### Scopes

- `panel` — panel-backend
- `node` — service-node
- `frontend` — panel-frontend
- `shared` — shared package
- `docs` — documentation
- `ci` — CI/CD
- `deps` — dependencies

### Examples

```
feat(panel): add wildcard SSL via Cloudflare

- Implement Cloudflare DNS-01 challenge for Let's Encrypt
- Add ACME client with acme-client v5
- Generate wildcard cert via panel UI

Closes #42
```

```
fix(node): prevent race condition in store updates

Add mutex for serializing writes to store.json.
Atomic write via .tmp + rename.

Fixes #56
```

```
docs: add TROUBLESHOOTING.md
```

---

## 🔄 Pull Request Process

### Before Opening PR

1. **Sync with upstream**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run tests locally**
   ```bash
   for pkg in shared service-node panel-backend; do
     (cd $pkg && npm run lint)
   done
   ```

3. **Update CHANGELOG.md** (for user-facing changes)

4. **Update documentation** (for new features)

### Opening PR

1. **Use the PR template** — fill in all sections
2. **Reference issues** — "Fixes #123", "Closes #456"
3. **Add screenshots** — for UI changes
4. **Keep PRs focused** — one feature per PR
5. **Small PRs** — under 500 lines if possible

### PR Title Format

Same as commit subject:
```
feat(panel): add NetBird integration
fix(node): prevent store.json corruption
docs: add troubleshooting guide
```

### PR Review Process

1. **Automated checks** — CI runs lint, build, tests
2. **Code review** — at least 1 maintainer approval
3. **Testing** — maintainer tests in dev environment
4. **Merge** — squash and merge after approval

### After Merge

1. **Delete branch** (auto-deleted by GitHub)
2. **Update CHANGELOG.md** if not done
3. **Close related issues**

---

## 🚀 Release Process

### Versioning

We follow **Semantic Versioning**:
- `MAJOR.MINOR.PATCH` (e.g., 2.0.0)
- MAJOR: breaking changes
- MINOR: new features (backward-compatible)
- PATCH: bug fixes (backward-compatible)

### Release Steps

1. **Update version** in all `package.json` files
2. **Update CHANGELOG.md** with release notes
3. **Create git tag** `v2.0.0`
4. **GitHub release** with notes from CHANGELOG
5. **Docker Hub** — push new image tags
6. **Announce** — GitHub Discussions, Twitter, etc.

### Release Checklist

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Migration guide (if breaking changes)
- [ ] Security audit (if security fixes)

---

## 🏷 Areas for Contribution

### High Priority

- [ ] **Unit tests** for backend services
- [ ] **Integration tests** for API endpoints
- [ ] **E2E tests** with Playwright
- [ ] **Rate limiting** middleware (security)
- [ ] **Audit logging** for admin actions
- [ ] **Webhooks** (Slack, Telegram notifications)

### Medium Priority

- [ ] **Multi-user roles** (admin, operator, viewer)
- [ ] **Prometheus exporter** for metrics
- [ ] **WebSocket** for real-time updates (vs polling)
- [ ] **Internationalization** (more languages)
- [ ] **Dark mode** for UI
- [ ] **Bulk proxy operations** (create 100 at once)

### Low Priority

- [ ] **CLI tool** for management without UI
- [ ] **VSCode extension** for config editing
- [ ] **Terraform provider** for IaC
- [ ] **Helm chart** for Kubernetes
- [ ] **Mobile app** (React Native)

---

## 📞 Communication

- **GitHub Issues**: https://github.com/ns8-support/mtproto-suite/issues
- **GitHub Discussions**: https://github.com/ns8-support/mtproto-suite/discussions
- **Email**: dev@mtproto-suite.example.com (placeholder)
- **Telegram**: TBD

For security issues, see [SECURITY.md](docs/SECURITY.md) for responsible disclosure.

---

## 🙏 Recognition

Contributors are recognized in:
- `CONTRIBUTORS.md` (auto-generated)
- Release notes
- GitHub contributors page

Thank you for making MTProto Suite better! 🎉
