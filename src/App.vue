<script setup lang="ts">
import { onMounted, ref, nextTick, watch } from 'vue'
import { initApp, draw, setSingleView, toggleDimensions, toggleRuler, clearRulers, runExport, loadSamplePart, openStlFile } from './engine/blueprint'
import IconUpload from '~icons/tabler/upload'
import IconCube from '~icons/tabler/cube'
import IconRuler from '~icons/tabler/ruler-2'
import IconRulerOff from '~icons/tabler/ruler-2-off'
import IconRulerMeasure from '~icons/tabler/ruler-measure'
import IconDownload from '~icons/tabler/download'
import IconChevronDown from '~icons/tabler/chevron-down'
import IconEye from '~icons/tabler/eye'
import IconSettings from '~icons/tabler/settings'

const activeTab = ref<'viewer' | 'measurements' | 'export' | 'settings'>('viewer')
const dimsOn = ref(true)
const rulerOn = ref(false)
const openMenu = ref<'file' | 'export' | null>(null)

function toggleDims() {
  dimsOn.value = toggleDimensions()
}

function toggleRulerTool() {
  rulerOn.value = toggleRuler()
}

function toggleMenu(name: 'file' | 'export') {
  openMenu.value = openMenu.value === name ? null : name
}

function closeMenus() {
  openMenu.value = null
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) openStlFile(file)
  input.value = ''
  closeMenus()
}

function chooseSample() {
  loadSamplePart()
  closeMenus()
}

function doExport(kind: string) {
  runExport(kind)
  closeMenus()
}

// on mobile the sheet shows one view at a time (four panes at once is unreadable);
// on desktop the engine always draws the full 4-up sheet regardless of this value
const singleView = ref<0 | 1 | 2 | 3>(0)
const desktopQuery = window.matchMedia('(min-width: 900px)')
const isDesktop = ref(desktopQuery.matches)

function syncViewMode() {
  setSingleView(isDesktop.value ? null : singleView.value)
}

function selectView(i: 0 | 1 | 2 | 3) {
  singleView.value = i
  if (!isDesktop.value) setSingleView(i)
}

watch(activeTab, async (tab) => {
  if (tab === 'viewer') {
    await nextTick()
    draw()
  }
})

onMounted(() => {
  initApp()
  syncViewMode()
  desktopQuery.addEventListener('change', (e) => {
    isDesktop.value = e.matches
    syncViewMode()
  })
  document.addEventListener('click', (e) => {
    if (openMenu.value && !(e.target as HTMLElement).closest('.dropdown-wrap')) closeMenus()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus()
  })
})
</script>

