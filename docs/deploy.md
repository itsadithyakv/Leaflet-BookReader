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
   A password with `@ : / ? # %` in it must be URL-encoded in the string
   (`@` → `%40`); a letters-and-digits password avoids the question.

**Only the server connects to MongoDB.** The app never sees the string: it
talks to `https://leafletapp.duckdns.org`, and the server talks to Atlas. So
the string goes in exactly one place, `/etc/leaflet-api.env` on the VM
(step 4). There is nothing Mongo-related to put in the app's build or in
`apps/.env`.

The server creates its own collections and indexes on first start.

### 3b. Optional: check the string from your PC first

Proves the user, password and string are right before the VM is involved.

1. Atlas → Network Access → **Add Current IP Address** (this PC; delete the
   entry afterwards).
2. In `D:\Leaflet\server`, create `.env` (it is git-ignored) with:
   ```
   MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
   MONGO_DB=leaflet
   ```
3. Run it:
   ```powershell
   cd D:\Leaflet\server
   npm install
   npm start
   ```
   `Leaflet API on http://127.0.0.1:8787` means it connected (a Mongo error
   and exit means it did not). `http://127.0.0.1:8787/health` in a browser
   shows `{"ok":true}`, and Atlas → Browse Collections now shows the
   `leaflet` database. Ctrl+C to stop.
4. Delete `server\.env` and the extra Atlas IP entry.

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
RESET_MAIL_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
RESET_MAIL_SECRET=the-long-random-string-from-step-4b
```

The two `RESET_MAIL_*` lines come from step 4b; leave them out until then
(password reset stays off and says so).

### 4b. Password-reset emails — *script.google.com*

Free: Google Apps Script sends from a Gmail account, about 100 emails a day.
The emails come **from** whichever Gmail owns the script, so use the one you
want readers to see (a dedicated one, e.g. `leaflet.app.mail@gmail.com`, keeps
resets out of your personal Sent folder). It can be done before or after the
rest of step 4 and step 5; until it is, "Forgot password?" says reset is not
set up yet.

1. **Make the secret.** In PowerShell, copy what this prints:
   ```powershell
   $bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)
   ```
2. **Create the project.** Sign in to that Gmail, open
   <https://script.google.com>, **New project**. Click "Untitled project" at
   the top and name it **Leaflet mailer**.
3. **Paste the script.** Select everything in `Code.gs`, delete it, and paste
   the whole of [`server/deploy/password-reset-mailer.gs`](../server/deploy/password-reset-mailer.gs).
   Check `SUPPORT_EMAIL` near the top (where a reader who has used up a year's
   resets is told to write). **Save** (Ctrl+S).
4. **Add the secret.** Left bar → **Project Settings** (gear) → scroll to
   **Script Properties** → **Add script property**: Property `SECRET`, Value =
   the string from step 1 → **Save script properties**.
5. **Deploy.** Top right **Deploy → New deployment** → gear next to "Select
   type" → **Web app**. Description "v1"; **Execute as: Me**; **Who has
   access: Anyone** → **Deploy**.
6. **Authorise.** Google asks for permission to send email as you: **Authorize
   access** → pick the account → "Google hasn't verified this app" →
   **Advanced** → **Go to Leaflet mailer (unsafe)** → **Allow**. (It is your
   own script; the warning is for scripts that are not published.)
7. **Copy the Web app URL**, `https://script.google.com/macros/s/…/exec`.
   Open it in a **private (InPrivate/Incognito) window**:
   `{"ok":true,"service":"leaflet-mailer","quotaLeft":100}` means it is live.
   In a normal window where you are signed in to more than one Google account,
   Google shows "Sorry, unable to open the file at present" instead. That is
   Google mixing up the accounts, not a fault in the script, and it does not
   affect the server, which calls it signed out.
8. **Give the server both values.** On the VM:
   ```bash
   sudo nano /etc/leaflet-api.env
   ```
   add
   ```
   RESET_MAIL_URL=https://script.google.com/macros/s/…/exec
   RESET_MAIL_SECRET=<the string from step 1>
   ```
   then, if the API is already running (step 5 done):
   ```bash
   sudo systemctl restart leaflet-api
   sudo journalctl -u leaflet-api -n 5
   ```
   The log says `[leaflet] reset mailer ready (100 emails left today)`: the
   server has checked the URL and the secret (a check that sends nothing). If
   it says the secret was refused, the two values differ; if it could not be
   checked, look at the URL and that access is **Anyone**.
