const form = document.getElementById('upload-form');
form?.addEventListener('submit', async event => {
  event.preventDefault();
  const result = document.getElementById('upload-result');
  const button = form.querySelector('button');
  const file = document.getElementById('image-file').files[0];
  if (!file || file.size > 5 * 1024 * 1024) { result.textContent = 'Choose an image smaller than 5 MiB.'; return; }
  button.disabled = true;
  try {
    const response = await fetch('/api/media', { method:'POST', headers:{ 'Content-Type':'application/octet-stream', 'X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content }, body:file });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    location.reload();
  } catch (error) { result.textContent = error.message || 'Upload failed.'; }
  finally { button.disabled = false; }
});
