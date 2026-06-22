import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { mkdirSync } from 'fs';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(__dirname, 'data/uploads'), { recursive: true });

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' }, transports: ['polling', 'websocket'] });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'data/uploads')));

const sessionMiddleware = session({
  secret: 'skver-tashkent-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'data/uploads')),
    filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname).toLowerCase() || '.jpg'}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only images'))
});

const requireAuth = (req, res, next) => req.session.userId ? next() : res.status(401).json({ error: 'Не авторизован' });
const safeUser = u => u ? { id: u.id, gender: u.gender, fullname: u.fullname, phone: u.phone, birthyear: u.birthyear, photo: u.photo } : null;

// ─── AUTH ────────────────────────────────────────────────────────────────────

app.post('/auth/register', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'photo_id', maxCount: 1 }]), async (req, res) => {
  try {
    const { gender, fullname, phone, password, birthyear } = req.body;
    if (!gender || !fullname?.trim() || !phone?.trim() || !password || !birthyear)
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    if (db.prepare('SELECT id FROM users WHERE phone=?').get(phone.trim()))
      return res.status(400).json({ error: 'Номер уже зарегистрирован' });
    const id = uuid();
    const hash = await bcrypt.hash(password, 10);
    const photo = req.files?.photo?.[0]?.filename || null;
    const photo_id = req.files?.photo_id?.[0]?.filename || null;
    db.prepare('INSERT INTO users (id,gender,fullname,phone,password,birthyear,photo,photo_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, gender, fullname.trim(), phone.trim(), hash, parseInt(birthyear), photo, photo_id);
    req.session.userId = id;
    res.json({ ok: true, user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone?.trim());
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
    if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: 'Неверный пароль' });
    req.session.userId = user.id;
    res.json({ ok: true, user: safeUser(user) });
  } catch (e) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

app.get('/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  res.json({ user: safeUser(u) || null });
});

app.post('/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

// ─── MENUS ───────────────────────────────────────────────────────────────────

const menus = {
  'Cafe 1991': [
    { name: 'Капучино', price: 18000, emoji: '☕' },
    { name: 'Американо', price: 15000, emoji: '☕' },
    { name: 'Латте', price: 22000, emoji: '☕' },
    { name: 'Круассан', price: 25000, emoji: '🥐' },
    { name: 'Завтрак (яйцо + тост + сок)', price: 42000, emoji: '🍳' },
    { name: 'Пицца Маргарита', price: 68000, emoji: '🍕' },
    { name: 'Чизкейк', price: 28000, emoji: '🍰' },
    { name: 'Апельсиновый фреш', price: 20000, emoji: '🍊' },
  ],
  'Navvat': [
    { name: 'Плов', price: 55000, emoji: '🍚' },
    { name: 'Лагман', price: 45000, emoji: '🍜' },
    { name: 'Манты (6 шт)', price: 42000, emoji: '🥟' },
    { name: 'Самса', price: 14000, emoji: '🫓' },
    { name: 'Шашлык говядина', price: 75000, emoji: '🍢' },
    { name: 'Шурпа', price: 40000, emoji: '🍲' },
    { name: 'Нон', price: 6000, emoji: '🫓' },
    { name: 'Чай (чайник)', price: 12000, emoji: '🍵' },
  ],
};

app.get('/api/menu/:name', (req, res) => res.json(menus[decodeURIComponent(req.params.name)] || []));

// ─── BOOKINGS ────────────────────────────────────────────────────────────────

app.post('/api/bookings', requireAuth, (req, res) => {
  const { place_id, date, time, guests, comment } = req.body;
  if (!place_id || !date || !time) return res.status(400).json({ error: 'Укажите дату и время' });
  const id = uuid();
  db.prepare('INSERT INTO bookings (id,place_id,user_id,date,time,guests,comment) VALUES (?,?,?,?,?,?,?)')
    .run(id, place_id, req.session.userId, date, time, parseInt(guests) || 1, comment || '');
  res.json({ ok: true, id });
});

app.get('/api/bookings/place/:placeId', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT b.id,b.date,b.time,b.guests,b.comment,b.status,b.created_at,u.fullname,u.photo,u.phone
    FROM bookings b JOIN users u ON b.user_id=u.id WHERE b.place_id=? ORDER BY b.date ASC,b.time ASC`).all(req.params.placeId);
  res.json(rows);
});

// ─── SOCIAL ──────────────────────────────────────────────────────────────────

app.get('/api/profile/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  res.json(safeUser(u) || null);
});

// Сколько людей сейчас в сквере (на карте)
app.get('/api/online', (req, res) => {
  res.json({ total: Object.keys(players).length, registered: onlineUsers.size });
});

// Кто именно сейчас онлайн (в сквере) — список
app.get('/api/online/list', requireAuth, (req, res) => {
  const ids = [...onlineUsers.keys()];
  const rows = ids.length
    ? db.prepare(`SELECT id,fullname,photo,gender,birthyear FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  rows.sort((a, b) => a.fullname.localeCompare(b.fullname));
  const guests = Math.max(0, Object.keys(players).length - onlineUsers.size);
  res.json({ users: rows, guests, total: Object.keys(players).length });
});

