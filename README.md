# Custom CloudStream 3 Extensions Repository

A modular, multi-site CloudStream 3 extension repository designed to host and maintain scrapers for multiple streaming websites.

## 🚀 Supported Sites

| Subfolder | Site Name | Type | Languages / Features |
| :--- | :--- | :--- | :--- |
| `Piratexplay/` | **PirateXPlay** | Anime & Cartoons | Multi-Audio (Hindi, English, Japanese, etc.), 19 Iframe Servers |
| `HDhub4u/` | **HDhub4u** | Movies & Series | Bollywood, Hollywood, Hindi Dubbed, HubCloud Extractor |
| `FourKHDHub/` | **4K HDHUB** | 4K Movies & Series | 2160p UHD HEVC, HubCloud, BuzzServer, PixelDrain |

---

## 📁 Repository Organization

Every streaming provider is kept strictly organized in its own subfolder as an independent Gradle subproject:

```text
cloudstream-extensions/
├── .github/workflows/
│   └── build.yml               # Automated CI/CD (Method 1) to build .cs3 & publish to builds branch
├── Piratexplay/
│   ├── build.gradle.kts        # Plugin metadata, tvTypes, version
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── kotlin/com/piratexplay/
│           ├── PiratexplayPlugin.kt
│           └── PiratexplayProvider.kt
├── HDhub4u/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── kotlin/com/hdhub4u/
│           ├── HDhub4uPlugin.kt
│           ├── HDhub4uProvider.kt
│           ├── Extractors.kt
│           └── Utils.kt
├── FourKHDHub/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       └── kotlin/com/fourKHDHub/
│           ├── FourKHDHubProvider.kt
│           ├── FourKHDHub.kt
│           ├── Extractor.kt
│           └── Utils.kt
├── build.gradle.kts            # Root project build configuration
├── settings.gradle.kts         # Dynamic auto-discovery for all site subfolders
├── gradle.properties
└── gradlew / gradlew.bat
```

---

## ⚡ How to Add a New Site in Seconds

1. Create a new subfolder (e.g. `MyNewSite/`).
2. Add `build.gradle.kts` with your plugin info:
   ```kotlin
   version = 1
   cloudstream {
       language = "hi"
       description = "MyNewSite Movies & Series"
       authors = listOf("YourName")
       status = 1
       tvTypes = listOf("Movie", "TvSeries")
   }
   ```
3. Add `src/main/AndroidManifest.xml`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <manifest xmlns:android="http://schemas.android.com/apk/res/android" />
   ```
4. Add your Kotlin Plugin (`@CloudstreamPlugin`) and Provider (`MainAPI()`) under `src/main/kotlin/com/mynewsite/`.
5. That's it! `settings.gradle.kts` **automatically discovers and includes** your new folder on next build!

---

## 📲 How to Connect to Nuvio Enhanced / CloudStream

Once you push this repo to GitHub, GitHub Actions will compile all `.cs3` plugins and publish `repo.json` to the `builds` branch.

1. In **Nuvio Enhanced** or **CloudStream**, go to **Settings** > **Extensions** > **Add Repository**.
2. Paste your repository URL:
   ```text
   https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>/builds/repo.json
   ```
3. Click **Add**. All plugins (`PirateXPlay`, `HDHub4U`, `4K HDHUB`) will appear ready for one-click install!

---

## 📤 Publishing to GitHub

Run these commands in this directory:
```bash
git init
git branch -M master
git add .
git commit -m "Initial commit: PirateXPlay, HDhub4u, FourKHDHub extensions"
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
git push -u origin master
```
The GitHub Action will automatically run and build your `.cs3` files within 1-2 minutes!
