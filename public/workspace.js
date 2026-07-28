const id = new URLSearchParams(location.search).get('id');
const $ = selector => document.querySelector(selector);
let job;
let running = false;
let progress = 0;
let extraImages = [];
let canvasImages = [];
let activeImageIndex = 0;
let autoWhiteStarted = false;
let regenerateFile = '';
let pendingReferenceType = '';

const autoScenes = {
  '消费电子': '自动建议：干净科技桌面与真实使用环境',
  '家居生活': '自动建议：温暖、干净的居家场景',
  '美妆个护': '自动建议：自然光梳妆台与日常护理场景',
  '服装鞋包': '自动建议：轻松通勤与城市日常',
  '宠物与玩具': '自动建议：明亮居家互动场景',
  '其他商品': '自动建议：干净、真实的使用场景'
};

function fileName(url) { return decodeURIComponent(url.split('/').pop()); }
function labelFor(file) {
  if (file.includes('-aiwhite')) return '精修白底图';
  if (file.includes('product-white')) return '合规白底图';
  if (file.includes('-lifestyle')) return '生活场景图';
  if (file.includes('-model')) return '真人使用图';
  if (file.includes('-feature')) return '英文功能图';
  if (file.includes('-detail')) return '细节特写图';
  if (file.includes('-package')) return '包装与清单图';
  return '商品图片';
}
function shotFor(file) {
  if (file.includes('-aiwhite')) return 'aiwhite';
  if (file.includes('-lifestyle')) return 'lifestyle';
  if (file.includes('-model')) return 'model';
  if (file.includes('-feature')) return 'feature';
  if (file.includes('-detail')) return 'detail';
  if (file.includes('-package')) return 'package';
  return '';
}
function titleFor(current) {
  if (current.codexStatus === 'running') return '正在生成图片';
  if (current.codexStatus === 'completed') return '图片包已生成';
  if (current.whiteReady) return '白底图已准备好';
  return '先处理商品图';
}
function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function setProgress(value, text) {
  progress = Math.max(progress, value);
  $('#progress-bar').style.width = `${progress}%`;
  $('#progress-number').textContent = `${progress}%`;
  $('#progress-text').textContent = text;
}

