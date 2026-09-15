# Deployment

Static site, no backend required for ordinary operation (project brief
section 29). Muse 2/ESP32 connections happen entirely in the operator's own
browser via Web Bluetooth/Serial — the deployed site never proxies or
touches EEG data.

## Local development

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run test        # vitest — 24 tests, no hardware required
npm run typecheck   # tsc -b --noEmit
npm run build        # production build -> web/dist/
npm run preview      # serve the production build locally
```

## GitHub Pages (primary, automated)

`.github/workflows/deploy-web.yml` builds and deploys `web/` to GitHub
Pages on every push to `main` that touches `web/**`. It runs `tsc --noEmit`
and `vitest run` before building — a failing test blocks the deploy.

**One-time setup** (repo owner, in GitHub's web UI, not this workflow):

1. Push this repository to GitHub.
2. Repo **Settings → Pages → Source → GitHub Actions**.
3. Push to `main` (or run the workflow manually via **Actions → Deploy BCI
   Hand Configurator → Run workflow**).
4. The deployed URL appears in the workflow run's summary and under
   **Settings → Pages**.

No secrets are required beyond GitHub Actions' own auto-issued
`GITHUB_TOKEN` (used only for the `actions/deploy-pages` step's
`id-token: write` permission) — no personal access token, no cloud account,
no developer credential of any kind (project brief section 5/36).

`vite.config.ts` uses `base: './'` (relative asset paths) and the PWA
manifest uses `start_url: '.'` / `scope: '.'` specifically so the same
build works correctly whether it's served from a domain root or a GitHub
Pages project-site subpath (`https://<user>.github.io/<repo>/`) — no
repo-name-specific configuration needed.

## Alternatives

Any static host works identically since there's no backend and no
server-specific configuration:

- **Cloudflare Pages**: connect the repo, build command `npm run build`
  (root directory `web`), output directory `dist`.
- **Vercel**: import the repo, set the root directory to `web`; Vercel
  auto-detects the Vite framework preset.
- **Netlify**: base directory `web`, build command `npm run build`, publish
  directory `web/dist`.

All three require HTTPS by default (satisfying the `isSecureContext`
requirement for Web Bluetooth/Serial) with no extra configuration.

## Production build requirements

- **HTTPS in production.** Web Bluetooth and Web Serial both require a
  secure context; `localhost` is exempt for local development only.
- No environment variables or secrets are required for the build itself —
  `npm run build` is fully self-contained.

## Verifying a deployment

After deploying, open the URL in Chrome or Edge and check the Diagnostics
page: **Secure Context: YES**, **Bluetooth API: AVAILABLE**, **Serial API:
AVAILABLE**. If any read differently, re-check the host's HTTPS
configuration before assuming an app bug.
