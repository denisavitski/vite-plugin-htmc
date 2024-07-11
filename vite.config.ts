import { defineConfig } from 'vite'
import { htmc } from './plugin'
import dtsPlugin from 'vite-plugin-dts'

export default defineConfig((env) => {
  if (env.mode === 'production' && env.command === 'build') {
    return {
      plugins: [
        dtsPlugin({
          exclude: ['src'],
        }),
      ],
      build: {
        ssr: 'plugin.ts',
        outDir: 'lib',
      },
    }
  } else {
    return {
      plugins: [
        htmc({
          srcFolderName: 'playground',
          assets: 'merge',
        }),
      ],
    }
  }
})
