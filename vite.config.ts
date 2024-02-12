import { defineConfig } from 'vite'
import { htmc } from './index'
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
        ssr: 'index.ts',
        outDir: 'lib',
      },
    }
  } else {
    return {
      plugins: [htmc({})],
    }
  }
})
