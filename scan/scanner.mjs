const fields = Object.fromEntries(
  ['camera', 'preview', 'start', 'stop', 'photo', 'code', 'open', 'copy', 'lookup', 'status']
    .map(id => [id, document.getElementById(id)]),
);
const { camera, preview, start, stop, photo, code, open, copy, lookup, status } = fields;
const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
const parameters = new URLSearchParams(location.hash.slice(1));
const control = parameters.get('control');
let run = 0;
let stream;
let scanning;

function returnUrl() {
  try {
    const url = new URL(parameters.get('return'));
    if (url.protocol === 'https:' && url.hostname === 'staging.sigmacomputing.io'
        && !url.username && !url.password && !url.port
        && /^\/[^/]+\/workbook\/[^/]+\/?$/.test(url.pathname)
        && /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(control ?? '')) return url;
  } catch {
    // Direct visits can still scan and copy a code.
  }
  return null;
}

const destination = returnUrl();
open.hidden = !destination;

function stopCamera() {
  run += 1;
  scanning?.stop();
  scanning = undefined;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  preview.srcObject = null;
  camera.hidden = true;
  start.disabled = false;
  stop.hidden = true;
}

function captured(value) {
  const normalized = value.trim();
  if (!normalized || normalized.length > code.maxLength) {
    status.textContent = 'This barcode does not contain a supported SKU.';
    return;
  }
  stopCamera();
  code.value = normalized;
  status.textContent = 'Barcode read. Review the SKU before looking it up.';
  code.focus();
}

start.addEventListener('click', async () => {
  const active = ++run;
  camera.hidden = false;
  start.disabled = true;
  stop.hidden = false;
  status.textContent = 'Waiting for camera access…';
  try {
    const opened = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: 'environment' } },
    });
    if (active !== run) {
      opened.getTracks().forEach(track => track.stop());
      return;
    }
    stream = opened;
    status.textContent = 'Hold the barcode in the frame.';
    const controls = await reader.decodeFromStream(stream, preview, result => {
      if (active === run && result) captured(result.getText());
    });
    if (active === run) scanning = controls;
    else controls.stop();
  } catch {
    if (active !== run) return;
    stopCamera();
    status.textContent = 'Camera unavailable. Scan a photo or enter the SKU.';
  }
});

stop.addEventListener('click', () => {
  stopCamera();
  status.textContent = 'Camera stopped.';
});

photo.addEventListener('change', async () => {
  const file = photo.files?.[0];
  if (!file) return;
  stopCamera();
  const active = run;
  const image = URL.createObjectURL(file);
  status.textContent = 'Reading barcode…';
  try {
    const result = await reader.decodeFromImageUrl(image);
    if (active === run) captured(result.getText());
  } catch {
    if (active === run) status.textContent = 'No barcode found. Try a clear photo or enter the SKU.';
  } finally {
    URL.revokeObjectURL(image);
    photo.value = '';
  }
});

lookup.addEventListener('submit', event => {
  event.preventDefault();
  if (!code.value.trim() || !destination) return;
  const url = new URL(destination);
  url.searchParams.set(control, code.value.trim());
  stopCamera();
  location.assign(url);
});

copy.addEventListener('click', async () => {
  if (!code.value.trim()) {
    status.textContent = 'Scan or enter a SKU first.';
    return;
  }
  try {
    await navigator.clipboard.writeText(code.value.trim());
    status.textContent = 'SKU copied.';
  } catch {
    code.select();
    status.textContent = 'SKU selected. Use your device’s Copy command.';
  }
});

window.addEventListener('pagehide', stopCamera);
