# Kotoba

A mobile-first Japanese vocabulary trainer powered directly by the CSV files in `vocab/`.

## Run locally

Browsers do not allow a page opened with `file://` to fetch local CSV files. Start a local web server from this directory:

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Publish with GitHub Pages

1. Create a GitHub repository and push this folder to its `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select `main`, choose `/ (root)`, and click **Save**.
5. GitHub will publish the app at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

## Set up accounts and cloud progress

The app uses Supabase for email/password authentication and per-user cloud progress. Signed-out users can still use the app, but their progress stays in that browser.

### 1. Create a Supabase project

1. Go to <https://supabase.com/dashboard> and create a project.
2. Wait for the project to finish provisioning.
3. Open the project and select **SQL Editor**.
4. Create a new query.
5. Copy the complete contents of `supabase-setup.sql` into the editor.
6. Click **Run**.

This creates the `user_progress` table and row-level security policies. Those policies ensure each signed-in user can only access their own progress.

If the table already exists, it is safe to run the complete SQL file again. The script also grants the required table privileges to signed-in users while denying anonymous database access.

### 2. Copy the public project configuration

1. In Supabase, open **Project Settings → API**.
2. Copy the **Project URL**.
3. Copy the **Publishable key**. Older Supabase projects may call this the `anon` public key.
4. Open `supabase-config.js` and enter both values:

```javascript
window.KOTOBA_SUPABASE = {
  url: "https://YOUR-PROJECT.supabase.co",
  publishableKey: "YOUR-PUBLISHABLE-KEY"
};
```

The publishable key is designed for browser applications and is protected by the database row-level security policies. Never place the Supabase `service_role` or secret key in this repository.

### 3. Configure authentication URLs

In Supabase, open **Authentication → URL Configuration**.

Set **Site URL** to the published GitHub Pages address:

```text
https://YOUR-USERNAME.github.io/REPOSITORY-NAME/
```

Add these **Redirect URLs**:

```text
https://YOUR-USERNAME.github.io/REPOSITORY-NAME/
http://localhost:8000/
```

The localhost address allows confirmation links to work during local testing.

### 4. Check email authentication

Open **Authentication → Providers → Email** and ensure the Email provider is enabled.

With **Confirm email** enabled, new users receive a confirmation email before they can sign in. This is recommended for a public website.

### 5. Publish the configuration

```powershell
git add .
git commit -m "Add user accounts and cloud progress"
git push
```

After GitHub Pages deploys, open the website and use the **Sign in** button in the top-right corner.

## How progress storage works

- Signed out: progress is stored locally in the browser.
- First sign-in: existing local progress is merged into the account.
- Signed in: progress is cached locally and synchronized to Supabase.
- Different accounts: each user has an isolated local cache and database row.
- Temporary connection failure: learning continues locally and synchronization retries after later progress changes.

## Learning paths and progress

The app contains two independent learning paths:

- **General Japanese** uses the existing files in `vocab/`.
- **JLPT N5 Vocabulary** uses files in `vocab-jlpt-n5/`.

Mastery, streaks, review queues, and completion percentages are recorded separately for each path. Existing progress from older versions is automatically assigned to General Japanese.

## Add a General Japanese collection

1. Add a CSV to `vocab/` with the columns `No,Japanese,Romaji,Meaning`.
2. Add one matching entry to `vocab-manifest.json`.

## Add a JLPT N5 collection

1. Add a CSV to `vocab-jlpt-n5/` with the columns `No,Japanese,Romaji,Meaning`.
2. Add a matching entry to `jlpt-n5-manifest.json`.

Example:

```json
{
  "file": "jlpt_n5_001-100_core_nouns.csv",
  "title": "Core Nouns",
  "subtitle": "Essential JLPT N5 nouns",
  "icon": "名",
  "accent": "#5472a0"
}
```

Collections may contain any number of words. The app automatically divides each CSV into levels of ten, with a smaller final level when necessary.
