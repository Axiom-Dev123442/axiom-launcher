'use strict';

/** Remote endpoints. Kept in one mutable object so tests can point them at a local server. */
module.exports = {
  versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  javaRuntimes:
    'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json',
  resources: 'https://resources.download.minecraft.net',
  libraries: 'https://libraries.minecraft.net/',
  fabricMeta: 'https://meta.fabricmc.net/v2',
  forgeMaven: 'https://maven.minecraftforge.net',
  forgePromotions: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
  modrinth: 'https://api.modrinth.com/v2',
  curseforge: 'https://api.curseforge.com/v1',
  msLogin: 'https://login.microsoftonline.com/consumers/oauth2/v2.0',
  xboxUser: 'https://user.auth.xboxlive.com/user/authenticate',
  xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  mcServices: 'https://api.minecraftservices.com',
  mojangApi: 'https://api.mojang.com',
  sessionServer: 'https://sessionserver.mojang.com',
};

// Developer override for testing against local fakes, e.g. OBSIDIAN_DEV_ENDPOINTS='{"modrinth":"http://127.0.0.1:9000"}'
if (process.env.OBSIDIAN_DEV_ENDPOINTS) {
  try {
    Object.assign(module.exports, JSON.parse(process.env.OBSIDIAN_DEV_ENDPOINTS));
  } catch {}
}
