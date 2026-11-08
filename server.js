// ระบบสั่งปริ้นรูปภาพ — รันบนคอมที่เปิดทิ้งไว้ (Windows)
const express = require('express');
const multer = require('multer');
const { buildPdf, PRESET } = require('./pdfbuild');
const ptp = require('pdf-to-printer');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ===== ตั้งค่าตรงนี้ =====
const CONFIG = {
  port: 3000,
  printerIP: '10.82.58.7',
  // ชื่อเครื่องพิมพ์ใน Windows (Settings > Printers) ถ้าเว้นว่างจะใช้เครื่อง Default
  printerName: process.env.PRINTER_NAME || '',
  pin: process.env.PIN || '1234',   // *** เปลี่ยนเป็นเลขของคุณ ***
  maxImages: 30,                     // จำนวนรูปสูงสุดต่อการสั่ง 1 ครั้ง
};

const SUMATRA_PAPER = { A6: 'A4', A5: 'A4', A4: 'A4', A3: 'A3' };

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 100 } });
app.use(express.static(path.join(__dirname, 'public')));

// ต้องมี PIN ทุก /api (กันคนนอกเมื่อเปิดผ่านอินเทอร์เน็ต) ใส่ผิด 10 ครั้ง ล็อก 10 นาที
const fails = new Map();
app.use('/api', (req, res, next) => {
  const ip = req.headers['cf-connecting-ip'] || req.ip;
  const f = fails.get(ip);
  const recent = f && Date.now() - f.t < 600000;
  if (recent && f.n >= 10) return res.status(429).json({ error: 'ใส่ PIN ผิดหลายครั้ง รอ 10 นาทีแล้วลองใหม่' });
  if (req.get('x-pin') !== CONFIG.pin) {
    fails.set(ip, { n: (recent ? f.n : 0) + 1, t: Date.now() });
    return res.status(401).json({ error: 'PIN ไม่ถูกต้อง' });
  }
  fails.delete(ip);
  next();
});

const jobs = [];
let nextId = 1;
let working = false;

async function processQueue() {
  if (working) return;
  working = true;
  let job;
  while ((job = jobs.find((j) => j.status === 'queued'))) {
    job.status = 'printing';
    try {
      const opts = { copies: job.copies, monochrome: !job.color, scale: 'noscale' };
      if (CONFIG.printerName) opts.printer = CONFIG.printerName;
      if (SUMATRA_PAPER[job.paper]) opts.paperSize = SUMATRA_PAPER[job.paper];
      await ptp.print(job.file, opts);
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = String(e.message || e).slice(0, 200);
    }
    job.finished = Date.now();
    fs.unlink(job.file, () => {});
  }
  working = false;
}

app.post('/api/print', upload.array('images', 100), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'ยังไม่ได้เลือกรูป' });
    const paper = PRESET[req.body.paper] ? req.body.paper : 'A4';
    const fit = ['stretch', 'contain', 'cover'].includes(req.body.fit) ? req.body.fit : 'contain';
    const copies = Math.min(Math.max(parseInt(req.body.copies) || 1, 1), 99);
    const color = req.body.color !== 'bw';

    const built = await buildPdf(files, paper, fit);
    if (built.count > CONFIG.maxImages) return res.status(400).json({ error: `สั่งได้ครั้งละไม่เกิน ${CONFIG.maxImages} ป้าย` });
    const file = path.join(os.tmpdir(), `print-${Date.now()}-${nextId}.pdf`);
    fs.writeFileSync(file, built.bytes);

    const job = {
      id: nextId++, file, paper, fit, copies, color,
      images: built.count, pages: built.sheets,
      status: 'queued', created: Date.now(),
    };
    jobs.push(job);
    if (jobs.length > 50) jobs.splice(0, jobs.length - 50);
    processQueue();
    res.json({ id: job.id });
  } catch (e) {
    res.status(500).json({ error: 'สร้างไฟล์ปริ้นไม่สำเร็จ: ' + e.message });
  }
});

function pingPrinter() {
  return new Promise((resolve) => {
    const s = net.connect({ host: CONFIG.printerIP, port: 9100, timeout: 1500 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}

app.get('/api/status', async (req, res) => {
  res.json({
    server: true,
    printerIP: CONFIG.printerIP,
    printerName: CONFIG.printerName || '(เครื่อง Default ของ Windows)',
    printerReachable: await pingPrinter(),
    jobs: jobs.slice(-10).reverse().map(({ file, ...j }) => j),
  });
});

app.listen(CONFIG.port, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('ระบบพร้อมแล้ว เปิดเว็บที่:');
  ips.forEach((ip) => console.log(`  http://${ip}:${CONFIG.port}`));
});
