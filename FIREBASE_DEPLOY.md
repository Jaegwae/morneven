# MOR.NEVEN Firebase deploy

## One-time console setup

1. Firebase project: `morneven-fc90f`
2. Upgrade the project to Blaze if Firebase asks for billing. Cloud Functions, Secret Manager, Storage, and Cloud Run-backed infrastructure can require it.
3. Enable Firestore in Native mode.
4. Enable Cloud Storage for Firebase.

## One-time local setup

```sh
npm install -g firebase-tools
firebase login
firebase use morneven-fc90f
```

Set secrets without committing them to source control:

```sh
firebase functions:secrets:set MORNEVEN_ADMIN_PASSWORD --project morneven-fc90f
openssl rand -base64 32
firebase functions:secrets:set MORNEVEN_SESSION_SECRET --project morneven-fc90f
```

Use the password value only in the CLI prompt. Do not write it into source files.
Use the generated random value from `openssl rand -base64 32` for the session secret.

Install function dependencies:

```sh
cd functions
npm install
cd ..
```

## Deploy

```sh
firebase deploy --project morneven-fc90f
```

After deploy, Firebase Hosting will serve the public site, and `/api/**` requests will be routed to the `api` Cloud Function.

## Troubleshooting

If Functions deploy fails with a missing build service account permission:

```sh
gcloud projects add-iam-policy-binding morneven-fc90f \
  --member="serviceAccount:65352838484-compute@developer.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder"
```

If `gcloud` is not installed locally, open Google Cloud Shell from the Cloud Console and run the same command there. Then deploy again:

```sh
firebase deploy --project morneven-fc90f
```

## Local preview

```sh
MORNEVEN_ADMIN_PASSWORD='your-admin-password' \
MORNEVEN_SESSION_SECRET='local-dev-session-secret' \
node server.js
```

Open `http://127.0.0.1:4173/`.

Local uploads are written to `uploads/` and local metadata to `.local-data/`. Both are ignored by git.