9. **Try it**: in the app, Settings → Account → **Forgot password?** with an
   address that has an account. The code arrives within a minute (check spam
   the first time and mark it "not spam").

Rules the server applies: a code works once, for 15 minutes, with 5 tries; 3
reset emails per address an hour; **3 completed resets per account a year**,
after which the email says when it can be reset again instead of carrying a
code.

After editing the script later (or pasting a newer copy of
`password-reset-mailer.gs`): **Deploy → Manage deployments** → pencil →
Version: **New version** → Deploy. The URL stays the same; a new *deployment*
would give a new URL.

Google's web apps are slow and uneven (a few seconds per email, now and then
far more, and the reply sometimes needs several reads). The server sends each
email once, after the reader already has their answer, and never re-sends to
get a reply, so a slow Google means a late email, never two.

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
# As the caddy user: checking the config opens the log file, and a file root
# creates here is one the running Caddy may not write, which fails the reload
# with "permission denied".
sudo -u caddy caddy validate --config /etc/caddy/Caddyfile
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
Leave `VITE_ENABLE_DESKTOP_PIP` unset too until Pip on the desktop has been
tried on a real desktop (the checklist is in HANDOFF.md).
The script warns about any required value that is missing; a warning here is a
feature missing from the release, so stop and set it.

Output: `D:\Leaflet\apps\src-tauri\target\msix\Leaflet_<version>.0_x64.msix`
(`Leaflet_1.2.0.0_x64.msix` for 1.2.0).

### 7b. A Mac build (optional, untried) — *github.com*

A Mac build cannot be made on Windows. `.github/workflows/macos.yml` makes one
on a GitHub Mac: push the branch, open the repository's **Actions** tab, pick
**macOS build**, **Run workflow** on that branch, and download
`Leaflet-macOS-universal` (a `.dmg` for Apple silicon and Intel) from the run
when it finishes. To include Google Drive backup, add
`LEAFLET_GOOGLE_CLIENT_ID` and `LEAFLET_GOOGLE_CLIENT_SECRET` as repository
secrets first (Settings → Secrets and variables → Actions).

Know before you run it: the workflow has not been run, and Leaflet has only
ever been built for Windows, so the first run may stop on code that does not
compile for macOS (its log says where). The build is not signed or notarised
(that needs an Apple Developer ID), so macOS refuses a double click: right-click
the app and choose Open the first time. Its icon is still the old logo
(`icons/icon.icns` was not regenerated). Reminders, Pip on the desktop and the
Store packaging are Windows-only.

## 8. Try the package on this PC first (recommended)

