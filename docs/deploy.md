# Deploying Leaflet 1.0 — the checklist

Everything, in order, for the first release. Each step says **where** it
happens and how to check it worked. The reasoning and the details behind each
step are in [release-msix.md](release-msix.md) and
[server/README.md](../server/README.md); this page is the run sheet.

| Piece | Lives at |
| --- | --- |
| Website, privacy policy, terms, signed `config.json` | GitHub Pages: `https://itsadithyakv.github.io/Leaflet-BookReader/` |
| API (accounts, leaderboards) | Oracle VM `129.154.40.208`, `/opt/leaflet-api`, behind Caddy at `https://leafletapp.duckdns.org` |
| Database | MongoDB Atlas (free M0), database `leaflet` |
| App | Microsoft Store, `AdithyaKV.LeafletBookReader` |

Never touched by any of this: the pilot server (`go.unifloe.app`,
`129.225.110.37`), `/var/www/unifloe`, and the existing `unifloe.app` blocks
in the Caddyfile.

Secrets and where they go:

| Secret | Goes in | Never in |
| --- | --- | --- |
| Atlas connection string | `/etc/leaflet-api.env` on the VM (root, `600`) | the repo, the app |
| Config signing key | `C:\Users\Adi\.leaflet\config-signing-key.pem` (back it up) | the repo |
| Google OAuth client id + secret | the PowerShell session that builds the MSIX | the repo |
| VM SSH key | `C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key` | the repo |

---

## 1. Put the code on GitHub — *your PC*

```powershell
cd D:\Leaflet
git switch main
git merge --ff-only release/1.0
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

CI (`.github/workflows/ci.yml`) runs the tests on the push; the website
workflow publishes `site/` once Pages is switched on (step 2).

## 2. Website on GitHub Pages — *github.com*

1. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → Website → Run workflow** (or push any change under `site/`).
3. Check, in a browser:
   - `https://itsadithyakv.github.io/Leaflet-BookReader/` (the site)
   - `https://itsadithyakv.github.io/Leaflet-BookReader/privacy/`
   - `https://itsadithyakv.github.io/Leaflet-BookReader/config.json` — a
     `payload` and a `signature`. This is how installed apps find the API.

## 3. Database on MongoDB Atlas — *cloud.mongodb.com*

1. Create a free **M0** cluster (any region near the VM, e.g. Mumbai/Hyderabad).
2. **Database Access → Add New Database User**: password auth, role
   **readWrite** on database **`leaflet`** only (Specific Privileges), not
   "Atlas admin".
3. **Network Access → Add IP Address → `129.154.40.208/32`**. Not
   `0.0.0.0/0`.
4. **Connect → Drivers** → copy the `mongodb+srv://…` string and put the user's
   password in it. Keep it for step 4; paste it nowhere else.

The server creates its own collections and indexes on first start.

## 4. The VM, one time — *ssh into the VM*

```powershell
ssh -i "C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key" ubuntu@129.154.40.208
```

Then on the VM:

```bash
# Node.js 22 LTS (skip if `node -v` already says v22)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v

# 1 GB of swap: npm install needs more memory than the VM has (skip if `swapon --show` lists one)
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# The environment file. Paste the Atlas string yourself.
sudo install -m 600 -o root -g root /dev/null /etc/leaflet-api.env
sudo nano /etc/leaflet-api.env
```

`/etc/leaflet-api.env`:

```
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGO_DB=leaflet
HOST=127.0.0.1
PORT=8787
```

### Caddy — add one block, change nothing else

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d)
sudo nano /etc/caddy/Caddyfile
```

Paste the block from [`server/deploy/Caddyfile.snippet`](../server/deploy/Caddyfile.snippet)
(from `leafletapp.duckdns.org {` to its closing `}`) at the **end** of the
file, below the existing blocks. Then:

```bash
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

If `validate` complains, restore the backup (`sudo cp /etc/caddy/Caddyfile.bak-* /etc/caddy/Caddyfile`)
before reloading; the Unifloe site keeps running on the old config until a
reload succeeds.

Oracle's firewall already allows 80 and 443 (Caddy serves the Unifloe site);
nothing new needs opening.

## 5. Ship the API — *PowerShell on your PC*

