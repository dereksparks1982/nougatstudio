(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const status = $('toolStatus');
  const human = n => {
    n = Number(n) || 0;
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GiB`;
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MiB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${n} B`;
  };

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadText(name, text, type = 'application/json') {
    downloadBlob(name, new Blob([text], { type }));
  }

  async function sha256(blob) {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  document.querySelectorAll('.tool-nav').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-nav').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tool-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      $(`${btn.dataset.view}View`).classList.add('active');
      status.textContent = btn.textContent.trim();
    });
  });

  let splitterFile = null;
  let splitterParts = [];
  let splitterManifest = null;

  function analyzeSplitter() {
    if (!splitterFile) {
      $('splitSummary').textContent = 'Choose a source file first.';
      return;
    }
    const target = Math.max(1, Math.min(476, Number($('splitTarget').value) || 450));
    const size = Math.floor(target * 1048576);
    const count = Math.max(1, Math.ceil(splitterFile.size / size));
    splitterParts = [];
    for (let i = 0; i < count; i++) {
      const start = i * size;
      const end = Math.min(splitterFile.size, start + size);
      splitterParts.push({
        name: `${splitterFile.name}.part${String(i + 1).padStart(3, '0')}`,
        start,
        end,
        size: end - start,
        sha256: ''
      });
    }
    splitterManifest = null;
    $('splitManifest').disabled = true;
    $('splitSummary').textContent = `${splitterFile.name} • ${human(splitterFile.size)} • ${count} part${count === 1 ? '' : 's'} • target ${target} MiB`;
    renderPartList();
  }

  function renderPartList() {
    const list = $('splitParts');
    if (!splitterParts.length) {
      list.innerHTML = '<div class="tool-empty">No parts calculated.</div>';
      return;
    }
    list.innerHTML = splitterParts.map((part, i) => `
      <div class="part-row">
        <div><strong>${part.name}</strong><span>${human(part.size)}${part.sha256 ? ` • ${part.sha256.slice(0, 12)}…` : ''}</span></div>
        <button class="btn" data-part="${i}">Download</button>
      </div>`).join('');
    list.querySelectorAll('[data-part]').forEach(btn => {
      btn.addEventListener('click', () => {
        const part = splitterParts[Number(btn.dataset.part)];
        if (part && splitterFile) downloadBlob(part.name, splitterFile.slice(part.start, part.end));
      });
    });
  }

  $('splitFile').addEventListener('change', e => {
    splitterFile = e.target.files?.[0] || null;
    if (splitterFile) analyzeSplitter();
  });
  $('splitTarget').addEventListener('input', () => splitterFile && analyzeSplitter());
  $('splitAnalyze').addEventListener('click', analyzeSplitter);
  $('splitHash').addEventListener('click', async () => {
    if (!splitterFile || !splitterParts.length) {
      $('splitSummary').textContent = 'Choose and analyze a source file first.';
      return;
    }
    for (let i = 0; i < splitterParts.length; i++) {
      const part = splitterParts[i];
      $('splitSummary').textContent = `Hashing part ${i + 1} of ${splitterParts.length}…`;
      part.sha256 = await sha256(splitterFile.slice(part.start, part.end));
      renderPartList();
    }
    splitterManifest = {
      format: 'Nougat File Splitter Manifest',
      version: 1,
      original_name: splitterFile.name,
      original_size: splitterFile.size,
      target_mib: Number($('splitTarget').value),
      parts: splitterParts.map(p => ({ name: p.name, size: p.size, sha256: p.sha256 }))
    };
    $('splitManifest').disabled = false;
    $('splitSummary').textContent = 'Per-part SHA-256 manifest ready.';
    status.textContent = 'Manifest ready';
  });
  $('splitManifest').addEventListener('click', () => {
    if (!splitterManifest) return;
    downloadText(`${splitterFile.name}.nougat-split.json`, JSON.stringify(splitterManifest, null, 2));
  });

  let assemblerFiles = [];
  let assemblerManifest = null;

  function sortParts(files) {
    return [...files].sort((a, b) => {
      const x = a.name.match(/\.part(\d+)$/i);
      const y = b.name.match(/\.part(\d+)$/i);
      return x && y ? Number(x[1]) - Number(y[1]) : a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  }

  function renderAssemblerList() {
    const list = $('assembleList');
    if (!assemblerFiles.length) {
      list.innerHTML = '<div class="tool-empty">No parts selected.</div>';
      return;
    }
    list.innerHTML = assemblerFiles.map((file, i) => `
      <div class="part-row static-row">
        <div><strong>Part ${i + 1}</strong><span>${file.name} • ${human(file.size)}</span></div>
      </div>`).join('');
  }

  async function verifyParts() {
    const out = $('assembleStatus');
    if (!assemblerFiles.length) {
      out.textContent = 'Select part files first.';
      return false;
    }
    if (!assemblerManifest?.parts) {
      out.textContent = 'No manifest loaded. Assembly can continue, but cryptographic verification cannot be claimed.';
      return true;
    }
    if (assemblerManifest.parts.length !== assemblerFiles.length) {
      out.textContent = `Manifest expects ${assemblerManifest.parts.length} parts; ${assemblerFiles.length} selected.`;
      return false;
    }
    for (let i = 0; i < assemblerFiles.length; i++) {
      const file = assemblerFiles[i];
      const expected = assemblerManifest.parts[i];
      out.textContent = `Verifying ${i + 1}/${assemblerFiles.length}: ${file.name}`;
      if (expected.name && expected.name !== file.name) {
        out.textContent = `Name mismatch: expected ${expected.name}, got ${file.name}.`;
        return false;
      }
      if (Number(expected.size) !== file.size) {
        out.textContent = `Size mismatch: ${file.name}.`;
        return false;
      }
      if (expected.sha256) {
        const actual = await sha256(file);
        if (actual.toLowerCase() !== String(expected.sha256).toLowerCase()) {
          out.textContent = `SHA-256 mismatch: ${file.name}. Assembly refused.`;
          return false;
        }
      }
    }
    out.textContent = 'All selected parts match the manifest.';
    status.textContent = 'Verified';
    return true;
  }

  $('assembleParts').addEventListener('change', e => {
    assemblerFiles = sortParts(e.target.files || []);
    renderAssemblerList();
    if (assemblerFiles[0] && !$('assembleName').value) {
      $('assembleName').value = assemblerFiles[0].name.replace(/\.part\d+$/i, '');
    }
  });
  $('assembleManifestFile').addEventListener('change', async e => {
    assemblerManifest = null;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      assemblerManifest = JSON.parse(await file.text());
      $('assembleStatus').textContent = `Loaded manifest for ${assemblerManifest.original_name || 'split file'}.`;
      if (assemblerManifest.original_name) $('assembleName').value = assemblerManifest.original_name;
    } catch (err) {
      $('assembleStatus').textContent = `Manifest parse failed: ${err.message || err}`;
    }
  });
  $('assembleVerify').addEventListener('click', verifyParts);
  $('assembleRun').addEventListener('click', async () => {
    if (!(await verifyParts())) return;
    const name = $('assembleName').value.trim() || assemblerManifest?.original_name || 'reassembled-file.bin';
    downloadBlob(name, new Blob(assemblerFiles));
    $('assembleStatus').textContent = `Assembly built from ${assemblerFiles.length} part(s). Download started.`;
    status.textContent = 'Assembly complete';
  });
})();
