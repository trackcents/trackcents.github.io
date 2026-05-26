# Setting up Google Drive sync (one-time, developer-only)

This is a **one-time setup the developer does once**. End users (your friends)
never touch the Google Cloud Console — they just click "Sign in with Google" in
the app and approve one prompt. The OAuth client ID created here identifies the
_app_ to Google; it is **not** linked to your personal Drive and holds no user
data. Each user's encrypted blob lives in **their own** Drive.

> Cost: $0. Scope used: `drive.file` (the app can only see files it creates — never
> your whole Drive), which is a **non-restricted scope and needs no Google
> verification** for personal/limited use.

## Steps

1. Open **https://console.cloud.google.com/** and sign in.
2. **Create a project** (project dropdown → _New Project_), name it e.g.
   `money-tracker`, then select it.
3. **Enable the Drive API:** ☰ → _APIs & Services → Library_ → search
   **"Google Drive API"** → **Enable**.
4. **Configure the OAuth consent screen:** _APIs & Services → OAuth consent
   screen_ → User type **External** → fill app name + your support email +
   developer email → Save.
   - Add the scope **`https://www.googleapis.com/auth/drive.file`**.
   - Under **Test users**, add your own and your friends' Google emails (up to
     100). Leave publishing status on **"Testing"** — no verification needed.
   - (Optional, later) To let anyone sign in without being a listed test user,
     **Publish** the app. Because the scope is the narrow `drive.file`, this needs
     **no Google verification/review**.
5. **Create the OAuth client ID:** _APIs & Services → Credentials → Create
   Credentials → OAuth client ID_ → Application type **Web application** → name
   it → under **Authorized JavaScript origins** add:
   - `http://localhost:5173` (local development)
   - your production URL when you deploy (e.g. `https://chitti-learns-ai.github.io`)
     → **Create**.
6. **Copy the Client ID** — it looks like `1234567890-abc123.apps.googleusercontent.com`.

## Where the Client ID goes

The Client ID is **public** (not a secret). Put it in a `.env` file at the repo
root:

```
PUBLIC_GOOGLE_OAUTH_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
```

For the deployed site, set the same variable in your GitHub Pages build
environment (a repository variable). The app reads it at build time; sign-in stays
disabled until it is present, so the app still runs locally without it.

## Privacy / zero-knowledge note

The shared Client ID never gives the developer (or Google) access to user data:
each user authorizes only their own Drive, and the synced blob is **encrypted with
that user's passphrase** (AES-256-GCM) before it leaves the device. Google stores
ciphertext it cannot read.
