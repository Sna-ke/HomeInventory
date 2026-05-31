// ── Images ─────────────────────────────────────────────────────────────────
function triggerImageUpload(entityType, entityId, refreshFn) {
  uploadTarget = { entityType, entityId, refreshFn };
  const inp = document.getElementById('img-input');
  inp.value = '';
  inp.click();
}

async function handleImageUpload(input) {
  if (!uploadTarget || !input.files.length) return;
  const { entityType, entityId, refreshFn } = uploadTarget;
  let uploaded = 0;
  for (const file of input.files) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entity_type', entityType);
    fd.append('entity_id', entityId);
    try {
      await fetch(API_BASE + '/api/images/upload', { method:'POST', body:fd });
      uploaded++;
    } catch(e) {
      toast(`Failed to upload ${file.name}`, true);
    }
  }
  if (uploaded) {
    toast(`${uploaded} photo${uploaded>1?'s':''} uploaded`);
    refreshFn();
  }
}

async function deleteImage(imageId, entityType, entityId) {
  if (!confirm('Delete this photo?')) return;
  await api(`/api/images/${imageId}`, { method:'DELETE' });
  toast('Photo deleted');
  if (entityType === 'box') openBoxDetail(entityId);
}

function viewImage(url) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position:'fixed', inset:'0', background:'rgba(0,0,0,.92)',
    zIndex:'500', display:'flex', alignItems:'center', justifyContent:'center',
    cursor:'pointer',
  });
  overlay.innerHTML = `<img src="${url}" style="max-width:95vw;max-height:90vh;object-fit:contain;">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}
