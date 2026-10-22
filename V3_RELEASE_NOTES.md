# CloudNest V3 Release Notes

V3 moves CloudNest from metadata-only records to real file uploads.

## New capabilities
- Multipart file uploads with Multer
- Local development storage under `server/uploads/`
- Optional Cloudinary storage through environment variables
- Download/open endpoint
- Rename endpoint
- Storage quota enforcement on upload/restore
- Physical storage cleanup on permanent deletion and folder deletion
- Safer search regex escaping
- Duplicate folder protection
- Better ObjectId validation
- Upload progress UI and drag/drop selection

## Next recommended release: V4
- File sharing links
- Download counters
- User profile editing
- Password change/reset flow
- Folder navigation and nested folders
- Pagination
- Admin/usage dashboard
- Automated API tests
- Production deployment configuration
