'use strict';
/* Школьный сервер опросов с MongoDB. Запуск: node server.js */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const mongoose = require('mongoose');

const DIR = __dirname;
const PORT = +process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://<username>:<password>@cluster.mongodb.net/school_polls?retryWrites=true&w=majority';

// Схемы данных для MongoDB
const pollSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    unit: { type: String, required: true },
    topic: { type: String, required: true },
    open: { type: Boolean, default: true },
    mode: { type: String, default: 'survey' },
    scale: { type: Array, default: [] },
    by: { type: String, required: true },
    created: { type: Number, required: true },
    qs: { type: Array, required: true },
    responses: { type: Array, default: [] },
    archive: { type: Array, default: [] }
});
const Poll = mongoose.model('Poll', pollSchema);

const L = ['А', 'Б', 'В', 'Г'], P = ['Технический', 'Естественный', 'Гуманитарный', 'Универсальный', 'Социально-экономический'];
const defClasses = [];
[5, 6, 7, 8].forEach(n => L.forEach(l => defClasses.push(n + l)));
['А', 'Б', 'В'].forEach(l => defClasses.push('9' + l));
[10, 11].forEach(n => P.forEach(p => defClasses.push(n + ' ' + p)));

const configPath = path.join(DIR, 'config.json');
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { }
const cfg = Object.assign({ teacherCode: 'teacher123', classes: defClasses }, fileConfig);
if (process.env.TEACHER_CODE) cfg.teacherCode = process.env.TEACHER_CODE;

const unitOf = c => { const g = +c.match(/^\d+/)[0]; return g >= 10 ? c : String(g); };
const units = [...new Set(cfg.classes.map(unitOf))];
const classesOf = u => cfg.classes.filter(c => unitOf(c) === u);
const sessions = new Map(), clients = new Set(), fails = new Map();

const bcast = o => { const s = 'data: ' + JSON.stringify(o) + '\n\n'; clients.forEach(r => r.write(s)); };
setInterval(() => clients.forEach(r => r.write(': ping\n\n')), 25000);

const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const J = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
function body(req) { return new Promise((ok, no) => { let b = '', n = 0; req.on('data', c => { n += c.length; if (n > 15e6) { no(new Error('too big')); req.destroy(); } else b += c; }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); req.on('error', no); }); }
const str = (s, m) => String(s == null ? '' : s).trim().slice(0, m);

