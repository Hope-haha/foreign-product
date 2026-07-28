const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const jobDirectory = process.argv[2];
const shot = process.argv[3] || 'lifestyle';
const index = process.argv[4] || '1';
const referenceIndex = Number(process.argv[5] || '0');
const customInstruction = String(process.argv[6] || '').trim();
if (!jobDirectory) throw new Error('Missing job directory');

const output = path.join(jobDirectory, 'output');
const task = path.join(jobDirectory, 'codex-task.md');
const logFile = path.join(jobDirectory, 'codex-app-server.log');
const userCodex = path.join(process.env.USERPROFILE || '', 'node_modules', '.bin', 'codex.cmd');
const codexCommand = process.env.CODEX_COMMAND || (fs.existsSync(userCodex) ? userCodex : 'codex');
const job = JSON.parse(fs.readFileSync(path.join(jobDirectory, 'job.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules.json'), 'utf8'));
const platform = rules[job.platform] || {};
const platformStyle = platform.imageStyles?.[shot] || platform.imageStyles?.base || '商品清楚、真实、信息简洁。';
const featureClaims = String(job.featureClaims || '').trim();
const packageInstruction = job.hasPackageReference
  ? 'Create a clean package and what-is-in-the-box image using only packaging or accessories visibly present in the references. Do not add items that are not shown.'
  : 'Create a packaging concept image from the supplied product only. The product is the only confirmed item: show it with one simple unbranded retail box designed for the product, but do not add accessories, cables, manuals, quantities, or a what-is-in-the-box list.';
fs.mkdirSync(output, { recursive: true });

const images = fs.readdirSync(path.join(jobDirectory, 'input'))
  .filter(name => /\.(png|jpe?g|webp)$/i.test(name))
  .map(name => path.join(jobDirectory, 'input', name));
const whiteImages = fs.readdirSync(jobDirectory)
  .filter(name => /^product-white-\d+\.jpg$/i.test(name))
  .map(name => path.join(jobDirectory, name));
const referenceImages = shot === 'aiwhite' ? [images[referenceIndex], whiteImages[referenceIndex]].filter(Boolean) : images;

const instructions = {
  aiwhite: 'Create a premium AI-enhanced white-background product image from the single supplied product reference. Keep the exact product structure, proportions, colors, printed graphics, logo and accessories. Use a pure white studio backdrop, crisp commercial lighting, subtle realistic grounding shadow and refined clarity. Do not add a filter that changes the product color. No text, badges, extra props, or invented details.',
  lifestyle: 'Create a premium real-life product scene. The product must sit in a believable, warm home setting with visible desk or kitchen context, natural daylight and real environmental depth. This is not a studio image: never use a plain white, beige, empty or seamless background. No person is required. Keep the product visually dominant and fully accurate.',
  model: 'Create a realistic human-use image. Show an appropriate adult using or holding the product naturally in a believable setting. Do not change the product, its logo, printed graphics, or proportions.',
  feature: featureClaims
    ? `Create an e-commerce feature card with a premium product close-up and restrained English layout. Use only these confirmed English claims, exactly as written: ${featureClaims}. Do not add a generic heading, performance numbers, certifications, icons, or any other text.`
    : 'Create an e-commerce feature card using only 1 to 3 visual facts that are clearly observable in the supplied images, such as a visible closure, strap, pocket, shape, button, port, or construction. Use short plain English and no generic heading. Do not claim material, performance, capacity, certification, compatibility, or any fact that cannot be directly seen.',
  detail: 'Create one finished e-commerce detail composite, not a single close-up. Arrange 2 to 4 balanced detail panels in one image, each showing a different, genuinely visible part of the supplied product: for example material, texture, stitching, closure, interface, button, port, or construction. Keep a consistent clean background, spacing and lighting across the panels. Do not add text, labels, numbers, arrows, extra products, or any hidden or invented structure. If the references only show two trustworthy details, use exactly two panels rather than inventing more.',
  package: packageInstruction
};
const prompt = `IMAGE-ONLY EXECUTION. This is a strict instruction, not a planning request. Your first action and only action must be to call the built-in image generation tool using the supplied reference image(s). Do not inspect files. Do not run commands. Do not check installed software. Do not read skills. Do not write code. Do not answer with text. Do not use any tool other than image generation.\n\n${fs.readFileSync(task, 'utf8')}\n\n当前图片类型：${shot}\n本次平台的明确作图风格：${platformStyle}\n\n${instructions[shot] || instructions.lifestyle}${customInstruction ? `\n\n用户对当前图片的修改要求：${customInstruction}` : ''}\n\nReturn exactly one finished e-commerce image. Preserve the exact product identity from the supplied references.`;

const child = spawn(codexCommand, ['app-server', '--stdio'], { shell: true, windowsHide: true });
let sequence = 0;
let completed = false;
let generatedPath;
let stderr = '';
function log(message) { fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`); }
function send(method, params, waitForResponse = true) {
  const id = waitForResponse ? ++sequence : undefined;
  child.stdin.write(`${JSON.stringify(waitForResponse ? { id, method, params } : { method, params })}\n`);
  return id;
}
function fail(message) {
  if (completed) return;
  completed = true;
  child.kill();
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
function finish() {
  if (completed) return;
  if (!generatedPath || !fs.existsSync(generatedPath)) fail('Codex completed without returning an image file.');
  completed = true;
  fs.copyFileSync(generatedPath, path.join(output, `${String(index).padStart(2, '0')}-${shot}.png`));
  child.kill();
  process.exit(0);
}
child.stderr.on('data', chunk => { stderr += chunk.toString(); log(`STDERR ${chunk.toString().trim()}`); });
child.on('error', error => fail(error.message));
child.on('close', code => { if (!completed) fail(`Codex generation service stopped unexpectedly (exit ${code}). ${stderr}`); });
child.stdout.setEncoding('utf8');
let buffer = '';
child.stdout.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    log(`RECV ${line}`);
    let message; try { message = JSON.parse(line); } catch { continue; }
    if (message.id === 1) {
      send('initialized', {}, false);
      send('thread/start', { cwd: jobDirectory, approvalPolicy: 'never', sandbox: 'danger-full-access', ephemeral: true });
    } else if (message.result?.thread?.id) {
      send('turn/start', { threadId: message.result.thread.id, approvalPolicy: 'never', input: [{ type: 'text', text: prompt }, ...referenceImages.map(image => ({ type: 'localImage', path: image }))] });
    }
    const item = message.params?.item || message.params?.threadItem;
    if (item?.type === 'commandExecution') fail('Codex did not enter image generation and attempted to run a command. Please retry.');
    if (item?.type === 'imageGeneration') {
      if (item.savedPath) generatedPath = item.savedPath;
      else if (item.status === 'completed' && item.id && message.params.threadId) generatedPath = path.join(process.env.USERPROFILE, '.codex', 'generated_images', message.params.threadId, `${item.id}.png`);
    }
    if (message.method === 'turn/completed') finish();
  }
});
send('initialize', { clientInfo: { name: 'product-image-studio', version: '0.2.0' }, capabilities: {} });
setTimeout(() => fail(`Codex image generation timed out after 3 minutes. ${stderr}`), 180000);
