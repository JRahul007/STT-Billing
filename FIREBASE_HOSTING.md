# Firebase Hosting Setup

This project uses Firebase Hosting for the Vite frontend in `client/`.

## What was configured

- `firebase.json` deploys the built frontend from `client/dist`
- SPA routes rewrite to `index.html`
- `client/src/services/api.js` now supports `VITE_API_BASE_URL`

## Before deploying

1. Create a Firebase project in the Firebase console.
2. Replace `your-firebase-project-id` in `.firebaserc` with your real project ID.
3. Create `client/.env.local` and add:

```env
VITE_API_BASE_URL=https://your-backend-url.com/api
```

Use the deployed URL of your backend server here. Keep `/api` at the end if your API routes are served under that path.

## Deploy commands

Install the Firebase CLI if needed:

```bash
npm install -g firebase-tools
```

Log in and deploy:

```bash
firebase login
firebase deploy --only hosting
```

The deploy automatically runs the frontend build first through the `predeploy` step in `firebase.json`.
