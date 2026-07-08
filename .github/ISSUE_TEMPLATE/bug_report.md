---
name: Bug Report
about: Report a bug to help us improve
title: "[BUG] "
labels: bug
assignees: ''
---

## Bug Description

A clear and concise description of what the bug is.

## Steps to Reproduce

1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

## Expected Behavior

A clear and concise description of what you expected to happen.

## Actual Behavior

What actually happened.

## Screenshots

If applicable, add screenshots to help explain the problem.

## Environment

**Panel:**
- OS: [e.g., Ubuntu 24.04]
- Docker version: [output of `docker version`]
- Panel version: [output of `curl http://panel/api/system/version`]
- Install method: [install.sh / manual]

**Service Node (if applicable):**
- OS: [e.g., Ubuntu 22.04]
- Node version: [output of `curl http://node:8443/api/health`]
- Number of proxies: [e.g., 5]

## Logs

```
docker compose logs --tail=100 backend
docker compose logs --tail=100 service-node
```

(Paste relevant log lines here)

## Additional Context

- Any recent changes (update, config edit, etc.)
- Related issues: #123, #456
- Workarounds you've tried

## Checklist

- [ ] I've checked [TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md)
- [ ] I've searched [existing issues](https://github.com/ns8-support/mtproto-suite/issues)
- [ ] I've tried the latest version
- [ ] Logs are included
- [ ] Reproduction steps are clear
