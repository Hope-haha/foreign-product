let rules = {};
let selectedImages = [];
const $ = selector => document.querySelector(selector);

async function loadRules() {
  rules = await fetch('/api/rules').then(response => response.json());
  $('#platform').innerHTML = Object.entries(rules)
    .map(([id, rule]) => `<option value="${id}">${rule.name}</option>`).join('');
  showRule();
}

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '已有任务';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function loadRecentJobs() {
  const container = $('#recent-jobs');
  if (!container) return;
  try {
    const jobs = await fetch('/api/jobs').then(response => response.json());
    if (!jobs.length) {
      container.innerHTML = '<div class="recent-empty"><b>还没有图片包</b><span>创建一个任务后，可以从这里继续处理。</span></div>';
      return;
    }
    container.innerHTML = jobs.map(job => {
      const image = job.sourceFiles?.[0] || job.files?.[0];
      const rule = rules[job.platform];
      return `<a class="recent-job" href="/workspace.html?id=${encodeURIComponent(job.id)}">${image ? `<img src="${image}" alt="${job.category}">` : '<span class="recent-thumb">商品图</span>'}<span class="recent-copy"><b>${job.category || '商品图片包'}</b><small>${rule?.name || job.platform} · ${dateLabel(job.createdAt)}</small><em>${job.status || '待处理'}</em></span><i aria-hidden="true">继续</i></a>`;
    }).join('');
  } catch {
    container.innerHTML = '<div class="recent-empty"><b>暂时无法读取图片包</b><span>可以直接从左侧新建任务。</span></div>';
  }
}

function showRule() {
  const rule = rules[$('#platform').value];
  if (!rule) return;
  $('#rule-card').innerHTML = `<strong>${rule.name} · ${rule.mainSize}</strong><span>比例 ${rule.ratio}　/　首图背景 ${rule.mainBackground}　/　首图文字 ${rule.mainText}</span>`;
}

function renderPreviews() {
  $('#previews').innerHTML = '';
  selectedImages.forEach((file, index) => {
    const card = document.createElement('figure');
    const image = document.createElement('img');
    const remove = document.createElement('button');
    image.src = URL.createObjectURL(file);
    image.alt = file.name;
    remove.type = 'button';
    remove.textContent = '移除';
    remove.addEventListener('click', () => { selectedImages.splice(index, 1); renderPreviews(); });
    const caption = document.createElement('figcaption');
    caption.textContent = file.name;
    card.append(image, caption, remove);
    $('#previews').append(card);
  });
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$('#platform').addEventListener('change', showRule);
$('#images').addEventListener('change', event => {
  [...event.target.files].forEach(file => {
    const duplicate = selectedImages.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
    if (!duplicate) selectedImages.push(file);
  });
  event.target.value = '';
  renderPreviews();
});

$('#job-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedImages.length) return alert('请先上传至少一张商品图片。');
  const button = $('.launch-button');
  button.disabled = true;
  button.querySelector('span').textContent = '正在创建任务…';
  const images = await Promise.all(selectedImages.map(async file => ({ name: file.name, dataUrl: await toDataUrl(file) })));
  const response = await fetch('/api/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: $('#platform').value, category: $('#category').value, imageType: $('#imageType').value, scene: $('#scene').value, images })
  });
  const job = await response.json();
  if (!response.ok) {
    button.disabled = false;
    button.querySelector('span').textContent = '进入生成画布';
    return alert(job.error || '任务创建失败');
  }
  location.href = `/workspace.html?id=${encodeURIComponent(job.id)}`;
});

loadRules().then(loadRecentJobs);