```powershell
cd D:\Leaflet\server\deploy
.\deploy.ps1 -Host 129.154.40.208 -KeyPath "C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key"
```

It ends with `{"ok":true} leaflet-api is up`. Re-run the same command for every
server update.

**Check it:**

```bash
# on the VM
systemctl status leaflet-api            # active (running), memory well under 256M
curl http://127.0.0.1:8787/health
sudo journalctl -u leaflet-api -n 50    # "Leaflet API on http://127.0.0.1:8787", no Mongo errors
```

and from anywhere (browser is fine):

- `https://leafletapp.duckdns.org/health` → `{"ok":true}`
- `https://leafletapp.duckdns.org/v1/leaderboard` → an (empty) board

A `MongoServerSelectionError` in the log almost always means the Atlas
Network Access entry (step 3.3) or the password in the string.

## 6. Google sign-in (Drive backup) — *console.cloud.google.com*

1. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Desktop app.** Note the client id and secret.
2. **OAuth consent screen:** app name Leaflet, home page
   `https://itsadithyakv.github.io/Leaflet-BookReader/`, privacy policy
   `https://itsadithyakv.github.io/Leaflet-BookReader/privacy/`, scope
   `drive.file` only. **Publish app → In production** (Testing mode signs
   everyone out of Drive every 7 days). `drive.file` is non-sensitive, so no
   verification review is needed.

## 7. Build the Store package — *PowerShell on your PC*

```powershell
$env:LEAFLET_GOOGLE_CLIENT_ID     = "…apps.googleusercontent.com"
$env:LEAFLET_GOOGLE_CLIENT_SECRET = "GOCSPX-…"
$env:VITE_ENABLE_ACCOUNTS         = "true"
$env:VITE_ENABLE_COMMUNITY        = "true"
$env:LEAFLET_API_BASE             = "https://leafletapp.duckdns.org"   # fallback; the signed config wins
cd D:\Leaflet\apps
npm ci
cd src-tauri\msix
.\build-msix.ps1
```

Leave `VITE_ENABLE_MULTI_DEVICE` and `VITE_ENABLE_FULL_PIP_HOUSE` unset for 1.0.
The script warns about any required value that is missing; a warning here is a
feature missing from the release, so stop and set it.

Output: `D:\Leaflet\apps\src-tauri\target\msix\Leaflet_1.0.0.0_x64.msix`.

## 8. Try the package on this PC first (recommended)

Sign a copy with a throwaway certificate and install it: the commands are in
[release-msix.md → Test it locally](release-msix.md#test-it-locally-before-uploading-optional).
Then, in the installed app:

- [ ] Import an EPUB, a PDF and a CBZ; each opens.
- [ ] Series: two books of one series appear under Collections → Series.
- [ ] Reader: Pages layout turns pages; Ctrl+F finds a word; a highlight survives closing the book.
- [ ] Settings → Backup: connect Google Drive, **Back up now** succeeds.
- [ ] Settings → Account: sign up, sign out, sign in.
- [ ] Social → Community: the board loads (you on it once your profile is public).
- [ ] Settings → Reminders → **Send a test**: a toast with Pip.
- [ ] Settings → About → **Copy diagnostics**: pastes a report with version 1.0.0.

Uninstall afterwards: `Get-AppxPackage *LeafletBookReader* | Remove-AppxPackage`
(it removes the test library too).

## 9. Submit — *partner.microsoft.com*

Upload the **unsigned** `.msix` from step 7 (the Store signs it). The listing
text, features and "what's new" are ready in
[store-listing.md](store-listing.md); the rest of the form is in
[release-msix.md → Submit](release-msix.md#submit).

## After launch

| To… | Do |
| --- | --- |
| Update the API | Re-run `deploy.ps1` (step 5) |
| Watch the API | `sudo journalctl -u leaflet-api -f` on the VM |
| Move the API to another address | Edit `site/config.source.json`, `node site/sign-config.mjs`, commit and push. Installed apps follow; no Store update |
| Release 1.0.1 | Bump the version in `apps/package.json`, `apps/src-tauri/Cargo.toml` and `apps/src-tauri/tauri.conf.json`, repeat steps 7–9 |
| Back up the database | Atlas M0 has no automatic backups: `mongodump --uri "<the string>" --out leaflet-$(date +%F)` from a machine on the Atlas allowlist |
