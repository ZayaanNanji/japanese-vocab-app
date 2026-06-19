# Kotoba

A mobile-first Japanese vocabulary trainer powered directly by the CSV files in `vocab/`.

## Run locally

Browsers do not allow a page opened with `file://` to fetch local CSV files. Start a small local server from this directory:

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

No build command, framework, server, or API key is needed.

## Add another vocabulary collection

1. Add a CSV to `vocab/` with the columns `No,Japanese,Romaji,Meaning`.
2. Add one matching entry to `vocab-manifest.json`.

The app generates the collection page and ten-word levels from the CSV data. Progress, mastery, review dates, and streaks are stored privately in the browser with `localStorage`.