// Список друзей (принятые заявки) + кто сейчас онлайн
app.get('/api/friends', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`
    SELECT u.id, u.fullname, u.photo, u.gender, u.birthyear
    FROM friend_requests fr
    JOIN users u ON u.id = (CASE WHEN fr.from_id=? THEN fr.to_id ELSE fr.from_id END)
    WHERE fr.status='accepted' AND (fr.from_id=? OR fr.to_id=?)
    ORDER BY u.fullname`).all(me, me, me);
  res.json(rows.map(r => ({ ...r, online: onlineUsers.has(r.id) })));
});

// Кол-во непрочитанных (уведомления + сообщения)
app.get('/api/notifications/count', requireAuth, (req, res) => {
  res.json({ count: unreadCount(req.session.userId) });
});

app.get('/api/profile/:userId', requireAuth, (req, res) => {
  const u = db.prepare('SELECT id,gender,fullname,birthyear,photo FROM users WHERE id=?').get(req.params.userId);
  if (!u) return res.status(404).json({ error: 'Не найден' });
  const me = req.session.userId;
  const fr1 = db.prepare('SELECT * FROM friend_requests WHERE from_id=? AND to_id=?').get(me, req.params.userId);
  const fr2 = db.prepare('SELECT * FROM friend_requests WHERE from_id=? AND to_id=?').get(req.params.userId, me);
  const fr = fr1 || fr2;
  let friendStatus = 'none';
  if (fr) friendStatus = fr.status === 'accepted' ? 'friends' : (fr.from_id === me ? 'pending_sent' : 'pending_received');
  res.json({ ...u, friendStatus, requestId: fr?.id || null });
});

app.post('/api/friends/request/:targetId', requireAuth, (req, res) => {
  const from = req.session.userId, to = req.params.targetId;
  if (from === to) return res.status(400).json({ error: 'Нельзя добавить себя' });
  if (db.prepare('SELECT id FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').get(from, to, to, from))
    return res.status(400).json({ error: 'Заявка уже существует' });
  const id = uuid();
  db.prepare('INSERT INTO friend_requests (id,from_id,to_id) VALUES (?,?,?)').run(id, from, to);
  const fu = db.prepare('SELECT fullname,photo FROM users WHERE id=?').get(from);
  const nid = uuid();
  db.prepare('INSERT INTO notifications (id,user_id,type,data) VALUES (?,?,?,?)')
    .run(nid, to, 'friend_request', JSON.stringify({ requestId: id, fromId: from, fromName: fu.fullname, fromPhoto: fu.photo }));
  const ts = onlineUsers.get(to);
  if (ts) io.to(ts).emit('notification', { type: 'friend_request', requestId: id, fromId: from, fromName: fu.fullname, fromPhoto: fu.photo });
  emitCount(to);
  res.json({ ok: true });
});

app.post('/api/friends/respond/:reqId', requireAuth, (req, res) => {
  const { accept } = req.body;
  const fr = db.prepare('SELECT * FROM friend_requests WHERE id=?').get(req.params.reqId);
  if (!fr || fr.to_id !== req.session.userId) return res.status(403).json({ error: 'Нет доступа' });
  db.prepare('UPDATE friend_requests SET status=? WHERE id=?').run(accept ? 'accepted' : 'rejected', req.params.reqId);
  if (accept) {
    const me = db.prepare('SELECT fullname FROM users WHERE id=?').get(req.session.userId);
    const nid = uuid();
    db.prepare('INSERT INTO notifications (id,user_id,type,data) VALUES (?,?,?,?)')
      .run(nid, fr.from_id, 'friend_accepted', JSON.stringify({ fromId: req.session.userId, fromName: me.fullname }));
    const ts = onlineUsers.get(fr.from_id);
    if (ts) io.to(ts).emit('notification', { type: 'friend_accepted', fromId: req.session.userId, fromName: me.fullname });
    emitCount(fr.from_id);
  }
  res.json({ ok: true });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(me)
    .map(n => ({ id: n.id, type: n.type, read: n.read, created_at: n.created_at, data: JSON.parse(n.data) }));
  // Непрочитанные сообщения, сгруппированные по отправителю
  const msgs = db.prepare(`
    SELECT m.from_id, u.fullname, u.photo, COUNT(*) cnt, MAX(m.created_at) created_at,
      (SELECT content FROM messages WHERE from_id=m.from_id AND to_id=? AND read=0 ORDER BY created_at DESC LIMIT 1) last
    FROM messages m JOIN users u ON u.id=m.from_id
    WHERE m.to_id=? AND m.read=0 GROUP BY m.from_id`).all(me, me);
  const msgItems = msgs.map(r => ({
    id: 'msg-' + r.from_id, type: 'message', read: 0, created_at: r.created_at,
    data: { fromId: r.from_id, fromName: r.fullname, fromPhoto: r.photo, content: r.last, count: r.cnt }
  }));
  res.json([...rows, ...msgItems].sort((a, b) => b.created_at - a.created_at));
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.session.userId);
  res.json({ ok: true, count: unreadCount(req.session.userId) });
});

