import Tonic from '@socketsupply/tonic'
import fs from 'socket:fs'
import path from 'socket:path'
import process from 'socket:process'
import { exec } from 'socket:child_process'
import { Encryption, sha256 } from 'socket:network'

import Config from '../lib/config.js'

class AppProperties extends Tonic {
  async saveSettingsFile () {
    const app = this.props.parent
    const currentProject = app.state.currentProject
    const pathToSettingsFile = path.join(path.DATA, 'projects', 'settings.json')
    const coTabs = document.querySelector('editor-tabs')
    const coEditor = document.querySelector('app-editor')

    // if the user currently has the config file open in the editor...
    if (coTabs.tab?.isRootSettingsFile) {
      try {
        coEditor.value = JSON.stringify(app.state.settings, null, 2)
      } catch (err) {
        return notifications.create({
          type: 'error',
          title: 'Unable to save config file',
          message: err.message
        })
      }
    }

    try {
      const str = JSON.stringify(app.state.settings)
      await fs.promises.writeFile(pathToSettingsFile, str)
    } catch (err) {
      return notifications?.create({
        type: 'error',
        title: 'Error',
        message: 'Unable to update settings'
      })
    }
  }

  async change (e) {
    const el = Tonic.match(e.target, '[data-event]')
    if (!el) return

    const { event, section, value } = el.dataset

    const app = this.props.parent
    const notifications = document.querySelector('#notifications')
    const editor = document.querySelector('app-editor')
    const project = document.querySelector('app-project')
    const config = new Config(app.state.currentProject?.id)

    if (event === 'org' || event === 'shared-secret') {
      const app = this.props.parent
      const config = new Config(app.state.currentProject?.id)
      if (!config) return

      let bundleId = await config.get('meta', 'bundle_identifier')
      if (bundleId) bundleId = bundleId.replace(/"/g, '')
      const { data: dataBundle } = await app.db.projects.get(bundleId)

      if (event === 'org') {
        dataBundle.org = el.value
        dataBundle.clusterId = await sha256(el.value, { bytes: true })
      }

      if (event === 'shared-secret') {
        const sharedKey = await Encryption.createSharedKey(el.value)
        const derivedKeys = await Encryption.createKeyPair(sharedKey)
        const subclusterId = Buffer.from(derivedKeys.publicKey)

        dataBundle.sharedKey = sharedKey
        dataBundle.sharedSecret = el.value
        dataBundle.subclusterId = subclusterId
      }

      await app.db.projects.put(bundleId, dataBundle)
      await app.initNetwork()
      this.reRender()
    }

    //
    // when the user wants to toggle one of the preview windows they have configured
    //
    if (event === 'preview') {
      const previewWindow = app.state.settings.previewWindows.find(o => o.title === value)

      if (previewWindow) {
        previewWindow.active = !previewWindow.active
      }

      await this.saveSettingsFile()
      app.activatePreviewWindows()
    }

    //
    // When the user wants to make a change to the one of the properties in the await config file
    //
    if (event === 'property') {
      await config.set(section, el.id, el.value)
      editor.loadProjectNode(node)

      notifications?.create({
        type: 'info',
        title: 'Note',
        message: 'A restart of the app your building may be required.'
      })
    }
  }

  async click (e) {
    const elCopy = Tonic.match(e.target, '[symbol-id="copy-icon"]')

    if (elCopy) {
      navigator.clipboard.writeText(elCopy.nextElementSibling.value)
      return
    }

    const el = Tonic.match(e.target, '[data-event]')
    if (!el) return

    const { event } = el.dataset

    if (event === 'publish') {
      const coDialogPublish = document.querySelector('dialog-publish')
      if (coDialogPublish) coDialogPublish.show()
    }
  }

  async loadProjectNode (node) {
    this.reRender()
    return true
  }

  async render () {
    const app = this.props.parent
    const settings = app.state.settings
    const currentProject = app.state.currentProject
    const cwd = currentProject?.id
    const config = new Config(cwd)
    const previewWindows = []

    if (settings?.previewWindows) {
      let index = 0

      if (Array.isArray(settings.previewWindows)) {
        for (const w of settings.previewWindows) {
          if (!w.title) continue
          previewWindows.push(this.html`
            <tonic-checkbox
              id="${w.title}-${String(index++)}"
              data-event="preview"
              data-value="${w.title}"
              checked="${String(w.active)}"
              data-aspect-ratio="${w.aspectRatio}"
              data-resolution="${w.resolution}"
              label="${w.title}"
              title="${w.description || ''}"
            ></tonic-checkbox>
          `)
        }
      }
    }

    let bundleId = await config.get('meta', 'bundle_identifier')
    if (bundleId) bundleId = bundleId.replace(/"/g, '')

    let project = {}

    const { data: hasBundle } = await app.db.projects.has(bundleId)

    if (hasBundle) {
      const { data } = await app.db.projects.get(bundleId)
      project = data
    } else if (currentProject?.isDirectory) {
      //
      // The clusterId is hard coded for now.
      //
      const clusterId = await sha256('socket-app-studio', { bytes: true })

      project.sharedSecret = (await Encryption.createId()).toString('hex')
      const sharedKey = await Encryption.createSharedKey(project.sharedSecret)
      const derivedKeys = await Encryption.createKeyPair(sharedKey)
      const subclusterId = Buffer.from(derivedKeys.publicKey)

      //
      // Projects are keyed off the bundleId
      //
      Object.assign(project, {
        bundleId,
        clusterId,
        subclusterId,
        sharedKey,
        org: 'union-app-studio',
      })

      await app.db.projects.put(bundleId, project)

      //
      // We need to tell the network to start listening for this subcluster
      //
      await app.initNetwork()
    }

    let projectUpdates = []
    let gitStatus = { stdout: '' }

    if (cwd) {
      //
      // If there is a current project, check if its been git await configtialized.
      //
      try {
        await fs.promises.stat(path.join(cwd, '.git'))
      } catch (err) {
        try {
          gitStatus = await exec('git await configt', { cwd })
        } catch (err) {
          gitStatus.stderr = err.message
        }

        if (gitStatus?.stderr.includes('command not found')) {
          projectUpdates.push(this.html`
            <tonic-toaster-inline
              id="git-not-installed"
              dismiss="false"
              display="true"
            >Git is not installed and is required to use this program.
            </tonic-toaster-inline>
          `)
        }
      }

      //
      // Try to get the status of the project to tell the user what
      // has changed and help them decide if they should publish.
      //
      try {
        gitStatus = await exec('git status --porcelain', { cwd })
      } catch (err) {
        gitStatus.stderr = err.message
      }

      projectUpdates = this.html`
        <pre id="project-status"><code>No changes.</code></pre>
      `

      const notInitialized = gitStatus.stderr.includes('not a git repo')

      if (notInitialized || (!gitStatus.stderr && gitStatus.stdout.length)) {
        projectUpdates = this.html`
          <pre id="project-status"><code>${gitStatus.stdout || 'No Changes.'}</code></pre>
          <tonic-button
            id="publish"
            data-event="publish"
            width="180px"
            class="pull-right"
          >Publish</tonic-button>
        `
      }
    }

    return this.html`
      <tonic-accordion id="options" selected="preview-windows">
        <h3>App Settings</h3>
        <tonic-accordion-section
          name="preview-windows"
          id="preview-windows"
          label="Preview Windows"
        >
          ${previewWindows}
        </tonic-accordion-section>
        <tonic-accordion-section
          name="build-target"
          id="build-target"
          label="Build Target"
        >
          <div class="build-controls">
            <tonic-select id="device" value="${process.platform}" title="Build Target Platform">
              <option value="ios-simulator" data-value="--platform=ios-simulator">iOS Simulator</option>
              <option value="android-emulator" data-value="--platform=android-emulator">Android Emulator</option>
              <option value="linux" data-value="" disabled>Linux</option>
              <option value="darwin" data-value="">MacOS</option>
              <option value="win32" data-value="" disabled>Windows</option>
            </tonic-select>
          </div>
        </tonic-accordion-section>

        <h3>Project Settings</h3>
        <tonic-accordion-section
          name="application"
          id="application"
          label="Desktop Features"
        >
          <tonic-checkbox data-section="build" id="headless" checked="${await config.get('build', 'headless')}" data-event="property" label="Headless" title="Headless"></tonic-checkbox>
          <tonic-checkbox data-section="application" id="tray" checked="${await config.get('application', 'tray')}" label="Tray" data-event="property" title="Tray"></tonic-checkbox>
          <tonic-checkbox data-section="application" id="agent" checked="${await config.get('application', 'agent')}" data-event="property" label="Agent" title="Agent"></tonic-checkbox>
        </tonic-accordion-section>
        <tonic-accordion-section
          name="permissions"
          id="permissions"
          label="Permissions"
        >
          <tonic-checkbox data-section="permissions" id="allow_fullscreen" checked="${await config.get('permissions', 'allow_fullscreen')}" data-event="property" label="Full Screen"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_microphone" checked="${await config.get('permissions', 'allow_microphone')}" data-event="property" label="Microphone"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_camera" checked="${await config.get('permissions', 'allow_camera')}" data-event="property" label="Camera"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_user_media" checked="${await config.get('permissions', 'allow_user_media')}" data-event="property" label="User Media"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_geolocation" checked="${await config.get('permissions', 'allow_geolocation')}" data-event="property" label="Geolocation"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_notifications" checked="${await config.get('permissions', 'allow_notifications')}" data-event="property" label="Notifications"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_sensors" checked="${await config.get('permissions', 'allow_sensors')}" data-event="property" label="Sensors"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_clipboard" checked="${await config.get('permissions', 'allow_clipboard')}" data-event="property" label="Clipboard"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_bluetooth" checked="${await config.get('permissions', 'allow_bluetooth')}" data-event="property" label="Bluetooth"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_data_access" checked="${await config.get('permissions', 'allow_data_access')}" data-event="property" label="Data Access"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_airplay" checked="${await config.get('permissions', 'allow_airplay')}" data-event="property" label="AirPlay"></tonic-checkbox>
          <tonic-checkbox data-section="permissions" id="allow_hotkeys" checked="${await config.get('permissions', 'allow_hotkeys')}" data-event="property" label="AirPlay"></tonic-checkbox>
        </tonic-accordion-section>
        <tonic-accordion-section
          name="share-settings"
          id="share-settings"
          label="Sharing"
        >
          <tonic-input
            label="Organization"
            id="org-name"
            data-event="org"
            spellcheck="false"
            value="${project.org}"
          ></tonic-input>

          <tonic-input
            label="Shared Secret"
            id="shared-secret"
            data-event="shared-secret"
            spellcheck="false"
            value="${project.sharedSecret}"
          ></tonic-input>

          <tonic-input
            label="Project Link"
            id="project-link"
            symbol-id="copy-icon"
            position="right"
            spellcheck="false"
            readonly="true"
            value="union://${project.sharedSecret}?id=${encodeURIComponent(bundleId)}&org=${project.org}"
          ></tonic-input>

          <label>Project Status</label>
          ${projectUpdates}
        </tonic-accordion-section>
      </tonic-accordion>
    `
  }
}

export { AppProperties }
export default AppProperties
