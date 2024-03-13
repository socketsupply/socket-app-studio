globalThis.RUNTIME_APPLICATION_ALLOW_MULTI_WINDOWS = true

let currentWindow = null
const consoleMethods = ['log', 'error', 'info', 'warn', 'debug']
for (const method of consoleMethods) {
  const original = console[method]
  globalThis.console[method] = async (...args) => {
    if (!currentWindow) {
      currentWindow = await application.getCurrentWindow()
    }
    original.call(console, ...args)
    if (currentWindow) {
      // @ts-ignore
      currentWindow.channel.postMessage({
        [method]: [inspect(...args)]
      })
    }
  }
}

import application from 'socket:application'
import { inspect } from 'socket:util'

const previewWindowTitleBar = 38
const previewWindowMargin = 12
const deviceWidth = (1179 / 4) - previewWindowMargin
const deviceHeight = (2556 / 4) - previewWindowTitleBar

let timeout

const scaleToFit = e => {
  const windowWidth = window.innerWidth
  const windowHeight = window.innerHeight

  const bodyStyles = window.getComputedStyle(document.body)

  const bodyMarginX = parseFloat(bodyStyles.marginLeft) + parseFloat(bodyStyles.marginRight)
  const bodyMarginY = parseFloat(bodyStyles.marginTop) + parseFloat(bodyStyles.marginBottom)
  const bodyPaddingX = parseFloat(bodyStyles.paddingLeft) + parseFloat(bodyStyles.paddingRight)
  const bodyPaddingY = parseFloat(bodyStyles.paddingTop) + parseFloat(bodyStyles.paddingBottom)

  const bodyInnerWidth = windowWidth + bodyMarginX + bodyPaddingX
  const bodyInnerHeight = windowHeight + bodyMarginY + bodyPaddingY

  const widthScaleFactor = bodyInnerWidth / deviceWidth
  const heightScaleFactor = bodyInnerHeight / deviceHeight

  const zoom = Math.min(widthScaleFactor, heightScaleFactor)
  document.body.parentElement.style.zoom = zoom

  if (currentWindow) {
    currentWindow.channel.postMessage({
      zoom
    })
  }
}

window.addEventListener('resize', scaleToFit)
