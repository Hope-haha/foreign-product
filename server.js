const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data', 'jobs-fresh');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules.json'), 'utf8'));
fs.mkdirSync(DATA, { recursive: true });

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
}
function safeName(name) { return String(name || 'product.png').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function imageNames(folder) {
  return fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => /\.(png|jpe?g|webp)$/i.test(name)) : [];
}
function run(command, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    child.on('error', error => resolve({ ok: false, output: error.message }));
    child.on('close', code => resolve({ ok: code === 0, output, code }));
  });
}
async function readJson(req) {
  let text = '';
  for await (const part of req) {
    text += part;
    if (text.length > 30 * 1024 * 1024) throw new Error('上传内容过大，单次请控制在 20MB 以内。');
  }
  return JSON.parse(text || '{}');
}
function writeImages(folder, images) {
  let added = 0;
  for (const image of images || []) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image.dataUrl || '');
    if (!match) continue;
    const extension = match[1] === 'image/jpeg' ? '.jpg' : match[1] === 'image/webp' ? '.webp' : '.png';
    const name = `${String(imageNames(folder).length + 1).padStart(2, '0')}-${safeName(image.name).replace(/\.[^.]+$/, '')}${extension}`;
    fs.writeFileSync(path.join(folder, name), Buffer.from(match[2], 'base64'));
    added += 1;
  }
  return added;
}
function jobInfo(id) {
  const dir = path.join(DATA, id);
  const file = path.join(dir, 'job.json');
  if (!fs.existsSync(file)) return null;
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rootFiles = imageNames(dir)
    .filter(name => /^product-(?:transparent|white)(?:-\d+)?\.(png|jpe?g)$/i.test(name))
    .map(name => `/jobs/${id}/${name}`);
  const output = path.join(dir, 'output');
  const outputFiles = imageNames(output)
    .filter(name => /^\d{2}-(?:aiwhite|lifestyle|model|feature|detail|package)\.(png|jpe?g|webp)$/i.test(name))
    .map(name => `/jobs/${id}/output/${name}`);
  const input = path.join(dir, 'input');
  job.sourceFiles = imageNames(input).map(name => `/jobs/${id}/input/${name}`);
  job.files = [...rootFiles, ...outputFiles];
  return job;
}
function saveJob(dir, job) { fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job, null, 2), 'utf8'); }
function recoverInterruptedJobs() {
  for (const entry of fs.readdirSync(DATA, { withFileTypes: true }).filter(item => item.isDirectory())) {
    const dir = path.join(DATA, entry.name);
    const file = path.join(dir, 'job.json');
    if (!fs.existsSync(file)) continue;
    const job = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (job.codexStatus !== 'running') continue;
    for (const task of job.generation?.tasks || []) {
      if (task.status === 'running' || task.status === 'queued') {
        task.status = 'failed';
        task.error = '生成服务已重启，未完成的图片需要重新生成。';
      }
    }
    job.codexStatus = 'failed';
    job.status = '生成服务已重启，未完成的图片可重新生成。';
    saveJob(dir, job);
  }
}
function writeTask(dir, job, platform) {
  const text = `# 电商商品图片任务\n\n平台：${platform.name}\n品类：${job.category}\n场景偏好：${job.scene || '由商品品类自动判断'}\n\n平台规则\n- 首图尺寸：${platform.mainSize}\n- 比例：${platform.ratio}\n- 首图背景：${platform.mainBackground}\n- 首图文字：${platform.mainText}\n- 商品占画面：${platform.productFill}\n- 平台整体风格：${platform.imageStyles?.base || '商品清楚、信息简洁、以真实可见细节为准。'}\n\n强制要求\n- 保持真实商品的结构、颜色、Logo、文字、接口、按键和配件数量。\n- 商品参考图和补充图均可用于确认外观。\n- 不得编造性能数值、认证、续航或包装内容。\n`;
  fs.writeFileSync(path.join(dir, 'codex-task.md'), text, 'utf8');
}
function platformSize(platform) {
  const match = String(platform.mainSize || '').match(/(\d+)\D+(\d+)/);
  return match ? `${match[1]}x${match[2]}` : '2000x2000';
}
function shotLabel(shot) {
  return ({ aiwhite: '精修白底图', lifestyle: '生活场景图', model: '真人使用图', feature: '英文功能图', detail: '细节特写图', package: '包装与清单图' })[shot] || '商品图';
}
function startCodexBatch(dir, job, shots) {
  const runner = path.join(ROOT, 'scripts', 'codex-image-task.js');
  const sourceCount = job.whiteCount || imageNames(path.join(dir, 'input')).length;
  const tasks = [];
  for (const shot of shots) {
    if (shot === 'aiwhite') {
      for (let referenceIndex = 0; referenceIndex < sourceCount; referenceIndex += 1) tasks.push({ shot, referenceIndex, label: `${shotLabel(shot)} ${referenceIndex + 1}`, status: 'queued' });
    } else tasks.push({ shot, label: shotLabel(shot), status: 'queued' });
  }
  job.generation = { total: tasks.length, completed: 0, tasks };
  job.codexStatus = 'running'; job.status = `展示图队列已创建：0/${tasks.length} 张完成。`; saveJob(dir, job);
  void (async () => {
    tasks.forEach((task, index) => { task.outputIndex = index + 1; });
    let nextTask = 0;
    async function worker() {
      while (nextTask < tasks.length) {
        const task = tasks[nextTask++]; task.status = 'running';
        job.status = `正在生成 ${task.label}（已完成 ${job.generation.completed}/${tasks.length}）…`; saveJob(dir, job);
        const args = [runner, dir, task.shot, String(task.outputIndex)];
        if (Number.isInteger(task.referenceIndex)) args.push(String(task.referenceIndex));
        const result = await run(process.execPath, args, ROOT);
        task.status = result.ok ? 'completed' : 'failed';
        task.error = result.ok ? '' : result.output.trim().slice(-300);
        job.generation.completed += 1;
        saveJob(dir, job);
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, tasks.length) }, worker));
    const failed = tasks.filter(task => task.status === 'failed').length;
    job.codexStatus = failed ? 'failed' : 'completed';
    job.status = failed ? `展示图完成：${tasks.length - failed}/${tasks.length} 张成功。` : `图片包已完成：${tasks.length} 张图片均可查看或下载。`;
    saveJob(dir, job);
  })();
}
function nextOutputIndex(dir) {
  const output = path.join(dir, 'output');
  return imageNames(output).reduce((highest, name) => Math.max(highest, Number(/^\d+/.exec(name)?.[0]) || 0), 0) + 1;
}
function startRegeneration(dir, job, shot, prompt) {
  const runner = path.join(ROOT, 'scripts', 'codex-image-task.js');
  const index = nextOutputIndex(dir);
  writeTask(dir, job, RULES[job.platform]);
  job.codexStatus = 'running';
  job.status = `正在按新描述重新生成 ${shotLabel(shot)}…`;
  job.regeneration = { shot, status: 'running' };
  saveJob(dir, job);
  void (async () => {
    const result = await run(process.execPath, [runner, dir, shot, String(index), '0', prompt], ROOT);
    job.regeneration = { shot, status: result.ok ? 'completed' : 'failed' };
    job.codexStatus = result.ok ? 'completed' : 'failed';
    job.status = result.ok ? `${shotLabel(shot)}已按新描述重新生成，可查看或下载。` : `${shotLabel(shot)}重新生成失败。`;
    saveJob(dir, job);
  })();
}
function retryFailedTask(dir, job, outputIndex) {
  const task = job.generation?.tasks?.find(item => item.outputIndex === outputIndex && item.status === 'failed');
  if (!task) return false;
  const runner = path.join(ROOT, 'scripts', 'codex-image-task.js');
  writeTask(dir, job, RULES[job.platform]);
  task.status = 'running';
  task.error = '';
  job.codexStatus = 'running';
  job.status = `正在重新生成失败的${task.label}…`;
  saveJob(dir, job);
  void (async () => {
    const args = [runner, dir, task.shot, String(task.outputIndex)];
    if (Number.isInteger(task.referenceIndex)) args.push(String(task.referenceIndex));
    const result = await run(process.execPath, args, ROOT);
    task.status = result.ok ? 'completed' : 'failed';
    task.error = result.ok ? '' : result.output.trim().slice(-300);
    const failed = job.generation.tasks.filter(item => item.status === 'failed').length;
    const stillRunning = job.generation.tasks.some(item => item.status === 'running' || item.status === 'queued');
    job.codexStatus = stillRunning ? 'running' : failed ? 'failed' : 'completed';
    job.status = result.ok ? `${task.label}已重新生成，可查看或下载。` : `${task.label}再次生成失败，请稍后重试。`;
    saveJob(dir, job);
  })();
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/api/rules') return send(res, 200, RULES);
  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    const jobs = fs.readdirSync(DATA, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => jobInfo(entry.name))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 6)
      .map(job => ({ id: job.id, createdAt: job.createdAt, platform: job.platform, category: job.category, status: job.status, sourceFiles: job.sourceFiles, files: job.files }));
    return send(res, 200, jobs);
  }
  if (req.method === 'GET' && /^\/api\/jobs\/[^/]+\/logs$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3];
    const log = path.join(DATA, id, 'codex-app-server.log');
    const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).slice(-30) : [];
    return send(res, 200, { lines });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
    const job = jobInfo(url.pathname.split('/').pop());
    return job ? send(res, 200, job) : send(res, 404, { error: '任务不存在。' });
  }
  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    try {
      const payload = await readJson(req);
      const platform = RULES[payload.platform];
      if (!platform || !Array.isArray(payload.images) || !payload.images.length) throw new Error('请至少上传一张商品图片并选择平台。');
      const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const dir = path.join(DATA, id);
      const input = path.join(dir, 'input');
      fs.mkdirSync(input, { recursive: true });
      writeImages(input, payload.images);
      const job = { id, createdAt: new Date().toISOString(), platform: payload.platform, category: payload.category || '其他商品', imageType: payload.imageType || '白底首图', scene: payload.scene || '', shots: [], status: '任务已创建，正在准备白底图。', codexStatus: '未启动', whiteStatus: 'queued', modelStatus: 'BEN2 等待运行' };
      saveJob(dir, job);
      writeTask(dir, job, platform);
      return send(res, 201, jobInfo(id));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && /^\/api\/jobs\/[^/]+\/add-references$/.test(url.pathname)) {
    try {
      const id = url.pathname.split('/')[3]; const dir = path.join(DATA, id); const job = jobInfo(id);
      const payload = await readJson(req);
      if (!job) return send(res, 404, { error: '任务不存在。' });
      const added = writeImages(path.join(dir, 'input'), payload.images);
      writeTask(dir, job, RULES[job.platform]);
      return send(res, 200, { ...jobInfo(id), added });
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && /^\/api\/jobs\/[^/]+\/run-white$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3]; const dir = path.join(DATA, id); const job = jobInfo(id);
    if (!job) return send(res, 404, { error: '任务不存在。' });
    if (job.whiteStatus === 'running') return send(res, 409, job);
    const input = path.join(dir, 'input');
    const sources = imageNames(input);
    const python = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
    if (!sources.length || !fs.existsSync(python)) return send(res, 503, { error: '本地 BEN2 尚未就绪。' });
    const platform = RULES[job.platform];
    job.status = `正在处理 ${sources.length} 张参考图的白底版本…`;
    job.whiteStatus = 'running'; job.modelStatus = 'BEN2 正在识别商品主体'; saveJob(dir, job);
    for (const name of imageNames(dir)) {
      if (/^product-(?:transparent|white)(?:-\d+)?\.(png|jpe?g)$/i.test(name)) fs.unlinkSync(path.join(dir, name));
    }
    const results = [];
    for (let index = 0; index < sources.length; index += 1) {
      const number = String(index + 1).padStart(2, '0');
      results.push(await run(python, [path.join(ROOT, 'scripts', 'cutout.py'), '--input', path.join(input, sources[index]), '--output', path.join(dir, `product-transparent-${number}.png`), '--white-output', path.join(dir, `product-white-${number}.jpg`), '--size', platformSize(platform)], ROOT));
    }
    const successful = results.filter(result => result.ok).length;
    job.whiteReady = successful > 0;
    job.whiteCount = successful;
    job.whiteStatus = successful === sources.length ? 'completed' : 'failed';
    job.modelStatus = `BEN2 已完成 ${successful}/${sources.length} 张 ${platform.name} 白底图`;
    job.status = successful === sources.length ? `已生成 ${successful} 张白底图。请选择要补充的展示图。` : `已生成 ${successful}/${sources.length} 张白底图，请检查失败的参考图。`;
    saveJob(dir, job);
    return send(res, successful ? 200 : 503, jobInfo(id));
  }
  if (req.method === 'POST' && /^\/api\/jobs\/[^/]+\/run-codex$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3]; const dir = path.join(DATA, id); const job = jobInfo(id);
    if (!job) return send(res, 404, { error: '任务不存在。' });
    if (job.codexStatus === 'running') return send(res, 409, job);
    const payload = await readJson(req);
    const shots = Array.isArray(payload.shots) && payload.shots.length ? payload.shots : ['lifestyle', 'feature'];
    job.shots = shots; job.scene = payload.scene || job.scene || ''; job.hasPackageReference = payload.hasPackageReference === true; job.featureClaims = String(payload.featureClaims || '').trim(); job.allowReferenceSkip = payload.allowReferenceSkip === true;
    writeTask(dir, job, RULES[job.platform]);
    startCodexBatch(dir, job, shots);
    return send(res, 202, jobInfo(id));
  }
  if (req.method === 'POST' && /^\/api\/jobs\/[^/]+\/regenerate$/.test(url.pathname)) {
    try {
      const id = url.pathname.split('/')[3]; const dir = path.join(DATA, id); const job = jobInfo(id);
      const payload = await readJson(req);
      const allowed = ['aiwhite', 'lifestyle', 'model', 'feature', 'detail', 'package'];
      if (!job) return send(res, 404, { error: '任务不存在。' });
      if (job.codexStatus === 'running') return send(res, 409, { error: '当前还有图片正在生成，请稍后再试。' });
      if (!allowed.includes(payload.shot) || !String(payload.prompt || '').trim()) return send(res, 400, { error: '请填写要修改的描述。' });
      startRegeneration(dir, job, payload.shot, String(payload.prompt).trim());
      return send(res, 202, jobInfo(id));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && /^\/api\/jobs\/[^/]+\/retry-failed$/.test(url.pathname)) {
    try {
      const id = url.pathname.split('/')[3]; const dir = path.join(DATA, id); const job = jobInfo(id);
      const payload = await readJson(req);
      if (!job) return send(res, 404, { error: '任务不存在。' });
      if (job.codexStatus === 'running') return send(res, 409, { error: '当前还有图片正在生成，请稍后再试。' });
      if (!retryFailedTask(dir, job, Number(payload.outputIndex))) return send(res, 400, { error: '没有找到可重试的失败图片。' });
      return send(res, 202, jobInfo(id));
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/jobs/')) {
    const relative = path.normalize(url.pathname.replace(/^\/jobs\//, ''));
    const file = path.join(DATA, relative);
    if (!file.startsWith(DATA) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return send(res, 200, fs.readFileSync(file), type);
  }
  const file = url.pathname === '/' ? path.join(PUBLIC, 'index.html') : path.join(PUBLIC, path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
  return send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
});
const port = Number(process.argv[2] || process.env.PRODUCT_IMAGE_PORT || 5177);
recoverInterruptedJobs();
server.listen(port, '127.0.0.1', () => console.log(`商品图工作台已启动：http://127.0.0.1:${port}`));