Sign a copy with a throwaway certificate and install it: the commands are in
[release-msix.md → Test it locally](release-msix.md#test-it-locally-before-uploading-optional).
Then, in the installed app:

- [ ] Import an EPUB, a PDF and a CBZ; each opens.
- [ ] Series: two books of one series appear under Collections → Series.
- [ ] Reader: Pages layout turns pages; Ctrl+F finds a word; a highlight survives closing the book.
- [ ] Settings → Backup: connect Google Drive, **Back up now** succeeds.
- [ ] Settings → Account: sign up, sign out, sign in.
- [ ] Settings → Account → Forgot password?: the code arrives by email and sets a new password.
- [ ] Social → Community: the board loads (you on it once your profile is public).
- [ ] Settings → Reminders → **Send a test**: a toast with Pip.
- [ ] Settings → About → **Copy diagnostics**: pastes a report with the version you built.

Uninstall afterwards: `Get-AppxPackage *LeafletBookReader* | Remove-AppxPackage`
(it removes the test library too).

## 9. Submit — *partner.microsoft.com*

Upload the **unsigned** `.msix` from step 7 (the Store signs it). The listing
text, features and "what's new" are ready in
[store-listing.md](store-listing.md); the rest of the form is in
[release-msix.md → Submit](release-msix.md#submit).

## Releasing an update — the short run sheet

For 1.1, 1.2 and every release after the first. Steps 2 to 6 above are done
once and are not repeated.

**What gets signed, and with what.** Three different things, easy to mix up:

| | Signed with | When |
| --- | --- | --- |
| The package you upload | **Nothing.** The Store signs it. Upload the unsigned `.msix` | Every release |
| A copy to install on this PC first | The self-signed test certificate, `CN=30ED0224-8255-4781-8ACD-EE3EF146115F` (made once, below) | Every release, if you test it installed |
| `config.json` on the website | `C:\Users\Adi\.leaflet\config-signing-key.pem` (`node site/sign-config.mjs`) | Only when the API's address changes. Not part of a release |

1. **The version.** `apps/package.json`, both places in
   `apps/package-lock.json`, `apps/src-tauri/Cargo.toml`, the `leaflet` entry
   of `Cargo.lock`, `apps/src-tauri/tauri.conf.json`. Each upload needs a
   higher one than the last.
2. **Build** (step 7's commands, in one PowerShell window that you keep open
   for step 3): the five values, then `.\build-msix.ps1`. No warnings about a
   missing value. Output:
   `apps\src-tauri\target\msix\Leaflet_<version>.0_x64.msix`, unsigned.
3. **Try it installed** (same window). The script signs the package where it
   lies, so **the signed file takes the upload's name**: sign, move the
   signed copy aside, and pack the unsigned one again.
   ```powershell
   # The test certificate, if this PC still has it (it was made for 1.1):
   $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq "CN=30ED0224-8255-4781-8ACD-EE3EF146115F" | Select-Object -First 1
   # Nothing printed by `$cert`? Make it: release-msix.md, "Test it locally",
   # the New-SelfSignedCertificate and Import-PfxCertificate lines (the import
   # needs an administrator PowerShell, once per certificate).
   $password = ConvertTo-SecureString -String "leaflet-test" -Force -AsPlainText
   Export-PfxCertificate -Cert $cert -FilePath "$env:TEMP\leaflet-test.pfx" -Password $password

   .\build-msix.ps1 -SkipBuild -CertificatePath "$env:TEMP\leaflet-test.pfx" -CertificatePassword "leaflet-test"
   Move-Item ..\target\msix\Leaflet_1.2.0.0_x64.msix ..\target\msix\Leaflet_1.2.0.0_x64.test-signed.msix -Force
   .\build-msix.ps1 -SkipBuild        # the unsigned one again, for the Store

   Get-AppxPackage *LeafletBookReader* | Remove-AppxPackage   # only if a test copy is installed; it removes that copy's library
   Add-AppxPackage ..\target\msix\Leaflet_1.2.0.0_x64.test-signed.msix
   ```
   Then step 8's list in the installed app, and what HANDOFF.md asks to be
   looked at for this release. If the Store's own Leaflet is installed on
   this PC, the test copy replaces it only when its version is higher.
4. **The server**, if `server/` changed (step 5's one command), then
   `https://leafletapp.duckdns.org/health`.
5. **The code and the website.** Fast-forward `main` and tag; the push
   publishes `site/` and `docs/legal/` (privacy policy, terms) by itself.
   ```powershell
   cd D:\Leaflet
   git switch main
   git merge --ff-only release/1.2
   git push origin main
   git tag v1.2.0
   git push origin v1.2.0
   ```
6. **Partner Center** → Leaflet → **Update** (a new submission): Packages →
   upload the **unsigned** `.msix` and remove the older package from the
   submission; Store listing → "What's new in this version"; submit.
   Certification usually takes a day or two.

## After launch

| To… | Do |
| --- | --- |
| Update the API | Re-run `deploy.ps1` (step 5) |
| Watch the API | `sudo journalctl -u leaflet-api -f` on the VM |
| Move the API to another address | Edit `site/config.source.json`, `node site/sign-config.mjs`, commit and push. Installed apps follow; no Store update |
| Release an update (e.g. 1.1.0) | Bump the version in `apps/package.json` and both places in `apps/package-lock.json`, in `apps/src-tauri/Cargo.toml` and the `leaflet` entry of `Cargo.lock`, and in `apps/src-tauri/tauri.conf.json`; repeat steps 7–9 (each upload needs a higher version than the last); then `git tag v<version>` and push the tag |
| Back up the database | Atlas M0 has no automatic backups: `mongodump --uri "<the string>" --out leaflet-$(date +%F)` from a machine on the Atlas allowlist |
