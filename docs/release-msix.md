# Releasing Leaflet

Everything needed to put Leaflet on the Microsoft Store: the website, the API
server, and the MSIX package. Do them in this order the first time; after that,
each is independent.

| Piece | Where it runs | Cost |
| --- | --- | --- |
| Website, privacy policy, terms, signed `config.json` | GitHub Pages: `https://itsadithyakv.github.io/Leaflet-BookReader/` | Free |
| API (accounts, leaderboards) | Oracle VM `129.154.40.208`, behind Caddy at `https://leafletapp.duckdns.org` | Free (Always Free VM, DuckDNS) |
| Database | MongoDB Atlas free tier | Free |
| The app | Microsoft Store, identity `AdithyaKV.LeafletBookReader`, publisher PaperKite | Store registration only |

Nothing depends on `unifloe.app`, so its expiry (July 2027) does not affect Leaflet.

## How the app finds the server

The app ships with one fixed address: `config.json` on GitHub Pages. That file
names the API, and is signed with PaperKite's Ed25519 key; the app checks the
signature with the public key compiled into `sync/remote_config.rs` and ignores
anything unsigned or tampered with, keeping the last good address. To move the
API later (a new domain, a new machine), change one line and re-sign; no Store
update is needed.

- Private key: `C:\Users\Adi\.leaflet\config-signing-key.pem`. **Back it up**
  (a password manager or an offline drive). Without it you cannot re-point
  installed apps, and you would have to ship an update with a new public key.
- Resolution order in the app: the reader's own override in Settings, then the
  signed config, then the build-time `LEAFLET_API_BASE` if one was set.

## 1. Website (GitHub Pages)

One-time: in the repo on GitHub, **Settings → Pages → Build and deployment →
Source: GitHub Actions**.

Each change to `site/`, `docs/legal/` or the Pip assets then deploys itself on
push to `main` (`.github/workflows/pages.yml`). To build locally:

```bash
node site/build.mjs
```

To change the API address:

```bash
node site/sign-config.mjs
```

after editing `site/config.source.json`, then commit `site/public/config.json`.

## 2. API server (Oracle VM)

The API is a Node service bound to `127.0.0.1:8787`, reached only through
Caddy, capped at 256 MB so it can never starve the Unifloe site. The deploy
files are in `server/deploy/`. Nothing here touches `/var/www/unifloe` or the
existing `unifloe.app` Caddy blocks, and nothing touches the pilot server
(`go.unifloe.app`, `129.225.110.37`).

### One-time setup

MongoDB Atlas: **Network Access → Add IP Address → `129.154.40.208`** (this VM's
fixed IP; no need to open it to the world). Create a database user limited to
the `leaflet` database and copy its connection string.

On the VM (`ssh -i "C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key" ubuntu@129.154.40.208`):

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# A 1 GB swap file: npm install briefly needs more memory than a 1 GB VM has
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# The environment file: paste the Atlas connection string in yourself
sudo install -m 600 /dev/null /etc/leaflet-api.env
sudo nano /etc/leaflet-api.env
```

`/etc/leaflet-api.env` contents (from `server/deploy/leaflet-api.env.example`):

```
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGO_DB=leaflet
HOST=127.0.0.1
PORT=8787
```

Then add the Caddy block from `server/deploy/Caddyfile.snippet` to the **end**
of `/etc/caddy/Caddyfile`, check it, and reload:

```bash
sudo nano /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy fetches the HTTPS certificate for `leafletapp.duckdns.org` by itself.

### Each release

From PowerShell on your PC:

```powershell
cd D:\Leaflet\server\deploy
.\deploy.ps1 -Host 129.154.40.208 -KeyPath "C:\Users\Adi\Documents\UnifloeMarketingKeys\unifloeMarketingPrivate.key"
```

It packs `server/`, copies it over, installs production dependencies into
`/opt/leaflet-api`, installs the systemd unit and restarts the service. Check it:

```bash
curl https://leafletapp.duckdns.org/health
```