function renderSources(sources) {
  $('#source-count').textContent = `${sources.length} 张`;
  $('#sources').innerHTML = sources.length
    ? sources.map((file, index) => `<button class="source-thumb ${index === 0 ? 'selected' : ''}" type="button" data-source="${index}"><img src="${file}" alt="商品参考图 ${index + 1}"></button>`).join('')
    : '<p class="empty-source">暂无图片</p>';
  document.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.source);
    $('#artboard-empty').classList.remove('hidden');
    $('#artboard-result').innerHTML = '';
    $('#artboard-empty').innerHTML = `<img class="reference-stage" src="${sources[index]}" alt="商品参考图"><span>商品参考图 ${index + 1}</span>`;
    $('#canvas-image-label').textContent = '商品参考图';
    $('#canvas-image-count').textContent = `${index + 1} / ${sources.length}`;
  }));
}
function renderCanvasImage(sources = []) {
  const image = canvasImages[activeImageIndex];
  const hasImages = Boolean(image);
  $('#artboard-empty').classList.toggle('hidden', hasImages);
  $('#previous-image').disabled = canvasImages.length < 2;
  $('#next-image').disabled = canvasImages.length < 2;
  $('#canvas-image-count').textContent = hasImages ? `${activeImageIndex + 1} / ${canvasImages.length}` : `${sources.length ? 1 : 0} / ${sources.length}`;
  $('#canvas-image-label').textContent = hasImages ? labelFor(image) : '商品参考图';
  if (hasImages) {
    $('#artboard-result').innerHTML = `<img src="${image}" alt="当前生成结果"><a class="open-original" href="${image}" target="_blank" rel="noopener">打开原图</a>`;
  } else {
    $('#artboard-result').innerHTML = '';
    $('#artboard-empty').innerHTML = sources[0] ? `<img class="reference-stage" src="${sources[0]}" alt="商品参考图"><span>商品参考图</span>` : '<p>请先添加商品参考图</p>';
  }
}
function renderGenerationStatus(generation) {
  if (!generation?.tasks?.length) { $('#generation-status').innerHTML = ''; return; }
  $('#generation-status').innerHTML = generation.tasks.map(task => {
    const status = task.status === 'completed' ? '已完成' : task.status === 'running' ? '生成中' : task.status === 'failed' ? '失败' : '排队中';
    const retry = task.status === 'failed' ? `<button type="button" class="retry-failed" data-retry-failed="${task.outputIndex}">重新生成</button>` : '';
    return `<span class="generation-item ${task.status}"><i></i>${task.label} · ${status}${retry}</span>`;
  }).join('');
  document.querySelectorAll('[data-retry-failed]').forEach(button => button.addEventListener('click', () => retryFailedImage(Number(button.dataset.retryFailed))));
}
function updatePackageOption() {
  $('#package-option').classList.remove('is-disabled');
}
function updateFeatureOption() {
  $('#feature-option').classList.remove('is-disabled');
}
function askForReference(type) {
  pendingReferenceType = type;
  const content = type === 'feature'
    ? '<div><b>英文功能图</b><span>建议填写 1–3 条卖点。未补充时，系统只会提取图片中看得见的结构特点，不会猜性能、材质或认证。</span></div>'
    : '<div><b>包装与清单图</b><span>建议上传包装盒或配件图。未补充时，系统只能生成包装概念图，不能确认真实包装内容。</span></div>';
  $('#reference-warning-copy').innerHTML = content;
  $('#reference-warning-dialog').showModal();
}
function renderDownloads(finals) {
  $('#result-count').textContent = `${finals.length} 张`;
  $('#downloads').innerHTML = finals.length ? finals.map(file => `
    <article class="download-card">
      <button type="button" class="result-preview" data-file="${file}"><img src="${file}" alt="${labelFor(file)}"></button>
      <div><b>${labelFor(file)}</b><small>${fileName(file)}</small><p><a href="${file}" target="_blank" rel="noopener">查看</a><a href="${file}" download>下载</a>${shotFor(file) ? `<button type="button" class="regenerate-link" data-regenerate="${file}">重新描述</button>` : ''}</p></div>
    </article>`).join('') : '<p class="no-output">生成完成后，图片会显示在这里。</p>';
  document.querySelectorAll('[data-file]').forEach(button => button.addEventListener('click', () => {
    const file = button.dataset.file;
    activeImageIndex = canvasImages.indexOf(file);
    renderCanvasImage(job.sourceFiles || []);
    document.querySelector('.canvas-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('[data-regenerate]').forEach(button => button.addEventListener('click', () => {
    regenerateFile = button.dataset.regenerate;
    $('#regenerate-target').textContent = `当前图片：${labelFor(regenerateFile)}`;
    $('#regenerate-prompt').value = '';
    $('#regenerate-dialog').showModal();
  }));
}
function render(current) {
  const sources = current.sourceFiles || [];
  const finals = (current.files || []).filter(file => file.includes('product-white') || file.includes('/output/'));
  const completed = current.codexStatus === 'completed';
  $('#job-meta').textContent = `${current.platform} · ${current.category} · ${sources.length} 张参考图 · ${finals.length} 张成品`;
  $('#canvas-title').textContent = titleFor(current);
  $('#status-chip').textContent = running ? '生成中' : completed ? '已完成' : current.whiteReady ? '可生成' : '待处理';
  $('#status-chip').classList.toggle('active', running);
  $('#scene-suggestion').textContent = autoScenes[current.category] || autoScenes['其他商品'];
  renderSources(sources);
  canvasImages = finals;
  if (activeImageIndex >= canvasImages.length) activeImageIndex = Math.max(0, canvasImages.length - 1);
  renderCanvasImage(sources);
  renderGenerationStatus(current.generation);
  renderDownloads(finals);
  updatePackageOption();
  updateFeatureOption();
  const selectedShots = [...document.querySelectorAll('input[name="shots"]:checked')];
  const whiteRunning = current.whiteStatus === 'running';
  $('#start-white').textContent = whiteRunning ? '正在生成白底图…' : current.whiteReady ? '重新生成白底图' : '先生成白底图';
  $('#start-white').disabled = running || whiteRunning;
  $('#start-codex').disabled = !current.whiteReady || running || !selectedShots.length;
  $('#start-codex').textContent = selectedShots.length ? `生成 ${selectedShots.length} 类展示图` : '生成已选展示图';
  $('#display-help').textContent = !current.whiteReady ? '请先生成白底图，再选择展示图类型。' : selectedShots.length ? `将生成 ${selectedShots.length} 类展示图。` : '请选择至少一种展示图类型。';
}
async function getLog() {
  if (!job) return;
  const queue = job.generation;
  const lines = [job.status || '系统已就绪，等待任务启动。'];
  if (queue?.total) lines.push(`图片进度：${queue.completed || 0} / ${queue.total}`);
  if (queue?.tasks?.length) lines.push(...queue.tasks.map(task => `${task.label}：${task.status === 'completed' ? '已完成' : task.status === 'running' ? '正在生成' : task.status === 'failed' ? '生成失败' : '等待生成'}`));
  else if (job.whiteReady) lines.push(`白底图：已完成 ${job.whiteCount || 1} 张`);
  $('#console-log').textContent = lines.join('\n');
}
async function refresh() {
  if (!id) return;
  const response = await fetch(`/api/jobs/${id}`);
  if (!response.ok) return;
  job = await response.json();
  running = job.codexStatus === 'running' || job.whiteStatus === 'running';
  render(job);
  await getLog();
  if (!job.whiteReady && !autoWhiteStarted && (job.whiteStatus === 'queued' || !job.whiteStatus)) {
    autoWhiteStarted = true;
    runWhite();
  }
  if (running) {
    const queue = job.generation;
    const runningTask = queue?.tasks?.some(task => task.status === 'running');
    const value = queue?.total ? Math.min(96, Math.round(((queue.completed || 0) + (runningTask ? .35 : 0)) / queue.total * 100)) : Math.min(92, progress + 4);
    progress = value;
    $('#console-state').textContent = queue?.total ? `${queue.completed || 0}/${queue.total}` : '生成中';
    setProgress(value, job.status || '正在生成图片…');
  } else if (job.whiteReady || job.codexStatus === 'completed') {
    $('#console-state').textContent = '已完成';
    setProgress(100, '已完成，可查看、下载或继续补图');
  }
}
function runWhite() {
  if (running) return;
  running = true;
  progress = 0;
  setProgress(8, '正在逐张识别商品主体…');
  fetch(`/api/jobs/${id}/run-white`, { method: 'POST' }).then(refresh).catch(() => { running = false; });
}
function runCodex() {
  if (running || !job?.whiteReady) return;
  const shots = [...document.querySelectorAll('input[name="shots"]:checked')].map(input => input.value);
  if (!shots.length) return alert('请至少选择一种要生成的图片。');
  running = true;
  progress = 0;
  setProgress(2, `正在创建 ${shots.length} 类图片…`);
  fetch(`/api/jobs/${id}/run-codex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots, scene: $('#scene-note').value.trim(), hasPackageReference: $('#has-package-reference').checked, featureClaims: $('#feature-claims').value.trim() })
  }).then(refresh).catch(() => { running = false; });
}
async function regenerateImage(event) {
  event.preventDefault();
  const shot = shotFor(regenerateFile);
  const prompt = $('#regenerate-prompt').value.trim();
  if (!shot || !prompt) return alert('请写清楚希望怎样修改这张图。');
  const button = $('#confirm-regenerate');
  button.disabled = true;
  button.textContent = '正在重新生成…';
  try {
    const response = await fetch(`/api/jobs/${id}/regenerate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shot, prompt })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '重新生成失败');
    $('#regenerate-dialog').close();
    running = true;
    progress = 2;
    setProgress(2, `正在按新描述生成${labelFor(regenerateFile)}…`);
    await refresh();
  } catch (error) { alert(error.message || '重新生成失败'); }
  finally { button.disabled = false; button.textContent = '按新描述生成'; }
}
async function retryFailedImage(outputIndex) {
  if (running) return;
  try {
    const response = await fetch(`/api/jobs/${id}/retry-failed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outputIndex })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '重新生成失败');
    running = true;
    progress = 2;
    setProgress(2, '正在重新生成失败图片…');
    await refresh();
  } catch (error) { alert(error.message || '重新生成失败'); }
}

$('#extra-images').addEventListener('change', event => {
  extraImages = [...event.target.files];
  $('#add-reference-button').disabled = !extraImages.length;
  $('#add-reference-button').textContent = extraImages.length ? `加入 ${extraImages.length} 张图片` : '加入本次任务';
});
$('#add-reference-button').addEventListener('click', async () => {
  if (!extraImages.length) return;
  const images = await Promise.all(extraImages.map(async file => ({ name: file.name, dataUrl: await toDataUrl(file) })));
  const response = await fetch(`/api/jobs/${id}/add-references`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images }) });
  if (!response.ok) return alert('补充图片失败，请重试。');
  extraImages = [];
  $('#extra-images').value = '';
  $('#add-reference-button').disabled = true;
  $('#add-reference-button').textContent = '加入本次任务';
  await refresh();
});
$('#start-white').addEventListener('click', runWhite);
$('#start-codex').addEventListener('click', runCodex);
$('#has-package-reference').addEventListener('change', () => {
  updatePackageOption();
  if (!$('#has-package-reference').checked && document.querySelector('input[name="shots"][value="package"]').checked) askForReference('package');
});
$('#feature-claims').addEventListener('input', updateFeatureOption);
document.querySelectorAll('input[name="shots"]').forEach(input => input.addEventListener('change', () => {
  if (input.checked && input.value === 'feature' && !$('#feature-claims').value.trim()) askForReference('feature');
  if (input.checked && input.value === 'package' && !$('#has-package-reference').checked) askForReference('package');
  if (job) render(job);
}));
$('#confirm-regenerate').addEventListener('click', regenerateImage);
$('#continue-without-reference').addEventListener('click', event => { event.preventDefault(); $('#reference-warning-dialog').close(); pendingReferenceType = ''; });
$('#supplement-reference').addEventListener('click', event => {
  event.preventDefault();
  if (pendingReferenceType) document.querySelector(`input[name="shots"][value="${pendingReferenceType}"]`).checked = false;
  $('#reference-warning-dialog').close();
  if (pendingReferenceType === 'feature') $('#feature-claims').focus();
  if (pendingReferenceType === 'package') $('#extra-images').click();
  pendingReferenceType = '';
  if (job) render(job);
});
$('#previous-image').addEventListener('click', () => { if (canvasImages.length > 1) { activeImageIndex = (activeImageIndex - 1 + canvasImages.length) % canvasImages.length; renderCanvasImage(job.sourceFiles || []); } });
$('#next-image').addEventListener('click', () => { if (canvasImages.length > 1) { activeImageIndex = (activeImageIndex + 1) % canvasImages.length; renderCanvasImage(job.sourceFiles || []); } });

if (!id) location.href = '/'; else { refresh(); setInterval(refresh, 2200); }
