import { Plugin, normalizePath } from 'vite'
import { join, resolve } from 'path'
import { parseHTML } from 'linkedom'
import { existsSync, readFileSync, readdir } from 'fs'

export interface HTMCOptions {
  assets?: 'split' | 'merge' | undefined
}

class HTMC {
  #plugin: Plugin
  #srcPath: string
  #componentsPath: string
  #publicPath: string

  #currentComponentHTMLFilePaths: Set<string> = new Set()
  #currentComponentFolderPaths: Set<string> = new Set()
  #dom: Window & typeof globalThis = null!
  #layout: string

  #bracketsRegExp = new RegExp('({[^}]*})', 'g')

  constructor(options?: HTMCOptions) {
    this.#srcPath = normalizePath(resolve(process.cwd(), 'src'))
    this.#componentsPath = this.#joinPaths(this.#srcPath, 'components')
    this.#publicPath = this.#joinPaths(this.#srcPath, 'static')

    const layoutPath = this.#joinPaths(this.#srcPath, 'components', 'layout')

    if (existsSync(layoutPath)) {
      this.#layout = `
        <component name="layout">
         @
        </component>
      `
    } else {
      this.#layout = `
        <!doctype html>
        <html>
          <head></head>
          <body>
            @
          </body>
        </html>
      `
    }

    const pages: { [key: string]: string } = {}

    readdir(this.#srcPath, { recursive: true }, (_, files) => {
      files.forEach((f) => {
        if (typeof f === 'string') {
          if (!f.includes('components') && f.includes('html')) {
            pages[f] = this.#joinPaths(this.#srcPath, f)
          }
        }
      })
    })

    this.#plugin = {
      name: 'vite-plugin-htmc',

      config: (config, env) => {
        if (env.mode === 'production' && env.command === 'serve') {
          return
        }

        config.root = this.#srcPath
        config.publicDir = this.#publicPath

        config.resolve = {
          ...config.resolve,
          alias: {
            ...config.resolve?.alias,
            '@components': this.#componentsPath,
          },
        }

        config.build = {
          assetsInlineLimit: 0,
          emptyOutDir: true,
          modulePreload: false,
          ...config.build,
          rollupOptions: {
            ...config.build?.rollupOptions,
            input: {
              ...pages,
            },
            output: {
              dir: resolve(process.cwd(), 'dist'),
              chunkFileNames: () => {
                return 'assets/[name].js'
              },
              assetFileNames: () => {
                return 'assets/[name].[ext]'
              },
              entryFileNames: (e) => {
                return `assets/${e.name.replace('.html', '')}.js`
              },
              manualChunks: options?.assets
                ? (e) => {
                    if (options?.assets === 'split') {
                      if (e.endsWith('ts') || e.endsWith('css')) {
                        return e.split('/').slice(-2).join('/').split('.')[0]
                      }
                    } else {
                      if (e.endsWith('ts')) {
                        return 'scripts'
                      } else if (e.endsWith('css')) {
                        return 'styles'
                      }
                    }
                  }
                : undefined,
              ...config.build?.rollupOptions?.output,
            },
          },
        }
      },

      handleHotUpdate: ({ file, server }) => {
        if (this.#currentComponentHTMLFilePaths.has(file)) {
          server.hot.send({
            type: 'full-reload',
            path: '*',
          })
        }
      },

      transformIndexHtml: {
        order: 'pre',
        handler: async (html, ctx) => {
          this.#currentComponentHTMLFilePaths.clear()
          this.#currentComponentFolderPaths.clear()

          const isComponent = ctx.originalUrl?.includes('/components/')

          if (isComponent) {
            let name = ctx.originalUrl!.split('/components/')[1]
            html = this.#layout.replace('@', `<component name="${name}" />`)
          }

          this.#dom = parseHTML(html)

          this.#transform()
          this.#resources()

          const res = `<!DOCTYPE html>\n` + this.#dom.document.documentElement.outerHTML

          return res
        },
      },
    }
  }

  public get plugin() {
    return this.#plugin
  }

  #transform() {
    let components: Array<HTMLElement> = [
      ...this.#dom.document.querySelectorAll<HTMLElement>('component'),
    ]

    do {
      components = [...this.#dom.document.querySelectorAll<HTMLElement>('component')]

      components.forEach((component) => {
        const name = component.getAttribute('name')!

        const folderPath = this.#joinPaths(this.#srcPath, 'components', name, '/')

        if (existsSync(folderPath)) {
          const indexHTMLPath = normalizePath(folderPath + '/index.html')

          if (existsSync(indexHTMLPath)) {
            this.#currentComponentHTMLFilePaths.add(indexHTMLPath)

            const componentHTML = readFileSync(indexHTMLPath, { encoding: 'utf-8' })
            const componentEmptyElement = this.#dom.document.createElement(null!) as Element
            componentEmptyElement.innerHTML = componentHTML.replace(/<!DOCTYPE\s+html>/i, '').trim()

            this.#attributes(component, componentEmptyElement)

            const componentFirstChild = componentEmptyElement.firstChild

            if (componentFirstChild) {
              if (componentFirstChild instanceof this.#dom.Element) {
                this.#nest(component, componentFirstChild)
                component.outerHTML = componentFirstChild.outerHTML
              }

              component.outerHTML = componentFirstChild.textContent || ''
            } else {
              component.outerHTML = ''
            }
          }

          const componentsNames = folderPath.split(this.#componentsPath)[1].slice(1, -1).split('/')

          componentsNames.reduce((p, c) => {
            const componentFolderPath = normalizePath(`${p}/${c}/`)
            this.#currentComponentFolderPaths.add(componentFolderPath)
            return componentFolderPath
          }, this.#componentsPath)
        } else {
          component.setAttribute('not-found', '')
          component.textContent = 'Компонент не найден'
        }
      })
    } while (
      components.length &&
      components.filter((c) => c.hasAttribute('not-found')).length !== components.length
    )
  }

  #attributes(component: Element, componentElement: Element) {
    const allElements = componentElement.querySelectorAll<HTMLElement>('*')

    const elements: Array<{
      element: HTMLElement
      attributeName: string
      defaultValue: string
    }> = []

    for (let i = 0; i < allElements.length; i++) {
      const element = allElements[i]
      const attributes = element.attributes

      for (let j = 0; j < attributes.length; j++) {
        const attributeName = attributes[j].name

        if (attributeName.startsWith('{') && attributeName.endsWith('}')) {
          const normalAttributeName = attributeName.slice(1, -1)
          const attributeValue = attributes[j].value

          element.removeAttribute(attributeName)

          if (attributeValue) {
            element.setAttribute(normalAttributeName, attributeValue)
          }

          elements.push({
            element,
            attributeName: normalAttributeName,
            defaultValue: attributeValue,
          })
        }
      }
    }

    for (const attr of component.attributes) {
      if (attr.name !== 'name' && attr.value) {
        elements.forEach((element) => {
          if (element.attributeName === attr.name) {
            const currentValue = element.element.getAttribute(element.attributeName) || ''
            element.element.setAttribute(
              element.attributeName,
              `${currentValue}${currentValue ? ' ' : ''}${attr.value}`
            )
          }
        })
      }
    }

    for (const attr of component.attributes) {
      if (attr.name !== 'name') {
        componentElement.innerHTML = componentElement.innerHTML.replace(
          new RegExp(`{\\s*${attr.name}\\s*(?:\\|\\|\\s*([^}]*))?\\s*}`, 'g'),
          attr.value
        )
      }
    }

    componentElement.innerHTML = componentElement.innerHTML.replace(this.#bracketsRegExp, (v) => {
      const content = v.slice(2, -2).split('||')

      if (content.length > 1) {
        return content[1].trim()
      }

      return ''
    })
  }

  #nest(component: Element, componentElement: Element) {
    let nestInserts = [...component.children].filter((element) => element.hasAttribute('nest'))

    nestInserts.forEach((insert) => {
      insert.remove()
    })

    const defaultInserts = component.innerHTML

    const nestElements = componentElement.querySelectorAll('nest')

    nestElements.forEach((nestElement) => {
      const name = nestElement.getAttribute('name')

      if (name && name !== 'default') {
        const inserts = nestInserts.filter((insert) => insert.getAttribute('nest') === name)
        inserts.forEach((insert) => insert.removeAttribute('nest'))
        nestElement.outerHTML = inserts.reduce((p, c) => p + c.outerHTML, '')
        nestInserts = nestInserts.filter((insert) => !inserts.includes(insert))
      } else {
        const inserts = nestInserts.filter(
          (insert) => !insert.getAttribute('nest') || insert.getAttribute('nest') === 'default'
        )
        inserts.forEach((insert) => insert.removeAttribute('nest'))
        nestElement.outerHTML = inserts.reduce((p, c) => p + c.outerHTML, '') + defaultInserts
      }
    })
  }

  #resources() {
    const document = this.#dom.document

    let head = document.querySelector('head')!

    if (!head) {
      head = document.createElement('head')
      document.prepend(head)
    }

    const exts = ['js', 'ts', 'css']

    this.#currentComponentFolderPaths.forEach((folderPath) => {
      const url = folderPath.split(this.#srcPath)[1]

      exts.forEach((ext) => {
        const urlPath = url + 'index.' + ext
        const filePath = this.#joinPaths(this.#srcPath, urlPath)

        if (existsSync(filePath)) {
          if (ext === 'css') {
            const element = document.createElement('link')
            element.rel = 'stylesheet'
            element.href = urlPath
            head.appendChild(element)
          } else {
            const element = document.createElement('script')
            element.type = 'module'
            element.src = urlPath
            head.appendChild(element)
          }
        }
      })
    })
  }

  #joinPaths(...paths: string[]) {
    return normalizePath(join(...paths))
  }
}

export function htmc(options?: HTMCOptions) {
  return new HTMC(options).plugin
}