Logs on the VM: `sudo journalctl -u leaflet-api -f`. Memory: `systemctl status leaflet-api`.

## 3. The app (MSIX)

### Build

Set the values that are compiled into the binary, then run the script:

```powershell
$env:LEAFLET_GOOGLE_CLIENT_ID = "…apps.googleusercontent.com"
$env:LEAFLET_GOOGLE_CLIENT_SECRET = "GOCSPX-…"
$env:VITE_ENABLE_ACCOUNTS = "true"
$env:VITE_ENABLE_COMMUNITY = "true"
$env:LEAFLET_API_BASE = "https://leafletapp.duckdns.org"   # fallback only; the signed config wins
cd D:\Leaflet\apps\src-tauri\msix
.\build-msix.ps1
```

The script builds the release exe with `tauri build --no-bundle`, stages it with
the Pip logos and `AppxManifest.xml`, fills in the version from `tauri.conf.json`
(as `x.y.z.0`, which the Store requires), indexes the logos into
`resources.pri` with `makepri` (without it Windows ignores the unplated taskbar
icons, `Square44x44Logo.targetsize-*`, made by `msix\taskbar-icons.py`), and packs
`apps\src-tauri\target\msix\Leaflet_x.y.z.0_x64.msix` with the Windows SDK's
`makeappx`. It also sets `LEAFLET_STORE_BUILD`, which compiles out the Calibre
auto-installer (see below). `-SkipBuild` repackages an existing exe.

### Test it locally before uploading (optional)

The Store signs what you upload, so the package is unsigned. To install it on
this PC first, sign a copy with a self-signed certificate whose subject matches
the manifest's Publisher:

```powershell
$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=30ED0224-8255-4781-8ACD-EE3EF146115F" `
  -KeyUsage DigitalSignature -FriendlyName "Leaflet sideload test" `
  -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
$password = ConvertTo-SecureString -String "leaflet-test" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath "$env:TEMP\leaflet-test.pfx" -Password $password
Import-PfxCertificate -FilePath "$env:TEMP\leaflet-test.pfx" -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $password
.\build-msix.ps1 -SkipBuild -CertificatePath "$env:TEMP\leaflet-test.pfx" -CertificatePassword "leaflet-test"
Add-AppxPackage ..\target\msix\Leaflet_1.0.0.0_x64.msix
```

(The TrustedPeople import needs an administrator PowerShell.) Uninstall with
`Get-AppxPackage *LeafletBookReader* | Remove-AppxPackage`.

### Submit

Partner Center → the Leaflet app → **Start submission**:

1. **Packages:** upload the unsigned `.msix` from `target\msix\`.
2. **Properties:** category Books & reference; privacy policy URL
   `https://itsadithyakv.github.io/Leaflet-BookReader/privacy/`; support contact
   `adithyakrishnan.vinod@gmail.com`.
3. **Age ratings:** complete the questionnaire. Leaflet has user-chosen handles
   and display names on leaderboards, so answer yes to user interaction.
4. **Store listing:** description, at least one 1366×768 or larger screenshot,
   and the Pip logos from `apps/src/assets/pip/` (the tile PNGs suit the Store
   logo slots).
5. **Pricing:** free.

`runFullTrust` is a restricted capability; Partner Center asks you to say why.
Leaflet is a Win32 desktop app packaged for the Store (Tauri), which needs full
trust to run at all.

### Check before submitting

- **Display name.** `AppxManifest.xml` uses "Leaflet Book Reader". It must match
  the name you reserved in Partner Center exactly, character for character.
- **Google sign-in screen.** In Google Cloud's OAuth consent screen, set the
  home page to `https://itsadithyakv.github.io/Leaflet-BookReader/` and the
  privacy policy to the `/privacy/` page, and publish the app to Production
  (Testing mode expires Drive sign-ins every 7 days).

## What changes under MSIX, and why it is fine

