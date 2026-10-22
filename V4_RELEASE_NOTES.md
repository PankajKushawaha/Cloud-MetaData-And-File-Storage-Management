# CloudNest V4 — Cloud Storage Release Notes

## Architecture and security
- Cloudinary stores the actual file bytes; MongoDB stores metadata and storage references.
- Cloudinary assets use authenticated delivery, and downloads/share links use short-lived signed URLs created by the backend.
- Cloudinary API secrets are server-side only. Production startup requires Cloudinary, MongoDB, HTTPS `APP_BASE_URL`, and Resend email settings for account recovery.
- Local disk storage is retained for development only.

## Frontend
- Responsive landing, authentication and workspace views.
- Live file search, nested folders, breadcrumbs and folder selection.
- Move folders between locations, including root and nested destinations; descendants move with the parent automatically.
- Upload modal, rename, move, star/unstar, share, version history, trash, restore and permanent deletion.
- Settings and storage display.

## Backend
- JWT authentication, bcrypt password hashes, one-time 15-minute password reset tokens and rate limits.
- Ownership checks, input validation, centralized error handling and role-protected admin endpoint.
- Folder move endpoint rejects self/descendant moves and duplicate folder names in the destination.
- File metadata and storage quota management; trash retains objects until permanent deletion.
- Version history preserves prior object references and supports restoring a previous version.
- Startup quota reconciliation counts unique objects across current files and versions.

## Run locally
Copy `server/.env.example` to `server/.env`, set `MONGO_URI` and `JWT_SECRET`, and configure Cloudinary if you want uploads in cloud storage. From `server/`, run `npm install`, `npm test`, and `npm start`; open `http://localhost:4000`.