<template>
  <header class="titlebar">
    <h1>
      <span class="title-mobile">STL Blueprint Viewer</span><span class="title-desktop">STL Blueprint</span><span id="fileName" class="file-name"></span>
    </h1>
    <div class="actions">
      <div class="group">
        <div class="dropdown-wrap split-btn">
          <label class="file icon-btn" title="Open an STL file">
            <IconUpload class="ico" />Open
            <input type="file" accept=".stl" @change="onFileChange">
          </label>
          <button type="button" class="icon-btn chevron-btn" @click.stop="toggleMenu('file')"
            :aria-expanded="openMenu === 'file'" title="More ways to open a part">
            <IconChevronDown class="ico" />
          </button>
          <div class="dropdown-menu" v-if="openMenu === 'file'">
            <button type="button" class="dropdown-item" @click="chooseSample"><IconCube class="ico" />Sample Part</button>
          </div>
        </div>
      </div>
      <div class="group">
        <button type="button" class="icon-btn dim-toggle" :class="{ on: rulerOn }" @click="toggleRulerTool"
          :title="rulerOn ? 'Click two points to measure · right-click to undo · click again to turn off' : 'Measure any distance: click two points in a view'">
          <IconRulerMeasure class="ico" />{{ rulerOn ? 'Ruler on' : 'Ruler' }}
        </button>
        <button type="button" class="icon-btn dim-toggle" v-if="rulerOn" @click="clearRulers" title="Clear all measurements">
          Clear
        </button>
        <button type="button" class="icon-btn dim-toggle" :class="{ off: !dimsOn }" @click="toggleDims" :title="dimsOn ? 'Hide dimension lines' : 'Show dimension lines'">
          <IconRuler v-if="dimsOn" class="ico" /><IconRulerOff v-else class="ico" />{{ dimsOn ? 'Dims' : 'Dims off' }}
        </button>
      </div>
      <div id="settingsSection" class="tab-section toolbar-section" :class="{ active: activeTab === 'settings' }">
        <span class="unit"><IconRuler class="ico dim" />Unit
          <select id="unit"><option value="1" selected>mm</option><option value="10">cm</option><option value="25.4">in</option></select>
        </span>
      </div>
      <div id="exportSection" class="tab-section toolbar-section" :class="{ active: activeTab === 'export' }">
        <div class="dropdown-wrap">
          <button type="button" class="icon-btn icon-only" @click.stop="toggleMenu('export')"
            :aria-expanded="openMenu === 'export'" title="Export">
            <IconDownload class="ico" />
          </button>
          <div class="dropdown-menu right" v-if="openMenu === 'export'">
            <button type="button" class="dropdown-item" @click="doExport('png')">PNG &mdash; as shown</button>
            <button type="button" class="dropdown-item" @click="doExport('svg')">SVG &mdash; vector line art</button>
            <button type="button" class="dropdown-item" @click="doExport('dxf')">DXF R12 &mdash; CAD, 1:1</button>
            <button type="button" class="dropdown-item" @click="doExport('csv')">CSV &mdash; measurements</button>
            <button type="button" class="dropdown-item" @click="doExport('json')">JSON &mdash; model for an AI to read</button>
            <button type="button" class="dropdown-item" @click="doExport('scad')">OpenSCAD &mdash; editable rebuild script</button>
          </div>
        </div>
      </div>
    </div>
  </header>
  <main>
    <div class="status" id="status"></div>
    <div id="drop">Drop an STL here, or use <b>Open</b> above.</div>
    <div id="panel" hidden>
      <div id="viewerCol">
        <div id="viewerSection" class="tab-section" :class="{ active: activeTab === 'viewer' }">
          <div class="view-tabs">
            <button type="button" :class="{ active: singleView === 0 }" @click="selectView(0)">Top</button>
            <button type="button" :class="{ active: singleView === 1 }" @click="selectView(1)">ISO</button>
            <button type="button" :class="{ active: singleView === 2 }" @click="selectView(2)">Front</button>
            <button type="button" :class="{ active: singleView === 3 }" @click="selectView(3)">Section</button>
          </div>
          <div class="sheet-wrap">
            <canvas id="sheet"></canvas>
            <select id="topSel" class="pane-select"><option value="top" selected>Top</option><option value="bottom">Bottom</option></select>
            <select id="elevSel" class="pane-select"><option value="front" selected>Front</option><option value="right">Right</option></select>
            <select id="fourthSel" class="pane-select"><option value="section">Section A-A</option><option value="other" id="otherOpt">Right view</option></select>
          </div>
        </div>
        <div id="statusBar" class="status-bar">
          <div id="statusBarBody"></div>
        </div>
      </div>
      <div id="measurementsSection" class="tab-section" :class="{ active: activeTab === 'measurements' }">
        <div class="cols">
          <div class="stack">
            <div class="card">
              <h3><span>Round &amp; spherical features</span><span id="featCount"></span></h3>
              <div class="body" id="featBody"></div>
            </div>
            <div class="card">
              <h3><span>Inclined faces</span></h3>
              <div class="body" id="angBody"></div>
            </div>
          </div>
          <div class="stack">
            <div class="card" id="stepsCard">
              <h3><span>Steps &amp; sections</span><span id="stepCount"></span></h3>
              <div class="body" id="stepBody"></div>
            </div>
            <div class="card" id="partCard">
              <h3>Part</h3>
              <div class="body"><dl id="partBody" style="margin:0"></dl></div>
            </div>
          </div>
        </div>
        <footer id="note"></footer>
      </div>
    </div>
  </main>
  <nav class="tabbar">
    <button type="button" :class="{ active: activeTab === 'viewer' }" @click="activeTab = 'viewer'"><IconEye class="ico" /><span>Viewer</span></button>
    <button type="button" :class="{ active: activeTab === 'measurements' }" @click="activeTab = 'measurements'"><IconRuler class="ico" /><span>Measurements</span></button>
    <button type="button" :class="{ active: activeTab === 'export' }" @click="activeTab = 'export'"><IconDownload class="ico" /><span>Export</span></button>
    <button type="button" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'"><IconSettings class="ico" /><span>Settings</span></button>
  </nav>
</template>