// ─── PROFILE EDIT ────────────────────────────────────────────────────────────

app.put('/api/profile/me', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { fullname, birthyear } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
    const nf = fullname?.trim() || u.fullname;
    const nb = birthyear ? parseInt(birthyear) : u.birthyear;
    if (nb < 1930 || nb > 2010) return res.status(400).json({ error: 'Укажите корректный год рождения' });
    const np = req.file ? req.file.filename : u.photo;
    db.prepare('UPDATE users SET fullname=?,birthyear=?,photo=? WHERE id=?').run(nf, nb, np, req.session.userId);
    const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
    res.json({ ok: true, user: safeUser(updated) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ─── MESSAGES ────────────────────────────────────────────────────────────────

app.get('/api/messages/:userId', requireAuth, (req, res) => {
  const me = req.session.userId, other = req.params.userId;
  const msgs = db.prepare(`SELECT m.*,u.fullname,u.photo FROM messages m JOIN users u ON m.from_id=u.id
    WHERE (m.from_id=? AND m.to_id=?) OR (m.from_id=? AND m.to_id=?) ORDER BY m.created_at ASC LIMIT 200`)
    .all(me, other, other, me);
  db.prepare('UPDATE messages SET read=1 WHERE to_id=? AND from_id=?').run(me, other);
  emitCount(me);
  res.json(msgs);
});

// ─── SOCKET.IO ───────────────────────────────────────────────────────────────

const players = {};
const onlineUsers = new Map();
const socketUsers = new Map();
const safeName = v => String(v || 'Guest').trim().slice(0, 24) || 'Guest';

// Непрочитанное = заявки/уведомления + входящие сообщения
const unreadCount = userId => {
  const n = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(userId).c;
  const m = db.prepare('SELECT COUNT(*) c FROM messages WHERE to_id=? AND read=0').get(userId).c;
  return n + m;
};
const emitCount = userId => { const ts = onlineUsers.get(userId); if (ts) io.to(ts).emit('notifCount', unreadCount(userId)); };

io.on('connection', s => {
  players[s.id] = { id: s.id, name: `Гость-${s.id.slice(0, 4)}`, x: 0, z: 10, rotationY: 0, userId: null, photo: null, gender: null };
  s.emit('currentPlayers', players);
  s.broadcast.emit('playerJoined', players[s.id]);

  s.on('identify', userId => {
    if (!userId) return;
    const u = db.prepare('SELECT id,fullname,photo,gender FROM users WHERE id=?').get(userId);
    if (!u) return;
    players[s.id].name = u.fullname;
    players[s.id].userId = u.id;
    players[s.id].photo = u.photo;
    players[s.id].gender = u.gender;
    onlineUsers.set(u.id, s.id);
    socketUsers.set(s.id, u.id);
    io.emit('playerUpdated', players[s.id]);
    s.emit('notifCount', unreadCount(u.id));
  });

  // Снимок текущих игроков (для сокета, подключившегося заранее — с главной страницы)
  s.on('getPlayers', () => s.emit('currentPlayers', players));

  s.on('setName', n => { if (players[s.id]) { players[s.id].name = safeName(n); io.emit('playerUpdated', players[s.id]); } });

  s.on('playerMove', d => {
    const p = players[s.id];
    if (!p) return;
    p.x = Number(d.x) || 0; p.z = Number(d.z) || 0; p.rotationY = Number(d.rotationY) || 0;
    s.broadcast.emit('playerMoved', p);
  });

  s.on('chatMessage', m => {
    const p = players[s.id], msg = String(m || '').trim().slice(0, 90);
    if (p && msg) io.emit('chatMessage', { id: s.id, name: p.name, message: msg });
  });

  s.on('privateMessage', ({ toUserId, content }) => {
    const fromId = socketUsers.get(s.id);
    if (!fromId || !content?.trim()) return;
    const text = content.trim().slice(0, 500);
    const id = uuid();
    db.prepare('INSERT INTO messages (id,from_id,to_id,content) VALUES (?,?,?,?)').run(id, fromId, toUserId, text);
    const fu = db.prepare('SELECT fullname,photo FROM users WHERE id=?').get(fromId);
    const msg = { id, fromId, toId: toUserId, content: text, fullname: fu.fullname, photo: fu.photo, created_at: Math.floor(Date.now() / 1000) };
    s.emit('privateMessage', msg);
    const ts = onlineUsers.get(toUserId);
    if (ts) {
      io.to(ts).emit('privateMessage', msg);
      io.to(ts).emit('notification', { type: 'message', fromId, fromName: fu.fullname, fromPhoto: fu.photo, content: text });
    }
    emitCount(toUserId);
  });

  s.on('disconnect', () => {
    const uid = socketUsers.get(s.id);
    if (uid) { onlineUsers.delete(uid); socketUsers.delete(s.id); }
    delete players[s.id];
    io.emit('playerLeft', s.id);
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', players: Object.keys(players).length, uptime: process.uptime() }));

server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Skver v7.2 running on :3000'));
