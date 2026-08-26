<script setup lang="ts">
import { onMounted } from 'vue'
import { initApp } from './engine/blueprint'

onMounted(() => {
  initApp()
})
</script>

<template>
  <header>
    <h1>STL Blueprint <span>&mdash; measured drawings from a mesh</span></h1>
    <div class="grow"></div>
    <div class="bar">
      <div class="group">
        <label class="file">Open STL<input type="file" id="file" accept=".stl"></label>
        <button id="sample">Sample part</button>
      </div>
      <div class="sep"></div>
      <span class="unit">file
        <select id="srcUnit"><option value="1" selected>mm</option><option value="10">cm</option><option value="25.4">in</option></select>
        &rarr; show
        <select id="dspUnit"><option value="1" selected>mm</option><option value="10">cm</option><option value="25.4">in</option></select>
      </span>
      <div class="sep"></div>
      <span class="unit">export
        <select id="exportSel">
          <option value="">choose…</option>
          <option value="png">PNG &mdash; as shown</option>
          <option value="svg">SVG &mdash; vector line art</option>
          <option value="dxf">DXF R12 &mdash; CAD, 1:1</option>
          <option value="csv">CSV &mdash; measurements</option>
          <option value="json">JSON &mdash; model for an AI to read</option>
          <option value="scad">OpenSCAD &mdash; editable rebuild script</option>
        </select>
      </span>
    </div>
  </header>
  <main>
    <div class="status" id="status"></div>
    <div id="drop">Drop an STL here, or use <b>Open STL</b> above.</div>
    <div id="panel" hidden>
      <div class="sheet-wrap">
        <canvas id="sheet"></canvas>
        <select id="topSel" class="pane-select"><option value="top" selected>Top</option><option value="bottom">Bottom</option></select>
        <select id="elevSel" class="pane-select"><option value="front" selected>Front</option><option value="right">Right</option></select>
        <select id="fourthSel" class="pane-select"><option value="section">Section A-A</option><option value="other" id="otherOpt">Right view</option></select>
      </div>
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
          <div class="card">
            <h3><span>Steps &amp; sections</span><span id="stepCount"></span></h3>
            <div class="body" id="stepBody"></div>
          </div>
          <div class="card">
            <h3>Part</h3>
            <div class="body"><dl id="partBody" style="margin:0"></dl></div>
          </div>
        </div>
      </div>
      <footer id="note"></footer>
    </div>
  </main>
</template>