function cleanQs(qs) {
    if (!Array.isArray(qs) || qs.length > 40) throw new Error('Некорректные вопросы');
    return qs.map(q => {
        if (!['quiz', 'choice', 'text', 'match'].includes(q.k)) throw new Error('Тип вопроса');
        const o = (q.k === 'text' || q.k === 'match') ? [] : (Array.isArray(q.o) ? q.o : []).slice(0, 12).map(x => ({ l: str(x.l, 200), ok: q.k === 'quiz' && !!x.ok }));
        if (q.k !== 'text' && q.k !== 'match' && o.length < 2) throw new Error('Нужно минимум 2 варианта');
        const r = { k: q.k, t: str(q.t, 500), o };
        if (q.k === 'quiz' || q.k === 'match') { let pts = Number(String(q.pts == null ? 1 : q.pts).replace(',', '.')); if (!isFinite(pts) || pts < 0) pts = 1; r.pts = Math.min(1000, Math.round(pts * 100) / 100); }
        if (q.k === 'match') {
            const Lf = Array.isArray(q.left) ? q.left : [], Rt = Array.isArray(q.right) ? q.right : [];
            if (Lf.length < 2 || Lf.length > 12 || Rt.length < 2 || Rt.length > 12) throw new Error('В вопросе на соответствие нужно от 2 до 12 элементов в каждой колонке');
            r.right = Rt.map(x => { const l = str(x && x.l, 200); if (!l) throw new Error('Заполните все элементы соответствия'); return { l }; });
            r.left = Lf.map(x => { const l = str(x && x.l, 200), c = Number(x && x.c); if (!l) throw new Error('Заполните все элементы соответствия'); if (!Number.isInteger(c) || c < 0 || c >= r.right.length) throw new Error('Для каждого элемента слева выберите правильный ответ справа'); return { l, c }; });
            r.partial = q.partial !== false;
        }
        if (typeof q.img === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(q.img) && q.img.length < 4e6) r.img = q.img;
        return r;
    });
}
const sig = qs => JSON.stringify(qs.map(q => [q.k, q.o.length, (q.left || []).length, (q.right || []).length]));
const okSet = q => q.o.map((o, j) => o.ok ? j : -1).filter(j => j >= 0);
const sameSet = (a, b) => { a = [...(a || [])].sort((x, y) => x - y); b = [...b].sort((x, y) => x - y); return a.length === b.length && a.every((x, i) => x === b[i]); };
const r2 = x => Math.round(x * 100) / 100;
function checkTest(qs) {
    const quiz = qs.filter(q => q.k === 'quiz' || q.k === 'match');
    if (!quiz.length) throw new Error('В тесте нужен хотя бы один вопрос с правильными ответами');
    if (quiz.some(q => q.k === 'quiz' && !okSet(q).length)) throw new Error('Отметьте верный ответ в каждом вопросе с правильными ответами');
    if (!(quiz.reduce((s, q) => s + q.pts, 0) > 0)) throw new Error('Сумма баллов теста должна быть больше нуля');
}
function cleanScale(s) {
    if (!Array.isArray(s) || !s.length || s.length > 12) throw new Error('Задайте шкалу оценок (от 1 до 12 порогов)');
    const out = s.map(x => {
        const min = Number(String(x.min).replace(',', '.')), grade = str(x.grade, 10);
        if (!isFinite(min) || min < 0 || min > 1000) throw new Error('Порог шкалы: число баллов от 0');
        if (!grade) throw new Error('Укажите оценку для каждого порога шкалы');
        return { min: r2(min), grade };
    });
    if (new Set(out.map(x => x.min)).size !== out.length) throw new Error('В шкале повторяются пороги');
    return out.sort((a, b) => b.min - a.min);
}
function gradeFor(score, scale) { for (const r of (scale || []).slice().sort((a, b) => b.min - a.min)) if (score >= r.min - 1e-9) return r.grade; return '—'; }
function fracOf(q, a) {
    if (q.k === 'quiz') return sameSet(a, okSet(q)) ? 1 : 0;
    const n = q.left.length; let k = 0;
    q.left.forEach((x, j) => { if (a && a[j] === x.c) k++; });
    return q.partial === false ? (k === n ? 1 : 0) : k / n;
}
function evaluate(p, answers) {
    let score = 0, max = 0; const items = [];
    p.qs.forEach((q, i) => {
        if (q.k !== 'quiz' && q.k !== 'match') return;
        const pts = q.pts == null ? 1 : q.pts, a = answers[i], f = fracOf(q, a);
        max += pts; score += pts * f;
        const it = { i, pts, got: r2(pts * f), ok: f === 1, yours: a };
        if (q.k === 'quiz') it.correct = okSet(q);
        else it.pairs = q.left.map((x, j) => ({ yours: a[j], correct: x.c, ok: a[j] === x.c }));
        items.push(it);
    });
    score = r2(score); max = r2(max);
    return { score, max, grade: gradeFor(score, p.scale), items };
}
const pub = p => ({ id: p.id, unit: p.unit, topic: p.topic, open: p.open, classes: classesOf(p.unit), mode: p.mode || 'survey', qs: p.qs.map(q => ({ k: q.k, t: q.t, img: q.img, pts: q.pts, left: q.left && q.left.map(x => ({ l: x.l })), right: q.right, o: q.o.map(x => ({ l: x.l })) })) });

