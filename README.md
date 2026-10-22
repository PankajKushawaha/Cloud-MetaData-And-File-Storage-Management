# CloudNest — Cloud File Metadata Management System

CloudNest is a full-stack file workspace. **The file bytes are stored in Cloudinary; MongoDB stores metadata and references** such as owner, original name, MIME type, extension, size, folder, timestamps, star/trash state and version history. The server never sends Cloudinary API secrets to the browser.

## Features

- Registration and login with bcrypt password hashes and JWT-protected APIs
- Password recovery with a cryptographically random, one-use token; only the token hash is stored and links expire after 15 minutes
- Cloudinary upload using authenticated delivery and short-lived signed download URLs
- Development-only local file storage fallback; production startup refuses to run without Cloudinary credentials
- File search as you type, pagination API, folder filtering, starred files and dashboard stats
- Nested folders, breadcrumbs, rename and move operations
- Rename metadata without re-uploading the object
- Trash/restore and permanent deletion with cloud object cleanup
- Version history that preserves previous file objects and supports restore
- Expiring share links; the share URL does not reveal the Cloudinary object ID
- Storage quota tracking that reconciles current files and version history on startup
- Rate limits, Helmet, input validation, ownership checks and centralized API errors

## Requirements

- Node.js 20.19+ (Node 22/24 recommended)
- MongoDB Atlas or a local MongoDB server
- Cloudinary account for cloud file storage
- Resend account/API key for production password-reset emails

## Run locally (Windows / VS Code)

1. Copy `server/.env.example` to `server/.env`.
2. Fill in `MONGO_URI` and a random `JWT_SECRET` of at least 32 characters. To use actual cloud storage, also set all three Cloudinary variables.
3. Open a terminal in the `server` directory and run:

   ```powershell
   npm install
   npm test
   npm start
   ```

4. Open `http://localhost:4000`.

If Cloudinary variables are not configured in development, files are saved under `server/uploads/`. This fallback is only for local development; those files are not uploaded to cloud storage.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | Production | Set to `production` when deployed |
| `PORT` | Hosting platform usually supplies it | HTTP port |
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Random secret, 32+ characters |
| `JWT_EXPIRES_IN` | No | JWT lifetime; default `15m` |
| `APP_BASE_URL` | Production | Public HTTPS base URL for reset links |
| `ALLOWED_ORIGINS` | Only if frontend is hosted separately | Comma-separated trusted origins |
| `CLOUDINARY_CLOUD_NAME` | Production | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Production | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Production | Cloudinary API secret — never expose it to the browser |
| `MAX_FILE_SIZE_MB` | No | Upload limit; default `50` |
| `RESEND_API_KEY` | Production password reset | Resend API key |
| `RESEND_FROM` | Production password reset | Verified sender, e.g. `CloudNest <no-reply@your-domain.com>` |

Never commit `.env`, paste secrets into support chats, or put Cloudinary credentials in frontend JavaScript.

## Deploy to Render

1. Push this project to a private or public Git repository (do not include `.env` or `node_modules`).
2. Create a MongoDB Atlas database and configure network access for the deployment host.
3. Create a Cloudinary product environment and copy its cloud name, API key and API secret.
4. Create a Resend API key and verify the sender domain if you want password recovery emails in production.
5. In Render, create a Blueprint from the repository using `render.yaml`, or create a Web Service with **Root Directory** `server`, **Build Command** `npm install`, and **Start Command** `npm start`.
6. Add the environment variables listed in `render.yaml`. Set `NODE_ENV=production` and all Cloudinary/MongoDB/Resend values. Render's `RENDER_EXTERNAL_URL` is used automatically for reset/share links; on other hosts, set `APP_BASE_URL` to the public HTTPS base URL. Use a newly generated `JWT_SECRET`.
7. Deploy, then visit `/api/health`. Confirm it reports `database: connected` and `storage: cloudinary`.
8. Test account creation, sign-in, upload, download, nested folders, rename, search, version restore, share-link expiry, trash/restore, and permanent deletion on the deployed service.

The app serves its own frontend from the same Express service, so a separate frontend deployment is not required. For a separate frontend domain, set `ALLOWED_ORIGINS` to the exact origin(s).

## Data and privacy behavior

- The browser uploads files to Express; Express validates the request and uploads bytes to Cloudinary. MongoDB metadata is saved after the cloud upload succeeds.
- Cloudinary assets use the `authenticated` delivery type. Downloads and share links receive a short-lived signed URL from the backend. Anyone who obtains a signed URL can use it until it expires, so URLs should be treated as temporary secrets.
- File rename and move change MongoDB metadata only. They do not upload the same bytes again.
- Trash retains file objects and continues counting them toward storage. Permanent deletion removes the current object and its version objects.
- Previous versions keep their own cloud object references. Restoring changes the current pointer and preserves the version that was current before restore.
- Password reset requires `RESEND_API_KEY` and `RESEND_FROM` for real email delivery in production. In development without a mail key, a reset link is logged to the server terminal for testing.

## API highlights

- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `GET /api/files`, `POST /api/files/upload`
- `PATCH /api/files/:id/rename`, `/move`, `/star`, `/trash`, `/restore`
- `GET /api/files/:id/download`
- `GET /api/files/:id/versions`, `POST /api/files/:id/versions`, `POST /api/files/:id/versions/:versionId/restore`
- `GET /api/folders`, `POST /api/folders`, `PATCH /api/folders/:id`, `DELETE /api/folders/:id`
- `POST /api/files/:id/share`, `DELETE /api/files/:id/share`, `GET /share/:token`
- `GET /api/admin/users` (admin role required)

## Test coverage and limitations

`npm test` runs local-storage smoke tests. JavaScript syntax checks are also run during packaging. Live integration tests still require your own MongoDB, Cloudinary and email-provider credentials; this package cannot truthfully verify those external accounts before you configure them. The current upload limit is 50 MB by default and files are buffered in server memory before upload, so use a streaming/chunked approach before raising the limit for large production workloads. Add malware scanning and operational monitoring before accepting untrusted public uploads at scale.
