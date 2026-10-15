# Obsidian

A custom Minecraft launcher for Windows. Play with Microsoft or offline accounts, run as many separate instances as you like, add Fabric or Forge, and install mods, modpacks, resource packs and shaders without leaving the app.

![Home](docs/screenshots/home.png)

## Features

- **Accounts**: Microsoft sign in and offline accounts with any username, with quick switching between them
- **Instances**: each one has its own version, mods, worlds, settings, RAM and Java arguments
- **Mod loaders**: Vanilla, Fabric and Forge, installed automatically when you press Play
- **Browse**: search Modrinth (no key needed) and CurseForge (needs a key) for mods, modpacks, resource packs and shaders. Required dependencies install automatically
- **Modpacks**: install from Modrinth or CurseForge, import `.mrpack`, CurseForge `.zip` and Prism or MultiMC exports, export your own instances as `.mrpack`, and update packs in place
- **Skins**: a 3D viewer with animations, a skin library with 3D previews, skin upload for Microsoft accounts, and cape switching
- **Java**: the right Java version is downloaded automatically for every Minecraft version
- **Discord status**: shows "Playing Minecraft, using Obsidian Launcher" with your version and play time
- **Themes**: Obsidian, Midnight, Ember, Forest, Nether, The End and Frost, plus custom accent colours
- **Downloads panel** with progress, speed and cancel buttons
- **Presets**: one click Bedwars, Hypixel SkyBlock and Crystal PvP instances with performance mods, texture packs and tuned settings
- **Custom installer** with its own look that downloads the latest version, plus automatic updates

| Library | Browse | Skins |
| --- | --- | --- |
| ![Library](docs/screenshots/library.png) | ![Browse](docs/screenshots/browse.png) | ![Skins](docs/screenshots/skins.png) |

## Install

Download `Obsidian-Setup.exe` from the [latest release](https://github.com/lazentho/obsidian-launcher/releases/latest) and run it. It downloads the latest Obsidian, installs it with Start menu and desktop shortcuts, and starts it. Obsidian updates itself after that. `Obsidian-Full-Setup.exe` on the same page is the standard offline installer.

![Installer](docs/installer/setup.png)

## Setup notes

### Microsoft login
Obsidian has a Microsoft app ID built in. Mojang has to approve that app before Minecraft accepts sign ins, so Microsoft login only works once the app at [aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid) is approved. Offline accounts work without it.

### CurseForge
CurseForge requires a free API key from [console.curseforge.com](https://console.curseforge.com). Paste it into **Settings → Integrations**. The key stays on your PC. Modrinth works without a key.

### Discord status
1. Create an application at [discord.com/developers/applications](https://discord.com/developers/applications) and name it **Minecraft** (Discord shows "Playing" followed by this name).
2. Under **Rich Presence → Art Assets**, upload [`assets/discord/obsidian.png`](assets/discord/obsidian.png) with the name `obsidian`.
3. Paste the **Application ID** into **Settings → Discord**, or into `BUILT_IN.discordClientId` in `src/core/settings.js` so everyone gets it.

## Development

Requires Node.js 22.

```bash
npm install
npm start          # run the launcher
npm test           # unit and end-to-end tests
npm run dist       # build the full Windows installer into dist/
npm run setup      # build the custom installer (Rust) into installer/target/release/
npm run icons      # regenerate icons and installer images from the logo
```

Building the Windows installer needs Windows (or Wine on Linux). GitHub Actions builds it on every push: open the run under **Actions** and download the **Obsidian-Windows** artifact.

### Publishing a release

1. Bump `version` in `package.json` (for example `0.2.0`).
2. Commit, then push a matching tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. GitHub Actions publishes a release with `Obsidian-Setup.exe` (custom installer) and `Obsidian-Full-Setup.exe`. Existing installs update themselves.

### Project layout

```
src/core/       launcher engine: downloads, Java, loaders, accounts, mods, modpacks, skins, Discord
src/main/       Electron main process, preload bridge and auto updater
src/renderer/   the interface (plain JavaScript modules and CSS, no build step)
test/           unit tests and end-to-end tests against fake Mojang, Fabric, Forge and CurseForge servers
installer/      the custom installer (Rust, egui): downloads and silently runs Obsidian-Full-Setup.exe
scripts/        icon and installer image generator
```

### Data folder

Everything lives in `%APPDATA%\.obsidian`: shared game files (`versions`, `libraries`, `assets`), downloaded Java (`runtimes`), and one folder per instance under `instances`.

## Legal

Obsidian is not affiliated with Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Studios. Obsidian ships no game files. Minecraft, its textures and Java are downloaded from official sources on your computer.
