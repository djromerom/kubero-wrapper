import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cli } from '../runtime.mjs';
import { getClusterSettings } from '../cluster-settings.mjs';
import { buildImage, cacheLocalImage } from '../kubero-build.mjs';

cli(import.meta.url, 'node scripts/tests/kubero-build.integration.mjs [--repository URL] [--commit SHA] [--strategy buildpacks|nixpacks|dockerfile] [--platform linux/amd64|linux/arm64] [--image IMAGEN_PUBLICADA]', async args => {
  const settings = getClusterSettings({ ...process.env, ATLAS_BUILD_PLATFORM: args.platform || 'linux/amd64' });
  if (args.image) {
    if (settings.Delivery === 'registry') throw new Error('--image verifica la caché del laboratorio local.');
    await cacheLocalImage(args.image, settings);
    console.log(`OK: imagen publicada disponible en los nodos locales para ${settings.Platform}.`);
    return;
  }
  const strategy = args.strategy || 'buildpacks';
  const build_env = strategy === 'buildpacks' ? { BP_NODE_VERSION: '22.*' } : strategy === 'nixpacks' ? { NIXPACKS_NODE_VERSION: '22' } : {};
  const result = await buildImage({ settings, slug: `native-check-${randomUUID().slice(0, 8)}`, commit: args.commit || '2c71d9971795dca95ef8f1e0214ca441fc4ab403', repository: args.repository || 'https://github.com/kubero-dev/template-nodeapp', strategy, dockerfile: 'Dockerfile', configuration: { build_env } });
  assert.ok(result.Image);
  console.log(`OK: Kubero empaquetó y publicó ${result.Image} para ${settings.Platform}; la ejecución de la aplicación se comprueba tras aprobar.`);
});
