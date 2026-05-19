# MOR.NEVEN

MOR.NEVEN is a ceramics studio website with a draggable image-board layout,
macOS-style image windows, a bottom link dock, and a password-protected image
manager.

Version: v1.0.0

Live site: https://morneven-fc90f.web.app

## Version History

### v1.0.0 - 2026-05-19

Initial production-ready MOR.NEVEN site.

Added:

- Ceramic archive image board with desktop drag movement.
- macOS-style image windows with close, minimize, and zoom controls.
- Up to 3 overlapping desktop image windows.
- Mobile image modal with backdrop-tap close behavior.
- Bottom dock links for Instagram, KakaoTalk, Naver Booking, and Naver Map.
- MOR.NEVEN logo background and moon favicon assets.
- Desktop-only password-protected image manager.
- Image add/delete flow with title, type, and description fields.
- 20-image total limit for managed gallery images.
- Firebase Hosting, Cloud Functions, Firestore, Storage, and Secret Manager
  integration.
- Local preview server with local upload and metadata storage.

## Features

- Draggable ceramic archive images on desktop.
- Clickable image windows with macOS-style close, minimize, and zoom controls.
- Multiple desktop image windows, capped at 3 open windows.
- Mobile-friendly single image modal that closes when the backdrop is tapped.
- Bottom dock links for Instagram, KakaoTalk, Naver Booking, and Naver Map.
- Desktop-only admin image manager behind a server-side password check.
- Image add/delete flow capped at 20 total images.
- Firebase-backed production storage with local IndexedDB fallback for preview.

## Project Structure

```text
.
├── index.html              # Static page markup
├── styles.css              # Site, modal, dock, and manager styling
├── script.js               # Board interactions, modals, admin UI, API client
├── server.js               # Local preview server and local API mirror
├── assets/                 # Logo, favicon, dock icons, default pottery images
├── functions/index.js      # Firebase Cloud Function API
├── firestore.rules         # Deny direct Firestore client access
├── storage.rules           # Deny direct Storage client access
├── firebase.json           # Hosting, rewrites, functions, rules config
└── FIREBASE_DEPLOY.md      # Detailed Firebase setup notes
```

Local-only runtime folders are ignored by git:

```text
.local-data/
uploads/
```

## Local Development

The local server requires an admin password in an environment variable. Do not
write the password into source files.

```sh
MORNEVEN_ADMIN_PASSWORD='your-admin-password' \
MORNEVEN_SESSION_SECRET='local-dev-session-secret' \
node server.js
```

Open:

```text
http://127.0.0.1:4173/
```

Local uploads are stored under `uploads/`, and local image metadata is stored in
`.local-data/images.json`.

## Admin Image Manager

On desktop, use the subtle `+` button in the top-right corner.

The manager supports:

- adding image files
- editing image name, type, and description before saving
- deleting existing default or uploaded images
- up to 20 total images

Production admin auth is handled by the Firebase Function. The password is
stored in Firebase Secret Manager as `MORNEVEN_ADMIN_PASSWORD`, not in client
code.

## Firebase

Production uses:

- Firebase Hosting for static files
- Cloud Functions v2 for `/api/**`
- Firestore for image metadata and hidden default image state
- Cloud Storage for uploaded image files
- Secret Manager for admin password and session signing secret

Set secrets:

```sh
firebase functions:secrets:set MORNEVEN_ADMIN_PASSWORD --project morneven-fc90f
firebase functions:secrets:set MORNEVEN_SESSION_SECRET --project morneven-fc90f
```

Install function dependencies:

```sh
cd functions
npm install
cd ..
```

Deploy everything:

```sh
firebase deploy --project morneven-fc90f
```

Deploy static changes only:

```sh
firebase deploy --only hosting --project morneven-fc90f
```

## Verification

Useful checks before deploying:

```sh
npm run verify
firebase deploy --only hosting --project morneven-fc90f --non-interactive
```

For function/API changes, deploy and test `/api/session`, `/api/images`, login,
image upload, and image delete.

## Asset Notes

Current dock icons:

- `assets/dock-instagram.svg`
- `assets/dock-kakao.svg`
- `assets/dock-naver-booking-20260519.webp`
- `assets/dock-naver-map.webp`

Default board images are `assets/pottery-01.jpeg` through
`assets/pottery-08.jpeg`.

## Security Notes

- Never commit `.env`, `.local-data/`, `uploads/`, or real password values.
- Firestore and Storage rules deny direct client reads/writes.
- The browser only talks to `/api/**`; privileged operations are done in the
  server or Firebase Function.
- The admin password must remain in environment variables or Firebase Secret
  Manager.