- **App data.** The library, database and covers live in the Tauri app-data
  directory under `%APPDATA%`, which MSIX redirects into the package's own
  storage. Nothing is written beside the exe (the install folder is read-only).
  Uninstalling removes the data, so remind readers to back up to Drive.
- **Google sign-in.** The loopback listener on `127.0.0.1` works for full-trust
  packaged apps.
- **Credentials.** The Drive refresh token and account session go to Windows
  Credential Manager as before.
- **Calibre.** Store policy does not let an app download and run executable
  code, so Store builds cannot install Calibre themselves. They still use a
  Calibre the reader installed from calibre-ebook.com; the Settings card says so.
- **Reading reminders.** Only the MSIX gets reminders with Leaflet closed; see
  [Reading reminders](#reading-reminders-toasts) below.
- **Updates.** The Store updates the app; there is no in-app updater.
- **WebView2.** Present on Windows 11 and current Windows 10.

## Reading reminders (toasts)

Settings → Reminders (see [features.md](features.md#reminders)). While Leaflet
runs, a Rust scheduler shows toasts itself. When it exits, the next reminders
are left with Windows as **scheduled toasts**
(`Windows.UI.Notifications.ScheduledToastNotification`, group
`leaflet-reminders`), and the next launch withdraws them again.

What the package needs, and what it deliberately does without:

- **Package identity: already there.** Windows only keeps a toast schedule for
  an app with identity, which the MSIX gives Leaflet. The exe checks with
  `GetCurrentPackageFullName` and, unpackaged (dev, NSIS/MSI), reminds only
  while running. Toasts need no capability and no manifest entry of their own;
  a packaged app's toasts show under its display name and logo.
- **Click to open: a protocol, not a COM activator.** The manifest registers
  `leaflet-reader` (`uap3:Protocol`, `Parameters="&quot;%1&quot;"`), and every
  reminder toast is `activationType="protocol"` with
  `launch="leaflet-reader://continue"`. Windows starts `leaflet.exe` with the URI
  as `argv[1]`, or single-instance hands it to the running window, and Leaflet
  reopens the last book. The alternative, `desktop:ToastNotificationActivation`
  plus a `com:ExeServer` toast activator, would need the exe to register a COM
  class factory at startup, and it only adds what Leaflet does not use (text
  input on toasts, handling a click without showing a window). Microsoft's
  "no COM / stub CLSID" route for packaged apps is documented but reported not
  to launch the app, so it was not relied on.
- **The Pip image** is staged by `build-msix.ps1` as `Assets\PipToast.png`
  (from `apps/src/assets/pip/pip-256.png`) and referenced as
  `ms-appx:///Assets/PipToast.png`. It cannot be a file the app writes at
  runtime: a packaged app's AppData is virtualised, and the notification
  platform, running outside the package, would not find it.

**Partner Center: nothing to do.** `windows.protocol` is not a restricted
extension, there is no new capability, and `runFullTrust` (already justified)
covers the rest. The protocol name is visible to other apps (any web page can
link `leaflet-reader:`), which is why the app acts on `continue` only.

**Limits worth knowing.** Windows drops a scheduled toast when the PC is off
for more than five minutes past its time. Reminders are scheduled at exit, so
if Leaflet is killed (Task Manager, a crash, shutdown with it open) nothing is
scheduled until it next runs and closes normally. A reader can turn Leaflet's
notifications off in Windows Settings → System → Notifications; the Reminders
card says so when that is the case.

### Checking it on a sideloaded package

Install the signed test package (above), then in Leaflet: Settings → Reminders,
turn on the daily reminder for a few minutes from now (on a day whose goal is
not met yet), and close Leaflet. The toast should arrive with Leaflet closed, show Pip, and clicking it
should open Leaflet on the last book (with Leaflet open, the same click
brings its window forward). Scheduled toasts only exist while Leaflet is
closed; opening it withdraws them.

"Send a Test" in the card shows a toast immediately, which is the quickest way
to see the wording, the image and whether Windows is letting it through.