const FILES = { '/': 'student.html', '/teacher': 'teacher.html', '/qr.js': 'qr.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

async function startServer() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Успешное подключение к MongoDB Atlas');
    } catch (err) {
        console.error('Ошибка подключения к MongoDB:', err);
        process.exit(1);
    }

    http.createServer(async (req, res) => {
        try {
            const u = new URL(req.url, 'http://x'), pn = u.pathname, m = req.method;
            if (FILES[pn] && m === 'GET') { 
    const f = path.join(DIR, FILES[pn]); 
    const content = fs.readFileSync(f); 
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], 'Cache-Control': 'no-cache' }); 
    return res.end(content); 
}
            if (!pn.startsWith('/api/')) return J(res, 404, { error: 'Не найдено' });

            const tok = req.headers['x-token'] || u.searchParams.get('token'), teacher = sessions.get(tok);
            const need = () => { if (!teacher) { J(res, 401, { error: 'Требуется вход учителя' }); return false; } return true; };

            if (pn === '/api/meta' && m === 'GET') return J(res, 200, { classes: cfg.classes, units });

            if (pn === '/api/teacher/login' && m === 'POST') {
                const b = await body(req), ip = req.socket.remoteAddress, f = fails.get(ip) || { n: 0, t: Date.now() };
                if (Date.now() - f.t > 6e5) { f.n = 0; f.t = Date.now(); }
                if (f.n >= 10) return J(res, 429, { error: 'Слишком много попыток, подождите 10 минут' });
                const fio = str(b.fio, 100); if (fio.split(/\s+/).length < 2) return J(res, 400, { error: 'Введите фамилию и имя' });
                if (!crypto.timingSafeEqual(hash(b.code), hash(cfg.teacherCode))) { f.n++; fails.set(ip, f); return J(res, 403, { error: 'Неверный код доступа' }); }
                const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, { fio }); return J(res, 200, { token: t, fio });
            }

            if (pn === '/api/events' && m === 'GET') {
                if (!need()) return;
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
                res.write('data: {"type":"hello"}\n\n'); clients.add(res);
                req.on('close', () => clients.delete(res));
                return;
            }

            if (pn === '/api/polls' && m === 'GET') {
                if (!need()) return;
                const pollsList = await Poll.find({}).sort({ created: -1 });
                return J(res, 200, pollsList);
            }

            if (pn === '/api/polls' && m === 'POST') {
                if (!need()) return; const b = await body(req);
                if (!units.includes(b.unit)) return J(res, 400, { error: 'Неизвестный класс/параллель' });
                const qs = cleanQs(b.qs); let p = b.id ? await Poll.findOne({ id: b.id }) : null;
                const mode = b.mode === 'test' ? 'test' : 'survey';
                let scale = [];
                if (mode === 'test') { checkTest(qs); scale = cleanScale(b.scale); }

                if (p) {
                    if (sig(p.qs) !== sig(qs) && p.responses.length) {
                        p.archive.push({ ts: Date.now(), responses: p.responses, qs: p.qs });
                        p.responses = [];
                    }
                    p.unit = b.unit;
                    p.topic = str(b.topic, 200);
                    p.qs = qs;
                    p.mode = mode;
                    p.scale = scale;
                    await p.save();
                } else {
                    const id = crypto.randomBytes(5).toString('hex');
                    p = await Poll.create({ id, unit: b.unit, topic: str(b.topic, 200), qs, mode, scale, open: true, by: teacher.fio, created: Date.now(), responses: [], archive: [] });
                }
                bcast({ type: 'update', id: p.id }); return J(res, 200, p);
            }

            let r = pn.match(/^\/api\/polls\/(\w+)\/(status|reset)$/);
            if (r && m === 'POST') {
                if (!need()) return; const p = await Poll.findOne({ id: r[1] }); if (!p) return J(res, 404, { error: 'Нет такого опроса' });
                const b = await body(req);
                if (r[2] === 'status') p.open = !!b.open;
                else if (p.responses.length) {
                    p.archive.push({ ts: Date.now(), responses: p.responses, qs: p.qs });
                    p.responses = [];
                }
                await p.save(); bcast({ type: 'update', id: p.id }); return J(res, 200, p);
            }

            r = pn.match(/^\/api\/polls\/(\w+)$/);
            if (r && m === 'DELETE') {
                if (!need()) return; await Poll.deleteOne({ id: r[1] }); bcast({ type: 'update', id: r[1] }); return J(res, 200, { ok: 1 });
            }

            r = pn.match(/^\/api\/poll\/(\w+)$/);
            if (r && m === 'GET') {
                const p = await Poll.findOne({ id: r[1] }); return p ? J(res, 200, pub(p)) : J(res, 404, { error: 'Опрос не найден' });
            }

            r = pn.match(/^\/api\/poll\/(\w+)\/answer$/);
            if (r && m === 'POST') {
                const p = await Poll.findOne({ id: r[1] }); if (!p) return J(res, 404, { error: 'Опрос не найден' }); if (!p.open) return J(res, 403, { error: 'Опрос закрыт учителем' });
                const b = await body(req), surname = str(b.surname, 60), name = str(b.name, 60), cls = str(b.cls, 60);
                if (!surname || !name) return J(res, 400, { error: 'Введите фамилию и имя' });
                if (!classesOf(p.unit).includes(cls)) return J(res, 400, { error: 'Этот опрос не для выбранного класса' });
                if (!Array.isArray(b.answers) || b.answers.length !== p.qs.length) return J(res, 400, { error: 'Неполные ответы' });

                const ans = p.qs.map((q, i) => {
                    const a = b.answers[i];
                    if (q.k === 'quiz') { if (!Array.isArray(a) || !a.length || a.some(x => !Number.isInteger(x) || x < 0 || x >= q.o.length)) throw new Error('Ответьте на все вопросы'); return [...new Set(a)].sort((x, y) => x - y); }
                    if (q.k === 'match') { if (!Array.isArray(a) || a.length !== q.left.length || a.some(x => !Number.isInteger(x) || x < 0 || x >= q.right.length)) throw new Error('Ответьте на все вопросы'); return a; }
                    if (q.k === 'choice') { if (!Number.isInteger(a) || a < 0 || a >= q.o.length) throw new Error('Ответьте на все вопросы'); return a; }
                    return str(a, 1000);
                });

                const key = (surname + '|' + name + '|' + cls).toLowerCase();
                if (p.responses.some(x => x.key === key)) return J(res, 409, { error: 'Вы уже прошли этот опрос' });

                p.responses.push({ key, surname, name, cls, answers: ans, ts: Date.now() });
                await p.save();
                
                
                const responseData = p.mode === 'test' ? { ok: 1, result: evaluate(p, ans) } : { ok: 1 };
                J(res, 200, responseData);
                
                
                setImmediate(() => bcast({ type: 'update', id: p.id }));
                return;
            }

           J(res, 404, { error: 'Не найдено' });
        } catch (e) { 
            if (!res.headersSent) {
                J(res, 400, { error: e.message || 'Ошибка' }); 
            }
        }
    }).listen(PORT, '0.0.0.0', () => {
        console.log('Сервер опросов с MongoDB запущен, порт ' + PORT);
    });
}

startServer();
