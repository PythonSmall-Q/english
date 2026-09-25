const fs = require('fs');

const NEW = `/**
 * Cloudflare AI 模型目录（与后端 worker/src/cfai.js 官方定价同构；1 credit = $0.01；
 * inPer1k/outPer1k = 每 1K 输入/输出 token 的 credits，输入输出分列精确计费）
 */
const CF_MODELS = [
  { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', tag: 'low', inPer1k: 0.0282, outPer1k: 0.0827 },
  { id: '@cf/mistral/mistral-7b-instruct-v0.1', label: 'Mistral 7B', tag: 'low', inPer1k: 0.011, outPer1k: 0.019 },
  { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B', tag: 'efficient', inPer1k: 0.02, outPer1k: 0.03 },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B', tag: 'high', inPer1k: 0.0293, outPer1k: 0.2253 },
  { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 32B', tag: 'extra-high', inPer1k: 0.0497, outPer1k: 0.4881 },
];`;

let s = fs.readFileSync('frontend/views/settings.js', 'utf8');
s = s.replace(/\/\*\* Cloudflare AI 模型目录[\s\S]*?\];/, NEW);
s = s.replace(/（\$\{CF_TAG_META\[m\.tag\]\.label\} · \$\{m\.creditsPer1k\} credits\/1k）/, '（${CF_TAG_META[m.tag].label} · 入${m.inPer1k} / 出${m.outPer1k} per 1k）');
fs.writeFileSync('frontend/views/settings.js', s);

let a = fs.readFileSync('frontend/views/admin.js', 'utf8');
a = a.replace(/\$\{m\.creditsPer1k\} credits \/ 1k tokens/, '入 ${m.inPer1k} / 出 ${m.outPer1k} per 1k');
fs.writeFileSync('frontend/views/admin.js', a);
console.log('patched');
