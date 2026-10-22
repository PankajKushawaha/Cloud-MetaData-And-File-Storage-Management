# CloudNest V4 — Validation and deployment checklist

## Included in this release
- Cloudinary authenticated file storage with short-lived signed download URLs.
- MongoDB metadata for files, owners, folders, storage references and version history.
- Password recovery with hashed one-use tokens and a 15-minute expiry; Resend delivery in production.
- Live search, nested folders, rename, move, star, trash, restore, permanent delete, expiring share links and version restore.
- Production startup guards for required cloud storage, HTTPS base URL and email configuration.
- Render Blueprint and deployment documentation.

## Checks performed in this build environment
- `node --check` passed for backend, storage service, models and frontend JavaScript.
- `npm test` passed 2 local storage smoke tests.
- Package metadata and lockfile were updated for the test script and supported Node.js engine.

## Before public deployment
1. Set up MongoDB Atlas, Cloudinary and Resend; keep all keys in the hosting provider's secret environment variables.
2. Deploy with `render.yaml` or use a Node web service with `server` as root, `npm install` as build command and `npm start` as start command.
3. Set `APP_BASE_URL` to the deployed HTTPS URL and configure all required production variables.
4. Confirm `/api/health` reports the database connected and Cloudinary storage mode.
5. Test registration/login, password recovery email, upload/download, live search, nested folders, rename/move, version upload/restore, share expiry, trash/restore and permanent deletion.

## Test boundary
The local storage tests do not prove that an external MongoDB, Cloudinary or Resend account is correctly configured. Those live integration checks must be completed after secrets are added to the deployment environment. This bundle is prepared for deployment, but it is not deployed or live-tested against your accounts from this environment.
