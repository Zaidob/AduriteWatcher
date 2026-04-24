# AduriteBot (Free static Firebase + GitHub Actions)

This project can be deployed as a **static site** on Firebase Hosting for free.

The “static-only” strategy is:

- **GitHub Actions** runs Playwright on a schedule to generate `web/latest.json`
- **Firebase Hosting** serves `web/` (including `latest.json`)
- The browser UI polls `latest.json` (no Socket.IO / no server)

## Local run

Generate a snapshot:

```bash
npm install
npm run build:snapshot
```

Preview the static site by opening `web/index.html` (or serve `web/` with any static server).

## Auto-deploy setup (GitHub + Firebase)

### 1) Create a Firebase project + enable Hosting

- Create a Firebase project in the Firebase console.
- In Firebase console: **Build → Hosting → Get started**

### 2) Push this repo to GitHub

Create a GitHub repo and push your code.

### 3) Create a Firebase CI token

On your computer:

```bash
npm i -g firebase-tools
firebase login
firebase login:ci
```

Copy the token string it prints.

### 4) Add GitHub repo secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

- `FIREBASE_TOKEN`: the token from `firebase login:ci`
- `FIREBASE_PROJECT_ID`: your Firebase Project ID (from Firebase console Project settings)

### 5) Done

The workflow `.github/workflows/update-and-deploy.yml` runs every 10 minutes and:

- generates `web/latest.json`
- deploys to Firebase Hosting

## Notes / limits

- This is **not real-time**; it updates on the workflow schedule.
- Scraping can break if the target site blocks GitHub runners or changes markup.
